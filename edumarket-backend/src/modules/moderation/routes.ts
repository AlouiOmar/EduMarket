import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Course } from '../courses/model.js';
import { CourseReview } from '../courses/review.model.js';
import { ForumReport } from '../forum/models.js';
import { ContentReport } from '../reports/model.js';
import { reviewCourse, setCourseSuspension } from '../courses/service.js';

/** Content moderation shared by moderators and administrators; financial and account operations stay admin-only. */
export const moderationRoutes = Router();
moderationRoutes.use(authenticate, allowRoles('moderator', 'admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const courseDto = (course: any) => ({
  id: String(course._id), title: course.title, slug: course.slug, category: course.category, price: course.price,
  status: course.status, teacherId: String(course.teacherId?._id || course.teacherId), teacherName: course.teacherId?.name || '',
  lessonsCount: (course.chapters || []).reduce((sum: number, chapter: any) => sum + (chapter.lessons?.length || 0), 0),
  studentsCount: course.studentsCount || 0, rating: course.rating || 0,
  review: { submittedAt: course.review?.submittedAt || null, reviewedAt: course.review?.reviewedAt || null, note: course.review?.note || '' },
  createdAt: course.createdAt, updatedAt: course.updatedAt,
});

moderationRoutes.get('/summary', async (_req, res, next) => {
  try {
    const [pendingCourses, suspendedCourses, openForumReports, hiddenReviews, openContentReports] = await Promise.all([
      Course.countDocuments({ status: 'pending_review' }), Course.countDocuments({ status: 'suspended' }),
      ForumReport.countDocuments({ status: 'open' }), CourseReview.countDocuments({ status: 'hidden' }),
      ContentReport.countDocuments({ status: 'open' }),
    ]);
    res.json({ success: true, data: { pendingCourses, suspendedCourses, openForumReports, hiddenReviews, openContentReports } });
  } catch (error) { next(error); }
});

moderationRoutes.get('/courses', async (req, res, next) => {
  try {
    const query = z.object({
      status: z.enum(['all', 'draft', 'pending_review', 'published', 'rejected', 'suspended']).default('pending_review'),
      search: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    const filter: Record<string, unknown> = query.status === 'all' ? {} : { status: query.status };
    if (query.search) filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    const [courses, total] = await Promise.all([
      Course.find(filter).select('-chapters.lessons.quiz -chapters.lessons.textContent').sort({ 'review.submittedAt': 1, updatedAt: -1 })
        .skip((query.page - 1) * query.limit).limit(query.limit).populate('teacherId', 'name').lean(),
      Course.countDocuments(filter),
    ]);
    res.json({ success: true, data: courses.map(courseDto), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
});

moderationRoutes.patch('/courses/:courseId/review', async (req: AuthRequest, res, next) => {
  try {
    const courseId = objectId.safeParse(req.params.courseId); if (!courseId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const input = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const course = await reviewCourse(courseId.data, input.decision, input.note, { userId: req.auth!.userId, role: req.auth!.role, ip: req.ip });
    res.json({ success: true, data: courseDto((await course.populate('teacherId', 'name')).toObject()) });
  } catch (error) { next(error); }
});

moderationRoutes.patch('/courses/:courseId/suspension', async (req: AuthRequest, res, next) => {
  try {
    const courseId = objectId.safeParse(req.params.courseId); if (!courseId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const input = z.object({ suspended: z.boolean(), note: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const course = await setCourseSuspension(courseId.data, input.suspended, input.note, { userId: req.auth!.userId, role: req.auth!.role, ip: req.ip });
    res.json({ success: true, data: courseDto((await course.populate('teacherId', 'name')).toObject()) });
  } catch (error) { next(error); }
});

moderationRoutes.get('/history', async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const filter = { action: { $regex: '^moderation\\.' } };
    const [events, total] = await Promise.all([
      AuditEvent.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).populate('actorId', 'name role').lean(),
      AuditEvent.countDocuments(filter),
    ]);
    res.json({ success: true, data: events.map(event => ({
      id: String(event._id), action: event.action, actorName: (event.actorId as any)?.name || '', actorRole: (event.actorId as any)?.role || '',
      targetType: event.targetType, targetId: event.targetId, severity: event.severity, createdAt: event.createdAt,
    })), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
});
