import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { Exam } from '../exams/models.js';
import { Certificate } from '../certificates/model.js';
import { AuditEvent } from './audit.model.js';
import { createNotification } from '../notifications/service.js';

/** Platform-wide exam and certificate administration (admin only). */
export const adminCatalogRoutes = Router();
adminCatalogRoutes.use(authenticate, allowRoles('admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE_SIZE = 25;

adminCatalogRoutes.get('/exams', async (req, res, next) => {
  try {
    const query = z.object({ type: z.enum(['online', 'in_person']).optional(), status: z.enum(['draft', 'published']).optional(), search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.search) filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    const [exams, total] = await Promise.all([
      Exam.find(filter).select('-questions').sort({ createdAt: -1 }).skip((query.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate('courseId', 'title').populate('creatorId', 'name').lean(),
      Exam.countDocuments(filter),
    ]);
    res.json({ success: true, data: exams.map(exam => ({
      id: String(exam._id), title: exam.title, type: exam.type, status: exam.status, fee: exam.fee, date: exam.date || null,
      registeredCount: exam.registeredCount, capacity: exam.location?.capacity || null, city: exam.location?.city || '',
      courseTitle: (exam.courseId as any)?.title || '', creatorName: (exam.creatorId as any)?.name || '', createdAt: exam.createdAt,
    })), pagination: { page: query.page, limit: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } });
  } catch (error) { next(error); }
});

/** Publishes or withdraws an exam. Registered students keep their registration; publishing needs a published course. */
adminCatalogRoutes.patch('/exams/:examId', async (req: AuthRequest, res, next) => {
  try {
    const examId = objectId.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const { status } = z.object({ status: z.enum(['draft', 'published']) }).strict().parse(req.body);
    const exam = await Exam.findById(examId.data).select('courseId status title');
    if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND');
    if (status === 'published' && !await Course.exists({ _id: exam.courseId, status: 'published' })) throw new AppError(400, 'PUBLISH_COURSE_FIRST');
    exam.status = status;
    await exam.save();
    await AuditEvent.create({ action: `exam.${status === 'published' ? 'published' : 'withdrawn'}`, actorId: req.auth!.userId, targetType: 'exam', targetId: String(exam._id), severity: 'warning', ipAddress: req.ip });
    res.json({ success: true, data: { id: String(exam._id), status: exam.status } });
  } catch (error) { next(error); }
});

const certificateDto = (certificate: any) => ({
  id: String(certificate._id), code: certificate.code, issuedAt: certificate.issuedAt,
  student: { id: String(certificate.studentId?._id || ''), name: certificate.studentId?.name || '', email: certificate.studentId?.email || '' },
  courseTitle: certificate.courseId?.title || '', status: certificate.revokedAt ? 'revoked' : 'valid',
  revokedAt: certificate.revokedAt || null, revokedReason: certificate.revokedReason || '',
});

adminCatalogRoutes.get('/certificates', async (req, res, next) => {
  try {
    const query = z.object({ search: z.string().trim().max(100).optional(), status: z.enum(['valid', 'revoked', 'all']).default('all'), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.status === 'valid') filter.revokedAt = null;
    if (query.status === 'revoked') filter.revokedAt = { $ne: null };
    if (query.search) {
      const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
      const students = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select('_id').limit(200).lean();
      filter.$or = [{ code: query.search.toUpperCase() }, { studentId: { $in: students.map(student => student._id) } }];
    }
    const [certificates, total] = await Promise.all([
      Certificate.find(filter).sort({ issuedAt: -1 }).skip((query.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate('studentId', 'name email').populate('courseId', 'title').lean(),
      Certificate.countDocuments(filter),
    ]);
    res.json({ success: true, data: certificates.map(certificateDto), pagination: { page: query.page, limit: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } });
  } catch (error) { next(error); }
});

/** Revocation keeps the record (the public registry then reports the code as revoked); restoring clears it. */
adminCatalogRoutes.patch('/certificates/:certificateId', async (req: AuthRequest, res, next) => {
  try {
    const certificateId = objectId.safeParse(req.params.certificateId); if (!certificateId.success) throw new AppError(404, 'CERTIFICATE_NOT_FOUND');
    const input = z.discriminatedUnion('status', [
      z.object({ status: z.literal('revoked'), reason: z.string().trim().min(5).max(500) }).strict(),
      z.object({ status: z.literal('valid') }).strict(),
    ]).parse(req.body);
    const update = input.status === 'revoked'
      ? { $set: { revokedAt: new Date(), revokedReason: input.reason, revokedBy: req.auth!.userId } }
      : { $set: { revokedAt: null, revokedReason: '', revokedBy: null } };
    const certificate = await Certificate.findOneAndUpdate({ _id: certificateId.data, revokedAt: input.status === 'revoked' ? null : { $ne: null } }, update, { new: true })
      .populate('studentId', 'name email').populate('courseId', 'title').lean();
    if (!certificate) {
      if (!await Certificate.exists({ _id: certificateId.data })) throw new AppError(404, 'CERTIFICATE_NOT_FOUND');
      throw new AppError(409, 'CERTIFICATE_STATUS_CONFLICT');
    }
    await AuditEvent.create({ action: input.status === 'revoked' ? 'certificate.revoked' : 'certificate.restored', actorId: req.auth!.userId, targetType: 'certificate', targetId: String(certificate._id), severity: 'critical', ipAddress: req.ip });
    void createNotification({ userId: String((certificate.studentId as any)._id), type: 'certificate', title: input.status === 'revoked' ? 'Certificate revoked' : 'Certificate restored', message: input.status === 'revoked' ? 'One of your certificates was revoked by the platform. Contact support for details.' : 'One of your certificates is valid again.', link: '/student/certificates', template: { key: input.status === 'revoked' ? 'certificateRevoked' : 'certificateRestored' } }).catch(() => undefined);
    res.json({ success: true, data: certificateDto(certificate) });
  } catch (error) { next(error); }
});
