import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { createNotification } from '../notifications/service.js';
import { InstitutionProfile } from './profile.model.js';

export const institutionVerificationRoutes = Router();
const submitLimit = rateLimit({ windowMs: 24 * 60 * 60_000, limit: 3, standardHeaders: true, legacyHeaders: false });
const application = z.object({
  name: z.string().trim().min(3).max(160), description: z.string().trim().min(30).max(4000),
  country: z.string().trim().min(2).max(100), city: z.string().trim().min(2).max(100),
  website: z.union([z.string().url().max(300), z.literal('')]).default(''),
  contactEmail: z.string().email().max(254),
}).strict();
const slugify = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

institutionVerificationRoutes.get('/mine', authenticate, allowRoles('student', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const profile = await InstitutionProfile.findOne({ ownerId: req.auth!.userId }).lean();
    res.json({ success: true, data: profile ? { ...profile, id: String(profile._id), ownerId: String(profile.ownerId) } : null });
  } catch (error) { next(error); }
});

institutionVerificationRoutes.post('/', authenticate, allowRoles('student'), submitLimit, async (req: AuthRequest, res, next) => {
  try {
    const input = application.parse(req.body);
    const existing = await InstitutionProfile.findOne({ ownerId: req.auth!.userId });
    if (existing?.status === 'pending' || existing?.status === 'approved') throw new AppError(409, 'INSTITUTION_APPLICATION_EXISTS');
    const contactEmail = input.contactEmail.toLowerCase();
    const values = { ...input, contactEmail, slug: `${slugify(input.name)}-${req.auth!.userId.slice(-6)}`, status: 'pending', reviewNote: '', reviewedBy: undefined, reviewedAt: undefined };
    const profile = existing
      ? await InstitutionProfile.findByIdAndUpdate(existing._id, { $set: values }, { new: true, runValidators: true })
      : await InstitutionProfile.create({ ...values, ownerId: req.auth!.userId });
    await AuditEvent.create({ action: 'institution.application.submitted', actorId: req.auth!.userId, targetType: 'institution-profile', targetId: String(profile!._id), ipAddress: req.ip });
    res.status(201).json({ success: true, data: { id: String(profile!._id), status: profile!.status, name: profile!.name } });
  } catch (error) { next(error); }
});

institutionVerificationRoutes.get('/admin', authenticate, allowRoles('admin'), async (_req, res, next) => {
  try {
    const profiles = await InstitutionProfile.find().sort({ createdAt: -1 }).populate('ownerId', 'name email').lean();
    res.json({ success: true, data: profiles.map(profile => ({ ...profile, id: String(profile._id), ownerId: profile.ownerId })) });
  } catch (error) { next(error); }
});

institutionVerificationRoutes.patch('/admin/:profileId', authenticate, allowRoles('admin'), async (req: AuthRequest, res, next) => {
  try {
    const profileId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.profileId);
    const input = z.object({ status: z.enum(['approved', 'rejected']), reviewNote: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const pending = await InstitutionProfile.findOne({ _id: profileId, status: 'pending' }).select('ownerId');
    if (!pending) throw new AppError(404, 'PENDING_INSTITUTION_APPLICATION_NOT_FOUND');
    if (!await User.exists({ _id: pending.ownerId })) throw new AppError(404, 'APPLICATION_OWNER_NOT_FOUND');
    const profile = await InstitutionProfile.findOneAndUpdate({ _id: profileId, status: 'pending' }, { $set: { status: input.status, reviewNote: input.reviewNote, reviewedBy: req.auth!.userId, reviewedAt: new Date() } }, { new: true, runValidators: true });
    if (!profile) throw new AppError(404, 'PENDING_INSTITUTION_APPLICATION_NOT_FOUND');
    if (input.status === 'approved') await User.findByIdAndUpdate(profile.ownerId, { $set: { role: 'institution', verified: true, status: 'active' } }, { runValidators: true });
    await AuditEvent.create({ action: `institution.application.${input.status}`, actorId: req.auth!.userId, targetType: 'institution-profile', targetId: profileId, severity: input.status === 'rejected' ? 'warning' : 'info', ipAddress: req.ip });
    void createNotification({ userId: String(profile.ownerId), type: 'account', title: 'Institution application reviewed', message: input.status === 'approved' ? 'Your institution is verified and its public profile is now available.' : `Your institution application was declined. ${input.reviewNote}`.trim(), link: '/institution/dashboard', template: { key: input.status === 'approved' ? 'institutionApproved' : 'institutionRejected', params: { note: input.reviewNote || '' } } }).catch(() => undefined);
    res.json({ success: true, data: { id: String(profile._id), status: profile.status, reviewNote: profile.reviewNote } });
  } catch (error) { next(error); }
});
