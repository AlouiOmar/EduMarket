import mongoose from 'mongoose';
import { AppError } from '../../common/errors.js';
import { courseDate, isValidTimeZone } from '../../common/timezone.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { Conversation } from '../messaging/models.js';
import { TutoringSession } from '../sessions/model.js';
import { CalendarEventModel } from './models.js';

/**
 * A date sent by the calendar: an ISO instant with offset, or a wall-clock value ("2026-11-02T14:00") interpreted in `timeZone`
 * (DST included). Stored as a UTC instant either way.
 */
export function parseEventInstant(value: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new AppError(400, 'INVALID_TIMEZONE');
  try {
    const date = courseDate(value, timeZone);
    if (!date) throw new RangeError('INVALID_DATE');
    return date;
  } catch { throw new AppError(400, 'INVALID_DATE'); }
}

const sameId = (left: unknown, right: unknown) => String(left) === String(right);

/** Teacher ↔ student relation used by messaging: the student is enrolled in a course the teacher owns or co-owns. */
export async function teachesStudent(teacherId: string, studentId: string) {
  const courseIds = await Course.find({ $or: [{ teacherId }, { coOwnerIds: teacherId }] }).distinct('_id');
  return !!courseIds.length && !!await Enrollment.exists({ studentId, courseId: { $in: courseIds } });
}

/**
 * Who an event owner may invite: someone they already have a conversation with, or a student/teacher of one of their courses.
 * Admins may invite any active account. Nobody can be invited by guessing an identifier.
 */
export async function canInvite(owner: { id: string; role: string }, targetId: string) {
  if (sameId(owner.id, targetId) || !mongoose.isValidObjectId(targetId)) return false;
  if (owner.role === 'admin') return true;
  if (await Conversation.exists({ participants: { $all: [owner.id, targetId] } })) return true;
  if (owner.role === 'teacher') return teachesStudent(owner.id, targetId);
  if (owner.role === 'student') return teachesStudent(targetId, owner.id);
  return false;
}

export interface CalendarConflict { kind: 'session' | 'event'; id: string; title: string; start: Date; end: Date; userId: string; mine: boolean }

/**
 * Busy periods overlapping [start, end[ for the given users: active tutoring sessions (and the teacher's own open slots) and
 * confirmed calendar events they own or accepted. Details of other people's events are not returned, only that they are busy.
 */
export async function findConflicts(viewerId: string, userIds: string[], start: Date, end: Date, exclude: { eventId?: string; sessionId?: string } = {}): Promise<CalendarConflict[]> {
  const ids = [...new Set(userIds.map(String))];
  const overlap = { $lt: end };
  const [sessions, events] = await Promise.all([
    TutoringSession.find({
      ...(exclude.sessionId ? { _id: { $ne: exclude.sessionId } } : {}),
      startAt: overlap, endAt: { $gt: start },
      $or: [{ teacherId: { $in: ids }, status: { $in: ['available', 'pending', 'confirmed'] } }, { studentId: { $in: ids }, status: { $in: ['pending', 'confirmed'] } }],
    }).select('teacherId studentId subject startAt endAt status').limit(50).lean(),
    CalendarEventModel.find({
      ...(exclude.eventId ? { _id: { $ne: exclude.eventId } } : {}),
      status: 'confirmed', allDay: false, start: overlap, end: { $gt: start },
      $or: [{ ownerId: { $in: ids } }, { participants: { $elemMatch: { userId: { $in: ids }, status: 'accepted' } } }],
    }).select('ownerId participants title start end').limit(50).lean(),
  ]);
  const conflicts: CalendarConflict[] = [];
  for (const session of sessions) {
    const userId = ids.find(id => sameId(id, session.teacherId) || sameId(id, session.studentId))!;
    const mine = sameId(userId, viewerId);
    conflicts.push({ kind: 'session', id: mine ? String(session._id) : '', title: mine ? session.subject || (session.status === 'available' ? 'Open slot' : 'Tutoring session') : '', start: session.startAt, end: session.endAt, userId, mine });
  }
  for (const event of events) {
    const userId = ids.find(id => sameId(id, event.ownerId) || event.participants.some(participant => sameId(participant.userId, id) && participant.status === 'accepted'))!;
    const mine = sameId(userId, viewerId);
    conflicts.push({ kind: 'event', id: mine ? String(event._id) : '', title: mine ? event.title : '', start: event.start, end: event.end, userId, mine });
  }
  return conflicts.sort((left, right) => left.start.getTime() - right.start.getTime());
}

export const conflictDetails = (conflicts: CalendarConflict[]) => ({
  conflicts: conflicts.map(conflict => ({ kind: conflict.kind, id: conflict.id || undefined, title: conflict.title || undefined, start: conflict.start, end: conflict.end, userId: conflict.userId, mine: conflict.mine })),
});
