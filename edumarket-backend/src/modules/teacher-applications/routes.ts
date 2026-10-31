import { Router, type NextFunction, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { documentStore, DocumentStoreError } from '../../integrations/documentStore.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { DOCUMENT_TYPES, IDENTITY_DOCUMENT_TYPES, TeacherApplication } from './model.js';
import { CANDIDATE_EDITABLE, TRANSITIONS, activeDocuments, adminDetailView, adminListView, approvalBlockers, candidateView, decryptSensitive, encryptSensitive, inspectDocument, missingItems, safeOriginalName } from './rules.js';
import { notifyAdmins, notifyCandidate } from './notifications.js';

export const teacherApplicationRoutes = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i);
const testing = env.NODE_ENV === 'test';
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: testing ? 1000 : 30, standardHeaders: true, legacyHeaders: false });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: testing ? 1000 : 10, standardHeaders: true, legacyHeaders: false });
const MAX_ACTIVE_DOCUMENTS = 30;
const CANDIDATE_ROLES = ['student', 'unverified_teacher', 'teacher'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.TEACHER_DOCUMENT_MAX_MB * 1024 * 1024, files: 1, fields: 4, parts: 5 },
  fileFilter: (_req, file, callback) => {
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype)) return callback(new AppError(415, 'UNSUPPORTED_DOCUMENT_TYPE'));
    callback(null, true);
  },
}).single('file');
const receiveFile = (req: AuthRequest, res: Response, next: NextFunction) => upload(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'DOCUMENT_TOO_LARGE' : 'INVALID_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? 'DOCUMENT_TOO_LARGE' : 'INVALID_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? { maxMb: env.TEACHER_DOCUMENT_MAX_MB } : undefined));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_UPLOAD'));
});

// Multipart file names arrive decoded as latin1 (busboy default): restore UTF-8 names such as « identité.pdf ».
const utf8Name = (name: string) => { const decoded = Buffer.from(name, 'latin1').toString('utf8'); return decoded.includes('�') ? name : decoded; };
const historyEntry = (actorRole: 'candidate' | 'admin' | 'system', action: string, actorId: string | null, from: string | null = null, to: string | null = null, message = '') => ({ at: new Date(), actorId, actorRole, action, from, to, message });
const audit = (req: AuthRequest, action: string, targetId: string, severity: 'info' | 'warning' | 'critical' = 'info') => AuditEvent.create({ action, actorId: req.auth!.userId, targetType: 'teacher_application', targetId, severity, ipAddress: req.ip });
const reapplyDate = (application: any) => application?.status === 'rejected' && application.decisionAt ? new Date(new Date(application.decisionAt).getTime() + env.TEACHER_APPLICATION_REAPPLY_DAYS * 86_400_000) : null;
const view = (application: any) => candidateView(application, { storageReady: documentStore().persistent, canReapplyAt: reapplyDate(application) });

/** Accounts that must not start an independent application: institutional teachers keep their institution's process. */
async function assertMayApply(userId: string) {
  const user = await User.findById(userId).select('role institutionId teacherType teacherVerification.status').lean();
  if (!user) throw new AppError(404, 'USER_NOT_FOUND');
  if (user.institutionId || (user as any).teacherType === 'institutional') throw new AppError(409, 'INSTITUTIONAL_TEACHER');
  if (user.role === 'teacher' || !['student', 'unverified_teacher'].includes(user.role)) throw new AppError(409, 'APPLICATION_NOT_ALLOWED');
  return user;
}

/** Conditional write: the application must still be in one of `from` at the revision the caller read. */
async function transition(applicationId: unknown, from: string[], revision: number, update: Record<string, any>, filter: Record<string, unknown> = {}, arrayFilters?: Record<string, unknown>[]) {
  const updated = await TeacherApplication.findOneAndUpdate({ _id: applicationId, status: { $in: from }, revision, ...filter }, { ...update, $inc: { revision: 1, ...(update.$inc || {}) } }, { new: true, runValidators: true, ...(arrayFilters ? { arrayFilters } : {}) });
  if (updated) return updated;
  const current = await TeacherApplication.findById(applicationId).select('status revision').lean();
  if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
  if (Object.keys(filter).length && current.revision === revision && from.includes(current.status)) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
  if (current.revision !== revision) throw new AppError(409, 'APPLICATION_REVISION_CONFLICT', 'APPLICATION_REVISION_CONFLICT', { revision: current.revision, status: current.status });
  throw new AppError(409, 'INVALID_APPLICATION_TRANSITION', 'INVALID_APPLICATION_TRANSITION', { status: current.status });
}

// =============================================================================================== candidate
const country = z.string().trim().regex(/^[A-Z]{2}$/).or(z.literal(''));
const optionalDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().transform(value => value ? new Date(value) : null);
const list = (max: number, length = 80) => z.array(z.string().trim().min(1).max(length)).max(max).transform(values => [...new Set(values)]);
const url = z.string().trim().max(500).refine(value => !value || /^https:\/\/[^\s]+$/i.test(value), 'HTTPS_URL_REQUIRED');
const objectIdOrNew = z.string().regex(/^[a-f\d]{24}$/i).optional();
const sectionsInput = z.object({
  personal: z.object({
    firstName: z.string().trim().max(60), lastName: z.string().trim().max(60), phone: z.string().trim().regex(/^(\+[1-9]\d{6,14})?$/, 'PHONE_E164'),
    country, city: z.string().trim().max(100), preferredLanguage: z.enum(['fr', 'en', 'ar']), birthDate: optionalDate, nationality: country, address: z.string().trim().max(300),
  }).partial().strict(),
  identity: z.object({
    documentType: z.enum(['', ...IDENTITY_DOCUMENT_TYPES]), documentNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{4,30}$/, 'DOCUMENT_NUMBER_FORMAT'),
    issuingCountry: country, issuingAuthority: z.string().trim().max(160), issuedAt: optionalDate, expiresAt: optionalDate,
  }).partial().strict(),
  academic: z.object({
    degrees: z.array(z.object({ id: objectIdOrNew, level: z.enum(['', 'secondary', 'bachelor', 'master', 'doctorate', 'engineering', 'professional', 'other']), title: z.string().trim().max(200), specialty: z.string().trim().max(160), institution: z.string().trim().max(200), country, year: z.number().int().min(1950).max(new Date().getFullYear()).nullable(), highest: z.boolean().default(false) }).strict()).max(10),
    certifications: z.array(z.object({ id: objectIdOrNew, name: z.string().trim().min(1).max(200), issuer: z.string().trim().max(200), year: z.number().int().min(1950).max(new Date().getFullYear()).nullable(), kind: z.enum(['certification', 'training']) }).strict()).max(20),
  }).partial().strict(),
  professional: z.object({
    headline: z.string().trim().max(160), bio: z.string().trim().max(4000), specialties: list(15), expertise: list(20), subjects: list(30), teachingLanguages: list(10, 40),
    yearsOfExperience: z.number().int().min(0).max(70).nullable(),
    experiences: z.array(z.object({ id: objectIdOrNew, kind: z.enum(['professional', 'teaching']), title: z.string().trim().min(1).max(160), organization: z.string().trim().max(200), startDate: optionalDate, endDate: optionalDate, current: z.boolean().default(false), description: z.string().trim().max(2000) }).strict()
      .refine(entry => !entry.endDate || !entry.startDate || entry.endDate >= entry.startDate, 'EXPERIENCE_DATES')).max(20),
    skills: list(30), portfolioUrl: url, linkedinUrl: url.refine(value => !value || /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(value), 'LINKEDIN_URL'),
  }).partial().strict(),
  acceptTerms: z.literal(true),
}).partial().strict();

teacherApplicationRoutes.use(authenticate);

teacherApplicationRoutes.get('/mine', allowRoles(...CANDIDATE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const application = await TeacherApplication.findOne({ userId: req.auth!.userId }).sort({ open: -1, createdAt: -1 }).lean();
    const user = await User.findById(req.auth!.userId).select('role institutionId teacherType').lean();
    const eligible = !!user && !user.institutionId && (user as any).teacherType !== 'institutional' && ['student', 'unverified_teacher'].includes(user.role);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: application ? view(application) : null, eligibility: { canStart: eligible && (!application || (!application.open && (reapplyDate(application)?.getTime() || 0) <= Date.now())), institutional: !!user?.institutionId || (user as any)?.teacherType === 'institutional' } });
  } catch (error) { next(error); }
});

/** Starts a file for a signed-in account (a student who wants to teach). Idempotent: an open file is returned as is. */
teacherApplicationRoutes.post('/', allowRoles('student', 'unverified_teacher'), async (req: AuthRequest, res, next) => {
  try {
    const user = await assertMayApply(req.auth!.userId);
    const open = await TeacherApplication.findOne({ userId: req.auth!.userId, open: true }).lean();
    if (open) { res.json({ success: true, data: view(open) }); return; }
    const previous = await TeacherApplication.findOne({ userId: req.auth!.userId }).sort({ createdAt: -1 }).lean();
    const allowedAt = reapplyDate(previous);
    if (allowedAt && allowedAt.getTime() > Date.now()) throw new AppError(409, 'REAPPLY_TOO_EARLY', 'REAPPLY_TOO_EARLY', { allowedAt });
    const account = await User.findById(user._id).select('name phone').lean();
    const [firstName, ...rest] = (account?.name || '').split(' ');
    // A new file after a refusal starts from the previous answers; documents and identity data are never copied.
    const created = await TeacherApplication.create({
      userId: req.auth!.userId,
      personal: previous ? { ...previous.personal, birthDate: null, address: '' } : { firstName: firstName || '', lastName: rest.join(' '), phone: /^\+[1-9]\d{6,14}$/.test(account?.phone || '') ? account!.phone : '' },
      academic: previous ? previous.academic : undefined, professional: previous ? previous.professional : undefined,
      previousApplicationId: previous?._id || null,
      history: [historyEntry('candidate', previous ? 'reapplied' : 'created', req.auth!.userId, null, 'draft')],
    });
    res.status(201).json({ success: true, data: view(created.toObject()) });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return next(new AppError(409, 'APPLICATION_ALREADY_OPEN'));
    next(error);
  }
});

/** Draft save (explicit or automatic): only sections sent are replaced; the revision protects against another tab. */
teacherApplicationRoutes.patch('/mine', allowRoles(...CANDIDATE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { revision, ...rest } = z.object({ revision: z.number().int().min(0) }).passthrough().parse(req.body);
    const input = sectionsInput.parse(rest);
    const current = await TeacherApplication.findOne({ userId: req.auth!.userId, open: true }).lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    if (!CANDIDATE_EDITABLE.includes(current.status as never)) throw new AppError(409, 'APPLICATION_LOCKED', 'APPLICATION_LOCKED', { status: current.status });
    const set: Record<string, unknown> = {};
    if (input.personal) for (const [key, value] of Object.entries(input.personal)) set[`personal.${key}`] = value;
    if (input.identity) {
      const { documentNumber, ...identity } = input.identity;
      for (const [key, value] of Object.entries(identity)) set[`identity.${key}`] = value;
      if (documentNumber !== undefined) {
        const normalized = documentNumber.replace(/[\s-]/g, '').toUpperCase();
        set['identity.documentNumberEncrypted'] = encryptSensitive(normalized);
        set['identity.documentNumberLast4'] = normalized.slice(-4);
      }
    }
    // Lists keep the ids of existing entries so diploma documents stay attached to their degree.
    const withIds = (entries: any[]) => entries.map(({ id: entryId, ...entry }) => ({ ...entry, _id: entryId ? new mongoose.Types.ObjectId(entryId) : new mongoose.Types.ObjectId() }));
    if (input.academic?.degrees) set['academic.degrees'] = withIds(input.academic.degrees);
    if (input.academic?.certifications) set['academic.certifications'] = withIds(input.academic.certifications);
    if (input.professional) for (const [key, value] of Object.entries(input.professional)) set[`professional.${key}`] = key === 'experiences' ? withIds(value as any[]) : value;
    if (input.acceptTerms) set.termsAcceptedAt = current.termsAcceptedAt || new Date();
    const updated = await transition(current._id, CANDIDATE_EDITABLE, revision, { $set: set });
    res.json({ success: true, data: view(updated.toObject()) });
  } catch (error) { next(error); }
});

teacherApplicationRoutes.post('/mine/documents', allowRoles(...CANDIDATE_ROLES), uploadLimiter, receiveFile, async (req: AuthRequest, res, next) => {
  let storedKey: string | null = null;
  try {
    if (!req.file) throw new AppError(400, 'DOCUMENT_REQUIRED');
    const fields = z.object({ type: z.enum(DOCUMENT_TYPES), degreeId: id.optional(), replaces: id.optional() }).strict().parse(req.body);
    const application = await TeacherApplication.findOne({ userId: req.auth!.userId, open: true }).lean();
    if (!application) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    if (!CANDIDATE_EDITABLE.includes(application.status as never)) throw new AppError(409, 'APPLICATION_LOCKED', 'APPLICATION_LOCKED', { status: application.status });
    if (fields.type !== 'diploma' && fields.degreeId) throw new AppError(400, 'INVALID_UPLOAD');
    const active = activeDocuments(application);
    let replaced: any = null;
    if (fields.replaces) {
      replaced = active.find((document: any) => String(document._id) === fields.replaces);
      if (!replaced) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
      // A verified document is replaced only while the file is still a draft.
      if (replaced.status === 'verified' && application.status !== 'draft') throw new AppError(409, 'DOCUMENT_ALREADY_VERIFIED');
      if (replaced.type !== fields.type) throw new AppError(400, 'DOCUMENT_TYPE_CHANGE');
    } else if (active.length >= MAX_ACTIVE_DOCUMENTS) throw new AppError(409, 'DOCUMENT_LIMIT_REACHED');
    // A replacement keeps the degree of the document it replaces.
    const degreeId = fields.degreeId || (replaced?.degreeId ? String(replaced.degreeId) : undefined);
    if (fields.type === 'diploma' && !(application.academic?.degrees || []).some((degree: any) => String(degree._id) === degreeId)) throw new AppError(400, 'DIPLOMA_DEGREE_REQUIRED');
    const inspection = inspectDocument(req.file.buffer, req.file.mimetype, req.file.originalname);
    if ('error' in inspection) throw new AppError(415, inspection.error!);
    const storageKey = `${randomBytes(16).toString('hex')}.${inspection.extension}`;
    try { await documentStore().put(storageKey, req.file.buffer, inspection.mimeType); }
    catch { throw new AppError(503, 'DOCUMENT_STORAGE_UNAVAILABLE'); }
    storedKey = storageKey;
    const documentId = new mongoose.Types.ObjectId();
    const record = { _id: documentId, type: fields.type, degreeId: degreeId || null, originalName: safeOriginalName(utf8Name(req.file.originalname), inspection.extension), storageKey, mimeType: inspection.mimeType, size: req.file.size, sha256: inspection.sha256, uploadedAt: new Date(), status: 'pending_review' };
    // Replacement: the old document is claimed first (conditional), so two concurrent replacements cannot both succeed.
    if (replaced) {
      const claimed = await TeacherApplication.updateOne({ _id: application._id, status: { $in: CANDIDATE_EDITABLE }, documents: { $elemMatch: { _id: replaced._id, replacedBy: null } } }, { $set: { 'documents.$.replacedBy': documentId } });
      if (!claimed.modifiedCount) throw new AppError(409, 'DOCUMENT_ALREADY_REPLACED');
    }
    const updated = await TeacherApplication.findOneAndUpdate(
      { _id: application._id, status: { $in: CANDIDATE_EDITABLE } },
      { $push: { documents: record, history: historyEntry('candidate', replaced ? 'document_replaced' : 'document_uploaded', req.auth!.userId, null, null, fields.type) }, $inc: { revision: 1 } },
      { new: true, runValidators: true },
    );
    if (!updated) {
      if (replaced) await TeacherApplication.updateOne({ _id: application._id, 'documents._id': replaced._id }, { $set: { 'documents.$.replacedBy': null } });
      throw new AppError(409, 'APPLICATION_LOCKED');
    }
    storedKey = null;
    res.status(201).json({ success: true, data: view(updated.toObject()) });
  } catch (error) { next(error); }
  finally { if (storedKey) await documentStore().remove(storedKey).catch(() => undefined); }
});

/** A document can be withdrawn only from a draft and before any review (afterwards it is replaced, keeping the history). */
teacherApplicationRoutes.delete('/mine/documents/:documentId', allowRoles(...CANDIDATE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const documentId = id.parse(req.params.documentId);
    const application = await TeacherApplication.findOne({ userId: req.auth!.userId, open: true, status: 'draft', documents: { $elemMatch: { _id: documentId, reviewedAt: null, replacedBy: null } } }).lean();
    if (!application) throw new AppError(409, 'DOCUMENT_NOT_REMOVABLE');
    const document = application.documents.find((entry: any) => String(entry._id) === documentId)!;
    const updated = await TeacherApplication.findOneAndUpdate({ _id: application._id, status: 'draft' }, { $pull: { documents: { _id: documentId } }, $inc: { revision: 1 } }, { new: true });
    if (!updated) throw new AppError(409, 'DOCUMENT_NOT_REMOVABLE');
    await documentStore().remove(document.storageKey).catch(() => undefined);
    res.json({ success: true, data: view(updated.toObject()) });
  } catch (error) { next(error); }
});

async function sendDocument(res: Response, document: any, download: boolean) {
  if (document.purgedAt) throw new AppError(410, 'DOCUMENT_PURGED');
  let bytes: Buffer;
  try { bytes = await documentStore().get(document.storageKey); }
  catch (error) { throw new AppError(error instanceof DocumentStoreError && error.code === 'NOT_FOUND' ? 404 : 503, error instanceof DocumentStoreError && error.code === 'NOT_FOUND' ? 'DOCUMENT_NOT_FOUND' : 'DOCUMENT_STORAGE_UNAVAILABLE'); }
  res.set({
    'Content-Type': document.mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    // Rendered inline in a sandboxed frame at most: no script of a document ever runs with the API origin.
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
  });
  res.end(bytes);
}

teacherApplicationRoutes.get('/mine/documents/:documentId', allowRoles(...CANDIDATE_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const documentId = id.parse(req.params.documentId);
    // Ownership is part of the query: another candidate's document id is simply not found.
    const application = await TeacherApplication.findOne({ userId: req.auth!.userId, 'documents._id': documentId }).select('documents').lean();
    const document = application?.documents.find((entry: any) => String(entry._id) === documentId);
    if (!document) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
    await sendDocument(res, document, req.query.download === '1');
  } catch (error) { next(error); }
});

teacherApplicationRoutes.post('/mine/submit', allowRoles(...CANDIDATE_ROLES), submitLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { revision } = z.object({ revision: z.number().int().min(0) }).strict().parse(req.body);
    const application = await TeacherApplication.findOne({ userId: req.auth!.userId, open: true }).lean();
    if (!application) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    await assertMayApply(req.auth!.userId);
    // Without a persistent private store the documents could be lost: the final submission waits for one.
    if (!documentStore().persistent) throw new AppError(503, 'DOCUMENT_STORAGE_NOT_PERSISTENT');
    const missing = missingItems(application);
    if (missing.length) throw new AppError(422, 'APPLICATION_INCOMPLETE', 'APPLICATION_INCOMPLETE', { missing });
    const action = application.status === 'draft' ? 'submit' : 'resubmit';
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(application.status as never)) throw new AppError(409, 'INVALID_APPLICATION_TRANSITION', 'INVALID_APPLICATION_TRANSITION', { status: application.status });
    const now = new Date();
    let updated = null;
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      const reference = application.reference || `EMT-${now.getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
      try {
        updated = await transition(application._id, rule.from, revision, {
          $set: { status: rule.to, reference, lastSubmittedAt: now, ...(action === 'submit' ? { submittedAt: now } : {}), ...(action === 'resubmit' ? { 'requests.$[open].resolvedAt': now } : {}) },
          $push: { history: historyEntry('candidate', action === 'submit' ? 'submitted' : 'resubmitted', req.auth!.userId, application.status, rule.to) },
        }, {}, action === 'resubmit' ? [{ 'open.resolvedAt': null }] : undefined);
      } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    }
    if (!updated) throw new AppError(409, 'APPLICATION_REFERENCE_CONFLICT');
    void notifyCandidate(req.auth!.userId, action === 'submit' ? 'teacherApplicationSubmitted' : 'teacherApplicationResubmitted', { reference: updated.reference! });
    void notifyAdmins(action === 'submit' ? 'teacherApplicationNew' : 'teacherApplicationResubmittedAdmin', { reference: updated.reference! }, `/admin/teacher-applications/${updated._id}`);
    res.json({ success: true, data: view(updated.toObject()) });
  } catch (error) { next(error); }
});

// =============================================================================================== central administration
// Platform administrators only: institution administrators (`institution` role) never see independent applications.
const admin = Router();
admin.use(allowRoles('admin'));
const revisionInput = z.object({ revision: z.number().int().min(0) });
const loadForAdmin = async (applicationId: string) => {
  const application = await TeacherApplication.findById(id.parse(applicationId)).select('+internalNotes').populate('userId', 'name email role emailVerified createdAt').populate('internalNotes.by', 'name').lean();
  if (!application) throw new AppError(404, 'APPLICATION_NOT_FOUND');
  return application;
};
const detail = async (applicationId: unknown) => adminDetailView(await loadForAdmin(String(applicationId)));

admin.get('/stats', async (_req, res, next) => {
  try {
    const rows = await TeacherApplication.aggregate([{ $match: { open: true } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const counts = Object.fromEntries(rows.map(row => [row._id, row.count]));
    const rejected = await TeacherApplication.countDocuments({ status: 'rejected' });
    const total = await TeacherApplication.countDocuments({});
    const incomplete = await TeacherApplication.countDocuments({ open: true, status: 'under_review', documents: { $elemMatch: { replacedBy: null, status: { $in: ['rejected', 'replacement_requested'] } } } });
    res.json({ success: true, data: {
      total, drafts: counts.draft || 0, new: (counts.submitted || 0) + (counts.resubmitted || 0), underReview: counts.under_review || 0, incomplete,
      informationRequired: counts.additional_information_required || 0, approved: counts.approved || 0, rejected, suspended: counts.suspended || 0,
    } });
  } catch (error) { next(error); }
});

admin.get('/', async (req, res, next) => {
  try {
    const query = z.object({
      search: z.string().trim().max(100).optional(), status: z.enum(['draft', 'submitted', 'under_review', 'additional_information_required', 'resubmitted', 'approved', 'rejected', 'suspended', 'to_review']).optional(),
      specialty: z.string().trim().max(80).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(), sort: z.enum(['submitted_desc', 'submitted_asc', 'updated_desc']).default('submitted_desc'),
      page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(20),
    }).parse(req.query);
    // Drafts are the candidate's private work in progress: listed only when explicitly asked for.
    const filter: Record<string, unknown> = { status: query.status === 'to_review' ? { $in: ['submitted', 'resubmitted'] } : query.status || { $ne: 'draft' } };
    if (query.specialty) filter['professional.specialties'] = query.specialty;
    if (query.country) filter['personal.country'] = query.country;
    if (query.search) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select('_id').limit(500).lean();
      filter.$or = [{ 'personal.firstName': pattern }, { 'personal.lastName': pattern }, { reference: pattern }, { userId: { $in: users.map(user => user._id) } }];
    }
    const sort: Record<string, 1 | -1> = query.sort === 'submitted_asc' ? { submittedAt: 1 } : query.sort === 'updated_desc' ? { updatedAt: -1 } : { submittedAt: -1 };
    const [rows, total, specialties, countries] = await Promise.all([
      TeacherApplication.find(filter).sort({ ...sort, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize)
        .select('reference status personal.firstName personal.lastName personal.country professional.specialties submittedAt updatedAt documents.status documents.replacedBy documents.purgedAt userId').populate('userId', 'name email').lean(),
      TeacherApplication.countDocuments(filter),
      TeacherApplication.distinct('professional.specialties', { status: { $ne: 'draft' } }),
      TeacherApplication.distinct('personal.country', { status: { $ne: 'draft' } }),
    ]);
    res.json({ success: true, data: rows.map(adminListView), pagination: { page: query.page, pageSize: query.pageSize, total }, facets: { specialties: specialties.filter(Boolean).sort().slice(0, 200), countries: countries.filter(Boolean).sort() } });
  } catch (error) { next(error); }
});

admin.get('/:applicationId', async (req: AuthRequest, res, next) => {
  try {
    const data = await detail(req.params.applicationId);
    await audit(req, 'teacher.application.viewed', data.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

/** The full identity number is shown on demand only, and each disclosure is audited. */
admin.post('/:applicationId/identity-number', async (req: AuthRequest, res, next) => {
  try {
    const application = await TeacherApplication.findById(id.parse(req.params.applicationId)).select('+identity.documentNumberEncrypted purgedAt').lean();
    if (!application) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    const encrypted = (application.identity as any)?.documentNumberEncrypted;
    if (!encrypted) throw new AppError(404, 'IDENTITY_NUMBER_NOT_AVAILABLE');
    await audit(req, 'teacher.application.identity_revealed', String(application._id), 'warning');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { documentNumber: decryptSensitive(encrypted) } });
  } catch (error) { next(error); }
});

admin.get('/:applicationId/documents/:documentId', async (req: AuthRequest, res, next) => {
  try {
    const applicationId = id.parse(req.params.applicationId), documentId = id.parse(req.params.documentId);
    const application = await TeacherApplication.findOne({ _id: applicationId, 'documents._id': documentId }).select('documents').lean();
    const document = application?.documents.find((entry: any) => String(entry._id) === documentId);
    if (!document) throw new AppError(404, 'DOCUMENT_NOT_FOUND');
    const download = req.query.download === '1';
    await audit(req, download ? 'teacher.application.document_downloaded' : 'teacher.application.document_viewed', `${applicationId}:${documentId}`);
    await sendDocument(res, document, download);
  } catch (error) { next(error); }
});

admin.post('/:applicationId/start-review', async (req: AuthRequest, res, next) => {
  try {
    const { revision } = revisionInput.strict().parse(req.body);
    const current = await TeacherApplication.findById(id.parse(req.params.applicationId)).select('status userId reference').lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    const rule = TRANSITIONS.start_review;
    await transition(current._id, rule.from, revision, { $set: { status: rule.to, reviewerId: req.auth!.userId }, $push: { history: historyEntry('admin', 'review_started', req.auth!.userId, current.status, rule.to) } });
    await audit(req, 'teacher.application.review_started', String(current._id));
    void notifyCandidate(String(current.userId), 'teacherApplicationUnderReview', { reference: current.reference || '' });
    res.json({ success: true, data: await detail(current._id) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/documents/:documentId/review', async (req: AuthRequest, res, next) => {
  try {
    const input = revisionInput.extend({ status: z.enum(['verified', 'rejected', 'replacement_requested']), comment: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    if (input.status !== 'verified' && input.comment.length < 5) throw new AppError(400, 'REVIEW_REASON_REQUIRED');
    const applicationId = id.parse(req.params.applicationId), documentId = id.parse(req.params.documentId);
    const now = new Date();
    const updated = await transition(applicationId, ['under_review'], input.revision, {
      $set: { 'documents.$[doc].status': input.status, 'documents.$[doc].adminComment': input.comment, 'documents.$[doc].reviewedAt': now, 'documents.$[doc].reviewedBy': req.auth!.userId },
      $push: { 'documents.$[doc].reviews': { status: input.status, comment: input.comment, by: req.auth!.userId, at: now }, history: historyEntry('admin', `document_${input.status}`, req.auth!.userId, null, null, input.comment) },
    }, { documents: { $elemMatch: { _id: documentId, replacedBy: null, purgedAt: null } } }, [{ 'doc._id': new mongoose.Types.ObjectId(documentId) }]);
    const document = updated.documents.find((entry: any) => String(entry._id) === documentId)!;
    await audit(req, `teacher.application.document_${input.status}`, `${applicationId}:${documentId}`, input.status === 'verified' ? 'info' : 'warning');
    void notifyCandidate(String(updated.userId), input.status === 'verified' ? 'teacherDocumentVerified' : input.status === 'rejected' ? 'teacherDocumentRejected' : 'teacherDocumentReplacement', { document: document.type });
    res.json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/request-information', async (req: AuthRequest, res, next) => {
  try {
    const input = revisionInput.extend({ message: z.string().trim().min(10).max(2000), items: z.array(z.string().regex(/^(personal|identity|academic|professional|document:[a-f\d]{24}|documents:(identity|cv|diploma|other))$/i)).min(1).max(30) }).strict().parse(req.body);
    const applicationId = id.parse(req.params.applicationId);
    const current = await TeacherApplication.findById(applicationId).select('status userId reference documents').lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    const now = new Date();
    // Documents named in the request are flagged for replacement with the same explanation.
    const documentIds = input.items.filter(item => item.startsWith('document:')).map(item => item.slice('document:'.length));
    const active = activeDocuments(current).filter((document: any) => documentIds.includes(String(document._id)));
    if (active.length !== documentIds.length) throw new AppError(400, 'DOCUMENT_NOT_FOUND');
    const rule = TRANSITIONS.request_information;
    const set: Record<string, unknown> = { status: rule.to };
    const push: Record<string, unknown> = { requests: { at: now, by: req.auth!.userId, message: input.message, items: input.items }, history: historyEntry('admin', 'information_requested', req.auth!.userId, current.status, rule.to, input.message) };
    const arrayFilters = active.length ? [{ 'flag._id': { $in: active.map((document: any) => document._id) } }] : undefined;
    const update: Record<string, any> = { $set: set, $push: push };
    if (active.length) Object.assign(set, { 'documents.$[flag].status': 'replacement_requested', 'documents.$[flag].adminComment': input.message, 'documents.$[flag].reviewedAt': now, 'documents.$[flag].reviewedBy': req.auth!.userId });
    if (active.length) push['documents.$[flag].reviews'] = { status: 'replacement_requested', comment: input.message, by: req.auth!.userId, at: now };
    await transition(applicationId, rule.from, input.revision, update, {}, arrayFilters);
    await audit(req, 'teacher.application.information_requested', String(applicationId), 'warning');
    void notifyCandidate(String(current.userId), 'teacherApplicationInfoRequired', { reference: current.reference || '' }, { email: true });
    res.json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/approve', async (req: AuthRequest, res, next) => {
  try {
    const input = revisionInput.extend({ confirm: z.literal(true) }).strict().parse(req.body);
    const applicationId = id.parse(req.params.applicationId);
    const current = await TeacherApplication.findById(applicationId).lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    // Idempotent: approving an already approved file (double click, retry) returns it unchanged.
    if (current.status === 'approved' && await User.exists({ _id: current.userId, role: 'teacher', 'teacherVerification.status': 'approved' })) { res.json({ success: true, data: await detail(applicationId) }); return; }
    const blockers = approvalBlockers(current);
    if (blockers.length) throw new AppError(422, 'APPROVAL_BLOCKED', 'APPROVAL_BLOCKED', { blockers });
    const rule = TRANSITIONS.approve, now = new Date();
    const approved = await transition(applicationId, rule.from, input.revision, { $set: { status: rule.to, decisionAt: now, decidedBy: req.auth!.userId, decisionReason: '' }, $push: { history: historyEntry('admin', 'approved', req.auth!.userId, current.status, rule.to) } });
    // Teacher permissions come from the existing user fields; written only for an account still eligible (never an institution's).
    const pro = approved.professional as any, personal = approved.personal as any;
    const user = await User.findOneAndUpdate(
      { _id: current.userId, role: { $in: ['student', 'unverified_teacher'] }, $or: [{ institutionId: null }, { institutionId: { $exists: false } }] },
      { $set: {
        role: 'teacher', verified: true, teacherType: 'independent', name: `${personal.firstName} ${personal.lastName}`.trim().slice(0, 100), phone: personal.phone, headline: pro.headline.slice(0, 160), bio: pro.bio.slice(0, 2000),
        teacherVerification: { specialty: pro.specialties[0].slice(0, 160), registrationNumber: approved.reference, credentialsSummary: pro.bio.slice(0, 2000), status: 'approved', submittedAt: approved.submittedAt, reviewedAt: now, reviewedBy: req.auth!.userId, reviewNote: '', documents: [] },
      } },
      { new: true, runValidators: true },
    );
    if (!user) {
      // Compensation: the account changed meanwhile (e.g. became institutional); the file goes back to review.
      await TeacherApplication.updateOne({ _id: applicationId, status: 'approved' }, { $set: { status: 'under_review', decisionAt: null, decidedBy: null }, $inc: { revision: 1 }, $push: { history: historyEntry('system', 'approval_reverted', null, 'approved', 'under_review') } });
      throw new AppError(409, 'APPLICATION_ACCOUNT_NOT_ELIGIBLE');
    }
    await audit(req, 'teacher.application.approved', String(applicationId), 'warning');
    void notifyCandidate(String(current.userId), 'teacherApplicationApproved', { reference: current.reference || '' }, { email: true, link: '/teacher/dashboard' });
    res.json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/reject', async (req: AuthRequest, res, next) => {
  try {
    const input = revisionInput.extend({ reason: z.string().trim().min(10).max(2000), category: z.enum(['incomplete', 'unverifiable', 'insufficient_qualification', 'policy', 'other']) }).strict().parse(req.body);
    const applicationId = id.parse(req.params.applicationId);
    const current = await TeacherApplication.findById(applicationId).select('status userId reference').lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    const rule = TRANSITIONS.reject;
    await transition(applicationId, rule.from, input.revision, { $set: { status: rule.to, open: false, decisionAt: new Date(), decidedBy: req.auth!.userId, decisionReason: input.reason, decisionCategory: input.category }, $push: { history: historyEntry('admin', 'rejected', req.auth!.userId, current.status, rule.to, input.reason) } });
    await audit(req, 'teacher.application.rejected', String(applicationId), 'warning');
    void notifyCandidate(String(current.userId), 'teacherApplicationRejected', { reference: current.reference || '' }, { email: true });
    res.json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/suspend', async (req: AuthRequest, res, next) => {
  try {
    const input = revisionInput.extend({ reason: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    const applicationId = id.parse(req.params.applicationId);
    const current = await TeacherApplication.findById(applicationId).select('status userId reference').lean();
    if (!current) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    const rule = TRANSITIONS.suspend;
    await transition(applicationId, rule.from, input.revision, { $set: { status: rule.to, decisionAt: new Date(), decidedBy: req.auth!.userId, decisionReason: input.reason }, $push: { history: historyEntry('admin', 'suspended', req.auth!.userId, current.status, rule.to, input.reason) } });
    // Teaching permissions are withdrawn through the same fields every teacher route checks; courses and history are kept.
    await User.updateOne({ _id: current.userId, role: 'teacher' }, { $set: { role: 'unverified_teacher', verified: false, 'teacherVerification.status': 'suspended', 'teacherVerification.reviewedAt': new Date(), 'teacherVerification.reviewedBy': req.auth!.userId } });
    await audit(req, 'teacher.application.suspended', String(applicationId), 'critical');
    void notifyCandidate(String(current.userId), 'teacherAccountSuspended', { reference: current.reference || '' }, { email: true });
    res.json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

admin.post('/:applicationId/notes', async (req: AuthRequest, res, next) => {
  try {
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    const applicationId = id.parse(req.params.applicationId);
    const updated = await TeacherApplication.updateOne({ _id: applicationId }, { $push: { internalNotes: { at: new Date(), by: req.auth!.userId, text } } });
    if (!updated.matchedCount) throw new AppError(404, 'APPLICATION_NOT_FOUND');
    res.status(201).json({ success: true, data: await detail(applicationId) });
  } catch (error) { next(error); }
});

teacherApplicationRoutes.use('/admin', admin);

/** Retention: refused or abandoned files lose their documents and identity data after the configured period (minimal record kept). */
export async function purgeExpiredApplications(now = new Date()) {
  const limit = new Date(now.getTime() - env.TEACHER_APPLICATION_RETENTION_DAYS * 86_400_000);
  const expired = await TeacherApplication.find({ purgedAt: null, $or: [{ status: 'rejected', decisionAt: { $lt: limit } }, { status: 'draft', updatedAt: { $lt: limit } }] }).select('documents status').limit(50).lean();
  for (const application of expired) {
    for (const document of application.documents) if (!document.purgedAt) await documentStore().remove(document.storageKey).catch(() => undefined);
    await TeacherApplication.updateOne({ _id: application._id, purgedAt: null }, {
      $set: { purgedAt: now, open: false, 'documents.$[].purgedAt': now, 'identity.documentNumberEncrypted': '', 'identity.documentNumberLast4': '', 'personal.birthDate': null, 'personal.address': '' },
      $push: { history: historyEntry('system', 'purged', null, application.status, application.status) },
    });
  }
  return expired.length;
}
