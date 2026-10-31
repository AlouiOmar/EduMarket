import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, optionalAuthenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Course } from '../courses/model.js';
import { issueCompletionCertificate } from '../certificates/service.js';
import { Certificate } from '../certificates/model.js';
import { Exam, ExamAttempt, ExamRegistration, InPersonExamResult } from './models.js';
import { User } from '../auth/model.js';
import { Enrollment } from '../enrollments/model.js';
import { canManageCourse, institutionOf, teacherAffiliation } from '../courses/service.js';
import { ClassGroup } from '../classes/model.js';
import { hasClassAccess } from '../classes/service.js';

export const examRoutes = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i);
/** Exam creator, admin, the creator's institution, or that institution's coordinators and examiners. */
async function canManageExam(auth: NonNullable<AuthRequest['auth']>, creatorId: unknown) {
  if (auth.role === 'admin' || String(creatorId) === auth.userId) return true;
  if (auth.role === 'institution') return await institutionOf(creatorId) === auth.userId;
  if (auth.role !== 'teacher') return false;
  const affiliation = await teacherAffiliation(auth.userId);
  return !!affiliation && affiliation.role !== 'teacher' && await institutionOf(creatorId) === affiliation.institutionId;
}
const question = z.object({ id: z.string().trim().min(1).max(100), question: z.string().trim().min(1).max(2000), options: z.array(z.string().trim().min(1).max(500)).min(2).max(10), correctOptionIndex: z.number().int().min(0).max(9), explanation: z.string().max(1000).optional() }).refine(q => q.correctOptionIndex < q.options.length);
const createExam = z.object({ courseId: id, title: z.string().trim().min(3).max(180), description: z.string().trim().min(1).max(4000), type: z.enum(['online', 'in_person']), fee: z.number().min(0).max(100000).default(0), durationMinutes: z.number().int().min(1).max(360), passPercentage: z.number().min(0).max(100), date: z.string().datetime({ offset: true }).optional(), location: z.object({ venue: z.string().trim().min(1).max(200), address: z.string().trim().max(300).optional(), city: z.string().trim().max(100), capacity: z.number().int().min(1) }).optional(), questions: z.array(question).max(100), status: z.enum(['draft', 'published']).default('draft') }).strict().superRefine((v, ctx) => {
  if (new Set(v.questions.map(q => q.id)).size !== v.questions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate question IDs' });
  if (v.type === 'online' && v.questions.length === 0) ctx.addIssue({ code: 'custom', message: 'Online exams need questions' });
  if (v.type === 'in_person' && (!v.location || !v.date)) ctx.addIssue({ code: 'custom', message: 'In-person exams need a date and location' });
});

function toPublic(exam: any, registered = false, attempt?: any) {
  return { id: String(exam._id), courseId: String(exam.courseId?._id || exam.courseId), courseTitle: exam.courseId?.title || '', title: exam.title, description: exam.description, type: exam.type, fee: exam.fee, durationMinutes: exam.durationMinutes, passPercentage: exam.passPercentage, date: exam.date, location: exam.location ? { ...exam.location, enrolledCount: exam.enrolledCount || 0 } : undefined, totalQuestions: exam.questions?.length || 0, isEnrolled: registered, userResult: attempt?.submittedAt ? { score: attempt.score, passed: attempt.passed, date: attempt.submittedAt } : undefined };
}

examRoutes.get('/', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const studentId = req.auth?.role === 'student' ? req.auth.userId : '';
    // Exams of restricted courses are only listed for students of the classes the course is assigned to.
    const restricted = await Course.find({ visibility: 'restricted' }).distinct('_id');
    const opened = studentId && restricted.length ? await ClassGroup.find({ studentIds: studentId, archivedAt: null }).distinct('courseIds') : [];
    const hidden = restricted.filter(courseId => !opened.some(id => String(id) === String(courseId)));
    const exams = await Exam.find({ status: 'published', courseId: { $nin: hidden } }).sort({ date: 1, createdAt: -1 }).populate('courseId', 'title').lean();
    const [registrations, attempts, counts] = studentId ? await Promise.all([
      ExamRegistration.find({ studentId }).select('examId').lean(), ExamAttempt.find({ studentId }).select('examId submittedAt score passed').lean(),
      ExamRegistration.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: '$examId', count: { $sum: 1 } } }]),
    ]) : [[], [], await ExamRegistration.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: '$examId', count: { $sum: 1 } } }])];
    const registered = new Set(registrations.map(row => String(row.examId))), attemptsByExam = new Map(attempts.map(row => [String(row.examId), row])), enrolledCount = new Map(counts.map(row => [String(row._id), row.count]));
    const inPersonResults = studentId ? await InPersonExamResult.find({ studentId }).lean() : [];
    const resultByExam = new Map(inPersonResults.map(result => [String(result.examId), result]));
    res.json({ success: true, data: exams.map(exam => {
      const examId = String(exam._id), attempt = attemptsByExam.get(examId), result = resultByExam.get(examId);
      const dto = toPublic({ ...exam, enrolledCount: enrolledCount.get(examId) }, registered.has(examId), attempt);
      return !attempt && result ? { ...dto, userResult: { score: result.score, passed: result.passed, date: result.gradedAt } } : dto;
    }) });
  } catch (error) { next(error); }
});

examRoutes.get('/manage', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    let creatorIds: unknown[] = [req.auth!.userId];
    const affiliation = req.auth!.role === 'teacher' ? await teacherAffiliation(req.auth!.userId) : null;
    const institutionId = req.auth!.role === 'institution' ? req.auth!.userId : affiliation && affiliation.role !== 'teacher' ? affiliation.institutionId : null;
    if (req.auth!.role === 'admin') creatorIds = [];
    else if (institutionId) {
      const teachers = await User.find({ institutionId, role: 'teacher', verified: true }).select('_id').lean();
      creatorIds = [...new Set([req.auth!.userId, institutionId, ...teachers.map(teacher => String(teacher._id))])];
    }
    const filter = req.auth!.role === 'admin' ? { type: 'in_person' } : { creatorId: { $in: creatorIds }, type: 'in_person' };
    const exams = await Exam.find(filter).sort({ date: -1 }).populate('courseId', 'title').lean();
    res.json({ success: true, data: exams.map(exam => toPublic(exam)) });
  } catch (error) { next(error); }
});

examRoutes.post('/', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const input = createExam.parse(req.body), course = await Course.findById(input.courseId).select('teacherId coOwnerIds status');
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    if (req.auth!.role === 'teacher' || req.auth!.role === 'institution') {
      if (!await canManageCourse(req.auth!, course.teacherId, course.coOwnerIds) && !await canManageExam(req.auth!, course.teacherId)) throw new AppError(403, 'FORBIDDEN');
      if (req.auth!.role === 'teacher') {
        const user = await User.findById(req.auth!.userId).select('verified');
        if (!user?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
      }
      if (input.status === 'published' && course.status !== 'published') throw new AppError(400, 'PUBLISH_COURSE_FIRST');
    }
    const exam = await Exam.create({ ...input, date: input.date ? new Date(input.date) : undefined, creatorId: req.auth!.userId });
    res.status(201).json({ success: true, data: { id: String(exam._id), title: exam.title, status: exam.status } });
  } catch (error) { next(error); }
});

examRoutes.get('/:examId/registrations', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const exam = await Exam.findById(examId.data).select('creatorId type title passPercentage');
    if (!exam || exam.type !== 'in_person') throw new AppError(404, 'IN_PERSON_EXAM_NOT_FOUND');
    if (!await canManageExam(req.auth!, exam.creatorId)) throw new AppError(403, 'FORBIDDEN');
    const registrations = await ExamRegistration.find({ examId: exam._id }).sort({ registeredAt: 1 }).populate('studentId', 'name email').lean();
    const results = await InPersonExamResult.find({ examId: exam._id }).lean();
    const byStudent = new Map(results.map(result => [String(result.studentId), result]));
    res.json({ success: true, data: registrations.map(row => {
      const student = row.studentId as any, result = byStudent.get(String(student._id));
      return { studentId: String(student._id), studentName: student.name, email: student.email, registeredAt: row.registeredAt, result: result ? { score: result.score, passed: result.passed, feedback: result.feedback, gradedAt: result.gradedAt } : null };
    }) });
  } catch (error) { next(error); }
});

examRoutes.patch('/:examId/registrations/:studentId/result', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId), studentId = id.safeParse(req.params.studentId);
    if (!examId.success || !studentId.success) throw new AppError(404, 'EXAM_REGISTRATION_NOT_FOUND');
    const input = z.object({ score: z.number().min(0).max(100), feedback: z.string().trim().max(2000).default('') }).strict().parse(req.body);
    const exam = await Exam.findById(examId.data).select('creatorId type passPercentage');
    if (!exam || exam.type !== 'in_person') throw new AppError(404, 'IN_PERSON_EXAM_NOT_FOUND');
    if (!await canManageExam(req.auth!, exam.creatorId)) throw new AppError(403, 'FORBIDDEN');
    if (!await ExamRegistration.exists({ examId: exam._id, studentId: studentId.data })) throw new AppError(404, 'EXAM_REGISTRATION_NOT_FOUND');
    const result = await InPersonExamResult.findOneAndUpdate({ examId: exam._id, studentId: studentId.data }, { $set: { score: input.score, passed: input.score >= exam.passPercentage, feedback: input.feedback, gradedBy: req.auth!.userId, gradedAt: new Date() } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    const course = await Course.findById(exam.courseId).select('hasCertification certificationPathway').lean();
    const completedCourse = course?.certificationPathway === 'both' && await Enrollment.exists({ studentId: studentId.data, courseId: exam.courseId, completedAt: { $ne: null } });
    const certificateIssued = Boolean(result.passed && course?.hasCertification && (course.certificationPathway === 'in_person_exam' || (course.certificationPathway === 'both' && completedCourse)));
    if (certificateIssued) await issueCompletionCertificate(studentId.data, String(exam.courseId));
    res.json({ success: true, data: { studentId: String(result.studentId), score: result.score, passed: result.passed, feedback: result.feedback, gradedAt: result.gradedAt, certificateIssued } });
  } catch (error) { next(error); }
});

examRoutes.post('/:examId/enroll', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const exam = await Exam.findOne({ _id: examId.data, status: 'published' }); if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND');
    if (await Course.exists({ _id: exam.courseId, visibility: 'restricted' }) && !await hasClassAccess(req.auth!.userId, exam.courseId)) throw new AppError(404, 'EXAM_NOT_FOUND');
    if (exam.fee > 0) throw new AppError(402, 'PAYMENT_REQUIRED');
    if (exam.type === 'online' && exam.date && exam.date <= new Date()) throw new AppError(409, 'EXAM_CLOSED');
    const existing = await ExamRegistration.findOne({ examId: exam.id, studentId: req.auth!.userId });
    if (existing) { res.json({ success: true, data: { examId: exam.id, registeredAt: existing.registeredAt, alreadyRegistered: true } }); return; }
    let reserved = false;
    if (exam.type === 'in_person' && exam.location?.capacity) {
      const capacityReservation = await Exam.findOneAndUpdate({ _id: exam.id, registeredCount: { $lt: exam.location.capacity } }, { $inc: { registeredCount: 1 } }, { new: true });
      if (!capacityReservation) throw new AppError(409, 'EXAM_FULL');
      reserved = true;
    }
    try {
      const registration = await ExamRegistration.create({ examId: exam.id, studentId: req.auth!.userId });
      if (!reserved) await Exam.updateOne({ _id: exam.id }, { $inc: { registeredCount: 1 } });
      res.status(201).json({ success: true, data: { examId: exam.id, registeredAt: registration.registeredAt } });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) { if (reserved) await Exam.updateOne({ _id: exam.id }, { $inc: { registeredCount: -1 } }); throw error; }
      if (reserved) await Exam.updateOne({ _id: exam.id }, { $inc: { registeredCount: -1 } });
      res.json({ success: true, data: { examId: exam.id, alreadyRegistered: true } });
    }
  } catch (error) { next(error); }
});

examRoutes.get('/:examId', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const registration = await ExamRegistration.exists({ examId: examId.data, studentId: req.auth!.userId });
    if (!registration) throw new AppError(403, 'EXAM_REGISTRATION_REQUIRED');
    const [exam, attempt, inPersonResult] = await Promise.all([Exam.findOne({ _id: examId.data, status: 'published' }).populate('courseId', 'title').lean(), ExamAttempt.findOne({ examId: examId.data, studentId: req.auth!.userId }).lean(), InPersonExamResult.findOne({ examId: examId.data, studentId: req.auth!.userId }).lean()]);
    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND');
    const certificateIssued = Boolean(attempt?.passed && await Certificate.exists({ studentId: req.auth!.userId, courseId: exam.courseId }));
    const userResult = attempt?.submittedAt ? { score: attempt.score, passed: attempt.passed, date: attempt.submittedAt, certificateIssued } : undefined;
    const result = userResult || (inPersonResult ? { score: inPersonResult.score, passed: inPersonResult.passed, date: inPersonResult.gradedAt } : undefined);
    res.json({ success: true, data: { ...toPublic(exam, true, userResult ? { ...userResult, submittedAt: userResult.date } : undefined), userResult: result, questions: exam.questions.map((q: any) => ({ id: q.id, question: q.question, options: q.options })), startedAt: attempt?.startedAt, submittedAt: attempt?.submittedAt } });
  } catch (error) { next(error); }
});

examRoutes.post('/:examId/attempts/start', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    if (!await ExamRegistration.exists({ examId: examId.data, studentId: req.auth!.userId })) throw new AppError(403, 'EXAM_REGISTRATION_REQUIRED');
    const exam = await Exam.findOne({ _id: examId.data, status: 'published', type: 'online' }); if (!exam) throw new AppError(404, 'ONLINE_EXAM_NOT_FOUND');
    if (exam.date && exam.date > new Date()) throw new AppError(409, 'EXAM_NOT_STARTED');
    if (exam.date && Date.now() - exam.date.getTime() > 24 * 60 * 60 * 1000) throw new AppError(409, 'EXAM_CLOSED');
    let attempt = await ExamAttempt.findOne({ examId: exam.id, studentId: req.auth!.userId });
    if (!attempt) { try { attempt = await ExamAttempt.create({ examId: exam.id, studentId: req.auth!.userId, startedAt: new Date() }); } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; attempt = await ExamAttempt.findOne({ examId: exam.id, studentId: req.auth!.userId }); } }
    if (!attempt || attempt.submittedAt) throw new AppError(409, 'EXAM_ATTEMPT_CLOSED');
    if (Date.now() > attempt.startedAt.getTime() + exam.durationMinutes * 60_000 + 30_000) {
      await ExamAttempt.updateOne({ _id: attempt.id, submittedAt: null }, { $set: { submittedAt: new Date(), score: 0, passed: false, answers: [] } });
      throw new AppError(409, 'EXAM_TIME_EXPIRED');
    }
    res.json({ success: true, data: { startedAt: attempt.startedAt, deadline: new Date(attempt.startedAt.getTime() + exam.durationMinutes * 60_000) } });
  } catch (error) { next(error); }
});

examRoutes.post('/:examId/attempts', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const examId = id.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const { answers } = z.object({ answers: z.array(z.object({ questionId: z.string().min(1).max(100), selectedOptionIndex: z.number().int().min(0).max(9) })).max(100).refine(v => new Set(v.map(a => a.questionId)).size === v.length) }).strict().parse(req.body);
    const exam = await Exam.findOne({ _id: examId.data, status: 'published', type: 'online' }).lean(); if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND');
    const questions = exam.questions as Array<{ id: string; options: string[]; correctOptionIndex: number }>;
    if (answers.some(answer => !questions.some(q => q.id === answer.questionId && answer.selectedOptionIndex < q.options.length))) throw new AppError(400, 'INVALID_EXAM_ANSWERS');
    const attempt = await ExamAttempt.findOne({ examId: exam._id, studentId: req.auth!.userId, submittedAt: null });
    if (!attempt) throw new AppError(409, 'EXAM_ATTEMPT_NOT_STARTED');
    if (Date.now() > attempt.startedAt.getTime() + exam.durationMinutes * 60_000 + 30_000) throw new AppError(409, 'EXAM_TIME_EXPIRED');
    const correct = questions.filter(q => answers.some(a => a.questionId === q.id && a.selectedOptionIndex === q.correctOptionIndex)).length;
    const score = Math.round(correct / questions.length * 100), passed = score >= exam.passPercentage;
    const submitted = await ExamAttempt.findOneAndUpdate({ _id: attempt.id, submittedAt: null }, { $set: { answers, score, passed, submittedAt: new Date() } }, { new: true });
    if (!submitted) throw new AppError(409, 'EXAM_ATTEMPT_CLOSED');
    const course = await Course.findById(exam.courseId).select('hasCertification certificationPathway').lean();
    const completedCourse = course?.certificationPathway === 'both' && await Enrollment.exists({ studentId: req.auth!.userId, courseId: exam.courseId, completedAt: { $ne: null } });
    const certificateIssued = Boolean(passed && course?.hasCertification && (course.certificationPathway === 'online_exam' || (course.certificationPathway === 'both' && completedCourse)));
    if (certificateIssued) await issueCompletionCertificate(req.auth!.userId, String(exam.courseId));
    res.status(201).json({ success: true, data: { score, passed, passPercentage: exam.passPercentage, submittedAt: submitted.submittedAt, certificateIssued } });
  } catch (error) { next(error); }
});
