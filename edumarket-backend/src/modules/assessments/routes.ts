import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { AuditEvent } from '../admin/audit.model.js';
import { sanitizeRichText } from '../courses/blocks.js';
import { canManageCourse } from '../courses/service.js';
import { Course } from '../courses/model.js';
import { managedCourse, objectId, parseId, studentCourse, withinWindow } from '../lms/access.js';
import { BankQuestion, DIFFICULTIES, Form, FormResponse, QuestionBank, Rubric, Test, TestAttempt } from './models.js';
import { attemptExpired, buildAttemptQuestions, finalizeAttempt, respondentKey, studentException, syncTestGrade, validateAndLinkTest } from './service.js';
import { attemptTotal, rubricMax } from './grading.js';

/**
 * Assessments API, scoped by course: `/assessments/:courseId/...` for managers, `/assessments/:courseId/student/...` for enrolled
 * students. Answer keys never leave the server before the grade is published (and only if the test shows correct answers).
 */
export const assessmentRoutes = Router();
assessmentRoutes.use(authenticate);
const managers = allowRoles('teacher', 'institution', 'admin');
const students = allowRoles('student');
const date = z.union([z.null(), z.coerce.date()]).optional();
const actorOf = (req: AuthRequest) => ({ userId: req.auth!.userId, role: req.auth!.role });
const audit = (req: AuthRequest, action: string, courseId: unknown) => AuditEvent.create({ action, actorId: req.auth!.userId, targetType: 'course', targetId: String(courseId), ipAddress: req.ip }).catch(() => undefined);

// --- Question banks ---------------------------------------------------------------------------------------------------------

const bankSchema = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default('') }).strict();
assessmentRoutes.get('/:courseId/banks', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const banks = await QuestionBank.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const counts = await BankQuestion.aggregate<{ _id: unknown; count: number }>([{ $match: { courseId: course._id, archivedAt: null } }, { $group: { _id: '$bankId', count: { $sum: 1 } } }]);
    res.json({ success: true, data: banks.map(bank => ({ id: String(bank._id), title: bank.title, description: bank.description, questionCount: counts.find(row => String(row._id) === String(bank._id))?.count || 0 })) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/banks', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const bank = await QuestionBank.create({ ...bankSchema.parse(req.body), courseId: course._id });
    res.status(201).json({ success: true, data: { id: String(bank._id), title: bank.title, description: bank.description, questionCount: 0 } });
  } catch (error) { next(error); }
});
assessmentRoutes.patch('/:courseId/banks/:bankId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const bank = await QuestionBank.findOneAndUpdate({ _id: parseId(req.params.bankId, 'BANK_NOT_FOUND'), courseId: course._id }, { $set: bankSchema.partial().parse(req.body) }, { new: true }).lean();
    if (!bank) throw new AppError(404, 'BANK_NOT_FOUND');
    res.json({ success: true, data: { id: String(bank._id), title: bank.title, description: bank.description } });
  } catch (error) { next(error); }
});
/** Copies a bank and its questions to another course the actor manages (no student data exists on banks). */
assessmentRoutes.post('/:courseId/banks/:bankId/copy', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const { targetCourseId } = z.object({ targetCourseId: objectId }).strict().parse(req.body);
    const target = await Course.findById(targetCourseId).select('teacherId coOwnerIds').lean();
    if (!target || !await canManageCourse(actorOf(req), target.teacherId, target.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    const bank = await QuestionBank.findOne({ _id: parseId(req.params.bankId, 'BANK_NOT_FOUND'), courseId: course._id }).lean();
    if (!bank) throw new AppError(404, 'BANK_NOT_FOUND');
    const copy = await QuestionBank.create({ courseId: target._id, title: bank.title, description: bank.description, copiedFrom: bank._id });
    const questions = await BankQuestion.find({ bankId: bank._id, archivedAt: null }).lean();
    await BankQuestion.insertMany(questions.map(({ _id, createdAt, updatedAt, ...question }: any) => ({ ...question, courseId: target._id, bankId: copy._id })));
    res.status(201).json({ success: true, data: { id: String(copy._id), questionCount: questions.length } });
  } catch (error) { next(error); }
});

const questionSchema = z.object({
  type: z.enum(['single', 'multiple', 'true_false', 'short', 'essay']), prompt: z.string().trim().min(1).max(20000),
  options: z.array(z.object({ id: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(1000) })).max(12).default([]),
  correct: z.array(z.string().trim().min(1).max(500)).max(20).default([]), caseSensitive: z.boolean().default(false),
  points: z.number().min(0).max(1000).default(1), chapter: z.string().trim().max(120).default(''), difficulty: z.enum(DIFFICULTIES).default('medium'),
  explanation: z.string().trim().max(4000).default(''),
}).strict().superRefine((value, ctx) => {
  const ids = value.options.map(option => option.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'DUPLICATE_OPTION' });
  if (['single', 'multiple'].includes(value.type)) {
    if (value.options.length < 2) ctx.addIssue({ code: 'custom', message: 'OPTIONS_REQUIRED' });
    if (!value.correct.length || value.correct.some(id => !ids.includes(id))) ctx.addIssue({ code: 'custom', message: 'CORRECT_OPTION_REQUIRED' });
    if (value.type === 'single' && value.correct.length !== 1) ctx.addIssue({ code: 'custom', message: 'SINGLE_CORRECT_OPTION' });
  }
  if (value.type === 'true_false' && (value.correct.length !== 1 || !['true', 'false'].includes(value.correct[0]))) ctx.addIssue({ code: 'custom', message: 'TRUE_FALSE_ANSWER' });
  if (value.type === 'short' && !value.correct.length) ctx.addIssue({ code: 'custom', message: 'ACCEPTED_ANSWER_REQUIRED' });
});
const questionDto = (question: any) => ({
  id: String(question._id), bankId: String(question.bankId), type: question.type, prompt: question.prompt, options: question.options, correct: question.correct,
  caseSensitive: question.caseSensitive, points: question.points, chapter: question.chapter, difficulty: question.difficulty, explanation: question.explanation,
});
const normalizeQuestion = (input: z.infer<typeof questionSchema>) => ({
  ...input, prompt: sanitizeRichText(input.prompt), explanation: sanitizeRichText(input.explanation),
  options: ['single', 'multiple'].includes(input.type) ? input.options : input.type === 'true_false' ? [{ id: 'true', text: 'true' }, { id: 'false', text: 'false' }] : [],
});

assessmentRoutes.get('/:courseId/banks/:bankId/questions', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const questions = await BankQuestion.find({ courseId: course._id, bankId: parseId(req.params.bankId, 'BANK_NOT_FOUND'), archivedAt: null }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: questions.map(questionDto) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/banks/:bankId/questions', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const bankId = parseId(req.params.bankId, 'BANK_NOT_FOUND');
    if (!await QuestionBank.exists({ _id: bankId, courseId: course._id })) throw new AppError(404, 'BANK_NOT_FOUND');
    const question = await BankQuestion.create({ ...normalizeQuestion(questionSchema.parse(req.body)), courseId: course._id, bankId });
    res.status(201).json({ success: true, data: questionDto(question) });
  } catch (error) { next(error); }
});
/** Editing a question affects future attempts only: attempts keep the snapshot they were given. */
assessmentRoutes.put('/:courseId/questions/:questionId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const question = await BankQuestion.findOneAndUpdate({ _id: parseId(req.params.questionId, 'QUESTION_NOT_FOUND'), courseId: course._id, archivedAt: null }, { $set: normalizeQuestion(questionSchema.parse(req.body)) }, { new: true }).lean();
    if (!question) throw new AppError(404, 'QUESTION_NOT_FOUND');
    res.json({ success: true, data: questionDto(question) });
  } catch (error) { next(error); }
});
assessmentRoutes.delete('/:courseId/questions/:questionId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const archived = await BankQuestion.updateOne({ _id: parseId(req.params.questionId, 'QUESTION_NOT_FOUND'), courseId: course._id, archivedAt: null }, { $set: { archivedAt: new Date() } });
    if (!archived.matchedCount) throw new AppError(404, 'QUESTION_NOT_FOUND');
    res.json({ success: true, data: { id: req.params.questionId } });
  } catch (error) { next(error); }
});

// --- Tests ------------------------------------------------------------------------------------------------------------------

const sectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), questionIds: z.array(objectId).min(1).max(200) }).strict(),
  z.object({ kind: z.literal('random'), bankId: objectId, count: z.number().int().min(1).max(200), chapter: z.string().trim().max(120).default(''), difficulty: z.enum(['', ...DIFFICULTIES]).default('') }).strict(),
]);
const testFields = z.object({
  title: z.string().trim().min(1).max(200), instructions: z.string().max(20000).default(''),
  availableFrom: date, availableUntil: date, timeLimitMinutes: z.number().int().min(0).max(600).default(0), maxAttempts: z.number().int().min(1).max(20).default(1),
  shuffleQuestions: z.boolean().default(false), shuffleOptions: z.boolean().default(false), sections: z.array(sectionSchema).max(20).default([]),
  gradePolicy: z.enum(['best', 'last']).default('best'), showCorrectAnswers: z.boolean().default(false),
}).strict();
const testSchema = testFields.refine(value => !value.availableFrom || !value.availableUntil || value.availableFrom < value.availableUntil, 'INVALID_AVAILABILITY_WINDOW');
const testDto = (test: any) => ({
  id: String(test._id), title: test.title, instructions: test.instructions, status: test.status, availableFrom: test.availableFrom, availableUntil: test.availableUntil,
  timeLimitMinutes: test.timeLimitMinutes, maxAttempts: test.maxAttempts, shuffleQuestions: test.shuffleQuestions, shuffleOptions: test.shuffleOptions,
  sections: test.sections, gradePolicy: test.gradePolicy, showCorrectAnswers: test.showCorrectAnswers,
});

/** Banks and fixed questions referenced by a test must belong to its course. */
async function assertSectionsInCourse(courseId: unknown, sections: z.infer<typeof sectionSchema>[]) {
  for (const section of sections) {
    if (section.kind === 'random' && !await QuestionBank.exists({ _id: section.bankId, courseId })) throw new AppError(422, 'BANK_NOT_FOUND');
    if (section.kind === 'fixed' && await BankQuestion.countDocuments({ _id: { $in: section.questionIds }, courseId }) !== new Set(section.questionIds).size) throw new AppError(422, 'TEST_QUESTION_MISSING');
  }
}

assessmentRoutes.get('/:courseId/tests', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const tests = await Test.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const stats = await TestAttempt.aggregate<{ _id: unknown; attempts: number; toGrade: number }>([{ $match: { courseId: course._id } }, { $group: { _id: '$testId', attempts: { $sum: 1 }, toGrade: { $sum: { $cond: [{ $eq: ['$status', 'needs_grading'] }, 1, 0] } } } }]);
    res.json({ success: true, data: tests.map(test => ({ ...testDto(test), attempts: stats.find(row => String(row._id) === String(test._id))?.attempts || 0, toGrade: stats.find(row => String(row._id) === String(test._id))?.toGrade || 0 })) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/tests', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const input = testSchema.parse(req.body);
    await assertSectionsInCourse(course._id, input.sections);
    const test = await Test.create({ ...input, instructions: sanitizeRichText(input.instructions), courseId: course._id, createdBy: req.auth!.userId });
    res.status(201).json({ success: true, data: testDto(test) });
  } catch (error) { next(error); }
});
/**
 * Settings can change at any time; questions (sections) are locked once a student started an attempt, so attempts of the same
 * test stay comparable. Published attempts keep their own question snapshot in any case.
 */
assessmentRoutes.patch('/:courseId/tests/:testId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const input = testFields.partial().parse(req.body);
    const test = await Test.findOne({ _id: parseId(req.params.testId, 'TEST_NOT_FOUND'), courseId: course._id });
    if (!test) throw new AppError(404, 'TEST_NOT_FOUND');
    if (input.sections) {
      if (await TestAttempt.exists({ testId: test._id })) throw new AppError(409, 'TEST_ALREADY_ATTEMPTED');
      await assertSectionsInCourse(course._id, input.sections);
    }
    Object.assign(test, { ...input, ...(input.instructions !== undefined ? { instructions: sanitizeRichText(input.instructions) } : {}) });
    if (test.availableFrom && test.availableUntil && test.availableFrom >= test.availableUntil) throw new AppError(422, 'INVALID_AVAILABILITY_WINDOW');
    if (test.status === 'published') await validateAndLinkTest(test);
    await test.save();
    res.json({ success: true, data: testDto(test) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/tests/:testId/publish', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const { status } = z.object({ status: z.enum(['published', 'closed', 'draft']).default('published') }).strict().parse(req.body ?? {});
    const test = await Test.findOne({ _id: parseId(req.params.testId, 'TEST_NOT_FOUND'), courseId: course._id });
    if (!test) throw new AppError(404, 'TEST_NOT_FOUND');
    if (status === 'draft' && await TestAttempt.exists({ testId: test._id })) throw new AppError(409, 'TEST_ALREADY_ATTEMPTED');
    const maxPoints = status === 'published' ? await validateAndLinkTest(test) : undefined;
    test.status = status;
    await test.save();
    await audit(req, `assessment.test.${status}`, course._id);
    res.json({ success: true, data: { ...testDto(test), maxPoints } });
  } catch (error) { next(error); }
});
assessmentRoutes.delete('/:courseId/tests/:testId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const testId = parseId(req.params.testId, 'TEST_NOT_FOUND');
    if (await TestAttempt.exists({ testId })) throw new AppError(409, 'TEST_ALREADY_ATTEMPTED');
    const deleted = await Test.deleteOne({ _id: testId, courseId: course._id });
    if (!deleted.deletedCount) throw new AppError(404, 'TEST_NOT_FOUND');
    res.json({ success: true, data: { id: testId } });
  } catch (error) { next(error); }
});

const attemptForTeacher = (attempt: any) => ({
  id: String(attempt._id), studentId: String(attempt.studentId?._id || attempt.studentId), studentName: attempt.studentId?.name || '', number: attempt.number, status: attempt.status,
  startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, autoSubmitted: attempt.autoSubmitted, score: attempt.score, maxScore: attempt.maxScore,
  questions: attempt.questions, answers: attempt.answers, autoScores: attempt.autoScores, manual: attempt.manual,
});
assessmentRoutes.get('/:courseId/tests/:testId/attempts', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const attempts = await TestAttempt.find({ courseId: course._id, testId: parseId(req.params.testId, 'TEST_NOT_FOUND') }).sort({ submittedAt: -1 }).populate('studentId', 'name').lean();
    res.json({ success: true, data: attempts.map(attemptForTeacher) });
  } catch (error) { next(error); }
});
/** Manual grading of essay answers (and optional override of automatic scores is not allowed: the key is the reference). */
assessmentRoutes.patch('/:courseId/attempts/:attemptId/grade', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const { scores } = z.object({ scores: z.array(z.object({ questionId: z.string().min(1).max(40), score: z.number().min(0), feedback: z.string().trim().max(4000).default('') }).strict()).min(1).max(200) }).strict().parse(req.body);
    const attempt = await TestAttempt.findOne({ _id: parseId(req.params.attemptId, 'ATTEMPT_NOT_FOUND'), courseId: course._id, status: { $ne: 'in_progress' } }).lean();
    if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND');
    const manual: { questionId: string; score?: number | null; feedback: string }[] = attempt.manual.filter(entry => !scores.some(score => score.questionId === entry.questionId)).map(entry => ({ questionId: entry.questionId, score: entry.score, feedback: entry.feedback }));
    for (const score of scores) {
      const question = attempt.questions.find(candidate => candidate.questionId === score.questionId);
      if (!question || question.type !== 'essay') throw new AppError(422, 'NOT_A_MANUAL_QUESTION');
      if (score.score > (question.points ?? 0)) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
      manual.push(score);
    }
    const total = attemptTotal(attempt.questions as any[], attempt.autoScores as any[], manual);
    const updated = await TestAttempt.findOneAndUpdate({ _id: attempt._id, updatedAt: attempt.updatedAt }, { $set: { manual, score: total, status: total === null ? 'needs_grading' : 'graded' } }, { new: true }).lean();
    if (!updated) throw new AppError(409, 'GRADE_CONFLICT');
    const test = await Test.findById(attempt.testId).lean();
    if (test) await syncTestGrade(test, attempt.studentId);
    res.json({ success: true, data: attemptForTeacher(updated) });
  } catch (error) { next(error); }
});

// --- Tests: student side ----------------------------------------------------------------------------------------------------

const studentQuestion = (question: any) => ({ questionId: question.questionId, type: question.type, prompt: question.prompt, points: question.points, options: question.type === 'true_false' ? [] : question.options });
async function studentAttemptView(attempt: any, test: any) {
  const base = { id: String(attempt._id), testId: String(attempt.testId), number: attempt.number, status: attempt.status, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, submittedAt: attempt.submittedAt, autoSubmitted: attempt.autoSubmitted };
  if (attempt.status === 'in_progress') return { ...base, questions: attempt.questions.map(studentQuestion), answers: attempt.answers };
  // After submission: answers are shown back; the grade and the key only once the teacher published the grade.
  const exception = await studentException(test.courseId, test._id, attempt.studentId);
  const published = !!exception.published;
  return {
    ...base, questions: attempt.questions.map((question: any) => ({
      ...studentQuestion(question),
      ...(published && test.showCorrectAnswers ? { correct: question.correct, explanation: question.explanation } : {}),
    })),
    answers: attempt.answers, gradePublished: published,
    ...(published ? { score: attempt.score, maxScore: attempt.maxScore, feedback: attempt.manual.map((entry: any) => ({ questionId: entry.questionId, score: entry.score, feedback: entry.feedback })), publishedGrade: exception.published } : {}),
  };
}

assessmentRoutes.get('/:courseId/student/tests', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId);
    const tests = await Test.find({ courseId: course._id, status: { $in: ['published', 'closed'] } }).sort({ availableFrom: 1, createdAt: 1 }).lean();
    const attempts = await TestAttempt.find({ courseId: course._id, studentId: req.auth!.userId }).select('testId number status submittedAt deadlineAt').lean();
    for (const attempt of attempts.filter(candidate => candidate.status === 'in_progress' && attemptExpired(candidate))) await finalizeAttempt(attempt._id, { auto: true });
    const fresh = await TestAttempt.find({ courseId: course._id, studentId: req.auth!.userId }).select('testId number status submittedAt deadlineAt').lean();
    const data = [];
    for (const test of tests) {
      const exception = await studentException(course._id, test._id, req.auth!.userId);
      const own = fresh.filter(attempt => String(attempt.testId) === String(test._id));
      data.push({
        id: String(test._id), title: test.title, instructions: test.instructions, availableFrom: test.availableFrom, availableUntil: exception.dueAt || test.availableUntil,
        timeLimitMinutes: test.timeLimitMinutes, maxAttempts: test.maxAttempts + exception.extraAttempts, attemptsUsed: own.length,
        open: test.status === 'published' && withinWindow(test, new Date(), exception.dueAt),
        inProgress: own.find(attempt => attempt.status === 'in_progress') ? String(own.find(attempt => attempt.status === 'in_progress')!._id) : null,
        attempts: own.map(attempt => ({ id: String(attempt._id), number: attempt.number, status: attempt.status, submittedAt: attempt.submittedAt })),
        publishedGrade: exception.published,
      });
    }
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

/** Starts a new attempt, or resumes the one in progress (same questions, same deadline). */
assessmentRoutes.post('/:courseId/student/tests/:testId/attempts', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId, { write: true });
    const test = await Test.findOne({ _id: parseId(req.params.testId, 'TEST_NOT_FOUND'), courseId: course._id, status: 'published' }).lean();
    if (!test) throw new AppError(404, 'TEST_NOT_FOUND');
    const current = await TestAttempt.findOne({ testId: test._id, studentId: req.auth!.userId, status: 'in_progress' }).lean();
    if (current && !attemptExpired(current)) return res.json({ success: true, data: await studentAttemptView(current, test) });
    if (current) await finalizeAttempt(current._id, { auto: true });
    const exception = await studentException(course._id, test._id, req.auth!.userId);
    const now = new Date();
    if (!withinWindow(test, now, exception.dueAt)) throw new AppError(409, 'TEST_NOT_OPEN');
    const used = await TestAttempt.countDocuments({ testId: test._id, studentId: req.auth!.userId });
    if (used >= test.maxAttempts + exception.extraAttempts) throw new AppError(409, 'NO_ATTEMPTS_LEFT');
    const until = exception.dueAt || test.availableUntil;
    const limit = test.timeLimitMinutes ? new Date(now.getTime() + test.timeLimitMinutes * 60_000) : null;
    const deadlineAt = limit && until ? new Date(Math.min(limit.getTime(), new Date(until).getTime())) : limit || until || null;
    let attempt;
    try {
      attempt = await TestAttempt.create({ testId: test._id, courseId: course._id, studentId: req.auth!.userId, number: used + 1, startedAt: now, deadlineAt, questions: await buildAttemptQuestions(test) });
    } catch (error) {
      // Concurrent start (two tabs): the unique "in progress" index keeps a single attempt; return it.
      if ((error as { code?: number }).code !== 11000) throw error;
      attempt = await TestAttempt.findOne({ testId: test._id, studentId: req.auth!.userId, status: 'in_progress' }).lean();
      if (!attempt) throw new AppError(409, 'ATTEMPT_CONFLICT');
    }
    res.status(201).json({ success: true, data: await studentAttemptView(attempt, test) });
  } catch (error) { next(error); }
});

async function ownAttempt(req: AuthRequest) {
  const course = await studentCourse(req, req.params.courseId);
  const attempt = await TestAttempt.findOne({ _id: parseId(req.params.attemptId, 'ATTEMPT_NOT_FOUND'), courseId: course._id, studentId: req.auth!.userId }).lean();
  if (!attempt) throw new AppError(404, 'ATTEMPT_NOT_FOUND');
  const test = await Test.findById(attempt.testId).lean();
  if (!test) throw new AppError(404, 'TEST_NOT_FOUND');
  return { course, attempt, test };
}

assessmentRoutes.get('/:courseId/student/attempts/:attemptId', students, async (req: AuthRequest, res, next) => {
  try {
    let { attempt, test } = await ownAttempt(req);
    if (attempt.status === 'in_progress' && attemptExpired(attempt)) attempt = (await finalizeAttempt(attempt._id, { auto: true }))!;
    res.json({ success: true, data: await studentAttemptView(attempt, test) });
  } catch (error) { next(error); }
});

const answersSchema = z.object({ answers: z.array(z.object({ questionId: z.string().min(1).max(40), optionIds: z.array(z.string().max(40)).max(12).default([]), text: z.string().max(20000).default('') }).strict()).max(200) }).strict();
/** Autosave: answers are kept server-side, so a reload or another device resumes where the student stopped. */
assessmentRoutes.put('/:courseId/student/attempts/:attemptId/answers', students, async (req: AuthRequest, res, next) => {
  try {
    const { attempt, test } = await ownAttempt(req);
    const { answers } = answersSchema.parse(req.body);
    if (attempt.status !== 'in_progress') throw new AppError(409, 'ATTEMPT_CLOSED');
    if (attemptExpired(attempt)) { await finalizeAttempt(attempt._id, { auto: true }); throw new AppError(409, 'ATTEMPT_CLOSED'); }
    const now = new Date();
    const merged = new Map(attempt.answers.map(answer => [answer.questionId, answer]));
    for (const answer of answers) {
      const question = attempt.questions.find(candidate => candidate.questionId === answer.questionId);
      if (!question) throw new AppError(400, 'INVALID_ANSWER');
      const allowed = question.type === 'true_false' ? ['true', 'false'] : question.options.map(option => option.id);
      if (['single', 'multiple', 'true_false'].includes(question.type) && answer.optionIds.some(id => !allowed.includes(id))) throw new AppError(400, 'INVALID_ANSWER');
      if (['single', 'true_false'].includes(question.type) && answer.optionIds.length > 1) throw new AppError(400, 'INVALID_ANSWER');
      merged.set(answer.questionId, { questionId: answer.questionId, optionIds: answer.optionIds, text: ['short', 'essay'].includes(question.type) ? answer.text : '', savedAt: now } as any);
    }
    const updated = await TestAttempt.findOneAndUpdate({ _id: attempt._id, status: 'in_progress' }, { $set: { answers: [...merged.values()] } }, { new: true }).lean();
    if (!updated) throw new AppError(409, 'ATTEMPT_CLOSED');
    res.json({ success: true, data: { savedAt: now, answers: updated.answers, deadlineAt: updated.deadlineAt, testId: String(test._id) } });
  } catch (error) { next(error); }
});

assessmentRoutes.post('/:courseId/student/attempts/:attemptId/submit', students, async (req: AuthRequest, res, next) => {
  try {
    const { attempt, test } = await ownAttempt(req);
    if (attempt.status !== 'in_progress') return res.json({ success: true, data: await studentAttemptView(attempt, test) });
    const finalized = await finalizeAttempt(attempt._id, { auto: attemptExpired(attempt) });
    res.json({ success: true, data: await studentAttemptView(finalized, test) });
  } catch (error) { next(error); }
});

// --- Rubrics ----------------------------------------------------------------------------------------------------------------

const rubricSchema = z.object({
  title: z.string().trim().min(1).max(200), visibleToStudents: z.boolean().default(true),
  criteria: z.array(z.object({
    id: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default(''),
    levels: z.array(z.object({ id: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), points: z.number().min(0).max(1000), description: z.string().trim().max(2000).default('') }).strict()).min(2).max(10),
  }).strict()).min(1).max(30),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.criteria.map(criterion => criterion.id)).size !== value.criteria.length) ctx.addIssue({ code: 'custom', message: 'DUPLICATE_CRITERION' });
  for (const criterion of value.criteria) if (new Set(criterion.levels.map(level => level.id)).size !== criterion.levels.length) ctx.addIssue({ code: 'custom', message: 'DUPLICATE_LEVEL' });
  if (rubricMax(value) <= 0) ctx.addIssue({ code: 'custom', message: 'INVALID_RUBRIC' });
});
const rubricDto = (rubric: any) => ({ id: String(rubric._id), title: rubric.title, criteria: rubric.criteria, visibleToStudents: rubric.visibleToStudents, maxPoints: rubricMax(rubric) });

assessmentRoutes.get('/:courseId/rubrics', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    res.json({ success: true, data: (await Rubric.find({ courseId: course._id }).sort({ createdAt: 1 }).lean()).map(rubricDto) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/rubrics', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    res.status(201).json({ success: true, data: rubricDto(await Rubric.create({ ...rubricSchema.parse(req.body), courseId: course._id })) });
  } catch (error) { next(error); }
});
assessmentRoutes.put('/:courseId/rubrics/:rubricId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const rubric = await Rubric.findOneAndUpdate({ _id: parseId(req.params.rubricId, 'RUBRIC_NOT_FOUND'), courseId: course._id }, { $set: rubricSchema.parse(req.body) }, { new: true }).lean();
    if (!rubric) throw new AppError(404, 'RUBRIC_NOT_FOUND');
    res.json({ success: true, data: rubricDto(rubric) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/rubrics/:rubricId/copy', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const { targetCourseId } = z.object({ targetCourseId: objectId }).strict().parse(req.body);
    const target = await Course.findById(targetCourseId).select('teacherId coOwnerIds').lean();
    if (!target || !await canManageCourse(actorOf(req), target.teacherId, target.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    const rubric = await Rubric.findOne({ _id: parseId(req.params.rubricId, 'RUBRIC_NOT_FOUND'), courseId: course._id }).lean();
    if (!rubric) throw new AppError(404, 'RUBRIC_NOT_FOUND');
    const { _id, createdAt, updatedAt, ...rest } = rubric as any;
    res.status(201).json({ success: true, data: rubricDto(await Rubric.create({ ...rest, courseId: target._id, copiedFrom: _id })) });
  } catch (error) { next(error); }
});

// --- Forms (never graded) ---------------------------------------------------------------------------------------------------

const formSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(''), anonymous: z.boolean().default(false),
  availableFrom: date, availableUntil: date,
  questions: z.array(z.object({ id: z.string().trim().min(1).max(40), type: z.enum(['single', 'multiple', 'text', 'scale']), prompt: z.string().trim().min(1).max(2000), options: z.array(z.string().trim().min(1).max(300)).max(20).default([]), required: z.boolean().default(false) }).strict()
    .refine(question => !['single', 'multiple'].includes(question.type) || question.options.length >= 2, 'OPTIONS_REQUIRED')).min(1).max(100),
}).strict();
const formDto = (form: any) => ({ id: String(form._id), title: form.title, description: form.description, anonymous: form.anonymous, status: form.status, availableFrom: form.availableFrom, availableUntil: form.availableUntil, questions: form.questions });

assessmentRoutes.get('/:courseId/forms', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const forms = await Form.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const counts = await FormResponse.aggregate<{ _id: unknown; count: number }>([{ $match: { courseId: course._id } }, { $group: { _id: '$formId', count: { $sum: 1 } } }]);
    res.json({ success: true, data: forms.map(form => ({ ...formDto(form), responses: counts.find(row => String(row._id) === String(form._id))?.count || 0 })) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/forms', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    res.status(201).json({ success: true, data: formDto(await Form.create({ ...formSchema.parse(req.body), courseId: course._id })) });
  } catch (error) { next(error); }
});
assessmentRoutes.patch('/:courseId/forms/:formId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const input = formSchema.partial().extend({ status: z.enum(['draft', 'published', 'closed']).optional() }).strict().parse(req.body);
    const form = await Form.findOne({ _id: parseId(req.params.formId, 'FORM_NOT_FOUND'), courseId: course._id });
    if (!form) throw new AppError(404, 'FORM_NOT_FOUND');
    // Anonymity cannot be turned off once answers were collected under the promise of anonymity.
    if (input.anonymous === false && form.anonymous && await FormResponse.exists({ formId: form._id })) throw new AppError(409, 'FORM_ANONYMITY_LOCKED');
    if (input.questions && await FormResponse.exists({ formId: form._id })) throw new AppError(409, 'FORM_ALREADY_ANSWERED');
    Object.assign(form, input);
    await form.save();
    res.json({ success: true, data: formDto(form) });
  } catch (error) { next(error); }
});
/** Responses with per-question tallies. Anonymous forms never expose respondents. */
assessmentRoutes.get('/:courseId/forms/:formId/responses', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const form = await Form.findOne({ _id: parseId(req.params.formId, 'FORM_NOT_FOUND'), courseId: course._id }).lean();
    if (!form) throw new AppError(404, 'FORM_NOT_FOUND');
    const responses = await FormResponse.find({ formId: form._id }).sort({ createdAt: 1 }).populate('respondentId', 'name').lean();
    const tallies = form.questions.map(question => ({
      questionId: question.id,
      counts: ['single', 'multiple', 'scale'].includes(question.type) ? Object.fromEntries((question.type === 'scale' ? ['1', '2', '3', '4', '5'] : question.options).map(option => [option, responses.filter(response => response.answers.find(answer => answer.questionId === question.id)?.values.includes(option)).length])) : undefined,
    }));
    res.json({ success: true, data: {
      form: formDto(form), total: responses.length, tallies,
      responses: responses.map(response => ({ id: String(response._id), submittedAt: (response as any).createdAt, respondent: form.anonymous ? null : (response.respondentId as any)?.name || '', answers: response.answers })),
    } });
  } catch (error) { next(error); }
});

assessmentRoutes.get('/:courseId/student/forms', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId);
    const forms = await Form.find({ courseId: course._id, status: { $in: ['published', 'closed'] } }).sort({ createdAt: 1 }).lean();
    const answered = new Set((await FormResponse.find({ formId: { $in: forms.map(form => form._id) }, respondentKey: { $in: forms.map(form => respondentKey(env.JWT_SECRET, String(form._id), req.auth!.userId)) } }).select('formId').lean()).map(row => String(row.formId)));
    res.json({ success: true, data: forms.map(form => ({ ...formDto(form), answered: answered.has(String(form._id)), open: form.status === 'published' && withinWindow(form) })) });
  } catch (error) { next(error); }
});
assessmentRoutes.post('/:courseId/student/forms/:formId/responses', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId, { write: true });
    const form = await Form.findOne({ _id: parseId(req.params.formId, 'FORM_NOT_FOUND'), courseId: course._id, status: 'published' }).lean();
    if (!form) throw new AppError(404, 'FORM_NOT_FOUND');
    if (!withinWindow(form)) throw new AppError(409, 'FORM_NOT_OPEN');
    const { answers } = z.object({ answers: z.array(z.object({ questionId: z.string().min(1).max(40), values: z.array(z.string().max(4000)).max(20) }).strict()).max(100) }).strict().parse(req.body);
    for (const question of form.questions) {
      const answer = answers.find(candidate => candidate.questionId === question.id);
      const values = (answer?.values || []).map(value => value.trim()).filter(Boolean);
      if (question.required && !values.length) throw new AppError(422, 'FORM_ANSWER_REQUIRED');
      if (question.type === 'single' && values.length > 1) throw new AppError(400, 'INVALID_ANSWER');
      if (['single', 'multiple'].includes(question.type) && values.some(value => !question.options.includes(value))) throw new AppError(400, 'INVALID_ANSWER');
      if (question.type === 'scale' && values.some(value => !['1', '2', '3', '4', '5'].includes(value))) throw new AppError(400, 'INVALID_ANSWER');
    }
    if (answers.some(answer => !form.questions.some(question => question.id === answer.questionId))) throw new AppError(400, 'INVALID_ANSWER');
    try {
      await FormResponse.create({ formId: form._id, courseId: course._id, respondentId: form.anonymous ? null : req.auth!.userId, respondentKey: respondentKey(env.JWT_SECRET, String(form._id), req.auth!.userId), answers });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new AppError(409, 'FORM_ALREADY_SUBMITTED');
      throw error;
    }
    res.status(201).json({ success: true, data: { formId: String(form._id) } });
  } catch (error) { next(error); }
});
