import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors.js';
import type { Role } from '../../common/auth.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { canManageCourse, manageableCourseFilter, teacherAffiliation } from '../courses/service.js';
import { ClassGroup } from './model.js';

interface Actor { userId: string; role: Role }

/** Courses listed publicly (catalogue, profiles, paths, stats, checkout): published and not restricted to classes. */
export const PUBLIC_COURSE_FILTER = { status: 'published', visibility: { $ne: 'restricted' } } as const;

export const newJoinCode = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'X').toUpperCase().slice(0, 8);

/** Owner, admin, or (for institution classes) a coordinator affiliated with that institution. */
export async function canManageClass(actor: Actor, group: { ownerId: unknown; ownerRole: string }) {
  if (actor.role === 'admin' || String(group.ownerId) === actor.userId) return true;
  if (group.ownerRole !== 'institution' || actor.role !== 'teacher') return false;
  const affiliation = await teacherAffiliation(actor.userId);
  return affiliation?.role === 'coordinator' && affiliation.institutionId === String(group.ownerId);
}

/** Classes an actor manages (listing counterpart of canManageClass). */
export async function manageableClassFilter(actor: Actor): Promise<Record<string, unknown>> {
  if (actor.role === 'admin') return {};
  const affiliation = actor.role === 'teacher' ? await teacherAffiliation(actor.userId) : null;
  const owners: unknown[] = [actor.userId];
  if (affiliation?.role === 'coordinator') owners.push(affiliation.institutionId);
  return { ownerId: { $in: owners.map(id => new mongoose.Types.ObjectId(String(id))) } };
}

/** Whether a student currently belongs to an active class the course is assigned to. */
export async function hasClassAccess(studentId: string, courseId: unknown) {
  return !!await ClassGroup.exists({ studentIds: studentId, courseIds: courseId, archivedAt: null });
}

/** Whether the course is visible to this viewer: public courses always, restricted ones to members, managers and admins. */
export async function canViewRestrictedCourse(viewer: Actor | undefined, course: { _id: unknown; teacherId: unknown; coOwnerIds?: unknown[] }) {
  if (!viewer) return false;
  if (viewer.role === 'admin' || String(course.teacherId) === viewer.userId || (course.coOwnerIds || []).some(id => String(id) === viewer.userId)) return true;
  if (viewer.role === 'student') return hasClassAccess(viewer.userId, course._id);
  return canManageCourse(viewer, course.teacherId, course.coOwnerIds || []);
}

/**
 * Reconciles class access for the given students (all their courses) and/or courses (all their members):
 * - covered pair without enrollment → class enrollment created;
 * - covered pair with an expired class/subscription enrollment → permanent class access;
 * - class enrollment no longer covered → expired now (progress is kept and returns if access is granted again).
 * Purchases and free enrollments are never touched.
 */
export async function syncClassAccess(scope: { studentIds?: unknown[]; courseIds?: unknown[] }) {
  const studentIds = (scope.studentIds || []).map(String), courseIds = (scope.courseIds || []).map(String);
  if (!studentIds.length && !courseIds.length) return;
  const classFilter: Record<string, unknown> = { archivedAt: null, $or: [
    ...(studentIds.length ? [{ studentIds: { $in: studentIds } }] : []),
    ...(courseIds.length ? [{ courseIds: { $in: courseIds } }] : []),
  ] };
  const classes = await ClassGroup.find(classFilter).select('studentIds courseIds').lean();
  const covered = new Set<string>();
  for (const group of classes) for (const student of group.studentIds) for (const course of group.courseIds) covered.add(`${student}:${course}`);
  const published = new Set((await Course.find({ _id: { $in: [...new Set([...covered].map(pair => pair.split(':')[1]))] }, status: 'published' }).distinct('_id')).map(String));

  const inScope = (student: string, course: string) => (!studentIds.length || studentIds.includes(student)) && (!courseIds.length || courseIds.includes(course));
  const wanted = [...covered].map(pair => pair.split(':')).filter(([student, course]) => inScope(student, course) && published.has(course));
  const enrollmentFilter: Record<string, unknown> = {
    ...(studentIds.length ? { studentId: { $in: studentIds } } : {}), ...(courseIds.length ? { courseId: { $in: courseIds } } : {}),
  };
  const existing = await Enrollment.find(enrollmentFilter).select('studentId courseId accessType accessExpiresAt').lean();
  const byPair = new Map(existing.map(row => [`${row.studentId}:${row.courseId}`, row]));
  const now = new Date();
  const created: string[] = [];
  for (const [student, course] of wanted) {
    const row = byPair.get(`${student}:${course}`);
    if (!row) {
      try {
        await Enrollment.create({ studentId: student, courseId: course, accessType: 'class', accessExpiresAt: null });
        created.push(course);
      } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    } else if (row.accessExpiresAt && ['class', 'subscription'].includes(row.accessType)) {
      await Enrollment.updateOne({ _id: row._id }, { $set: { accessType: 'class', accessExpiresAt: null } });
    }
  }
  for (const courseId of created) await Course.updateOne({ _id: courseId }, { $inc: { studentsCount: 1 } });
  const lost = existing.filter(row => row.accessType === 'class' && !row.accessExpiresAt && !covered.has(`${row.studentId}:${row.courseId}`));
  if (lost.length) await Enrollment.updateMany({ _id: { $in: lost.map(row => row._id) } }, { $set: { accessExpiresAt: now } });
  return { granted: created.length, revoked: lost.length };
}

/** Courses the class owner may assign: published courses the owner manages. */
export async function assertAssignableCourses(group: { ownerId: unknown; ownerRole: string }, courseIds: string[]) {
  if (!courseIds.length) return;
  const filter = await manageableCourseFilter({ userId: String(group.ownerId), role: group.ownerRole as Role });
  const count = await Course.countDocuments({ $and: [filter, { _id: { $in: courseIds }, status: 'published' }] });
  if (count !== new Set(courseIds).size) throw new AppError(400, 'CLASS_COURSE_NOT_ASSIGNABLE');
}

/** Resolves active student accounts by e-mail; unknown addresses are returned so the UI can report them. */
export async function studentsByEmail(emails: string[]) {
  const normalized = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
  const students = await User.find({ email: { $in: normalized }, role: 'student', status: 'active' }).select('_id email name').lean();
  const found = new Set(students.map(student => student.email));
  return { students, notFound: normalized.filter(email => !found.has(email)) };
}
