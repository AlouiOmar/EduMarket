import { Router } from 'express';
import { AuditEvent } from '../admin/audit.model.js';
import { z } from 'zod';
import { authenticate, allowRoles, optionalAuthenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Course } from './model.js';
import { CourseReview } from './review.model.js';
import { Enrollment } from '../enrollments/model.js';
import { canManageCourse, manageableCourseFilter } from './service.js';
import { createNotification } from '../notifications/service.js';

export const courseReviewRoutes = Router();
const identifier = z.string().trim().min(1).max(180);
const reviewIdentifier = z.string().regex(/^[a-f\d]{24}$/i);
async function refreshCourseRating(courseId: unknown) {
  const summary = await CourseReview.aggregate<{ _id: null; rating: number; count: number }>([
    { $match: { courseId, status: 'published' } },
    { $group: { _id: null, rating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const rating = Math.round((summary[0]?.rating || 0) * 100) / 100;
  const ratingCount = summary[0]?.count || 0;
  await Course.updateOne({ _id: courseId }, { $set: { rating, ratingCount } });
}
async function resolvePublishedCourse(identifierValue: string) {
  const routeId = /^[a-f\d]{24}$/i.test(identifierValue) ? identifierValue : null;
  const selector = routeId ? { $or: [{ _id: routeId }, { slug: identifierValue }] } : { slug: identifierValue };
  return Course.findOne({ ...selector, status: 'published' }).select('_id');
}

courseReviewRoutes.get('/moderation/reviews', authenticate, allowRoles('moderator', 'admin'), async (_req, res, next) => {
  try {
    const reviews = await CourseReview.find({}).sort({ createdAt: -1 }).limit(100)
      .populate('studentId', 'name').populate('courseId', 'title').lean();
    res.json({ success: true, data: reviews.map(review => ({
      id: String(review._id), rating: review.rating, comment: review.comment, status: review.status, createdAt: review.createdAt,
      studentName: (review.studentId as any)?.name || 'Student', courseTitle: (review.courseId as any)?.title || 'Course',
    })) });
  } catch (error) { next(error); }
});

courseReviewRoutes.patch('/moderation/reviews/:reviewId', authenticate, allowRoles('moderator', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const parsedId = reviewIdentifier.safeParse(req.params.reviewId);
    if (!parsedId.success) throw new AppError(404, 'REVIEW_NOT_FOUND');
    const input = z.object({ status: z.enum(['published', 'hidden']) }).strict().parse(req.body);
    const review = await CourseReview.findByIdAndUpdate(parsedId.data, { $set: { status: input.status } }, { new: true, runValidators: true });
    if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND');
    await refreshCourseRating(review.courseId);
    await AuditEvent.create({ action: input.status === 'hidden' ? 'moderation.review.hidden' : 'moderation.review.restored', actorId: req.auth!.userId, targetType: 'course_review', targetId: String(review._id), severity: input.status === 'hidden' ? 'warning' : 'info', ipAddress: req.ip });
    res.json({ success: true, data: { id: String(review._id), status: review.status } });
  } catch (error) { next(error); }
});

/** Published reviews of the courses the signed-in teacher/institution manages, newest first. */
courseReviewRoutes.get('/reviews/managed', authenticate, allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const courses = await Course.find(await manageableCourseFilter({ userId: req.auth!.userId, role: req.auth!.role })).select('_id title').lean();
    const titles = new Map(courses.map(course => [String(course._id), course.title]));
    const reviews = await CourseReview.find({ courseId: { $in: courses.map(course => course._id) }, status: 'published' }).sort({ createdAt: -1 }).limit(200).populate('studentId', 'name').lean();
    res.json({ success: true, data: reviews.map(review => ({
      id: String(review._id), courseId: String(review.courseId), courseTitle: titles.get(String(review.courseId)) || '', rating: review.rating, comment: review.comment,
      createdAt: review.createdAt, studentName: (review.studentId as any)?.name || '', reply: review.reply?.body ? { body: review.reply.body, repliedAt: review.reply.repliedAt } : null,
    })) });
  } catch (error) { next(error); }
});

/** Owner/manager answer to a published review; an empty body removes the answer. */
courseReviewRoutes.put('/:courseId/reviews/:reviewId/reply', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const reviewId = reviewIdentifier.safeParse(req.params.reviewId), courseId = reviewIdentifier.safeParse(req.params.courseId);
    if (!reviewId.success || !courseId.success) throw new AppError(404, 'REVIEW_NOT_FOUND');
    const { body } = z.object({ body: z.string().trim().max(2000) }).strict().parse(req.body);
    const [review, course] = await Promise.all([CourseReview.findOne({ _id: reviewId.data, courseId: courseId.data, status: 'published' }), Course.findById(courseId.data).select('teacherId coOwnerIds title').lean()]);
    if (!review || !course || !await canManageCourse({ userId: req.auth!.userId, role: req.auth!.role }, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'REVIEW_NOT_FOUND');
    const hadReply = Boolean(review.reply?.body);
    review.set('reply', body ? { body, authorId: req.auth!.userId, repliedAt: new Date() } : undefined);
    await review.save();
    if (body && !hadReply) void createNotification({ userId: String(review.studentId), type: 'course', title: 'Reply to your review', message: `The teacher replied to your review of "${course.title}".`, link: `/courses/${courseId.data}`, template: { key: 'reviewReplied', params: { course: course.title } } }).catch(() => undefined);
    res.json({ success: true, data: { id: String(review._id), reply: body ? { body, repliedAt: review.reply?.repliedAt } : null } });
  } catch (error) { next(error); }
});

courseReviewRoutes.get('/:courseId/reviews', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsedId = identifier.safeParse(req.params.courseId); if (!parsedId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const course = await resolvePublishedCourse(parsedId.data); if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const [reviews, mine, summary] = await Promise.all([
      CourseReview.find({ courseId: course._id, status: 'published' }).sort({ createdAt: -1 }).limit(100).populate('studentId', 'name').lean(),
      req.auth?.role === 'student' ? CourseReview.findOne({ courseId: course._id, studentId: req.auth.userId, status: 'published' }).lean() : null,
      CourseReview.aggregate<{ _id: null; rating: number; count: number }>([{ $match: { courseId: course._id, status: 'published' } }, { $group: { _id: null, rating: { $avg: '$rating' }, count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: {
      reviews: reviews.map(review => ({ id: String(review._id), rating: review.rating, comment: review.comment, createdAt: review.createdAt, studentName: (review.studentId as any)?.name || 'Student', reply: review.reply?.body ? { body: review.reply.body, repliedAt: review.reply.repliedAt } : null })),
      mine: mine ? { id: String(mine._id), rating: mine.rating, comment: mine.comment, createdAt: mine.createdAt } : null,
      rating: summary[0]?.rating || 0, ratingCount: summary[0]?.count || 0,
    } });
  } catch (error) { next(error); }
});

courseReviewRoutes.put('/:courseId/reviews/mine', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const parsedId = identifier.safeParse(req.params.courseId); if (!parsedId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(10).max(3000) }).strict().parse(req.body);
    const course = await resolvePublishedCourse(parsedId.data); if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    if (!await Enrollment.exists({ studentId: req.auth!.userId, courseId: course._id })) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    const review = await CourseReview.findOneAndUpdate({ courseId: course._id, studentId: req.auth!.userId }, { $set: { ...input, status: 'published' } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    const summary = await CourseReview.aggregate<{ _id: null; rating: number; count: number }>([{ $match: { courseId: course._id, status: 'published' } }, { $group: { _id: null, rating: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    const rating = Math.round((summary[0]?.rating || 0) * 100) / 100, ratingCount = summary[0]?.count || 0;
    await Course.updateOne({ _id: course._id }, { $set: { rating, ratingCount } });
    res.json({ success: true, data: { id: String(review._id), rating: review.rating, comment: review.comment, createdAt: review.createdAt, courseRating: rating, ratingCount } });
  } catch (error) { next(error); }
});
