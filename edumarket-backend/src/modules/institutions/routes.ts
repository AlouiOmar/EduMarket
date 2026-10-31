import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { InstitutionInvitation } from './model.js';
import { InstitutionProfile } from './profile.model.js';
import { createNotification } from '../notifications/service.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { toPublicCourse } from '../courses/dto.js';
import { PUBLIC_COURSE_FILTER } from '../classes/service.js';

export const institutionRoutes = Router();

async function publicInstitution(profile: any) {
  const teachers = await User.find({ institutionId: profile.ownerId, role: 'teacher', verified: true }).select('_id').lean();
  const teacherIds = [profile.ownerId, ...teachers.map(teacher => teacher._id)];
  const courseIds = await Course.find({ teacherId: { $in: teacherIds }, ...PUBLIC_COURSE_FILTER }).select('_id').lean();
  const studentIds = courseIds.length ? await Enrollment.distinct('studentId', { courseId: { $in: courseIds.map(course => course._id) } }) : [];
  return {
    id: String(profile._id), ownerId: String(profile.ownerId), name: profile.name, slug: profile.slug,
    logo: profile.logo || '', banner: profile.banner || '', description: profile.description,
    country: profile.country, city: profile.city, website: profile.website, verified: true,
    teachersCount: teachers.length, coursesCount: courseIds.length, studentsCount: studentIds.length,
    rating: 0, joinedDate: profile.createdAt, contactEmail: profile.contactEmail,
  };
}

institutionRoutes.get('/', async (_req, res, next) => {
  try {
    const eligibleOwners = await User.find({ role: 'institution', status: 'active' }).distinct('_id');
    const profiles = await InstitutionProfile.find({ status: 'approved', ownerId: { $in: eligibleOwners } }).sort({ name: 1 }).lean();
    res.json({ success: true, data: await Promise.all(profiles.map(publicInstitution)) });
  } catch (error) { next(error); }
});

institutionRoutes.get('/teachers', authenticate, allowRoles('institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const institutionId = req.auth!.role === 'admin' && typeof req.query.institutionId === 'string' ? req.query.institutionId : req.auth!.userId;
    if (!/^[a-f\d]{24}$/i.test(institutionId)) throw new AppError(400, 'VALIDATION_ERROR');
    const teachers = await User.find({ institutionId, role: 'teacher', verified: true }).select('name email headline institutionRevenueShare institutionRole').sort({ name: 1 }).lean();
    res.json({ success: true, data: teachers.map(teacher => ({ id: String(teacher._id), name: teacher.name, email: teacher.email, headline: teacher.headline, revenueSharePercent: teacher.institutionRevenueShare || 0, internalRole: teacher.institutionRole || 'teacher' })) });
  } catch (error) { next(error); }
});

institutionRoutes.get('/invitations', authenticate, allowRoles('institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const institutionId = req.auth!.role === 'admin' && typeof req.query.institutionId === 'string' ? req.query.institutionId : req.auth!.userId;
    const invitations = await InstitutionInvitation.find({ institutionId }).sort({ createdAt: -1 }).populate('teacherId', 'name email').lean();
    res.json({ success: true, data: invitations.map(invite => ({ id: String(invite._id), status: invite.status, revenueSharePercent: invite.revenueSharePercent || 0, createdAt: invite.createdAt, teacher: invite.teacherId })) });
  } catch (error) { next(error); }
});

institutionRoutes.post('/invitations', authenticate, allowRoles('institution'), async (req: AuthRequest, res, next) => {
  try {
    const { email, revenueSharePercent } = z.object({ email: z.string().email().max(254), revenueSharePercent: z.number().int().min(0).max(50).default(0) }).strict().parse(req.body);
    const teacher = await User.findOne({ email: email.toLowerCase(), role: 'teacher', verified: true }).select('_id institutionId');
    if (!teacher) throw new AppError(404, 'VERIFIED_TEACHER_NOT_FOUND');
    if (teacher.institutionId && String(teacher.institutionId) !== req.auth!.userId) throw new AppError(409, 'TEACHER_ALREADY_AFFILIATED');
    const old = await InstitutionInvitation.findOne({ institutionId: req.auth!.userId, teacherId: teacher._id });
    if (old?.status === 'pending') throw new AppError(409, 'INVITATION_ALREADY_PENDING');
    if (old?.status === 'accepted') throw new AppError(409, 'TEACHER_ALREADY_AFFILIATED');
    const invitation = old
      ? await InstitutionInvitation.findByIdAndUpdate(old._id, { status: 'pending', revenueSharePercent, respondedAt: undefined, endedAt: undefined }, { new: true })
      : await InstitutionInvitation.create({ institutionId: req.auth!.userId, teacherId: teacher._id, revenueSharePercent });
    await AuditEvent.create({ action: 'institution.teacher.invited', actorId: req.auth!.userId, targetType: 'teacher', targetId: String(teacher._id), ipAddress: req.ip });
    void createNotification({ userId: String(teacher._id), type: 'account', title: 'Institution invitation', message: 'A verified institution invited you to affiliate your teacher account.', link: '/teacher/affiliations', template: { key: 'institutionInvitation' } }).catch(() => undefined);
    res.status(201).json({ success: true, data: { id: String(invitation!._id), status: invitation!.status } });
  } catch (error) { next(error); }
});

institutionRoutes.get('/invitations/mine', authenticate, allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const invitations = await InstitutionInvitation.find({ teacherId: req.auth!.userId }).sort({ createdAt: -1 }).populate('institutionId', 'name email').lean();
    res.json({ success: true, data: invitations.map(invite => ({ id: String(invite._id), status: invite.status, revenueSharePercent: invite.revenueSharePercent || 0, createdAt: invite.createdAt, institution: invite.institutionId })) });
  } catch (error) { next(error); }
});

institutionRoutes.patch('/invitations/:invitationId', authenticate, allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const invitationId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.invitationId);
    const { decision } = z.object({ decision: z.enum(['accepted', 'rejected']) }).strict().parse(req.body);
    const invite = await InstitutionInvitation.findOne({ _id: invitationId, teacherId: req.auth!.userId, status: 'pending' });
    if (!invite) throw new AppError(404, 'PENDING_INVITATION_NOT_FOUND');
    if (decision === 'accepted') {
      const teacher = await User.findOneAndUpdate({ _id: req.auth!.userId, role: 'teacher', verified: true, $or: [{ institutionId: null }, { institutionId: { $exists: false } }, { institutionId: invite.institutionId }] }, { $set: { institutionId: invite.institutionId, institutionRevenueShare: invite.revenueSharePercent || 0, institutionRole: 'teacher' } }, { new: true });
      if (!teacher) throw new AppError(409, 'TEACHER_ALREADY_AFFILIATED');
    }
    invite.status = decision;
    invite.respondedAt = new Date();
    await invite.save();
    await AuditEvent.create({ action: `institution.teacher.invitation.${decision}`, actorId: req.auth!.userId, targetType: 'institution', targetId: String(invite.institutionId), ipAddress: req.ip });
    void createNotification({ userId: String(invite.institutionId), type: 'account', title: 'Institution invitation response', message: `A teacher ${decision} your affiliation invitation.`, link: '/institution/teachers', template: { key: decision === 'accepted' ? 'invitationAccepted' : 'invitationRejected' } }).catch(() => undefined);
    res.json({ success: true, data: { id: String(invite._id), status: invite.status } });
  } catch (error) { next(error); }
});

/** Ends an affiliation. Either party may leave; past orders keep the share snapshot taken at purchase time. */
async function endAffiliation(teacherId: string, institutionId: string, actorId: string, ip?: string) {
  const teacher = await User.findOneAndUpdate({ _id: teacherId, institutionId }, { $unset: { institutionId: '' }, $set: { institutionRevenueShare: 0, institutionRole: 'teacher' } });
  if (!teacher) throw new AppError(404, 'AFFILIATION_NOT_FOUND');
  await InstitutionInvitation.updateOne({ institutionId, teacherId, status: 'accepted' }, { $set: { status: 'ended', endedAt: new Date() } });
  await AuditEvent.create({ action: 'institution.teacher.affiliation.ended', actorId, targetType: 'teacher', targetId: teacherId, ipAddress: ip });
  const counterpart = actorId === teacherId ? institutionId : teacherId;
  void createNotification({ userId: counterpart, type: 'account', title: 'Affiliation ended', message: 'An institution affiliation has ended. Future sales are no longer shared.', link: actorId === teacherId ? '/institution/teachers' : '/teacher/affiliations', template: { key: 'affiliationEnded' } }).catch(() => undefined);
}

/**
 * Updates an affiliated teacher's internal role and/or revenue share. A new share applies to future sales only:
 * past orders keep the share snapshot taken at purchase time.
 */
institutionRoutes.patch('/teachers/:teacherId', authenticate, allowRoles('institution'), async (req: AuthRequest, res, next) => {
  try {
    const teacherId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.teacherId); if (!teacherId.success) throw new AppError(404, 'AFFILIATION_NOT_FOUND');
    const input = z.object({ internalRole: z.enum(['teacher', 'coordinator', 'examiner']).optional(), revenueSharePercent: z.number().int().min(0).max(50).optional() }).strict()
      .refine(value => Object.keys(value).length > 0, 'At least one field is required').parse(req.body);
    const update: Record<string, unknown> = {};
    if (input.internalRole) update.institutionRole = input.internalRole;
    if (input.revenueSharePercent !== undefined) update.institutionRevenueShare = input.revenueSharePercent;
    const teacher = await User.findOneAndUpdate({ _id: teacherId.data, institutionId: req.auth!.userId, role: 'teacher', verified: true }, { $set: update }, { new: true }).select('name email headline institutionRevenueShare institutionRole');
    if (!teacher) throw new AppError(404, 'AFFILIATION_NOT_FOUND');
    if (input.revenueSharePercent !== undefined) await InstitutionInvitation.updateOne({ institutionId: req.auth!.userId, teacherId: teacher._id, status: 'accepted' }, { $set: { revenueSharePercent: input.revenueSharePercent } });
    await AuditEvent.create({ action: 'institution.teacher.member.updated', actorId: req.auth!.userId, targetType: 'teacher', targetId: String(teacher._id), ipAddress: req.ip });
    void createNotification({ userId: String(teacher._id), type: 'account', title: 'Institution membership updated', message: 'Your institution updated your internal role or revenue share.', link: '/teacher/affiliations', template: { key: 'membershipUpdated' } }).catch(() => undefined);
    res.json({ success: true, data: { id: String(teacher._id), name: teacher.name, email: teacher.email, headline: teacher.headline, revenueSharePercent: teacher.institutionRevenueShare || 0, internalRole: teacher.institutionRole || 'teacher' } });
  } catch (error) { next(error); }
});

/** Current affiliation of the signed-in teacher (institution, share and internal role), or null. */
institutionRoutes.get('/affiliation/mine', authenticate, allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const teacher = await User.findById(req.auth!.userId).select('institutionId institutionRevenueShare institutionRole').populate('institutionId', 'name email').lean();
    const institution = teacher?.institutionId as any;
    res.json({ success: true, data: institution ? { institution: { id: String(institution._id), name: institution.name, email: institution.email }, revenueSharePercent: teacher!.institutionRevenueShare || 0, internalRole: teacher!.institutionRole || 'teacher' } : null });
  } catch (error) { next(error); }
});

institutionRoutes.delete('/teachers/:teacherId', authenticate, allowRoles('institution'), async (req: AuthRequest, res, next) => {
  try {
    const teacherId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.teacherId); if (!teacherId.success) throw new AppError(404, 'AFFILIATION_NOT_FOUND');
    await endAffiliation(teacherId.data, req.auth!.userId, req.auth!.userId, req.ip);
    res.status(204).end();
  } catch (error) { next(error); }
});

institutionRoutes.delete('/affiliation/mine', authenticate, allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const teacher = await User.findById(req.auth!.userId).select('institutionId').lean();
    if (!teacher?.institutionId) throw new AppError(404, 'AFFILIATION_NOT_FOUND');
    await endAffiliation(req.auth!.userId, String(teacher.institutionId), req.auth!.userId, req.ip);
    res.status(204).end();
  } catch (error) { next(error); }
});

institutionRoutes.get('/:institutionId', async (req, res, next) => {
  try {
    const routeId = String(req.params.institutionId);
    const filter = /^[a-f\d]{24}$/i.test(routeId) ? { _id: routeId, status: 'approved' } : { slug: routeId, status: 'approved' };
    const profile = await InstitutionProfile.findOne(filter).lean();
    if (!profile) throw new AppError(404, 'INSTITUTION_NOT_FOUND');
    if (!await User.exists({ _id: profile.ownerId, role: 'institution', status: 'active' })) throw new AppError(404, 'INSTITUTION_NOT_FOUND');
    const teachers = await User.find({ institutionId: profile.ownerId, role: 'teacher', verified: true }).select('_id').lean();
    const teacherIds = [profile.ownerId, ...teachers.map(teacher => teacher._id)];
    const courses = await Course.find({ teacherId: { $in: teacherIds }, ...PUBLIC_COURSE_FILTER }).sort({ updatedAt: -1 }).populate('teacherId', 'name').lean();
    res.json({ success: true, data: { institution: await publicInstitution(profile), courses: courses.map(toPublicCourse) } });
  } catch (error) { next(error); }
});
