import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { createNotification } from '../notifications/service.js';
import { Assignment, AssignmentSubmission } from './models.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { recordSourceGrade } from '../gradebook/service.js';
import { GradeColumn, GradeEntry } from '../gradebook/models.js';
import { Rubric } from '../assessments/models.js';
import { rubricScore } from '../assessments/grading.js';
import { canManageCourse } from '../courses/service.js';
import { CourseAsset } from '../courses/assets.model.js';

export const assignmentRoutes = Router();
assignmentRoutes.use(authenticate);
const id = z.string().regex(/^[a-f\d]{24}$/i);
const storageRoot = privateStorage.uploadDirectory('assignment-submissions');
const fileUploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const assignmentFilesUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(storageRoot, { recursive: true }).then(() => callback(null, storageRoot), error => callback(error as Error, storageRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 3, fields: 6, parts: 9 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.mimetype)) return callback(new AppError(415, 'UNSUPPORTED_ASSIGNMENT_FILE_TYPE'));
    callback(null, true);
  },
}).array('files', 3);
const receiveAssignmentFiles = (req: AuthRequest, res: any, next: (error?: unknown) => void) => assignmentFilesUpload(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'ASSIGNMENT_FILE_TOO_LARGE' : 'INVALID_ASSIGNMENT_UPLOAD'));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_ASSIGNMENT_UPLOAD'));
});
const uploadedFiles = (req: AuthRequest) => (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
const assignmentFileDto = (file: any) => ({ name: file.originalName, type: file.mimeType, url: `/assignments/submission-files/${file._id}` });
const policyFields = {
  lateUntil: z.union([z.null(), z.string().datetime({ offset: true })]).optional(), latePenaltyPercent: z.number().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(0).max(20).optional(), rubricId: z.union([z.null(), id]).optional(), allowLinks: z.boolean().optional(),
  attachments: z.array(z.object({ assetId: id, name: z.string().trim().min(1).max(180) }).strict()).max(10).optional(),
};
const createSchema = z.object({ courseId: id, title: z.string().trim().min(3).max(180), instructions: z.string().trim().min(5).max(12000), dueAt: z.string().datetime({ offset: true }), points: z.number().int().min(1).max(1000).default(100), status: z.enum(['draft', 'published']).default('published'), ...policyFields }).strict();
const webLink = z.string().trim().max(2000).url().refine(value => /^https?:\/\//i.test(value), 'HTTP_URL_REQUIRED');
const policyDto = (row: any) => ({ lateUntil: row.lateUntil ?? null, latePenaltyPercent: row.latePenaltyPercent ?? 0, maxAttempts: row.maxAttempts ?? 0, rubricId: row.rubricId ? String(row.rubricId) : null, allowLinks: row.allowLinks !== false,
  attachments: (row.attachments || []).map((file: any) => ({ assetId: file.assetId, name: file.name, url: `/courses/${String(row.courseId?._id || row.courseId)}/assets/${file.assetId}` })) });
/** Attachments must be files of the same course. */
async function assertAttachments(courseId: unknown, attachments?: { assetId: string }[]) {
  if (!attachments?.length) return;
  const count = await CourseAsset.countDocuments({ courseId, _id: { $in: attachments.map(file => file.assetId) }, kind: { $in: ['block_file', 'resource', 'image'] } });
  if (count !== new Set(attachments.map(file => file.assetId)).size) throw new AppError(422, 'INVALID_COURSE_ASSET_REFERENCE');
}
/** Rubric of an assignment must belong to the same course. */
async function assertRubric(courseId: unknown, rubricId: string | null | undefined) {
  if (rubricId && !await Rubric.exists({ _id: rubricId, courseId })) throw new AppError(422, 'RUBRIC_NOT_FOUND');
}
/** Individual exception (extended due date, extra attempts) granted in the gradebook. */
async function assignmentException(assignment: { _id: unknown; courseId: unknown }, studentId: string) {
  const column = await GradeColumn.findOne({ courseId: assignment.courseId, 'source.kind': 'assignment', 'source.refId': String(assignment._id) }).select('_id').lean();
  const entry = column ? await GradeEntry.findOne({ columnId: column._id, studentId }).select('exception').lean() : null;
  return { dueAt: entry?.exception?.dueAt ?? null, extraAttempts: entry?.exception?.extraAttempts ?? 0 };
}
/** Course managers (owner, co-authors, coordinators, institution, admin) can grade and configure an assignment. */
async function manageableAssignment(req: AuthRequest, assignmentId: string) {
  const assignment = await Assignment.findById(assignmentId);
  if (!assignment) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND');
  const course = await Course.findById(assignment.courseId).select('teacherId coOwnerIds').lean();
  if (!course || !await canManageCourse({ userId: req.auth!.userId, role: req.auth!.role }, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND');
  return assignment;
}
async function ensureVerifiedTeacher(userId: string) {
  const user = await User.findById(userId).select('verified');
  if (!user?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
}

assignmentRoutes.get('/teacher', allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    await ensureVerifiedTeacher(req.auth!.userId);
    const assignments = await Assignment.find({ teacherId: req.auth!.userId }).sort({ dueAt: 1 }).populate('courseId', 'title').lean();
    const submissions = await AssignmentSubmission.find({ assignmentId: { $in: assignments.map(row => row._id) } }).sort({ submittedAt: 1 }).populate('studentId', 'name').lean();
    const byAssignment = new Map<string, typeof submissions>();
    for (const submission of submissions) { const key = String(submission.assignmentId); byAssignment.set(key, [...(byAssignment.get(key) || []), submission]); }
    res.json({ success: true, data: assignments.map(row => ({ id: String(row._id), courseId: String((row.courseId as any)?._id || row.courseId), courseTitle: (row.courseId as any)?.title || '', title: row.title, instructions: row.instructions, dueAt: row.dueAt, points: row.points, status: row.status, ...policyDto(row), submissions: (byAssignment.get(String(row._id)) || []).map(submission => ({ id: String(submission._id), studentId: String((submission.studentId as any)?._id || submission.studentId), studentName: (submission.studentId as any)?.name || '', answerText: submission.answerText, files: (submission.files || []).map(assignmentFileDto), status: submission.status, submittedAt: submission.submittedAt, score: submission.score, feedback: submission.feedback, links: submission.links || [], late: !!submission.late, attemptCount: submission.attemptCount || 1, rawScore: submission.rawScore ?? null, penaltyPercent: submission.penaltyPercent || 0, rubricRatings: submission.rubricRatings || [], history: (submission.history || []).map((entry: any) => ({ ...entry, files: (entry.files || []).map(assignmentFileDto) })) })) })) });
  } catch (error) { next(error); }
});

assignmentRoutes.post('/', allowRoles('teacher'), async (req: AuthRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body), course = await Course.findOne({ _id: input.courseId, teacherId: req.auth!.userId }).select('status');
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    if (new Date(input.dueAt) <= new Date()) throw new AppError(400, 'INVALID_DUE_DATE');
    if (course.status !== 'published' && input.status === 'published') throw new AppError(400, 'PUBLISH_COURSE_FIRST');
    await ensureVerifiedTeacher(req.auth!.userId);
    await assertRubric(input.courseId, input.rubricId);
    await assertAttachments(input.courseId, input.attachments);
    if (input.lateUntil && new Date(input.lateUntil) <= new Date(input.dueAt)) throw new AppError(400, 'INVALID_LATE_WINDOW');
    const assignment = await Assignment.create({ ...input, dueAt: new Date(input.dueAt), lateUntil: input.lateUntil ? new Date(input.lateUntil) : null, teacherId: req.auth!.userId });
    res.status(201).json({ success: true, data: { id: String(assignment._id), ...input, dueAt: assignment.dueAt } });
  } catch (error) { next(error); }
});

assignmentRoutes.get('/', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const enrollments = await Enrollment.find(activeAccess({ studentId: req.auth!.userId })).select('courseId').lean();
    const assignments = await Assignment.find({ courseId: { $in: enrollments.map(item => item.courseId) }, status: 'published' }).sort({ dueAt: 1 }).populate('courseId', 'title').lean();
    const submissions = await AssignmentSubmission.find({ studentId: req.auth!.userId, assignmentId: { $in: assignments.map(row => row._id) } }).lean();
    const byId = new Map(submissions.map(submission => [String(submission.assignmentId), submission]));
    // Controlled publication: once an assignment has a gradebook column, its grade is shown only after the teacher publishes it.
    const columns = await GradeColumn.find({ 'source.kind': 'assignment', 'source.refId': { $in: assignments.map(row => String(row._id)) } }).select('_id source.refId').lean();
    const entries = await GradeEntry.find({ columnId: { $in: columns.map(column => column._id) }, studentId: req.auth!.userId }).select('columnId published').lean();
    // Rubrics shown before submission when the teacher made them visible.
    const rubrics = await Rubric.find({ _id: { $in: assignments.map(row => row.rubricId).filter(Boolean) }, visibleToStudents: true }).select('title criteria').lean();
    const releaseOf = (assignmentId: string) => {
      const column = columns.find(candidate => candidate.source?.refId === assignmentId);
      if (!column) return { gated: false, published: null };
      return { gated: true, published: entries.find(entry => String(entry.columnId) === String(column._id))?.published ?? null };
    };
    res.json({ success: true, data: assignments.map(row => {
      const submission = byId.get(String(row._id));
      const release = releaseOf(String(row._id));
      const visibleGrade = !release.gated ? { score: submission?.score, feedback: submission?.feedback } : release.published ? { score: release.published.score ?? undefined, feedback: release.published.feedback } : { score: undefined, feedback: '' };
      return { id: String(row._id), courseId: String((row.courseId as any)?._id || row.courseId), courseTitle: (row.courseId as any)?.title || '', title: row.title, instructions: row.instructions, dueAt: row.dueAt, points: row.points, ...policyDto(row), rubric: rubrics.find(rubric => String(rubric._id) === String(row.rubricId)) ?? null, status: submission?.status || (row.dueAt < new Date() ? (row.lateUntil && row.lateUntil > new Date() ? 'late_open' : 'overdue') : 'open'), submission: submission ? { id: String(submission._id), answerText: submission.answerText, files: (submission.files || []).map(assignmentFileDto), submittedAt: submission.submittedAt, links: submission.links || [], late: !!submission.late, attemptCount: submission.attemptCount || 1, score: visibleGrade.score, feedback: visibleGrade.feedback, status: release.gated && submission.status === 'graded' && !release.published ? 'submitted' : submission.status } : undefined };
    }) });
  } catch (error) { next(error); }
});

assignmentRoutes.post('/:assignmentId/submissions', allowRoles('student'), fileUploadLimiter, receiveAssignmentFiles, async (req: AuthRequest, res, next) => {
  let persisted = false;
  const storedKeys: string[] = [];
  const files = uploadedFiles(req);
  try {
    const assignmentId = id.safeParse(req.params.assignmentId); if (!assignmentId.success) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND');
    const body = z.object({ answerText: z.string().trim().max(12000).optional().default(''), links: z.union([z.string(), z.array(z.string())]).optional() }).strict().parse(req.body);
    const answerText = body.answerText;
    const links = z.array(webLink).max(5).parse((Array.isArray(body.links) ? body.links : body.links ? [body.links] : []).map(link => link.trim()).filter(Boolean));
    if (!answerText && files.length === 0 && links.length === 0) throw new AppError(400, 'SUBMISSION_CONTENT_REQUIRED');
    const assignment = await Assignment.findOne({ _id: assignmentId.data, status: 'published' });
    if (!assignment) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND');
    if (links.length && assignment.allowLinks === false) throw new AppError(400, 'LINKS_NOT_ALLOWED');
    if (!await Enrollment.exists(activeAccess({ studentId: req.auth!.userId, courseId: assignment.courseId }))) throw new AppError(403, 'ENROLLMENT_REQUIRED');
    // Due date: individual extension first; after it, late work is accepted until `lateUntil` and flagged.
    const exception = await assignmentException(assignment, req.auth!.userId);
    const now = new Date();
    const dueAt = exception.dueAt && exception.dueAt > assignment.dueAt ? exception.dueAt : assignment.dueAt;
    const late = dueAt < now;
    if (late && !(assignment.lateUntil && assignment.lateUntil >= now)) throw new AppError(409, 'ASSIGNMENT_CLOSED');
    const existing = await AssignmentSubmission.findOne({ assignmentId: assignment.id, studentId: req.auth!.userId });
    const multiAttempt = (assignment.maxAttempts || 0) > 0;
    if (existing?.status === 'graded' && !multiAttempt) throw new AppError(409, 'SUBMISSION_ALREADY_GRADED');
    if (existing && multiAttempt && (existing.attemptCount || 1) >= assignment.maxAttempts + exception.extraAttempts) throw new AppError(409, 'NO_ATTEMPTS_LEFT');

    const newFiles: Array<{ originalName: string; storageKey: string; mimeType: string; size: number; uploadedAt: Date }> = [];
    for (const file of files) {
      const bytes = await privateStorage.readUpload(file.path);
      let extension: 'pdf' | 'zip' | 'docx' | undefined;
      if (bytes.subarray(0, 5).toString() === '%PDF-' && file.mimetype === 'application/pdf') extension = 'pdf';
      else if (['application/zip', 'application/x-zip-compressed'].includes(file.mimetype) && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3])) extension = 'zip';
      else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from('word/document.xml'))) extension = 'docx';
      if (!extension) throw new AppError(415, 'INVALID_ASSIGNMENT_FILE_CONTENT');
      const storageKey = `${path.basename(file.filename, '.upload')}.${extension}`;
      await privateStorage.storeUpload('assignment-submissions', storageKey, file.path);
      storedKeys.push(storageKey);
      newFiles.push({ originalName: path.basename(file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `submission.${extension}`, storageKey, mimeType: file.mimetype, size: file.size, uploadedAt: new Date() });
    }

    // Multi-attempt assignments keep previous attempts (and their files) in the history; legacy ones replace the work.
    const oldKeys = files.length && !multiAttempt ? existing?.files.map(file => file.storageKey) || [] : [];
    const values: Record<string, unknown> = { answerText, links, late, status: 'submitted', submittedAt: now };
    if (files.length || multiAttempt) values.files = newFiles;
    const update: Record<string, unknown> = { $set: values };
    if (existing && multiAttempt) {
      values.attemptCount = (existing.attemptCount || 1) + 1;
      values.rubricRatings = []; values.penaltyPercent = 0; values.feedback = '';
      update.$unset = { score: '', rawScore: '', gradedAt: '', graderId: '' };
      update.$push = { history: { answerText: existing.answerText, links: existing.links, files: existing.files, submittedAt: existing.submittedAt, late: existing.late, score: existing.score, feedback: existing.feedback } };
    }
    const guard = existing ? { _id: existing._id, updatedAt: existing.updatedAt } : { assignmentId: assignment.id, studentId: req.auth!.userId };
    const submission = await AssignmentSubmission.findOneAndUpdate(guard, update, { new: true, upsert: !existing, setDefaultsOnInsert: true, runValidators: true });
    if (!submission) throw new AppError(409, 'SUBMISSION_CONFLICT');
    persisted = true;
    for (const key of oldKeys) if (/^[a-f0-9-]{36}\.(pdf|zip|docx)$/.test(key)) await privateStorage.remove('assignment-submissions', key).catch(() => undefined);
    await recordSourceGrade({ courseId: assignment.courseId, kind: 'assignment', refId: String(assignment._id), studentId: req.auth!.userId, score: null, status: 'pending', title: assignment.title, maxPoints: assignment.points, dueAt: assignment.dueAt }).catch(error => console.error('Gradebook sync failed', { name: (error as Error).name }));
    void createNotification({ userId: String(assignment.teacherId), type: 'course', title: 'Assignment submitted', message: 'A student submitted work for grading.', link: '/teacher/assignments', template: { key: 'assignmentSubmitted' } }).catch(() => undefined);
    res.status(existing ? 200 : 201).json({ success: true, data: { id: String(submission!._id), status: submission!.status, submittedAt: submission!.submittedAt, files: submission!.files.map(assignmentFileDto), links: submission!.links, late: submission!.late, attemptCount: submission!.attemptCount } });
  } catch (error) { next(error); }
  finally {
    if (!persisted) await Promise.all([...files.map(file => privateStorage.removeUpload(file.path).catch(() => undefined)), ...storedKeys.map(key => privateStorage.remove('assignment-submissions', key).catch(() => undefined))]);
  }
});

assignmentRoutes.get('/submission-files/:fileId', allowRoles('student', 'teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const fileId = id.safeParse(req.params.fileId); if (!fileId.success) throw new AppError(404, 'ASSIGNMENT_FILE_NOT_FOUND');
    const submission = await AssignmentSubmission.findOne({ $or: [{ 'files._id': fileId.data }, { 'history.files._id': fileId.data }] }).lean();
    const file = [...(submission?.files || []), ...(submission?.history || []).flatMap(entry => entry.files || [])].find(candidate => String(candidate._id) === fileId.data);
    if (!submission || !file) throw new AppError(404, 'ASSIGNMENT_FILE_NOT_FOUND');
    let allowed = req.auth!.role === 'admin' || String(submission.studentId) === req.auth!.userId;
    if (!allowed && req.auth!.role === 'teacher') {
      await ensureVerifiedTeacher(req.auth!.userId);
      allowed = !!await manageableAssignment(req, String(submission.assignmentId)).catch(() => null);
    }
    if (!allowed) throw new AppError(404, 'ASSIGNMENT_FILE_NOT_FOUND');
    if (!/^[a-f0-9-]{36}\.(pdf|zip|docx)$/.test(file.storageKey)) throw new AppError(404, 'ASSIGNMENT_FILE_NOT_FOUND');
    privateStorage.send('assignment-submissions', file.storageKey, res, { mimeType: file.mimeType, downloadName: file.originalName, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }, error => {
      if (error && !res.headersSent) next(new AppError(404, 'ASSIGNMENT_FILE_NOT_FOUND'));
    });
  } catch (error) { next(error); }
});

assignmentRoutes.patch('/:assignmentId/submissions/:submissionId/grade', allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    if (req.auth!.role === 'teacher') await ensureVerifiedTeacher(req.auth!.userId);
    const assignmentId = id.safeParse(req.params.assignmentId), submissionId = id.safeParse(req.params.submissionId);
    if (!assignmentId.success || !submissionId.success) throw new AppError(404, 'SUBMISSION_NOT_FOUND');
    const input = z.object({ score: z.number().min(0).optional(), rubricRatings: z.array(z.object({ criterionId: z.string().min(1).max(40), levelId: z.string().min(1).max(40) }).strict()).max(30).optional(), feedback: z.string().trim().max(4000).default('') }).strict()
      .refine(value => value.score !== undefined || value.rubricRatings !== undefined, 'SCORE_REQUIRED').parse(req.body);
    const feedback = input.feedback;
    const assignment = await manageableAssignment(req, assignmentId.data);
    // Rubric grading computes the score from the selected levels, scaled to the assignment points.
    let rawScore = input.score ?? 0;
    if (input.rubricRatings) {
      const rubric = assignment.rubricId ? await Rubric.findOne({ _id: assignment.rubricId, courseId: assignment.courseId }).lean() : null;
      if (!rubric) throw new AppError(422, 'RUBRIC_NOT_FOUND');
      try { rawScore = rubricScore(rubric as any, input.rubricRatings, assignment.points).score; } catch (error) { throw new AppError(422, (error as { code?: string }).code || 'RUBRIC_INCOMPLETE'); }
    }
    if (rawScore > assignment.points) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
    const current = await AssignmentSubmission.findOne({ _id: submissionId.data, assignmentId: assignment.id, status: 'submitted' }).lean();
    if (!current) throw new AppError(404, 'SUBMISSION_NOT_FOUND');
    // Late penalty (flat percentage) applies to late work only; the raw score is kept for transparency.
    const penaltyPercent = current.late ? assignment.latePenaltyPercent || 0 : 0;
    const score = Math.round(rawScore * (1 - penaltyPercent / 100) * 100) / 100;
    const submission = await AssignmentSubmission.findOneAndUpdate({ _id: current._id, status: 'submitted' }, { $set: { score, rawScore, penaltyPercent, rubricRatings: input.rubricRatings || [], feedback, status: 'graded', gradedAt: new Date(), graderId: req.auth!.userId } }, { new: true });
    if (!submission) throw new AppError(404, 'SUBMISSION_NOT_FOUND');
    // The grade goes to the gradebook unpublished: the student is notified when the teacher publishes it.
    await recordSourceGrade({ courseId: assignment.courseId, kind: 'assignment', refId: String(assignment._id), studentId: submission.studentId, score, feedback, status: 'graded', title: assignment.title, maxPoints: assignment.points, dueAt: assignment.dueAt, graderId: req.auth!.userId });
    res.json({ success: true, data: { id: String(submission._id), status: submission.status, score: submission.score, rawScore: submission.rawScore, penaltyPercent: submission.penaltyPercent, feedback: submission.feedback, gradedAt: submission.gradedAt } });
  } catch (error) { next(error); }
});

/** Assignment settings (late policy, attempts, rubric, links, schedule) by course managers. Points are locked once graded. */
assignmentRoutes.patch('/:assignmentId', allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const assignmentId = id.safeParse(req.params.assignmentId); if (!assignmentId.success) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND');
    const input = z.object({ title: z.string().trim().min(3).max(180).optional(), instructions: z.string().trim().min(5).max(12000).optional(), dueAt: z.string().datetime({ offset: true }).optional(), points: z.number().int().min(1).max(1000).optional(), status: z.enum(['draft', 'published', 'closed']).optional(), ...policyFields }).strict()
      .refine(value => Object.keys(value).length > 0, 'At least one field is required').parse(req.body);
    const assignment = await manageableAssignment(req, assignmentId.data);
    if (input.points !== undefined && input.points !== assignment.points && await AssignmentSubmission.exists({ assignmentId: assignment._id, status: 'graded' })) throw new AppError(409, 'ASSIGNMENT_POINTS_LOCKED');
    await assertRubric(assignment.courseId, input.rubricId);
    await assertAttachments(assignment.courseId, input.attachments);
    Object.assign(assignment, { ...input, ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}), ...(input.lateUntil !== undefined ? { lateUntil: input.lateUntil ? new Date(input.lateUntil) : null } : {}) });
    if (assignment.lateUntil && assignment.lateUntil <= assignment.dueAt) throw new AppError(400, 'INVALID_LATE_WINDOW');
    await assignment.save();
    res.json({ success: true, data: { id: String(assignment._id), title: assignment.title, dueAt: assignment.dueAt, points: assignment.points, status: assignment.status, ...policyDto(assignment) } });
  } catch (error) { next(error); }
});

/** Assignments of one course for its managers (co-authors included), with submissions. */
assignmentRoutes.get('/course/:courseId', allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const courseId = id.safeParse(req.params.courseId); if (!courseId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const course = await Course.findById(courseId.data).select('teacherId coOwnerIds').lean();
    if (!course || !await canManageCourse({ userId: req.auth!.userId, role: req.auth!.role }, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    const assignments = await Assignment.find({ courseId: courseId.data }).sort({ dueAt: 1 }).lean();
    const submissions = await AssignmentSubmission.find({ assignmentId: { $in: assignments.map(row => row._id) } }).populate('studentId', 'name').lean();
    res.json({ success: true, data: assignments.map(row => ({
      id: String(row._id), title: row.title, instructions: row.instructions, dueAt: row.dueAt, points: row.points, status: row.status, ...policyDto(row),
      submissions: submissions.filter(submission => String(submission.assignmentId) === String(row._id)).map(submission => ({
        id: String(submission._id), studentId: String((submission.studentId as any)?._id || submission.studentId), studentName: (submission.studentId as any)?.name || '',
        answerText: submission.answerText, links: submission.links || [], files: (submission.files || []).map(assignmentFileDto), status: submission.status, submittedAt: submission.submittedAt,
        late: !!submission.late, attemptCount: submission.attemptCount || 1, score: submission.score ?? null, rawScore: submission.rawScore ?? null, penaltyPercent: submission.penaltyPercent || 0,
        feedback: submission.feedback, rubricRatings: submission.rubricRatings || [], history: (submission.history || []).map((entry: any) => ({ ...entry, files: (entry.files || []).map(assignmentFileDto) })),
      })),
    })) });
  } catch (error) { next(error); }
});
