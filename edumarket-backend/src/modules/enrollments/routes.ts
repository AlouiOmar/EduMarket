import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Course } from '../courses/model.js';
import { Enrollment, activeAccess } from './model.js';
import { enrollWithSubscription } from '../subscriptions/service.js';
import { QuizAttempt } from './quiz-attempt.model.js';
import { toStudentCourse } from '../courses/dto.js';
import { rateLimit } from 'express-rate-limit';
import { issueCompletionCertificate } from '../certificates/service.js';
import { Exam, ExamAttempt } from '../exams/models.js';
import { LessonActivity } from './lesson-activity.model.js';
import { CourseAsset } from '../courses/assets.model.js';
import { hasClassAccess, syncClassAccess } from '../classes/service.js';
import { accessibleItems, countableItems } from '../courses/structure.js';
import { recordSourceGrade } from '../gradebook/service.js';

/** Students can learn in open courses only: private hides the content, completed keeps it read-only. */
function assertLearningOpen(course: { accessState?: string }) {
  if (course.accessState === 'private') throw new AppError(404, 'LESSON_NOT_FOUND');
  if (course.accessState === 'completed') throw new AppError(409, 'COURSE_COMPLETED');
}
const allCompleted = (chapters: any, completedIds: string[]) => {
  const items = countableItems(chapters);
  return items.length > 0 && items.every(item => completedIds.includes(item.id));
};

export const enrollmentRoutes = Router();
enrollmentRoutes.use(authenticate, allowRoles('student'));

const courseIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

enrollmentRoutes.get('/', async (req: AuthRequest, res, next) => {
  try {
    const enrollments = await Enrollment.find({ studentId: req.auth!.userId })
      .sort({ lastAccessedAt: -1 }).populate({ path: 'courseId', populate: { path: 'teacherId', select: 'name' } }).lean();
    const courseIds = enrollments.map(item => (item.courseId as any)?._id || item.courseId);
    const assets = await CourseAsset.find({ courseId: { $in: courseIds } }).lean();
    const data = enrollments.map(item => {
      const course = item.courseId as any;
      const view = toStudentCourse(course, assets.filter(asset => String(asset.courseId) === String(course._id)), item.completedLessonIds);
      return { ...item, courseId: course.accessState === 'private' ? { ...view, chapters: [] } : view };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

enrollmentRoutes.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const [completed, attempts] = await Promise.all([
      LessonActivity.find({ studentId: req.auth!.userId }).sort({ completedAt: -1 }).limit(50).populate('courseId', 'title').lean(),
      QuizAttempt.find({ studentId: req.auth!.userId }).sort({ createdAt: -1 }).limit(50).populate('courseId', 'title').lean(),
    ]);
    const courseIds = [...new Set([...completed, ...attempts].map(item => String(item.courseId && typeof item.courseId === 'object' ? (item.courseId as any)._id : item.courseId)))];
    const courses = await Course.find({ _id: { $in: courseIds } }).select('title chapters').lean();
    const courseMap = new Map(courses.map(course => [String(course._id), course]));
    const event = (item: any, type: 'lesson_completed' | 'quiz_submitted') => {
      const courseId = String(item.courseId && typeof item.courseId === 'object' ? item.courseId._id : item.courseId);
      const course = courseMap.get(courseId);
      const lesson = course?.chapters.flatMap(chapter => chapter.lessons).find(candidate => candidate.id === item.lessonId);
      return {
        id: String(item._id), type, courseId, courseTitle: course?.title || 'Course',
        lessonId: item.lessonId, lessonTitle: lesson?.title || 'Lesson',
        createdAt: type === 'lesson_completed' ? item.completedAt : item.createdAt,
        ...(type === 'quiz_submitted' ? { score: item.score, passed: item.passed } : {}),
      };
    };
    const history = [...completed.map(item => event(item, 'lesson_completed')), ...attempts.map(item => event(item, 'quiz_submitted'))]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100);
    res.json({ success: true, data: history });
  } catch (error) { next(error); }
});

enrollmentRoutes.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { courseId } = z.object({ courseId: courseIdSchema }).parse(req.body);
    const course = await Course.findOne({ _id: courseId, status: 'published' });
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    // Class members get the courses assigned to their classes without payment; restricted courses are class-only.
    if (await hasClassAccess(req.auth!.userId, course._id)) {
      await syncClassAccess({ studentIds: [req.auth!.userId], courseIds: [course._id] });
      res.status(201).json({ success: true, data: await Enrollment.findOne({ studentId: req.auth!.userId, courseId }) });
      return;
    }
    if (course.visibility === 'restricted') throw new AppError(403, 'COURSE_RESTRICTED');
    // Paid courses: permanent access requires a purchase; active subscribers get access for their subscription period.
    if (course.price > 0) { res.status(201).json({ success: true, data: await enrollWithSubscription(req.auth!.userId, courseId) }); return; }

    let enrollment = await Enrollment.findOne({ studentId: req.auth!.userId, courseId });
    if (!enrollment) {
      try {
        enrollment = await Enrollment.create({ studentId: req.auth!.userId, courseId, accessType: 'free' });
        await Course.updateOne({ _id: courseId }, { $inc: { studentsCount: 1 } });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        enrollment = await Enrollment.findOne({ studentId: req.auth!.userId, courseId });
      }
    }
    res.status(201).json({ success: true, data: enrollment });
  } catch (error) { next(error); }
});

enrollmentRoutes.get('/:courseId', async (req: AuthRequest, res, next) => {
  try {
    const parsedId = courseIdSchema.safeParse(req.params.courseId);
    if (!parsedId.success) throw new AppError(404, 'ENROLLMENT_NOT_FOUND');
    const enrollment = await Enrollment.findOne(activeAccess({ studentId: req.auth!.userId, courseId: parsedId.data })).lean();
    if (!enrollment) throw new AppError(404, 'ENROLLMENT_NOT_FOUND');
    res.json({ success: true, data: enrollment });
  } catch (error) { next(error); }
});

enrollmentRoutes.put('/:courseId/lessons/:lessonId/complete', async (req: AuthRequest, res, next) => {
  try {
    const parsedId = courseIdSchema.safeParse(req.params.courseId);
    const lessonId = z.string().trim().min(1).max(100).safeParse(req.params.lessonId);
    if (!parsedId.success || !lessonId.success) throw new AppError(404, 'LESSON_NOT_FOUND');
    const course = await Course.findById(parsedId.data).select('chapters hasCertification certificationPathway accessState').lean();
    if (!course) throw new AppError(404, 'LESSON_NOT_FOUND');
    const current = await Enrollment.findOne(activeAccess({ studentId: req.auth!.userId, courseId: parsedId.data })).select('completedLessonIds').lean();
    if (!current) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    assertLearningOpen(course);
    // Hidden, scheduled and locked (sequential) items cannot be completed.
    const lesson = accessibleItems(course.chapters as any, { completedIds: current.completedLessonIds }).find(item => item.id === lessonId.data) as any;
    if (!lesson) throw new AppError(404, 'LESSON_NOT_FOUND');
    const totalLessons = countableItems(course.chapters as any).length;
    if (lesson.quiz) {
      const passed = await QuizAttempt.exists({ studentId: req.auth!.userId, courseId: parsedId.data, lessonId: lessonId.data, quizId: lesson.quiz.id, passed: true });
      if (!passed) throw new AppError(403, 'QUIZ_REQUIRED');
    }
    const wasAlreadyCompleted = await Enrollment.exists({ studentId: req.auth!.userId, courseId: parsedId.data, completedLessonIds: lessonId.data });
    const completed = await Enrollment.findOneAndUpdate(
      activeAccess({ studentId: req.auth!.userId, courseId: new mongoose.Types.ObjectId(parsedId.data) }),
      { $addToSet: { completedLessonIds: lessonId.data }, $set: { lastAccessedAt: new Date() } },
      { new: true },
    );
    if (!completed) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    if (!wasAlreadyCompleted) {
      await LessonActivity.updateOne(
        { studentId: req.auth!.userId, courseId: parsedId.data, lessonId: lessonId.data },
        { $setOnInsert: { completedAt: new Date() } }, { upsert: true },
      ).catch(error => { if ((error as { code?: number }).code !== 11000) throw error; });
    }
    if (allCompleted(course.chapters, completed.completedLessonIds) && !completed.completedAt) {
      completed.completedAt = new Date();
      await completed.save();
    }
    if (completed.completedAt && course.hasCertification) {
      if (course.certificationPathway === 'learning_and_quiz') await issueCompletionCertificate(req.auth!.userId, parsedId.data);
      if (course.certificationPathway === 'both') {
        const onlineExams = await Exam.find({ courseId: parsedId.data, type: 'online', status: 'published' }).select('_id').lean();
        if (onlineExams.length && await ExamAttempt.exists({ studentId: req.auth!.userId, examId: { $in: onlineExams.map(exam => exam._id) }, passed: true })) await issueCompletionCertificate(req.auth!.userId, parsedId.data);
      }
    }
    res.json({ success: true, data: { completedLessonIds: completed.completedLessonIds, completedAt: completed.completedAt, totalLessons } });
  } catch (error) { next(error); }
});

enrollmentRoutes.post('/:courseId/lessons/:lessonId/quiz-attempts', rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }), async (req: AuthRequest, res, next) => {
  try {
    const parsedId = courseIdSchema.safeParse(req.params.courseId);
    const lessonId = z.string().trim().min(1).max(100).safeParse(req.params.lessonId);
    const input = z.object({
      answers: z.array(z.object({ questionId: z.string().min(1).max(100), selectedOptionIndex: z.number().int().min(0).max(99) })).min(1).max(100)
        .refine(items => new Set(items.map(item => item.questionId)).size === items.length, 'Duplicate question answers'),
    }).parse(req.body);
    if (!parsedId.success || !lessonId.success) throw new AppError(404, 'LESSON_NOT_FOUND');
    const course = await Course.findById(parsedId.data).select('chapters accessState').lean();
    const enrollment = await Enrollment.findOne(activeAccess({ studentId: req.auth!.userId, courseId: parsedId.data }));
    if (course && !enrollment) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    if (course) assertLearningOpen(course);
    const lesson = course && enrollment ? accessibleItems(course.chapters as any, { completedIds: enrollment.completedLessonIds }).find(item => item.id === lessonId.data) as any : undefined;
    if (!lesson?.quiz || !Array.isArray(lesson.quiz.questions) || lesson.quiz.questions.length === 0) throw new AppError(404, 'QUIZ_NOT_FOUND');
    const questions = lesson.quiz.questions as Array<{ id: string; options: string[]; correctOptionIndex: number; explanation?: string }>;
    if (!enrollment) throw new AppError(403, 'ENROLLMENT_REQUIRED');

    const answerMap = new Map(input.answers.map(answer => [answer.questionId, answer.selectedOptionIndex]));
    if (input.answers.some(answer => !questions.some(question => question.id === answer.questionId))) throw new AppError(400, 'INVALID_QUIZ_ANSWER');
    if (input.answers.some(answer => answer.selectedOptionIndex >= questions.find(question => question.id === answer.questionId)!.options.length)) throw new AppError(400, 'INVALID_QUIZ_ANSWER');
    const correctCount = questions.filter(question => answerMap.get(question.id) === question.correctOptionIndex).length;
    const score = Math.round(correctCount / questions.length * 100);
    const passed = score >= lesson.quiz.passPercentage;
    const attempt = await QuizAttempt.create({
      studentId: req.auth!.userId, courseId: parsedId.data, lessonId: lessonId.data, quizId: lesson.quiz.id,
      answers: input.answers, score, passed, correctCount, totalQuestions: questions.length,
    });
    if (passed) {
      const newlyCompleted = !enrollment.completedLessonIds.includes(lessonId.data);
      if (newlyCompleted) enrollment.completedLessonIds.push(lessonId.data);
      enrollment.lastAccessedAt = new Date();
      if (!enrollment.completedAt && allCompleted(course!.chapters, enrollment.completedLessonIds)) enrollment.completedAt = new Date();
      await enrollment.save();
      if (newlyCompleted) await LessonActivity.updateOne(
        { studentId: req.auth!.userId, courseId: parsedId.data, lessonId: lessonId.data },
        { $setOnInsert: { completedAt: new Date() } }, { upsert: true },
      ).catch(error => { if ((error as { code?: number }).code !== 11000) throw error; });
    }
    // Gradebook: best attempt of this lesson quiz (in percent).
    const best = await QuizAttempt.findOne({ studentId: req.auth!.userId, courseId: parsedId.data, lessonId: lessonId.data }).sort({ score: -1 }).select('score').lean();
    await recordSourceGrade({ courseId: parsedId.data, kind: 'lesson_quiz', refId: lessonId.data, studentId: req.auth!.userId, score: best?.score ?? score, status: 'graded', title: `Quiz : ${lesson.title}`, maxPoints: 100 })
      .catch(error => console.error('Gradebook sync failed', { name: (error as Error).name }));
    const answerResults = questions.map(question => ({
      questionId: question.id,
      selectedOptionIndex: answerMap.get(question.id) ?? null,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation || '',
    }));
    res.status(201).json({ success: true, data: { attemptId: attempt.id, score, passed, correctCount, totalQuestions: questions.length, results: answerResults } });
  } catch (error) { next(error); }
});
