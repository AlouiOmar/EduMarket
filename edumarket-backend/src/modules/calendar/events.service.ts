import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { isValidTimeZone } from '../../common/timezone.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { canManageCourse } from '../courses/service.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { Exam, ExamRegistration } from '../exams/models.js';
import { Message, Conversation } from '../messaging/models.js';
import { createNotification } from '../notifications/service.js';
import { TutoringSession } from '../sessions/model.js';
import { CalendarConnection, CalendarEventModel } from './models.js';
import { canInvite, conflictDetails, findConflicts, parseEventInstant } from './rules.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const MAX_EVENT_MS = 14 * 86_400_000;

export const eventInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  type: z.enum(['appointment', 'meeting', 'personal', 'other']).default('personal'),
  start: z.string().trim().max(40),
  end: z.string().trim().max(40),
  timeZone: z.string().trim().max(64).refine(isValidTimeZone, 'INVALID_TIMEZONE'),
  allDay: z.boolean().default(false),
  mode: z.enum(['online', 'in_person', 'none']).default('none'),
  location: z.string().trim().max(300).default(''),
  // A pasted link stays a link: it never counts as a Teams or Google synchronisation.
  meetingUrl: z.union([z.literal(''), z.string().trim().url().max(1000).refine(value => value.startsWith('https://'), 'HTTPS_REQUIRED')]).default(''),
  participantIds: z.array(objectId).max(50).default([]),
  courseId: z.union([z.null(), objectId]).default(null),
  reminderMinutes: z.array(z.number().int().min(0).max(40_320)).max(3).default([]),
  destination: z.object({ provider: z.enum(['edumarket', 'google', 'microsoft']), calendarId: z.string().trim().max(512).default('') }).default({ provider: 'edumarket', calendarId: '' }),
  teamsMeeting: z.boolean().default(false),
  sendExternalInvites: z.boolean().default(false),
  notifyParticipants: z.boolean().default(false),
  allowOverlap: z.boolean().default(false),
  sourceMessageId: z.union([z.null(), objectId]).default(null),
}).strict();
export const eventUpdateInput = eventInput.partial().extend({ expectedRevision: z.number().int().min(0) }).strict();

type Actor = { id: string; role: string };
type EventDoc = InstanceType<typeof CalendarEventModel>;
const sameId = (left: unknown, right: unknown) => String(left) === String(right);

function eventWindow(start: string, end: string, timeZone: string) {
  const startAt = parseEventInstant(start, timeZone), endAt = parseEventInstant(end, timeZone);
  if (endAt <= startAt || endAt.getTime() - startAt.getTime() > MAX_EVENT_MS) throw new AppError(400, 'INVALID_EVENT_TIME');
  return { start: startAt, end: endAt };
}

async function assertCourseContext(actor: Actor, courseId: string | null) {
  if (!courseId) return;
  const course = await Course.findById(courseId).select('teacherId coOwnerIds').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (await canManageCourse({ userId: actor.id, role: actor.role as never }, course.teacherId, course.coOwnerIds)) return;
  if (await Enrollment.exists(activeAccess({ studentId: actor.id, courseId }))) return;
  throw new AppError(404, 'COURSE_NOT_FOUND');
}

/** The message must belong to a conversation of the actor: a suggestion never reaches someone else's messages. */
async function assertSourceMessage(actor: Actor, messageId: string | null) {
  if (!messageId) return;
  const message = await Message.findById(messageId).select('conversationId').lean();
  const conversation = message && await Conversation.findById(message.conversationId).select('participants').lean();
  if (!conversation || !conversation.participants.some(participant => sameId(participant, actor.id))) throw new AppError(404, 'MESSAGE_NOT_FOUND');
}

async function assertParticipants(actor: Actor, ids: string[], previous: string[] = []) {
  for (const id of new Set(ids)) {
    if (previous.includes(id)) continue;
    if (!await User.exists({ _id: id, status: 'active' }) || !await canInvite(actor, id)) throw new AppError(404, 'PARTICIPANT_NOT_FOUND');
  }
}

async function destinationLink(actor: Actor, destination: { provider: string; calendarId: string }, teamsMeeting: boolean, sendInvites: boolean) {
  if (destination.provider === 'edumarket') {
    if (teamsMeeting) throw new AppError(400, 'TEAMS_REQUIRES_MICROSOFT_CALENDAR');
    return undefined;
  }
  const connection = await CalendarConnection.findOne({ userId: actor.id, provider: destination.provider }).lean();
  if (!connection || connection.status === 'expired') throw new AppError(409, 'CALENDAR_CONNECTION_REQUIRED');
  if (connection.syncMode === 'read_only' || connection.access !== 'write') throw new AppError(409, 'CALENDAR_READ_ONLY');
  const calendarId = destination.calendarId || connection.defaultCalendarId;
  const calendar = connection.calendars.find(entry => entry.id === calendarId);
  if (!calendar || !calendar.canEdit) throw new AppError(409, 'CALENDAR_READ_ONLY');
  if (teamsMeeting && (destination.provider !== 'microsoft' || !calendar.teamsAvailable)) throw new AppError(409, 'TEAMS_NOT_AVAILABLE');
  return { connectionId: connection._id, provider: destination.provider, calendarId, state: 'pending', sendInvites, teamsMeeting };
}

async function assertNoOverlap(actor: Actor, participantIds: string[], start: Date, end: Date, allowOverlap: boolean, excludeEventId?: string) {
  if (allowOverlap) return;
  const conflicts = await findConflicts(actor.id, [actor.id, ...participantIds], start, end, { eventId: excludeEventId });
  // Personal events may legitimately overlap: the user is told and can confirm with `allowOverlap`.
  if (conflicts.length) throw new AppError(409, 'EVENT_CONFLICT', 'EVENT_CONFLICT', conflictDetails(conflicts));
}

async function inviteParticipants(event: EventDoc, actorName: string) {
  const now = new Date();
  for (const participant of event.participants) {
    if (participant.invitedAt) continue;
    participant.invitedAt = now;
    void createNotification({ userId: String(participant.userId), type: 'session', title: 'Calendar invitation', message: `${actorName} invited you to "${event.title}".`, link: '/calendar', template: { key: 'calendarInvitation', params: { name: actorName, title: event.title } } }).catch(() => undefined);
  }
}

function notifyInvited(event: EventDoc, key: 'calendarEventUpdated' | 'calendarEventCancelled') {
  for (const participant of event.participants) {
    if (!participant.invitedAt || participant.status === 'declined') continue;
    void createNotification({ userId: String(participant.userId), type: 'session', title: key === 'calendarEventCancelled' ? 'Event cancelled' : 'Event updated', message: `"${event.title}" ${key === 'calendarEventCancelled' ? 'was cancelled' : 'was changed'}.`, link: '/calendar', template: { key, params: { title: event.title } } }).catch(() => undefined);
  }
}

export async function createEvent(actor: Actor, raw: unknown, hooks: { push: (eventId: string) => Promise<void> }) {
  const input = eventInput.parse(raw);
  const window = eventWindow(input.start, input.end, input.timeZone);
  await assertCourseContext(actor, input.courseId);
  await assertSourceMessage(actor, input.sourceMessageId);
  await assertParticipants(actor, input.participantIds);
  const external = await destinationLink(actor, input.destination, input.teamsMeeting, input.sendExternalInvites);
  await assertNoOverlap(actor, input.participantIds, window.start, window.end, input.allowOverlap);
  const event = new CalendarEventModel({
    ownerId: actor.id, source: 'edumarket', title: input.title, description: input.description, type: input.type, ...window, allDay: input.allDay, timeZone: input.timeZone,
    mode: input.mode, location: input.mode === 'in_person' ? input.location : '', meetingUrl: input.mode === 'online' ? input.meetingUrl : '',
    participants: [...new Set(input.participantIds)].map(userId => ({ userId, status: 'pending' })), courseId: input.courseId,
    reminderMinutes: [...new Set(input.reminderMinutes)], sourceMessageId: input.sourceMessageId, external,
  });
  if (input.notifyParticipants) await inviteParticipants(event, (await User.findById(actor.id).select('name').lean())?.name || 'EduMarket');
  await event.save();
  if (external) await hooks.push(String(event._id));
  return CalendarEventModel.findById(event._id).lean();
}

/** Owner edits; imported events only when the connection is two-way and the calendar writable. */
export async function loadEditableEvent(actor: Actor, eventId: string) {
  if (!mongoose.isValidObjectId(eventId)) throw new AppError(404, 'EVENT_NOT_FOUND');
  const event = await CalendarEventModel.findOne({ _id: eventId, ownerId: actor.id });
  if (!event) {
    if (await CalendarEventModel.exists({ _id: eventId, 'participants.userId': actor.id })) throw new AppError(403, 'EVENT_READ_ONLY');
    throw new AppError(404, 'EVENT_NOT_FOUND');
  }
  if (event.source !== 'edumarket') {
    const connection = await CalendarConnection.findById(event.external?.connectionId).lean();
    const calendar = connection?.calendars.find(entry => entry.id === event.external?.calendarId);
    if (event.readOnly || !connection || connection.syncMode !== 'two_way' || connection.access !== 'write' || !calendar?.canEdit) throw new AppError(403, 'EVENT_READ_ONLY');
  }
  return event;
}

export async function updateEvent(actor: Actor, eventId: string, raw: unknown, hooks: { push: (eventId: string) => Promise<void> }) {
  const input = eventUpdateInput.parse(raw);
  const event = await loadEditableEvent(actor, eventId);
  if (event.revision !== input.expectedRevision) throw new AppError(409, 'EVENT_REVISION_CONFLICT');
  if (event.status === 'cancelled') throw new AppError(409, 'EVENT_CANCELLED');
  if (event.source !== 'edumarket' && (input.participantIds?.length || input.destination || input.teamsMeeting)) throw new AppError(400, 'EXTERNAL_EVENT_FIELDS_READ_ONLY');
  if (input.destination && !(input.destination.provider === (event.external?.provider || 'edumarket') && (!input.destination.calendarId || input.destination.calendarId === (event.external?.calendarId || '')))) throw new AppError(400, 'EVENT_DESTINATION_IMMUTABLE');
  const timeZone = input.timeZone || event.timeZone;
  const timeChanged = input.start !== undefined || input.end !== undefined || input.timeZone !== undefined;
  const window = timeChanged ? eventWindow(input.start ?? event.start.toISOString(), input.end ?? event.end.toISOString(), timeZone) : { start: event.start, end: event.end };
  if (input.courseId !== undefined) await assertCourseContext(actor, input.courseId);
  const previous = event.participants.map(participant => String(participant.userId));
  if (input.participantIds) await assertParticipants(actor, input.participantIds, previous);
  const participantIds = input.participantIds ?? previous;
  if (timeChanged) await assertNoOverlap(actor, participantIds, window.start, window.end, !!input.allowOverlap, String(event._id));

  for (const key of ['title', 'description', 'type', 'allDay', 'mode', 'courseId'] as const) if (input[key] !== undefined) event.set(key, input[key]);
  if (input.location !== undefined || input.mode !== undefined) event.location = event.mode === 'in_person' ? (input.location ?? event.location) : '';
  if (input.meetingUrl !== undefined || input.mode !== undefined) event.meetingUrl = event.mode === 'online' ? (input.meetingUrl ?? event.meetingUrl) : '';
  if (input.reminderMinutes) { event.reminderMinutes = [...new Set(input.reminderMinutes)]; event.remindersSent = []; }
  if (input.sendExternalInvites !== undefined && event.external) event.external.sendInvites = input.sendExternalInvites;
  Object.assign(event, window, { timeZone });
  if (timeChanged) event.remindersSent = [];
  if (input.participantIds) {
    const kept = event.participants.filter(participant => participantIds.includes(String(participant.userId)));
    const added = participantIds.filter(id => !previous.includes(id)).map(userId => ({ userId, status: 'pending' }));
    event.set('participants', [...kept, ...added]);
  }
  event.revision += 1;
  if (event.external && event.external.state !== 'conflict') event.external.state = 'pending';
  if (input.notifyParticipants) await inviteParticipants(event, (await User.findById(actor.id).select('name').lean())?.name || 'EduMarket');
  const { _id, createdAt: _createdAt, updatedAt: _updatedAt, ...changes } = event.toObject();
  const saved = await CalendarEventModel.findOneAndUpdate({ _id, revision: input.expectedRevision }, { $set: changes }, { new: true });
  if (!saved) throw new AppError(409, 'EVENT_REVISION_CONFLICT');
  if (timeChanged || input.title !== undefined) notifyInvited(event, 'calendarEventUpdated');
  if (saved.external) await hooks.push(String(saved._id));
  return CalendarEventModel.findById(saved._id).lean();
}

/**
 * Deletes an event. One that invited participants were told about is kept as cancelled so they see it; the provider copy is
 * removed first and a provider failure leaves the event untouched.
 */
export async function deleteEvent(actor: Actor, eventId: string, hooks: { remove: (event: EventDoc) => Promise<void> }) {
  const event = await loadEditableEvent(actor, eventId);
  if (event.external?.eventId) await hooks.remove(event);
  if (event.participants.some(participant => participant.invitedAt) && event.source === 'edumarket') {
    await CalendarEventModel.updateOne({ _id: event._id }, { $set: { status: 'cancelled', 'external.state': 'synced' }, $inc: { revision: 1 } });
    notifyInvited(event, 'calendarEventCancelled');
    return;
  }
  await CalendarEventModel.deleteOne({ _id: event._id });
}

export async function respondToEvent(actor: Actor, eventId: string, status: 'accepted' | 'declined') {
  if (!mongoose.isValidObjectId(eventId)) throw new AppError(404, 'EVENT_NOT_FOUND');
  const updated = await CalendarEventModel.findOneAndUpdate(
    { _id: eventId, status: 'confirmed', participants: { $elemMatch: { userId: actor.id, invitedAt: { $ne: null } } } },
    { $set: { 'participants.$.status': status, 'participants.$.respondedAt': new Date() } }, { new: true },
  );
  if (!updated) throw new AppError(404, 'EVENT_NOT_FOUND');
  const name = (await User.findById(actor.id).select('name').lean())?.name || '';
  void createNotification({ userId: String(updated.ownerId), type: 'session', title: `Invitation ${status}`, message: `${name} ${status} "${updated.title}".`, link: '/calendar', template: { key: status === 'accepted' ? 'calendarInvitationAccepted' : 'calendarInvitationDeclined', params: { name, title: updated.title } } }).catch(() => undefined);
  return updated.toObject();
}

export interface FeedPermissions { edit: boolean; move: boolean; resize: boolean; delete: boolean; respond: boolean }
const none: FeedPermissions = { edit: false, move: false, resize: false, delete: false, respond: false };

/**
 * Everything the user's calendar shows between `from` and `to`: tutoring sessions (and a teacher's open slots), exams, course
 * programme, EduMarket events they own or are invited to, and events of their visible connected calendars. Each item says what
 * the user may do with it; the API enforces the same rules again on every write.
 */
export async function calendarFeed(actor: Actor, from: Date, to: Date) {
  const userId = actor.id;
  const [sessions, events, registrations, connections] = await Promise.all([
    TutoringSession.find({ startAt: { $lt: to }, endAt: { $gt: from }, $or: [{ teacherId: userId }, { studentId: userId, status: { $ne: 'available' } }] })
      .sort({ startAt: 1 }).limit(1000).populate('teacherId', 'name').populate('studentId', 'name').lean(),
    CalendarEventModel.find({ start: { $lt: to }, end: { $gt: from }, $or: [{ ownerId: userId }, { participants: { $elemMatch: { userId, invitedAt: { $ne: null } } } }] })
      .sort({ start: 1 }).limit(2000).populate('participants.userId', 'name').populate('ownerId', 'name').lean(),
    ExamRegistration.find({ studentId: userId }).select('examId').lean(),
    CalendarConnection.find({ userId }).select('provider syncMode access calendars.id calendars.canEdit calendars.selected calendars.name').lean(),
  ]);
  const exams = await Exam.find({ _id: { $in: registrations.map(row => row.examId) }, date: { $gte: from, $lt: to } }).select('title type date durationMinutes location').lean();
  const enrolledIds = await Enrollment.find(activeAccess({ studentId: userId })).distinct('courseId');
  const courses = await Course.find({ $or: [{ _id: { $in: enrolledIds }, status: 'published', accessState: { $ne: 'private' } }, { teacherId: userId }, { coOwnerIds: userId }], 'syllabus.startsAt': { $gte: from, $lt: to } }).select('title syllabus').limit(200).lean();
  const now = new Date();
  const feed: Record<string, unknown>[] = [];

  for (const session of sessions) {
    const teacher = session.teacherId as unknown as { _id: unknown; name: string }, student = session.studentId as unknown as { _id: unknown; name: string } | null;
    const isTeacher = sameId(teacher?._id, userId);
    // A checkout in progress holds the teacher's slot (shown to them as awaiting payment); the student sees it once paid.
    if (!isTeacher && session.status === 'pending' && session.paymentStatus === 'awaiting_payment') continue;
    const future = session.startAt > now;
    const ownProposal = session.status === 'pending' && session.proposedBy === 'teacher';
    const movable = isTeacher && future && (session.status === 'available' || ownProposal);
    feed.push({
      id: `session-${session._id}`, kind: 'session', sourceId: String(session._id), calendarKey: session.status === 'pending' ? 'pending' : session.status === 'available' ? 'slots' : 'sessions',
      title: session.subject || (session.status === 'available' ? 'Open slot' : 'Tutoring session'), subject: session.subject || '', description: session.notes || '',
      start: session.startAt, end: session.endAt, allDay: false, timeZone: session.timeZone || null, status: session.status, type: 'tutoring', mode: session.type,
      location: session.type === 'in_person' ? session.venue : '', price: session.price, paymentStatus: session.paymentStatus, proposedBy: session.proposedBy || null,
      counterpart: isTeacher ? student?.name || '' : teacher?.name || '', participants: student ? [{ id: String(student._id), name: student.name, status: session.status }] : [],
      owner: { id: String(teacher?._id), name: teacher?.name || '' }, isOwner: isTeacher,
      permissions: { ...none, move: movable, resize: movable, edit: movable, delete: isTeacher && session.status === 'available' && future, respond: !isTeacher && ownProposal && future },
    });
  }

  const writable = new Map(connections.map(connection => [String(connection._id), connection]));
  for (const event of events) {
    const owner = event.ownerId as unknown as { _id: unknown; name: string };
    const isOwner = sameId(owner?._id, userId);
    let canWrite = isOwner && event.status === 'confirmed';
    if (canWrite && event.source !== 'edumarket') {
      const connection = writable.get(String(event.external?.connectionId));
      const calendar = connection?.calendars.find(entry => entry.id === event.external?.calendarId);
      canWrite = !event.readOnly && connection?.syncMode === 'two_way' && connection.access === 'write' && !!calendar?.canEdit;
      if (!calendar?.selected) continue;
    }
    const mine = event.participants.find(participant => sameId((participant.userId as unknown as { _id: unknown })?._id, userId));
    feed.push({
      id: `event-${event._id}`, kind: event.source === 'edumarket' ? 'event' : 'external', sourceId: String(event._id),
      calendarKey: event.source === 'edumarket' ? (event.external ? `${event.external.provider}:${event.external.calendarId}` : 'personal') : `${event.source}:${event.external?.calendarId}`,
      title: event.title, description: event.description, start: event.start, end: event.end, allDay: event.allDay, timeZone: event.timeZone, status: event.status, type: event.type,
      mode: event.mode, location: event.location, meetingUrl: event.meetingUrl, teamsJoinUrl: event.teamsJoinUrl, courseId: event.courseId ? String(event.courseId) : null,
      reminderMinutes: event.reminderMinutes, revision: event.revision, source: event.source,
      counterpart: isOwner ? '' : owner?.name || '', owner: { id: String(owner?._id), name: owner?.name || '' }, isOwner, myStatus: mine?.status || null,
      participants: event.participants.map(participant => { const user = participant.userId as unknown as { _id: unknown; name: string }; return { id: String(user?._id), name: user?.name || '', status: participant.status, invited: !!participant.invitedAt }; }),
      sync: event.external ? { provider: event.external.provider, calendarId: event.external.calendarId, state: event.external.state, error: event.external.error || null, teamsRequested: event.external.teamsMeeting, hasConflict: event.external.state === 'conflict' } : null,
      permissions: { edit: canWrite, move: canWrite && !event.allDay, resize: canWrite && !event.allDay, delete: canWrite, respond: !isOwner && !!mine && event.status === 'confirmed' },
    });
  }

  for (const exam of exams) feed.push({
    id: `exam-${exam._id}`, kind: 'exam', sourceId: String(exam._id), calendarKey: 'exams', title: exam.title, description: '', start: exam.date, end: new Date(exam.date!.getTime() + exam.durationMinutes * 60_000),
    allDay: false, timeZone: null, status: 'registered', type: 'exam', mode: exam.type, location: exam.type === 'in_person' ? [exam.location?.venue, exam.location?.city].filter(Boolean).join(', ') : '',
    counterpart: '', participants: [], isOwner: false, permissions: none,
  });
  for (const course of courses) for (const entry of course.syllabus || []) {
    if (!entry.startsAt || entry.startsAt < from || entry.startsAt >= to) continue;
    feed.push({
      id: `course-${course._id}-${entry.id}`, kind: 'course', sourceId: String(course._id), calendarKey: 'course', title: entry.title || course.title, description: entry.description || '',
      start: entry.startsAt, end: new Date(entry.startsAt.getTime() + (entry.durationMinutes || 0) * 60_000), allDay: false, timeZone: null, status: 'scheduled', type: 'course', mode: 'in_person',
      location: '', counterpart: course.title, participants: [], isOwner: false, permissions: none,
    });
  }
  return feed.sort((left, right) => (left.start as Date).getTime() - (right.start as Date).getTime());
}

/** In-app reminders of EduMarket events (owner and accepted participants), each offset sent once. */
export async function sendDueEventReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + 40_320 * 60_000);
  const events = await CalendarEventModel.find({ status: 'confirmed', source: 'edumarket', start: { $gt: now, $lte: horizon }, 'reminderMinutes.0': { $exists: true } })
    .select('ownerId title start reminderMinutes remindersSent participants').limit(500).lean();
  for (const event of events) {
    const due = event.reminderMinutes.filter(minutes => !event.remindersSent.includes(minutes) && event.start.getTime() - minutes * 60_000 <= now.getTime());
    if (!due.length) continue;
    // Claim the offsets first so two API instances never remind twice.
    const claimed = await CalendarEventModel.updateOne({ _id: event._id, remindersSent: { $nin: due } }, { $addToSet: { remindersSent: { $each: due } } });
    if (!claimed.modifiedCount) continue;
    const recipients = [String(event.ownerId), ...event.participants.filter(participant => participant.status === 'accepted').map(participant => String(participant.userId))];
    for (const userId of recipients) void createNotification({ userId, type: 'session', title: 'Upcoming event', message: `"${event.title}" starts soon.`, link: '/calendar', template: { key: 'calendarReminder', params: { title: event.title, start: event.start.toISOString() } } }).catch(() => undefined);
  }
}
