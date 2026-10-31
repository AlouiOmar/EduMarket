import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { TeacherApplication } from '../teacher-applications/model.js';

export const teacherVerificationRoutes = Router();
const submissionLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const storageRoot = privateStorage.uploadDirectory('teacher-evidence');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(storageRoot, { recursive: true }).then(() => callback(null, storageRoot), error => callback(error as Error, storageRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)) return callback(new AppError(415, 'UNSUPPORTED_DOCUMENT_TYPE'));
    callback(null, true);
  },
}).single('file');
const receiveDocument = (req: AuthRequest, _res: any, next: (error?: unknown) => void) => upload(req, _res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'DOCUMENT_TOO_LARGE' : 'INVALID_UPLOAD'));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_UPLOAD'));
});
const requestSchema = z.object({
  specialty: z.string().trim().min(3).max(160),
  registrationNumber: z.string().trim().max(80).default(''),
  credentialsSummary: z.string().trim().min(30).max(2000),
}).strict();

const toRequestDto = (user: any) => ({
  id: String(user._id), teacherId: String(user._id), teacherName: user.name, email: user.email,
  specialty: user.teacherVerification.specialty,
  registrationNumber: user.teacherVerification.registrationNumber,
  credentialsSummary: user.teacherVerification.credentialsSummary,
  submittedAt: user.teacherVerification.submittedAt,
  status: user.teacherVerification.status,
  documents: (user.teacherVerification.documents || []).map((document: any) => ({
    name: document.originalName, type: document.mimeType, url: `/teacher-verifications/documents/${document._id}`,
  })),
  notes: user.teacherVerification.reviewNote,
});

teacherVerificationRoutes.get('/mine', authenticate, allowRoles('student', 'unverified_teacher', 'teacher'), async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).select('name email teacherVerification').lean();
    if (!user) throw new AppError(404, 'USER_NOT_FOUND');
    res.json({ success: true, data: user.teacherVerification ? toRequestDto(user) : null });
  } catch (error) { next(error); }
});

teacherVerificationRoutes.post('/', authenticate, allowRoles('student', 'unverified_teacher'), submissionLimiter, async (req: AuthRequest, res, next) => {
  try {
    const input = requestSchema.parse(req.body);
    const user = await User.findById(req.auth!.userId).select('name email role verified teacherVerification institutionId teacherType');
    if (!user) throw new AppError(404, 'USER_NOT_FOUND');
    if (user.teacherVerification?.status === 'pending') throw new AppError(409, 'VERIFICATION_ALREADY_PENDING');
    // Accounts with a full teacher application go through it (no second, lighter path to the same permissions).
    if (await TeacherApplication.exists({ userId: user._id })) throw new AppError(409, 'USE_TEACHER_APPLICATION');
    if (user.get('institutionId') || user.get('teacherType') === 'institutional') throw new AppError(409, 'INSTITUTIONAL_TEACHER');
    const submittedAt = new Date();
    user.role = 'unverified_teacher';
    user.verified = false;
    user.teacherVerification = { ...input, status: 'pending', submittedAt, reviewNote: '', documents: user.teacherVerification?.documents || [] };
    await user.save();
    res.status(201).json({ success: true, data: toRequestDto(user.toObject()) });
  } catch (error) { next(error); }
});

teacherVerificationRoutes.post('/documents', authenticate, allowRoles('student', 'unverified_teacher'), uploadLimiter, receiveDocument, async (req: AuthRequest, res, next) => {
  let persisted = false;
  let storedKey: string | undefined;
  try {
    if (!req.file) throw new AppError(400, 'DOCUMENT_REQUIRED');
    const bytes = await privateStorage.readUpload(req.file.path);
    let extension: 'pdf' | 'png' | 'jpg' | undefined;
    let mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | undefined;
    if (bytes.subarray(0, 5).toString() === '%PDF-') { extension = 'pdf'; mimeType = 'application/pdf'; }
    else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { extension = 'png'; mimeType = 'image/png'; }
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { extension = 'jpg'; mimeType = 'image/jpeg'; }
    if (!extension || !mimeType || mimeType !== req.file.mimetype) throw new AppError(415, 'INVALID_DOCUMENT_CONTENT');

    const user = await User.findById(req.auth!.userId).select('name email teacherVerification');
    if (!user?.teacherVerification) throw new AppError(409, 'VERIFICATION_APPLICATION_REQUIRED');
    if (user.teacherVerification.status === 'approved') throw new AppError(409, 'VERIFICATION_ALREADY_APPROVED');
    const storageKey = `${path.basename(req.file.filename, '.upload')}.${extension}`;
    storedKey = storageKey;
    await privateStorage.storeUpload('teacher-evidence', storageKey, req.file.path);
    const originalName = path.basename(req.file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `evidence.${extension}`;
    const documentRecord = { originalName, storageKey, mimeType, size: req.file.size, uploadedAt: new Date() };
    const updatedUser = await User.findOneAndUpdate({
      _id: req.auth!.userId,
      'teacherVerification.status': { $in: ['pending', 'rejected'] },
      $expr: { $lt: [{ $size: { $ifNull: ['$teacherVerification.documents', []] } }, 5] },
    }, { $push: { 'teacherVerification.documents': documentRecord } }, { new: true, runValidators: true }).select('teacherVerification');
    if (!updatedUser) {
      const latest = await User.findById(req.auth!.userId).select('teacherVerification').lean();
      if (!latest?.teacherVerification) throw new AppError(409, 'VERIFICATION_APPLICATION_REQUIRED');
      if (latest.teacherVerification.status === 'approved') throw new AppError(409, 'VERIFICATION_ALREADY_APPROVED');
      throw new AppError(409, 'DOCUMENT_LIMIT_REACHED');
    }
    persisted = true;
    await AuditEvent.create({ action: 'teacher.verification.document.uploaded', actorId: req.auth!.userId, targetType: 'user', targetId: String(updatedUser._id), severity: 'info', ipAddress: req.ip });
    const document = updatedUser.teacherVerification!.documents[updatedUser.teacherVerification!.documents.length - 1];
    res.status(201).json({ success: true, data: { name: document.originalName, type: document.mimeType, url: `/teacher-verifications/documents/${document._id}` } });
  } catch (error) { next(error); }
  finally { if (req.file && !persisted) { if (storedKey) await privateStorage.remove('teacher-evidence', storedKey).catch(() => undefined); await privateStorage.removeUpload(req.file.path).catch(() => undefined); } }
});

teacherVerificationRoutes.get('/documents/:documentId', authenticate, allowRoles('student', 'unverified_teacher', 'teacher', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const documentId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.documentId);
    const user = await User.findOne({ 'teacherVerification.documents._id': documentId }).select('teacherVerification').lean();
    const document = user?.teacherVerification?.documents?.find((candidate: any) => String(candidate._id) === documentId);
    if (!user || !document || (req.auth!.role !== 'admin' && String(user._id) !== req.auth!.userId)) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
    if (!/^[a-f0-9-]{36}\.(pdf|png|jpg)$/.test(document.storageKey)) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
    privateStorage.send('teacher-evidence', document.storageKey, res, { mimeType: document.mimeType, downloadName: document.originalName, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }, error => {
      if (error && !res.headersSent) next(new AppError(404, 'DOCUMENT_NOT_FOUND'));
    });
  } catch (error) { next(error); }
});

teacherVerificationRoutes.get('/admin', authenticate, allowRoles('admin'), async (_req, res, next) => {
  try {
    const users = await User.find({ 'teacherVerification.status': { $in: ['pending', 'approved', 'rejected'] } })
      .select('name email teacherVerification').sort({ 'teacherVerification.submittedAt': -1 }).lean();
    res.json({ success: true, data: users.map(toRequestDto) });
  } catch (error) { next(error); }
});

teacherVerificationRoutes.patch('/admin/:userId', authenticate, allowRoles('admin'), async (req: AuthRequest, res, next) => {
  try {
    const userId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.userId);
    const input = z.object({ status: z.enum(['approved', 'rejected']), reviewNote: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const user = await User.findOneAndUpdate(
      { _id: userId, 'teacherVerification.status': 'pending' },
      { $set: {
        role: input.status === 'approved' ? 'teacher' : 'unverified_teacher',
        verified: input.status === 'approved',
        'teacherVerification.status': input.status,
        'teacherVerification.reviewedAt': new Date(),
        'teacherVerification.reviewedBy': req.auth!.userId,
        'teacherVerification.reviewNote': input.reviewNote,
      } },
      { new: true, runValidators: true },
    ).select('name email role verified teacherVerification');
    if (!user) throw new AppError(404, 'PENDING_VERIFICATION_NOT_FOUND');
    await AuditEvent.create({ action: `teacher.verification.${input.status}`, actorId: req.auth!.userId, targetType: 'user', targetId: userId, severity: input.status === 'rejected' ? 'warning' : 'info', ipAddress: req.ip });
    res.json({ success: true, data: toRequestDto(user.toObject()), teacher: { id: user.id, role: user.role, verified: user.verified } });
  } catch (error) { next(error); }
});
