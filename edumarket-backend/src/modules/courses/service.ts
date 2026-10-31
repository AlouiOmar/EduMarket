import { AppError } from '../../common/errors.js';
import type { Role } from '../../common/auth.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { createNotification, type NotificationTemplate } from '../notifications/service.js';
import { Course } from './model.js';

/**
 * Course publication lifecycle shared by course owners, moderators and administrators.
 * draft|rejected -> pending_review -> published|rejected; published <-> suspended.
 */
export type CourseStatus = 'draft' | 'pending_review' | 'published' | 'rejected' | 'suspended';
interface Actor { userId: string; role: Role; ip?: string }

const audit = (actor: Actor, action: string, courseId: string, severity: 'info' | 'warning' | 'critical' = 'info') =>
  AuditEvent.create({ action, actorId: actor.userId, targetType: 'course', targetId: courseId, severity, ipAddress: actor.ip || '' });

const notifyOwner = (teacherId: unknown, title: string, message: string, link: string, template?: NotificationTemplate) =>
  createNotification({ userId: String(teacherId), type: 'course', title, message, link, template }).catch(() => undefined);

/** Institution responsible for a seller account: the institution itself, or the institution of a verified affiliated teacher. */
export async function institutionOf(userId: unknown) {
  const user = await User.findById(userId).select('role institutionId verified').lean();
  if (!user) return null;
  if (user.role === 'institution') return String(user._id);
  return user.role === 'teacher' && user.verified && user.institutionId ? String(user.institutionId) : null;
}

/** Affiliation of a verified teacher with its internal role, or null. */
export async function teacherAffiliation(userId: string) {
  const teacher = await User.findOne({ _id: userId, role: 'teacher', verified: true }).select('institutionId institutionRole').lean();
  return teacher?.institutionId ? { institutionId: String(teacher.institutionId), role: teacher.institutionRole || 'teacher' } : null;
}

/** Owner, owning institution or admin: the only actors allowed to change price, status and co-owners. */
export async function isPrimaryCourseManager(actor: Actor, teacherId: unknown) {
  if (actor.role === 'admin' || String(teacherId) === actor.userId) return true;
  return actor.role === 'institution' && await institutionOf(teacherId) === actor.userId;
}

/**
 * Owners are the authoring teacher/institution; institutions also manage courses of their verified affiliated teachers.
 * Co-owners and institution coordinators may edit content of the courses they are attached to.
 */
export async function canManageCourse(actor: Actor, teacherId: unknown, coOwnerIds: unknown[] = []) {
  if (await isPrimaryCourseManager(actor, teacherId)) return true;
  if (actor.role !== 'teacher') return false;
  if (coOwnerIds.some(id => String(id) === actor.userId)) return !!await User.exists({ _id: actor.userId, verified: true });
  const affiliation = await teacherAffiliation(actor.userId);
  return affiliation?.role === 'coordinator' && await institutionOf(teacherId) === affiliation.institutionId;
}

/** Mongo filter of the courses an actor can manage (listing counterpart of canManageCourse). */
export async function manageableCourseFilter(actor: Actor): Promise<Record<string, unknown>> {
  if (actor.role === 'admin') return {};
  const sellersOf = async (institutionId: string) => [institutionId, ...await User.find({ institutionId, role: 'teacher', verified: true }).distinct('_id')];
  if (actor.role === 'institution') return { teacherId: { $in: await sellersOf(actor.userId) } };
  const clauses: Record<string, unknown>[] = [{ teacherId: actor.userId }, { coOwnerIds: actor.userId }];
  const affiliation = await teacherAffiliation(actor.userId);
  if (affiliation?.role === 'coordinator') clauses.push({ teacherId: { $in: await sellersOf(affiliation.institutionId) } });
  return { $or: clauses };
}

export async function submitCourseForReview(courseId: string, actor: Actor) {
  const course = await Course.findById(courseId);
  if (!course || !await canManageCourse(actor, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (actor.role === 'teacher' && !(await User.exists({ _id: actor.userId, verified: true }))) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
  if (!['draft', 'rejected'].includes(course.status)) throw new AppError(409, 'COURSE_STATUS_CONFLICT');
  const lessons = course.chapters.flatMap(chapter => chapter.lessons || []);
  if (lessons.length === 0) throw new AppError(422, 'COURSE_CONTENT_REQUIRED');
  const updated = await Course.findOneAndUpdate(
    { _id: course._id, status: course.status },
    { $set: { status: 'pending_review', 'review.submittedAt': new Date(), 'review.note': '' } },
    { new: true },
  );
  if (!updated) throw new AppError(409, 'COURSE_STATUS_CONFLICT');
  await audit(actor, 'course.review.submitted', courseId);
  return updated;
}

export async function reviewCourse(courseId: string, decision: 'approve' | 'reject', note: string, actor: Actor) {
  if (decision === 'reject' && !note.trim()) throw new AppError(422, 'REVIEW_NOTE_REQUIRED');
  const status: CourseStatus = decision === 'approve' ? 'published' : 'rejected';
  const course = await Course.findOneAndUpdate(
    { _id: courseId, status: 'pending_review' },
    { $set: { status, 'review.reviewedAt': new Date(), 'review.reviewedBy': actor.userId, 'review.note': note.trim() } },
    { new: true },
  );
  if (!course) {
    if (!await Course.exists({ _id: courseId })) throw new AppError(404, 'COURSE_NOT_FOUND');
    throw new AppError(409, 'COURSE_STATUS_CONFLICT');
  }
  await audit(actor, decision === 'approve' ? 'moderation.course.approved' : 'moderation.course.rejected', courseId, decision === 'approve' ? 'info' : 'warning');
  await notifyOwner(course.teacherId,
    decision === 'approve' ? 'Course published' : 'Course changes requested',
    decision === 'approve' ? `"${course.title}" is now published in the catalogue.` : `"${course.title}" was not approved: ${note.trim()}`,
    `/teacher/courses/${course._id}/edit`,
    { key: decision === 'approve' ? 'coursePublished' : 'courseChangesRequested', params: { course: course.title, note: note.trim() } });
  return course;
}

export async function setCourseSuspension(courseId: string, suspended: boolean, note: string, actor: Actor) {
  if (suspended && !note.trim()) throw new AppError(422, 'REVIEW_NOTE_REQUIRED');
  const course = await Course.findOneAndUpdate(
    { _id: courseId, status: suspended ? 'published' : 'suspended' },
    { $set: { status: suspended ? 'suspended' : 'published', 'review.reviewedAt': new Date(), 'review.reviewedBy': actor.userId, 'review.note': note.trim() } },
    { new: true },
  );
  if (!course) {
    if (!await Course.exists({ _id: courseId })) throw new AppError(404, 'COURSE_NOT_FOUND');
    throw new AppError(409, 'COURSE_STATUS_CONFLICT');
  }
  await audit(actor, suspended ? 'moderation.course.suspended' : 'moderation.course.restored', courseId, suspended ? 'critical' : 'warning');
  await notifyOwner(course.teacherId,
    suspended ? 'Course suspended' : 'Course restored',
    suspended ? `"${course.title}" was removed from the catalogue: ${note.trim()}` : `"${course.title}" is visible in the catalogue again.`,
    '/teacher/courses',
    { key: suspended ? 'courseSuspended' : 'courseRestored', params: { course: course.title, note: note.trim() } });
  return course;
}
