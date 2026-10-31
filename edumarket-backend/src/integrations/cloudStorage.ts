import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';
import { decryptToken } from './googleCalendar.js';

/**
 * Cloud drives used as file storage by teachers and institutions (course videos/resources, grade exports).
 * Google Drive: OAuth `drive.file` scope (the app only sees the files it created). OneDrive: Microsoft Graph,
 * `Files.ReadWrite offline_access User.Read`. Refresh tokens are stored encrypted by the caller (AES-256-GCM).
 * Files are always served through the API after an access check; drive links are never exposed for course content.
 */
export type CloudProviderName = 'google_drive' | 'onedrive';
export interface CloudAccountInfo { refreshToken: string; accountEmail: string; displayName: string }
export interface Quota { total: number | null; used: number }
export interface UploadedFile { fileId: string; webUrl: string }
export interface CloudProvider {
  name: CloudProviderName;
  enabled(): boolean;
  authorizationUrl(state: string): string;
  connect(code: string): Promise<CloudAccountInfo>;
  /** Returns an access token and, for providers rotating refresh tokens, the new (plain) refresh token. */
  accessToken(encryptedRefreshToken: string): Promise<{ token: string; rotatedRefreshToken?: string }>;
  ensureFolder(token: string): Promise<string>;
  quota(token: string): Promise<Quota>;
  upload(token: string, folderId: string, file: { name: string; mimeType: string; path: string }): Promise<UploadedFile>;
  download(token: string, fileId: string, range?: string): Promise<Response>;
  remove(token: string, fileId: string): Promise<void>;
  revoke(encryptedRefreshToken: string): Promise<void>;
}

const FOLDER_NAME = 'EduMarket';
const fail = (provider: CloudProviderName, status?: number, detail?: unknown): never => {
  console.error('Cloud storage request failed', { provider, status, detail: typeof detail === 'string' ? detail.slice(0, 120) : undefined });
  throw new AppError(502, 'CLOUD_STORAGE_ERROR');
};
const json = async (response: Response) => response.json().catch(() => ({})) as Promise<any>;

// ---------------------------------------------------------------- Google Drive

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const googleDrive: CloudProvider = {
  name: 'google_drive',
  enabled: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_DRIVE_REDIRECT_URI),
  authorizationUrl(state) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.GOOGLE_DRIVE_REDIRECT_URI!, response_type: 'code', scope: GOOGLE_SCOPE, access_type: 'offline', prompt: 'consent select_account', state }).toString();
    return url.toString();
  },
  async connect(code) {
    const tokens = await googleToken({ code, grant_type: 'authorization_code', redirect_uri: env.GOOGLE_DRIVE_REDIRECT_URI! });
    if (!tokens.refresh_token) fail('google_drive', 400, 'missing refresh token');
    const about = await googleApi(tokens.access_token, 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
    return { refreshToken: tokens.refresh_token!, accountEmail: about.user?.emailAddress || '', displayName: about.user?.displayName || '' };
  },
  async accessToken(encrypted) { return { token: (await googleToken({ refresh_token: decryptToken(encrypted), grant_type: 'refresh_token' })).access_token }; },
  async ensureFolder(token) {
    const created = await googleApi(token, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
    return String(created.id);
  },
  async quota(token) {
    const about = await googleApi(token, 'https://www.googleapis.com/drive/v3/about?fields=storageQuota');
    const limit = about.storageQuota?.limit;
    return { total: limit === undefined ? null : Number(limit), used: Number(about.storageQuota?.usage || 0) };
  },
  async upload(token, folderId, file) {
    const size = (await stat(file.path)).size;
    // Resumable session: metadata first, then the bytes streamed in one request (handles 250 MB videos).
    const session = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.mimeType, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name: file.name, parents: [folderId] }),
    });
    const location = session.headers.get('location');
    if (!session.ok || !location) {
      if (session.status === 403 && JSON.stringify(await json(session)).includes('storageQuotaExceeded')) throw new AppError(507, 'STORAGE_ACCOUNT_FULL');
      fail('google_drive', session.status);
    }
    const uploaded = await fetch(location!, { method: 'PUT', headers: { 'Content-Length': String(size), 'Content-Type': file.mimeType }, body: Readable.toWeb(createReadStream(file.path)) as any, duplex: 'half' } as RequestInit);
    const payload = await json(uploaded);
    if (!uploaded.ok || !payload.id) fail('google_drive', uploaded.status);
    return { fileId: String(payload.id), webUrl: String(payload.webViewLink || '') };
  },
  async download(token, fileId, range) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) } });
    if (response.status === 404) throw new AppError(404, 'CLOUD_FILE_NOT_FOUND');
    if (!response.ok) fail('google_drive', response.status);
    return response;
  },
  async remove(token, fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok && response.status !== 404) fail('google_drive', response.status);
  },
  async revoke(encrypted) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptToken(encrypted))}`, { method: 'POST' }).catch(() => undefined);
  },
};

async function googleToken(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const payload = await json(response);
  if (!response.ok || !payload.access_token) {
    if (payload?.error === 'invalid_grant') throw new AppError(409, 'STORAGE_ACCOUNT_RECONNECT_REQUIRED');
    fail('google_drive', response.status, payload?.error);
  }
  return payload as { access_token: string; refresh_token?: string };
}

async function googleApi(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const payload = await json(response);
  if (!response.ok) fail('google_drive', response.status, payload?.error?.message);
  return payload;
}

// ---------------------------------------------------------------- OneDrive (Microsoft Graph)

const MS_SCOPE = 'offline_access Files.ReadWrite User.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const CHUNK = 320 * 1024 * 32; // 10 MiB, a multiple of 320 KiB as required by upload sessions

const oneDrive: CloudProvider = {
  name: 'onedrive',
  enabled: () => !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_REDIRECT_URI),
  authorizationUrl(state) {
    const url = new URL(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID!, redirect_uri: env.MICROSOFT_REDIRECT_URI!, response_type: 'code', response_mode: 'query', scope: MS_SCOPE, prompt: 'select_account', state }).toString();
    return url.toString();
  },
  async connect(code) {
    const tokens = await microsoftToken({ code, grant_type: 'authorization_code', redirect_uri: env.MICROSOFT_REDIRECT_URI! });
    if (!tokens.refresh_token) fail('onedrive', 400, 'missing refresh token');
    const me = await graph(tokens.access_token, '/me?$select=mail,userPrincipalName,displayName');
    return { refreshToken: tokens.refresh_token!, accountEmail: me.mail || me.userPrincipalName || '', displayName: me.displayName || '' };
  },
  async accessToken(encrypted) {
    const tokens = await microsoftToken({ refresh_token: decryptToken(encrypted), grant_type: 'refresh_token' });
    return { token: tokens.access_token, rotatedRefreshToken: tokens.refresh_token };
  },
  async ensureFolder(token) {
    const existing = await fetch(`${GRAPH}/me/drive/root:/${FOLDER_NAME}`, { headers: { Authorization: `Bearer ${token}` } });
    if (existing.ok) return String((await json(existing)).id);
    const created = await graph(token, '/me/drive/root/children', { method: 'POST', body: JSON.stringify({ name: FOLDER_NAME, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) });
    return String(created.id);
  },
  async quota(token) {
    const drive = await graph(token, '/me/drive?$select=quota');
    return { total: drive.quota?.total === undefined ? null : Number(drive.quota.total), used: Number(drive.quota?.used || 0) };
  },
  async upload(token, folderId, file) {
    const size = (await stat(file.path)).size;
    const session = await graph(token, `/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(file.name)}:/createUploadSession`, {
      method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
    });
    const handle = await open(file.path, 'r');
    try {
      let offset = 0, last: any = null;
      while (offset < size) {
        const length = Math.min(CHUNK, size - offset);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        // The pre-authenticated upload URL must not receive the Authorization header.
        const response = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` }, body: buffer });
        if (response.status === 507) throw new AppError(507, 'STORAGE_ACCOUNT_FULL');
        if (!response.ok) fail('onedrive', response.status);
        last = await json(response);
        offset += length;
      }
      if (!last?.id) fail('onedrive', 500, 'upload without item');
      return { fileId: String(last.id), webUrl: String(last.webUrl || '') };
    } finally { await handle.close(); }
  },
  async download(token, fileId, range) {
    // Graph answers with a redirect to a pre-authenticated URL; fetch follows it (and drops Authorization cross-origin).
    const response = await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/content`, { headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) } });
    if (response.status === 404) throw new AppError(404, 'CLOUD_FILE_NOT_FOUND');
    if (!response.ok) fail('onedrive', response.status);
    return response;
  },
  async remove(token, fileId) {
    const response = await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok && response.status !== 404) fail('onedrive', response.status);
  },
  // Microsoft offers no per-token revocation endpoint for this flow; the encrypted token is deleted by the caller.
  async revoke() { /* no-op */ },
};

async function microsoftToken(params: Record<string, string>) {
  const response = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!, scope: MS_SCOPE, ...params }),
  });
  const payload = await json(response);
  if (!response.ok || !payload.access_token) {
    if (payload?.error === 'invalid_grant') throw new AppError(409, 'STORAGE_ACCOUNT_RECONNECT_REQUIRED');
    fail('onedrive', response.status, payload?.error);
  }
  return payload as { access_token: string; refresh_token?: string };
}

async function graph(token: string, pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${GRAPH}${pathname}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const payload = await json(response);
  if (!response.ok) fail('onedrive', response.status, payload?.error?.code);
  return payload;
}

export const cloudProviders: Record<CloudProviderName, CloudProvider> = { google_drive: googleDrive, onedrive: oneDrive };
export const cloudProvider = (name: string) => {
  const provider = cloudProviders[name as CloudProviderName];
  if (!provider) throw new AppError(404, 'STORAGE_PROVIDER_NOT_FOUND');
  if (!provider.enabled()) throw new AppError(503, 'STORAGE_PROVIDER_NOT_CONFIGURED');
  return provider;
};
