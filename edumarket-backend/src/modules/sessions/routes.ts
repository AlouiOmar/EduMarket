import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { TeacherScheduleLock, TutoringSession } from './model.js';
import { createNotification } from '../notifications/service.js';
import { SessionReview } from './review.model.js';
import { env } from '../../config/env.js';
import { refundCancelledSession } from '../payments/service.js';
import { Order } from '../payments/models.js';
import { removeSessionFromCalendars, syncConfirmedSession } from '../calendar/service.js';
import { canInvite, findConflicts, parseEventInstant } from '../calendar/rules.js';

export const sessionRoutes = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i);
const isoDate = z.string().datetime({ offset: true });
// Times: ISO instants with offset (existing clients) or wall-clock values of `timeZone` sent by the calendar.
const slotTime = z.string().trim().max(40);
const timeZoneInput = z.string().trim().max(64).optional();
const availabilityInput = z.object({ startAt: slotTime, endAt: slotTime, timeZone: timeZoneInput, type: z.enum(['online', 'in_person']), price: z.number().min(0).max(100000), venue: z.string().trim().max(200).optional(), subject: z.string().trim().max(160).optional(), notes: z.string().trim().max(2000).optional() }).strict();
const slotWindow = (input: { startAt: string; endAt: string; timeZone?: string }) => {
  const zone = input.timeZone || 'UTC';
  const startAt = parseEventInstant(input.startAt, zone), endAt = parseEventInstant(input.endAt, zone);
  if (startAt <= new Date() || endAt <= startAt || endAt.getTime() - startAt.getTime() > 4 * 60 * 60 * 1000) throw new AppError(400, 'INVALID_SESSION_TIME');
  return { startAt, endAt, timeZone: input.timeZone || undefined };
};
const requireVerifiedTeacher = async (userId: string) => {
  const teacher = await User.findById(userId).select('role teacherVerification.status');
  if (!teacher || teacher.role !== 'teacher' || teacher.get('teacherVerification.status') !== 'approved') throw new AppError(403, 'VERIFIED_TEACHER_REQUIRED');
};
/** Same rule as availability: one teacher never has two active sessions or slots at the same time. */
const assertTeacherFree = async (teacherId: string, startAt: Date, endAt: Date, excludeId?: unknown) => {
  const collision = await TutoringSession.findOne({ teacherId, ...(excludeId ? { _id: { $ne: excludeId } } : {}), status: { $nin: ['rejected', 'cancelled'] }, startAt: { $lt: endAt }, endAt: { $gt: startAt } }).select('_id startAt endAt status subject').lean();
  if (collision) throw new AppError(409, 'SESSION_TIME_CONFLICT', 'SESSION_TIME_CONFLICT', { conflicts: [{ kind: 'session', id: String(collision._id), title: collision.subject || undefined, start: collision.startAt, end: collision.endAt, mine: true }] });
};
const sessionDto = ({ googleEventIds: _calendarEvents, ...session }: any) => ({
  ...session,
  meetingUrl: session.status === 'confirmed' && session.type === 'online' && session.jitsiRoomId && env.JITSI_BASE_URL
    ? `${env.JITSI_BASE_URL.replace(/\/$/, '')}/${encodeURIComponent(session.jitsiRoomId)}`
    : undefined,
});
const acquireTeacherScheduleLock = async (teacherId: string) => {
  const token = randomBytes(18).toString('hex');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const lock = await TeacherScheduleLock.findOneAndUpdate(
        { _id: teacherId, $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: { $exists: false } }] },
        { $set: { token, expiresAt: new Date(Date.now() + 60_000) } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (lock) return token;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new AppError(409, 'SESSION_SCHEDULE_BUSY');
};
sessionRoutes.get('/availability', async (req, res, next) => {
  try {
    const query = z.object({ teacherId: id.optional(), from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const filter: Record<string, unknown> = { status: 'available', startAt: { $gt: new Date() } };
    if (query.teacherId) filter.teacherId = query.teacherId;
    if (query.from || query.to) filter.startAt = { $gt: new Date(), ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
    const slots = await TutoringSession.find(filter).sort({ startAt: 1 }).limit(100).populate('teacherId', 'name').lean();
    res.json({ success: true, data: slots });
  } catch (error) { next(error); }
});
sessionRoutes.use(authenticate);
sessionRoutes.get('/', allowRoles('student', 'teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const filter = req.auth!.role === 'teacher' ? { teacherId: req.auth!.userId } : req.auth!.role === 'admin' ? {} : { studentId: req.auth!.userId };
    if (!['student', 'teacher', 'admin'].includes(req.auth!.role)) throw new AppError(403, 'FORBIDDEN');
    const sessions = await TutoringSession.find(filter).sort({ startAt: -1 }).populate('teacherId', 'name').populate('studentId', 'name').lean();
    if (req.auth!.role === 'student' && sessions.length) {
      const reviews = await SessionReview.find({ studentId: req.auth!.userId, sessionId: { $in: sessions.map(session => session._id) } }).lean();
      const reviewMap = new Map(reviews.map(review => [String(review.sessionId), { id: String(review._id), rating: review.rating, comment: review.comment, createdAt: review.createdAt }]));
      res.json({ success: true, data: sessions.map(session => ({ ...sessionDto(session), review: reviewMap.get(String(session._id)) || null })) });
      return;
    }
    res.json({ success: true, data: sessions.map(sessionDto) });
  } catch (error) { next(error); }
});
sessionRoutes.put('/:sessionId/review', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId);
    if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    const session = await TutoringSession.findOne({ _id: sessionId.data, studentId: req.auth!.userId, status: 'completed' }).select('_id');
    if (!session) {
      if (!await TutoringSession.exists({ _id: sessionId.data })) throw new AppError(404, 'SESSION_NOT_FOUND');
      throw new AppError(403, 'SESSION_REVIEW_NOT_ALLOWED');
    }
    const review = await SessionReview.findOneAndUpdate(
      { sessionId: session._id, studentId: req.auth!.userId }, { $set: input },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: { id: String(review._id), rating: review.rating, comment: review.comment, createdAt: review.createdAt } });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return next(new AppError(409, 'SESSION_REVIEW_CONFLICT'));
    next(error);
  }
});
sessionRoutes.post('/availability', allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    await requireVerifiedTeacher(req.auth!.userId);
    const input = availabilityInput.parse(req.body), { startAt, endAt, timeZone } = slotWindow(input);
    const lockToken = await acquireTeacherScheduleLock(req.auth!.userId);
    try {
      await assertTeacherFree(req.auth!.userId, startAt, endAt);
      // Optional label of the slot (topic, level…); a booking request replaces the subject with the student's own.
      const slot = await TutoringSession.create({ teacherId: req.auth!.userId, startAt, endAt, timeZone, type: input.type, price: input.price, venue: input.venue || '', subject: input.subject || '', notes: input.notes || '' });
      res.status(201).json({ success: true, data: slot });
    } finally {
      await TeacherScheduleLock.deleteOne({ _id: req.auth!.userId, token: lockToken }).catch(() => undefined);
    }
  } catch (error) { if ((error as { code?: number }).code === 11000) return next(new AppError(409, 'SESSION_TIME_CONFLICT')); next(error); }
});
/**
 * A teacher proposes a free session to one of their students (from the calendar or from a chat suggestion). It starts as
 * `pending` with `proposedBy: 'teacher'`: only the student can accept (confirm) or decline it. Paid sessions keep going through
 * published slots and checkout, so a proposal is always free.
 */
sessionRoutes.post('/proposals', allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    await requireVerifiedTeacher(req.auth!.userId);
    const input = z.object({ studentId: id, startAt: slotTime, endAt: slotTime, timeZone: timeZoneInput, type: z.enum(['online', 'in_person']), venue: z.string().trim().max(200).optional(), subject: z.string().trim().min(1).max(160), notes: z.string().trim().max(2000).optional(), allowOverlap: z.boolean().default(false) }).strict().parse(req.body);
    const { startAt, endAt, timeZone } = slotWindow(input);
    const student = await User.findOne({ _id: input.studentId, role: 'student', status: 'active' }).select('_id').lean();
    if (!student || !await canInvite({ id: req.auth!.userId, role: 'teacher' }, input.studentId)) throw new AppError(404, 'STUDENT_NOT_FOUND');
    const lockToken = await acquireTeacherScheduleLock(req.auth!.userId);
    try {
      await assertTeacherFree(req.auth!.userId, startAt, endAt);
      // The student's own agenda is a warning the teacher can override; details of it are never disclosed.
      const studentBusy = (await findConflicts(req.auth!.userId, [input.studentId], startAt, endAt)).length > 0;
      if (studentBusy && !input.allowOverlap) throw new AppError(409, 'PARTICIPANT_BUSY', 'PARTICIPANT_BUSY', { conflicts: [{ kind: 'participant', userId: input.studentId, start: startAt, end: endAt, mine: false }] });
      const session = await TutoringSession.create({ teacherId: req.auth!.userId, studentId: input.studentId, startAt, endAt, timeZone, type: input.type, price: 0, venue: input.venue || '', subject: input.subject, notes: input.notes || '', status: 'pending', proposedBy: 'teacher' });
      void createNotification({ userId: input.studentId, type: 'session', title: 'Tutoring session proposed', message: 'A teacher proposed a tutoring session to you.', link: '/calendar', template: { key: 'sessionProposed' } }).catch(() => undefined);
      res.status(201).json({ success: true, data: sessionDto(session.toObject()) });
    } finally {
      await TeacherScheduleLock.deleteOne({ _id: req.auth!.userId, token: lockToken }).catch(() => undefined);
    }
  } catch (error) { if ((error as { code?: number }).code === 11000) return next(new AppError(409, 'SESSION_TIME_CONFLICT')); next(error); }
});
/**
 * Moves or resizes, from the calendar, a session nobody has committed to yet: an open slot, or the teacher's own pending
 * proposal (the student is notified). Booked or confirmed sessions keep the reschedule flow, which carries payments over.
 */
sessionRoutes.patch('/:sessionId/time', allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    await requireVerifiedTeacher(req.auth!.userId);
    const input = z.object({ startAt: slotTime, endAt: slotTime, timeZone: timeZoneInput }).strict().parse(req.body);
    const { startAt, endAt, timeZone } = slotWindow(input);
    const current = await TutoringSession.findOne({ _id: sessionId.data, teacherId: req.auth!.userId }).lean();
    if (!current) throw new AppError(404, 'SESSION_NOT_FOUND');
    const movable = current.status === 'available' || (current.status === 'pending' && current.proposedBy === 'teacher');
    if (!movable || current.startAt <= new Date()) throw new AppError(409, 'SESSION_NOT_MOVABLE');
    const lockToken = await acquireTeacherScheduleLock(req.auth!.userId);
    try {
      await assertTeacherFree(req.auth!.userId, startAt, endAt, current._id);
      const updated = await TutoringSession.findOneAndUpdate({ _id: current._id, status: current.status, startAt: current.startAt }, { $set: { startAt, endAt, ...(timeZone ? { timeZone } : {}) } }, { new: true });
      if (!updated) throw new AppError(409, 'SESSION_STATUS_CONFLICT');
      if (updated.studentId) void createNotification({ userId: String(updated.studentId), type: 'session', title: 'Tutoring session rescheduled', message: 'A tutoring session you participate in was moved to a new time.', link: '/calendar', template: { key: 'sessionRescheduled' } }).catch(() => undefined);
      res.json({ success: true, data: sessionDto(updated.toObject()) });
    } finally {
      await TeacherScheduleLock.deleteOne({ _id: req.auth!.userId, token: lockToken }).catch(() => undefined);
    }
  } catch (error) { if ((error as { code?: number }).code === 11000) return next(new AppError(409, 'SESSION_TIME_CONFLICT')); next(error); }
});
/** Removes an open slot nobody booked (no history to keep); booked sessions are cancelled through the status route instead. */
sessionRoutes.delete('/:sessionId', allowRoles('teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    if (req.auth!.role === 'teacher') await requireVerifiedTeacher(req.auth!.userId);
    const deleted = await TutoringSession.deleteOne({ _id: sessionId.data, ...(req.auth!.role === 'admin' ? {} : { teacherId: req.auth!.userId }), status: 'available', studentId: null, orderId: null });
    if (!deleted.deletedCount) {
      if (!await TutoringSession.exists({ _id: sessionId.data, ...(req.auth!.role === 'admin' ? {} : { teacherId: req.auth!.userId }) })) throw new AppError(404, 'SESSION_NOT_FOUND');
      throw new AppError(409, 'SESSION_NOT_DELETABLE');
    }
    res.status(204).end();
  } catch (error) { next(error); }
});
sessionRoutes.post('/:sessionId/book', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    const input = z.object({ subject: z.string().trim().min(1).max(160), notes: z.string().trim().max(2000).optional() }).strict().parse(req.body);
    // Paid slots are booked through POST /payments/checkout/sessions/:id so the price is settled before the request.
    const session = await TutoringSession.findOneAndUpdate({ _id: sessionId.data, status: 'available', price: 0, startAt: { $gt: new Date() }, teacherId: { $ne: req.auth!.userId } }, { $set: { studentId: req.auth!.userId, subject: input.subject, notes: input.notes || '', status: 'pending' } }, { new: true });
    if (!session) {
      if (await TutoringSession.exists({ _id: sessionId.data, status: 'available', price: { $gt: 0 } })) throw new AppError(402, 'PAYMENT_REQUIRED');
      throw new AppError(409, 'SESSION_UNAVAILABLE');
    }
    void createNotification({ userId: String(session.teacherId), type: 'session', title: 'New tutoring request', message: 'A student requested one of your tutoring slots.', link: '/teacher/tutoring', template: { key: 'tutoringRequest' } }).catch(() => undefined);
    res.status(201).json({ success: true, data: session });
  } catch (error) { next(error); }
});
/**
 * Moves a booked session (pending or confirmed, not awaiting payment) to another open slot of the same teacher with the
 * same type and price, so payments carry over unchanged. A student's request goes back to `pending` for the teacher;
 * a move made by the teacher or an admin stays confirmed. The original slot is released for other students.
 */
sessionRoutes.post('/:sessionId/reschedule', allowRoles('student', 'teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    const { targetSessionId } = z.object({ targetSessionId: id }).strict().parse(req.body);
    const role = req.auth!.role;
    if (role === 'teacher' && !await User.exists({ _id: req.auth!.userId, role: 'teacher', 'teacherVerification.status': 'approved' })) throw new AppError(403, 'VERIFIED_TEACHER_REQUIRED');
    const ownership = role === 'admin' ? {} : role === 'teacher' ? { teacherId: req.auth!.userId } : { studentId: req.auth!.userId };
    const source = await TutoringSession.findOne({ _id: sessionId.data, ...ownership, status: { $in: ['pending', 'confirmed'] }, startAt: { $gt: new Date() } });
    if (!source || !source.studentId) throw new AppError(404, 'SESSION_NOT_FOUND');
    if (source.paymentStatus === 'awaiting_payment') throw new AppError(409, 'SESSION_PAYMENT_PENDING');
    const status = role === 'student' || source.status === 'pending' ? 'pending' : 'confirmed';
    const meeting = status === 'confirmed' && source.type === 'online' && env.JITSI_BASE_URL ? randomBytes(24).toString('base64url') : '';
    const target = await TutoringSession.findOneAndUpdate(
      { _id: targetSessionId, teacherId: source.teacherId, status: 'available', startAt: { $gt: new Date() }, type: source.type, price: source.price },
      { $set: { studentId: source.studentId, subject: source.subject, notes: source.notes, status, jitsiRoomId: meeting, paymentStatus: source.paymentStatus, orderId: source.orderId } },
      { new: true },
    );
    if (!target) throw new AppError(409, 'RESCHEDULE_SLOT_UNAVAILABLE');
    const released = await TutoringSession.findOneAndUpdate(
      { _id: source._id, status: source.status, studentId: source.studentId },
      { $set: { studentId: null, subject: '', notes: '', status: 'available', jitsiRoomId: '', paymentStatus: 'not_required', orderId: null, reservationExpiresAt: null } },
    );
    if (!released) {
      await TutoringSession.updateOne({ _id: target._id, studentId: source.studentId }, { $set: { studentId: null, subject: '', notes: '', status: 'available', jitsiRoomId: '', paymentStatus: 'not_required', orderId: null } });
      throw new AppError(409, 'SESSION_STATUS_CONFLICT');
    }
    if (source.orderId) await Order.updateOne({ _id: source.orderId, items: { $elemMatch: { itemType: 'session', itemId: source._id } } }, { $set: { 'items.$.itemId': target._id } });
    void removeSessionFromCalendars(String(source._id));
    if (status === 'confirmed') void syncConfirmedSession(String(target._id));
    const recipientId = role === 'student' ? String(source.teacherId) : String(source.studentId);
    void createNotification({ userId: recipientId, type: 'session', title: 'Tutoring session rescheduled', message: 'A tutoring session you participate in was moved to a new time.', link: role === 'student' ? '/teacher/tutoring' : '/student/sessions', template: { key: 'sessionRescheduled' } }).catch(() => undefined);
    if (role === 'admin') void createNotification({ userId: String(source.teacherId), type: 'session', title: 'Tutoring session rescheduled', message: 'An administrator moved one of your tutoring sessions.', link: '/teacher/tutoring', template: { key: 'sessionRescheduledByAdmin' } }).catch(() => undefined);
    res.json({ success: true, data: sessionDto(target.toObject()) });
  } catch (error) { next(error); }
});
sessionRoutes.patch('/:sessionId/status', allowRoles('student', 'teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const sessionId = id.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    const { status } = z.object({ status: z.enum(['confirmed', 'rejected', 'cancelled', 'completed']) }).strict().parse(req.body);
    const isAdmin = req.auth!.role === 'admin';
    const isTeacher = req.auth!.role === 'teacher';
    const isStudent = req.auth!.role === 'student';
    if (isTeacher) {
      const teacher = await User.findById(req.auth!.userId).select('role teacherVerification.status');
      if (!teacher || teacher.role !== 'teacher' || teacher.get('teacherVerification.status') !== 'approved') throw new AppError(403, 'VERIFIED_TEACHER_REQUIRED');
    }
    const ownership = isAdmin ? {} : isTeacher ? { teacherId: req.auth!.userId } : isStudent ? { studentId: req.auth!.userId } : null;
    if (!ownership) throw new AppError(403, 'FORBIDDEN');
    let allowedStatuses: string[] = [];
    // A request is answered by the other side: teachers answer student bookings, students answer teacher proposals.
    let proposal: Record<string, unknown> = {};
    if (isAdmin) allowedStatuses = ['available', 'pending', 'confirmed', 'rejected', 'completed', 'cancelled'];
    else if (status === 'cancelled' && (isTeacher || isStudent)) allowedStatuses = ['pending', 'confirmed'];
    else if (isTeacher && status === 'confirmed' || isTeacher && status === 'rejected') { allowedStatuses = ['pending']; proposal = { proposedBy: { $ne: 'teacher' } }; }
    else if (isStudent && (status === 'confirmed' || status === 'rejected')) { allowedStatuses = ['pending']; proposal = { proposedBy: 'teacher' }; }
    else if (isTeacher && status === 'completed') allowedStatuses = ['confirmed'];
    else throw new AppError(403, 'FORBIDDEN');
    const canCreateMeeting = status === 'confirmed' && !!env.JITSI_BASE_URL && !!await TutoringSession.exists({ _id: sessionId.data, type: 'online' });
    if (status === 'confirmed' && await TutoringSession.exists({ _id: sessionId.data, paymentStatus: 'awaiting_payment' })) throw new AppError(409, 'SESSION_PAYMENT_PENDING');
    const updated = await TutoringSession.findOneAndUpdate({ _id: sessionId.data, ...ownership, ...proposal, status: { $in: allowedStatuses }, ...(status === 'confirmed' ? { paymentStatus: { $ne: 'awaiting_payment' } } : {}) }, { $set: { status, ...(status === 'confirmed' ? { jitsiRoomId: canCreateMeeting ? randomBytes(24).toString('base64url') : '' } : {}) } }, { new: true });
    if (!updated) {
      if (!await TutoringSession.exists({ _id: sessionId.data })) throw new AppError(404, 'SESSION_NOT_FOUND');
      throw new AppError(403, 'FORBIDDEN');
    }
    if (status === 'rejected' || status === 'cancelled') {
      await refundCancelledSession(updated);
      void removeSessionFromCalendars(String(updated._id));
    } else if (status === 'confirmed') void syncConfirmedSession(String(updated._id));
    const recipientId = isAdmin ? (String(updated.studentId || '') || String(updated.teacherId)) : isTeacher ? String(updated.studentId || '') : String(updated.teacherId);
    if (recipientId) void createNotification({ userId: recipientId, type: 'session', title: `Tutoring session ${status}`, message: 'A tutoring session you participate in has changed status.', link: '/student/sessions', template: { key: `session_${status}` } }).catch(() => undefined);
    res.json({ success: true, data: sessionDto(updated.toObject()) });
  } catch (error) { next(error); }
});
