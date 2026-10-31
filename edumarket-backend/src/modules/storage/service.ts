import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { AppError } from '../../common/errors.js';
import { cloudProvider, type CloudProviderName } from '../../integrations/cloudStorage.js';
import { encryptToken } from '../../integrations/googleCalendar.js';
import { StorageAccount } from './model.js';

/** Free space kept on an account before it is considered full (drive metadata, thumbnails…). */
const SAFETY_MARGIN = 5 * 1024 * 1024;

export const accountDto = (account: any) => ({
  id: String(account._id), provider: account.provider, accountEmail: account.accountEmail, displayName: account.displayName,
  isDefault: !!account.isDefault, status: account.status, connectedAt: account.connectedAt,
  quota: { total: account.quota?.total ?? null, used: account.quota?.used ?? 0, free: account.quota?.total == null ? null : Math.max(0, account.quota.total - account.quota.used), checkedAt: account.quota?.checkedAt || null },
});

/** Fresh access token for an account; rotated refresh tokens are persisted and expired grants flag the account. */
export async function accessTokenFor(accountId: unknown) {
  const account = await StorageAccount.findById(accountId).select('+refreshToken');
  if (!account) throw new AppError(404, 'STORAGE_ACCOUNT_NOT_FOUND');
  const provider = cloudProvider(account.provider);
  try {
    const { token, rotatedRefreshToken } = await provider.accessToken(account.refreshToken);
    if (rotatedRefreshToken) await StorageAccount.updateOne({ _id: account._id }, { $set: { refreshToken: encryptToken(rotatedRefreshToken), status: 'connected' } });
    return { account, provider, token };
  } catch (error) {
    if ((error as AppError).code === 'STORAGE_ACCOUNT_RECONNECT_REQUIRED') await StorageAccount.updateOne({ _id: account._id }, { $set: { status: 'reconnect_required' } });
    throw error;
  }
}

export async function refreshQuota(accountId: unknown) {
  const { provider, token } = await accessTokenFor(accountId);
  const quota = await provider.quota(token);
  return StorageAccount.findByIdAndUpdate(accountId, { $set: { quota: { ...quota, checkedAt: new Date() } } }, { new: true }).lean();
}

/**
 * Candidate accounts for an upload: the requested account, else the default one, then the others by most free space.
 * Accounts known to lack room for `size` bytes are skipped, so a full drive automatically hands over to the next one.
 */
async function uploadCandidates(ownerId: string, size: number, preferredId?: string) {
  const accounts = await StorageAccount.find({ ownerId, status: 'connected' }).lean();
  if (preferredId && !accounts.some(account => String(account._id) === preferredId)) throw new AppError(404, 'STORAGE_ACCOUNT_NOT_FOUND');
  const free = (account: any) => account.quota?.total == null ? Number.MAX_SAFE_INTEGER : account.quota.total - account.quota.used;
  const ordered = [...accounts].sort((a, b) => {
    const rank = (account: any) => String(account._id) === preferredId ? 0 : account.isDefault ? 1 : 2;
    return rank(a) - rank(b) || free(b) - free(a);
  });
  return ordered.filter(account => free(account) >= size + SAFETY_MARGIN);
}

export interface CloudStorageRef { provider: CloudProviderName; accountId: unknown; fileId: string }

/** Uploads a local file to the owner's drives. Returns null when the owner has no account (caller keeps local storage). */
export async function uploadToOwnerDrive(ownerId: string, file: { name: string; mimeType: string; path: string; size: number }, preferredId?: string): Promise<(CloudStorageRef & { webUrl: string }) | null> {
  if (!preferredId && !await StorageAccount.exists({ ownerId, status: 'connected' })) return null;
  const candidates = await uploadCandidates(ownerId, file.size, preferredId);
  if (!candidates.length) throw new AppError(507, 'STORAGE_ACCOUNTS_FULL');
  for (const candidate of candidates) {
    const { provider, token } = await accessTokenFor(candidate._id);
    // Live check: the stored quota may be stale if files were added from outside the platform.
    const quota = await provider.quota(token);
    await StorageAccount.updateOne({ _id: candidate._id }, { $set: { quota: { ...quota, checkedAt: new Date() } } });
    if (quota.total != null && quota.total - quota.used < file.size + SAFETY_MARGIN) continue;
    try {
      const uploaded = await provider.upload(token, candidate.folderId, file);
      await StorageAccount.updateOne({ _id: candidate._id }, { $inc: { 'quota.used': file.size } });
      return { provider: provider.name, accountId: candidate._id, fileId: uploaded.fileId, webUrl: uploaded.webUrl };
    } catch (error) {
      if ((error as AppError).code !== 'STORAGE_ACCOUNT_FULL') throw error;
    }
  }
  throw new AppError(507, 'STORAGE_ACCOUNTS_FULL');
}

/** Streams a cloud file through the API (the access check happens before), forwarding Range for video seeking. */
export async function streamCloudFile(ref: CloudStorageRef, req: Request, res: Response, headers: Record<string, string>, downloadName?: string) {
  const { provider, token } = await accessTokenFor(ref.accountId);
  const upstream = await provider.download(token, ref.fileId, typeof req.headers.range === 'string' ? req.headers.range : undefined);
  res.status(upstream.status === 206 ? 206 : 200);
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.set(headers);
  if (downloadName) res.attachment(downloadName);
  if (!upstream.body) { res.end(); return; }
  Readable.fromWeb(upstream.body as any).on('error', () => res.destroy()).pipe(res);
}

export async function removeCloudFile(ref: CloudStorageRef) {
  const { provider, token } = await accessTokenFor(ref.accountId);
  await provider.remove(token, ref.fileId);
}

/** Whole cloud file as a buffer (course exports); bounded by the caller's size limit. */
export async function readCloudFile(ref: CloudStorageRef) {
  const { provider, token } = await accessTokenFor(ref.accountId);
  const upstream = await provider.download(token, ref.fileId);
  if (!upstream.ok) throw new Error('CLOUD_DOWNLOAD_FAILED');
  return Buffer.from(await upstream.arrayBuffer());
}
