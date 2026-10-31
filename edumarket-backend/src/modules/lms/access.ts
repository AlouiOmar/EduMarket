import { z } from 'zod';
import type { AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Course } from '../courses/model.js';
import { getManageableCourse } from '../courses/assets.routes.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';

/** Access rules shared by the LMS modules (assessments, participation, attendance, groups, integrations). */
export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const parseId = (value: unknown, notFound = 'NOT_FOUND') => {
  const parsed = objectId.safeParse(value);
  if (!parsed.success) throw new AppError(404, notFound);
  return parsed.data;
};

/** Course manager (owner, co-author, coordinator, owning institution, admin): returns the course. */
export const managedCourse = (req: AuthRequest, courseId: unknown) => getManageableCourse(req, courseId);

/**
 * Student with active access to an open course. `write` refuses completed (read-only) courses. Private courses and courses the
 * student is not enrolled in answer 404, so their existence is not revealed.
 */
export async function studentCourse(req: AuthRequest, courseId: unknown, options: { write?: boolean } = {}) {
  const id = parseId(courseId, 'COURSE_NOT_FOUND');
  const [course, enrollment] = await Promise.all([
    Course.findById(id).select('title teacherId coOwnerIds accessState status settings chapters').lean(),
    Enrollment.exists(activeAccess({ courseId: id, studentId: req.auth!.userId })),
  ]);
  if (!course || !enrollment || course.accessState === 'private') throw new AppError(404, 'COURSE_NOT_FOUND');
  if (options.write && course.accessState === 'completed') throw new AppError(409, 'COURSE_COMPLETED');
  return course;
}

/** Window check shared by tests, forms, discussions and journals. */
export const withinWindow = (entity: { availableFrom?: Date | null; availableUntil?: Date | null }, now = new Date(), extendedUntil?: Date | null) =>
  (!entity.availableFrom || entity.availableFrom <= now) && (!(extendedUntil ?? entity.availableUntil) || (extendedUntil ?? entity.availableUntil)! >= now);
