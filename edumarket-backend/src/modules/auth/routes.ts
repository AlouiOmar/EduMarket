import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { authenticate, type AuthRequest } from '../../common/auth.js';
import { User } from './model.js';
import { ensureEmailProviderAvailable, sendAuthEmail } from '../../integrations/email.js';
import { TeacherApplication } from '../teacher-applications/model.js';
import { notifyCandidate } from '../teacher-applications/notifications.js';

export const authRoutes = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: true, legacyHeaders: false });
const recoveryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: env.NODE_ENV === 'test' ? 1000 : 6, standardHeaders: true, legacyHeaders: false });
const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(10).max(128) });
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const actionUrl = (path: string, token: string) => {
  const url = new URL(path, env.APP_ORIGIN);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
};

async function createEmailAction(userId: string, email: string, kind: 'verification' | 'reset') {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (kind === 'verification' ? 24 : 1) * 60 * 60 * 1000);
  const field = kind === 'verification' ? 'emailVerification' : 'passwordReset';
  await User.updateOne({ _id: userId }, { $set: { [`${field}TokenHash`]: tokenHash(token), [`${field}ExpiresAt`]: expiresAt } });
  const link = actionUrl(kind === 'verification' ? '/auth/verify-email' : '/auth/reset-password', token);
  const delivery = await sendAuthEmail({
    to: email,
    subject: kind === 'verification' ? 'Verify your EduMarket email' : 'Reset your EduMarket password',
    actionUrl: link,
    actionLabel: kind === 'verification' ? 'Verify email address' : 'Reset password',
  });
  return delivery.delivery === 'development-preview' ? { previewUrl: delivery.previewUrl } : {};
}

authRoutes.post('/register', authLimiter, async (req, res, next) => {
  try {
    // Independent teacher candidates use the same account and authentication; the server alone decides the resulting role.
    const candidate = req.body?.accountType === 'teacher_candidate';
    const input = candidate
      ? credentials.extend({
        accountType: z.literal('teacher_candidate'), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
        phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'PHONE_E164'), country: z.string().regex(/^[A-Z]{2}$/), city: z.string().trim().min(1).max(100),
        preferredLanguage: z.enum(['fr', 'en', 'ar']), acceptTerms: z.literal(true),
      }).strict().parse(req.body)
      : credentials.extend({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    ensureEmailProviderAvailable();
    const email = input.email.toLowerCase();
    if (await User.exists({ email })) throw new AppError(409, 'EMAIL_IN_USE');
    const name = 'firstName' in input ? `${input.firstName} ${input.lastName}` : input.name;
    const user = await User.create({ name, email, emailVerified: false, passwordHash: await bcrypt.hash(input.password, 12), role: candidate ? 'unverified_teacher' : 'student', ...('phone' in input ? { phone: input.phone } : {}) });
    if ('firstName' in input) {
      try {
        await TeacherApplication.create({
          userId: user._id, termsAcceptedAt: new Date(),
          personal: { firstName: input.firstName, lastName: input.lastName, phone: input.phone, country: input.country, city: input.city, preferredLanguage: input.preferredLanguage },
          history: [{ at: new Date(), actorId: user._id, actorRole: 'candidate', action: 'created', from: null, to: 'draft', message: '' }],
        });
      } catch (error) { await User.deleteOne({ _id: user._id }); throw error; }
      void notifyCandidate(user.id, 'teacherApplicationCreated', {});
    }
    const verification = await createEmailAction(user.id, user.email, 'verification');
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ success: true, data: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: false, ...verification, createdAt: user.get('createdAt') } });
  } catch (error) { next(error); }
});

authRoutes.post('/login', authLimiter, async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS');
    if (!user.emailVerified) throw new AppError(403, 'EMAIL_NOT_VERIFIED');
    const token = jwt.sign({ ver: user.authVersion || 0 }, env.JWT_SECRET, { subject: user.id, expiresIn: '1h', issuer: 'edumarket-api', audience: 'edumarket-web' });
    res.cookie('edumarket_access', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000, path: '/api/v1' });
    res.json({ success: true, data: { expiresIn: 3600, user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role, verified: user.verified, status: user.status || 'active', institutionId: user.get('institutionId') ? String(user.get('institutionId')) : undefined, createdAt: user.get('createdAt') } } });
  } catch (error) { next(error); }
});

authRoutes.post('/email/verification/resend', recoveryLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email().max(254) }).strict().parse(req.body);
    ensureEmailProviderAvailable();
    const user = await User.findOne({ email: email.toLowerCase(), emailVerified: false }).select('_id email');
    const preview = user ? await createEmailAction(user.id, user.email, 'verification') : {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { accepted: true, ...preview } });
  } catch (error) { next(error); }
});

authRoutes.post('/email/verification/confirm', recoveryLimiter, async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(32).max(128) }).strict().parse(req.body);
    const result = await User.updateOne(
      { emailVerificationTokenHash: tokenHash(token), emailVerificationExpiresAt: { $gt: new Date() }, emailVerified: false },
      { $set: { emailVerified: true }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } },
    );
    if (result.modifiedCount !== 1) throw new AppError(400, 'EMAIL_VERIFICATION_TOKEN_INVALID');
    res.json({ success: true, data: { verified: true } });
  } catch (error) { next(error); }
});

authRoutes.post('/password/forgot', recoveryLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email().max(254) }).strict().parse(req.body);
    ensureEmailProviderAvailable();
    const user = await User.findOne({ email: email.toLowerCase() }).select('_id email');
    const preview = user ? await createEmailAction(user.id, user.email, 'reset') : {};
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { accepted: true, ...preview } });
  } catch (error) { next(error); }
});

authRoutes.post('/password/reset', recoveryLimiter, async (req, res, next) => {
  try {
    const input = z.object({ token: z.string().min(32).max(128), newPassword: z.string().min(10).max(128) }).strict().parse(req.body);
    const hashedToken = tokenHash(input.token);
    const user = await User.findOne({ passwordResetTokenHash: hashedToken, passwordResetExpiresAt: { $gt: new Date() } }).select('authVersion');
    if (!user) throw new AppError(400, 'PASSWORD_RESET_TOKEN_INVALID');
    const result = await User.updateOne(
      { _id: user._id, passwordResetTokenHash: hashedToken, passwordResetExpiresAt: { $gt: new Date() } },
      { $set: { passwordHash: await bcrypt.hash(input.newPassword, 12) }, $inc: { authVersion: 1 }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } },
    );
    if (result.modifiedCount !== 1) throw new AppError(400, 'PASSWORD_RESET_TOKEN_INVALID');
    res.json({ success: true, data: { reset: true } });
  } catch (error) { next(error); }
});

authRoutes.post('/logout', (_req, res) => {
  res.clearCookie('edumarket_access', { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1' });
  res.status(204).end();
});

authRoutes.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).select('name email emailVerified role verified status headline bio phone institutionId createdAt');
    if (!user) throw new AppError(401, 'USER_NOT_FOUND');
    res.json({ success: true, data: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified !== false, role: user.role, verified: user.verified, status: user.status || 'active', headline: user.get('headline'), bio: user.get('bio'), phone: user.get('phone'), institutionId: user.get('institutionId') ? String(user.get('institutionId')) : undefined, createdAt: user.get('createdAt') } });
  } catch (error) { next(error); }
});

authRoutes.patch('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (req.auth!.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED');
    const updates = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      headline: z.string().trim().max(160).optional(),
      bio: z.string().trim().max(2000).optional(),
      phone: z.string().trim().max(32).optional(),
    }).strict().refine(value => Object.keys(value).length > 0).parse(req.body);
    const user = await User.findByIdAndUpdate(req.auth!.userId, updates, { new: true, runValidators: true }).select('name email emailVerified role verified status headline bio phone createdAt');
    if (!user) throw new AppError(401, 'USER_NOT_FOUND');
    res.json({ success: true, data: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified !== false, role: user.role, verified: user.verified, status: user.status || 'active', headline: user.get('headline'), bio: user.get('bio'), phone: user.get('phone'), createdAt: user.get('createdAt') } });
  } catch (error) { next(error); }
});

authRoutes.post('/me/password', authenticate, authLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (req.auth!.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED');
    const input = z.object({ currentPassword: z.string().min(10).max(128), newPassword: z.string().min(10).max(128) }).strict().parse(req.body);
    if (input.currentPassword === input.newPassword) throw new AppError(400, 'PASSWORD_UNCHANGED');
    const user = await User.findById(req.auth!.userId).select('+passwordHash authVersion');
    if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new AppError(401, 'CURRENT_PASSWORD_INVALID');
    const currentVersion = user.authVersion || 0;
    const nextVersion = currentVersion + 1;
    const updated = await User.updateOne(
      { _id: user._id, $or: [{ authVersion: currentVersion }, { authVersion: { $exists: false } }] },
      { $set: { passwordHash: await bcrypt.hash(input.newPassword, 12) }, $inc: { authVersion: 1 } },
    );
    if (updated.modifiedCount !== 1) throw new AppError(409, 'PASSWORD_CHANGE_CONFLICT');
    const token = jwt.sign({ ver: nextVersion }, env.JWT_SECRET, { subject: user.id, expiresIn: '1h', issuer: 'edumarket-api', audience: 'edumarket-web' });
    res.cookie('edumarket_access', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000, path: '/api/v1' });
    res.json({ success: true, data: { changed: true } });
  } catch (error) { next(error); }
});

authRoutes.get('/me/preferences', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).select('notificationPreferences').lean();
    if (!user) throw new AppError(401, 'USER_NOT_FOUND');
    const prefs = user.notificationPreferences || {};
    res.json({ success: true, data: { sessions: prefs.sessions !== false, messages: prefs.messages !== false, courseActivity: prefs.courseActivity !== false, email: prefs.email === true } });
  } catch (error) { next(error); }
});

authRoutes.patch('/me/preferences', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (req.auth!.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED');
    const input = z.object({ sessions: z.boolean().optional(), messages: z.boolean().optional(), courseActivity: z.boolean().optional(), email: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0).parse(req.body);
    const updates = Object.fromEntries(Object.entries(input).map(([key, value]) => [`notificationPreferences.${key}`, value]));
    const user = await User.findByIdAndUpdate(req.auth!.userId, { $set: updates }, { new: true, runValidators: true }).select('notificationPreferences').lean();
    if (!user) throw new AppError(401, 'USER_NOT_FOUND');
    const prefs = user.notificationPreferences || {};
    res.json({ success: true, data: { sessions: prefs.sessions !== false, messages: prefs.messages !== false, courseActivity: prefs.courseActivity !== false, email: prefs.email === true } });
  } catch (error) { next(error); }
});
