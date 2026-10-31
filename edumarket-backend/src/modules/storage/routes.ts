import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { cloudProvider, cloudProviders } from '../../integrations/cloudStorage.js';
import { encryptToken } from '../../integrations/googleCalendar.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { CourseAsset } from '../courses/assets.model.js';
import { StorageAccount } from './model.js';
import { accountDto, refreshQuota, uploadToOwnerDrive } from './service.js';
import { buildGradeReport } from './gradeReport.js';

/** Cloud drives paired by teachers and institutions (Google Drive, OneDrive), and grade exports. */
export const storageRoutes = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const providerName = z.enum(['google_drive', 'onedrive']);

/** OAuth redirect target for both providers (signed state, no session cookie needed). */
storageRoutes.get('/oauth/:provider/callback', async (req, res) => {
  const target = new URL('/storage', env.APP_ORIGIN);
  try {
    const provider = cloudProvider(providerName.parse(req.params.provider));
    const query = z.object({ code: z.string().min(1).max(4000).optional(), state: z.string().min(1).max(2000), error: z.string().max(200).optional() }).passthrough().parse(req.query);
    const claims = jwt.verify(query.state, env.JWT_SECRET) as jwt.JwtPayload;
    if (claims.purpose !== 'cloud-storage' || claims.provider !== provider.name || typeof claims.sub !== 'string') throw new AppError(400, 'INVALID_OAUTH_STATE');
    if (query.error || !query.code) throw new AppError(400, 'STORAGE_CONNECTION_DENIED');
    if (!await User.exists({ _id: claims.sub, role: { $in: ['teacher', 'institution'] }, status: 'active' })) throw new AppError(400, 'INVALID_OAUTH_STATE');
    const info = await provider.connect(query.code);
    if (!info.accountEmail) throw new AppError(502, 'CLOUD_STORAGE_ERROR');
    const { token } = await provider.accessToken(encryptToken(info.refreshToken));
    const [folderId, quota] = await Promise.all([provider.ensureFolder(token), provider.quota(token)]);
    const hasDefault = await StorageAccount.exists({ ownerId: claims.sub, isDefault: true });
    // Re-pairing the same account refreshes its token instead of creating a duplicate.
    await StorageAccount.findOneAndUpdate(
      { ownerId: claims.sub, provider: provider.name, accountEmail: info.accountEmail.toLowerCase() },
      { $set: { refreshToken: encryptToken(info.refreshToken), displayName: info.displayName, folderId, quota: { ...quota, checkedAt: new Date() }, status: 'connected' }, $setOnInsert: { isDefault: !hasDefault, connectedAt: new Date() } },
      { upsert: true, new: true, runValidators: true },
    );
    await AuditEvent.create({ action: `storage.account.connected.${provider.name}`, actorId: claims.sub, targetType: 'storage_account', targetId: info.accountEmail.toLowerCase(), ipAddress: req.ip });
    target.searchParams.set('storage', 'connected');
  } catch (error) {
    target.searchParams.set('storage', 'error');
    target.searchParams.set('code', error instanceof AppError ? error.code : 'INVALID_OAUTH_STATE');
  }
  res.redirect(303, target.toString());
});

storageRoutes.use(authenticate, allowRoles('teacher', 'institution'));

storageRoutes.get('/providers', (_req, res) => {
  res.json({ success: true, data: Object.values(cloudProviders).map(provider => ({ provider: provider.name, configured: provider.enabled() })) });
});

storageRoutes.get('/accounts', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await StorageAccount.find({ ownerId: req.auth!.userId }).sort({ isDefault: -1, connectedAt: 1 }).lean();
    const usage = await CourseAsset.aggregate<{ _id: unknown; files: number; bytes: number }>([
      { $match: { 'storage.accountId': { $in: accounts.map(account => account._id) } } },
      { $group: { _id: '$storage.accountId', files: { $sum: 1 }, bytes: { $sum: '$size' } } },
    ]);
    const byAccount = new Map(usage.map(row => [String(row._id), row]));
    res.json({ success: true, data: accounts.map(account => ({ ...accountDto(account), platformFiles: byAccount.get(String(account._id))?.files || 0 })) });
  } catch (error) { next(error); }
});

storageRoutes.post('/accounts/connect', async (req: AuthRequest, res, next) => {
  try {
    const { provider } = z.object({ provider: providerName }).strict().parse(req.body);
    if (req.auth!.role === 'teacher' && !await User.exists({ _id: req.auth!.userId, verified: true })) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    if (await StorageAccount.countDocuments({ ownerId: req.auth!.userId }) >= 10) throw new AppError(409, 'STORAGE_ACCOUNT_LIMIT_REACHED');
    const state = jwt.sign({ sub: req.auth!.userId, provider, purpose: 'cloud-storage' }, env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ success: true, data: { authorizationUrl: cloudProvider(provider).authorizationUrl(state) } });
  } catch (error) { next(error); }
});

const ownAccount = async (req: AuthRequest) => {
  const accountId = objectId.safeParse(req.params.accountId); if (!accountId.success) throw new AppError(404, 'STORAGE_ACCOUNT_NOT_FOUND');
  const account = await StorageAccount.findOne({ _id: accountId.data, ownerId: req.auth!.userId });
  if (!account) throw new AppError(404, 'STORAGE_ACCOUNT_NOT_FOUND');
  return account;
};

/** Switches the default account (the one receiving new uploads). */
storageRoutes.patch('/accounts/:accountId', async (req: AuthRequest, res, next) => {
  try {
    const account = await ownAccount(req);
    z.object({ isDefault: z.literal(true) }).strict().parse(req.body);
    await StorageAccount.updateMany({ ownerId: req.auth!.userId, _id: { $ne: account._id } }, { $set: { isDefault: false } });
    account.isDefault = true;
    await account.save();
    res.json({ success: true, data: accountDto(account) });
  } catch (error) { next(error); }
});

storageRoutes.post('/accounts/:accountId/refresh', async (req: AuthRequest, res, next) => {
  try {
    const account = await ownAccount(req);
    res.json({ success: true, data: accountDto(await refreshQuota(account._id)) });
  } catch (error) { next(error); }
});

/** An account still holding course files cannot be removed: those files would become unreachable for learners. */
storageRoutes.delete('/accounts/:accountId', async (req: AuthRequest, res, next) => {
  try {
    const account = await ownAccount(req);
    const files = await CourseAsset.countDocuments({ 'storage.accountId': account._id });
    if (files) throw new AppError(409, 'STORAGE_ACCOUNT_IN_USE');
    const withToken = await StorageAccount.findById(account._id).select('+refreshToken').lean();
    if (withToken) await cloudProvider(account.provider).revoke(withToken.refreshToken).catch(() => undefined);
    await account.deleteOne();
    if (account.isDefault) await StorageAccount.findOneAndUpdate({ ownerId: req.auth!.userId }, { $set: { isDefault: true } }, { sort: { connectedAt: 1 } });
    await AuditEvent.create({ action: 'storage.account.disconnected', actorId: req.auth!.userId, targetType: 'storage_account', targetId: String(account._id), ipAddress: req.ip });
    res.status(204).end();
  } catch (error) { next(error); }
});

/**
 * Grade sheet (progress, quizzes, assignments, exams) of a managed course: downloaded as CSV (`destination: download`)
 * or saved to a paired drive (`default` or an account id); the drive link is returned.
 */
storageRoutes.post('/exports/grades', async (req: AuthRequest, res, next) => {
  const stagingDir = privateStorage.uploadDirectory('cloud-staging');
  const stagingPath = path.join(stagingDir, `${crypto.randomUUID()}.csv`);
  try {
    const input = z.object({ courseId: objectId, destination: z.union([z.literal('download'), z.literal('default'), objectId]).default('download') }).strict().parse(req.body);
    const { csv, fileName } = await buildGradeReport(input.courseId, { userId: req.auth!.userId, role: req.auth!.role });
    if (input.destination === 'download') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }).attachment(fileName).send(csv);
      return;
    }
    await mkdir(stagingDir, { recursive: true });
    await writeFile(stagingPath, csv, 'utf8');
    const uploaded = await uploadToOwnerDrive(req.auth!.userId, { name: fileName, mimeType: 'text/csv', path: stagingPath, size: Buffer.byteLength(csv) }, input.destination === 'default' ? undefined : input.destination);
    if (!uploaded) throw new AppError(409, 'STORAGE_ACCOUNT_REQUIRED');
    const account = await StorageAccount.findById(uploaded.accountId).lean();
    await AuditEvent.create({ action: 'storage.grades.exported', actorId: req.auth!.userId, targetType: 'course', targetId: input.courseId, ipAddress: req.ip });
    res.status(201).json({ success: true, data: { fileName, webUrl: uploaded.webUrl, provider: uploaded.provider, accountEmail: account?.accountEmail || '' } });
  } catch (error) { next(error); }
  finally { await rm(stagingPath, { force: true }).catch(() => undefined); }
});

