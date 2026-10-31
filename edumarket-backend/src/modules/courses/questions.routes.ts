import { Router } from 'express';
import mongoose, { Schema, model } from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { createNotification } from '../notifications/service.js';
import { Course } from './model.js';
import { canManageCourse } from './service.js';
import { accessibleItems } from './structure.js';

/** Lesson Q&A: enrolled learners ask, course staff (owner, affiliated institution, admin) and other learners answer. */
const answerSchema = new Schema({
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  staff: { type: Boolean, default: false },
  body: { type: String, required: true, trim: true, minlength: 2, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });
const questionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  lessonId: { type: String, required: true, maxlength: 100 },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, minlength: 5, maxlength: 4000 },
  answers: { type: [answerSchema], default: [], validate: (answers: unknown[]) => answers.length <= 100 },
  status: { type: String, enum: ['published', 'hidden'], default: 'published' },
}, { timestamps: true, versionKey: false });
questionSchema.index({ courseId: 1, lessonId: 1, createdAt: -1 });
export const LessonQuestion = model('LessonQuestion', questionSchema);

export const lessonQuestionRoutes = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const writeLimiter = rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED' } } });

/** Returns the course and whether the caller is staff; learners must hold active access. Others get 404. */
async function resolveAccess(req: AuthRequest) {
  const courseId = objectId.safeParse(req.params.courseId);
  const lessonId = z.string().trim().min(1).max(100).safeParse(req.params.lessonId);
  if (!courseId.success || !lessonId.success) throw new AppError(404, 'LESSON_NOT_FOUND');
  const course = await Course.findById(courseId.data).select('title teacherId coOwnerIds status accessState chapters').lean();
  if (!course || !course.chapters.some((chapter: any) => chapter.lessons.some((lesson: any) => lesson.id === lessonId.data))) throw new AppError(404, 'LESSON_NOT_FOUND');
  const actor = { userId: req.auth!.userId, role: req.auth!.role };
  const staff = await canManageCourse(actor, course.teacherId, course.coOwnerIds);
  if (!staff) {
    if (req.auth!.role !== 'student' || course.status !== 'published') throw new AppError(403, 'ENROLLMENT_REQUIRED');
    const enrollment = await Enrollment.findOne(activeAccess({ studentId: req.auth!.userId, courseId: course._id })).select('completedLessonIds').lean();
    if (!enrollment) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    // Hidden, scheduled or locked lessons do not exist for students.
    if (course.accessState === 'private' || !accessibleItems(course.chapters as any, { completedIds: enrollment.completedLessonIds }).some(item => item.id === lessonId.data)) throw new AppError(404, 'LESSON_NOT_FOUND');
  }
  return { course, lessonId: lessonId.data, staff };
}

const questionDto = (question: any, viewerId: string) => ({
  id: String(question._id), body: question.body, createdAt: question.createdAt, mine: String(question.authorId?._id || question.authorId) === viewerId,
  author: { name: question.authorId?.name || '' },
  answers: (question.answers || []).map((answer: any) => ({ id: String(answer._id), body: answer.body, staff: answer.staff, createdAt: answer.createdAt, author: { name: answer.authorId?.name || '' } })),
});

lessonQuestionRoutes.get('/:courseId/lessons/:lessonId/questions', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { course, lessonId } = await resolveAccess(req);
    const questions = await LessonQuestion.find({ courseId: course._id, lessonId, status: 'published' }).sort({ createdAt: -1 }).limit(100)
      .populate('authorId', 'name').populate('answers.authorId', 'name').lean();
    res.json({ success: true, data: questions.map(question => questionDto(question, req.auth!.userId)) });
  } catch (error) { next(error); }
});

lessonQuestionRoutes.post('/:courseId/lessons/:lessonId/questions', authenticate, writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, lessonId, staff } = await resolveAccess(req);
    if (staff) throw new AppError(403, 'FORBIDDEN');
    const { body } = z.object({ body: z.string().trim().min(5).max(4000) }).strict().parse(req.body);
    const question = await LessonQuestion.create({ courseId: course._id, lessonId, authorId: req.auth!.userId, body });
    void createNotification({ userId: String(course.teacherId), type: 'course', title: 'New learner question', message: `A learner asked a question in "${course.title}".`, link: `/learning/${course._id}`, template: { key: 'learnerQuestion', params: { course: course.title } } }).catch(() => undefined);
    await question.populate('authorId', 'name');
    res.status(201).json({ success: true, data: questionDto(question.toObject(), req.auth!.userId) });
  } catch (error) { next(error); }
});

lessonQuestionRoutes.post('/:courseId/lessons/:lessonId/questions/:questionId/answers', authenticate, writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, lessonId, staff } = await resolveAccess(req);
    const questionId = objectId.safeParse(req.params.questionId); if (!questionId.success) throw new AppError(404, 'QUESTION_NOT_FOUND');
    const { body } = z.object({ body: z.string().trim().min(2).max(4000) }).strict().parse(req.body);
    const question = await LessonQuestion.findOneAndUpdate(
      { _id: questionId.data, courseId: course._id, lessonId, status: 'published', 'answers.99': { $exists: false } },
      { $push: { answers: { _id: new mongoose.Types.ObjectId(), authorId: req.auth!.userId, staff, body } } },
      { new: true },
    ).populate('authorId', 'name').populate('answers.authorId', 'name');
    if (!question) throw new AppError(404, 'QUESTION_NOT_FOUND');
    const authorId = String((question.authorId as any)?._id || question.authorId);
    if (authorId !== req.auth!.userId) void createNotification({ userId: authorId, type: 'course', title: 'Your question was answered', message: `New answer in "${course.title}".`, link: `/learning/${course._id}`, template: { key: 'questionAnswered', params: { course: course.title } } }).catch(() => undefined);
    res.status(201).json({ success: true, data: questionDto(question.toObject(), req.auth!.userId) });
  } catch (error) { next(error); }
});
