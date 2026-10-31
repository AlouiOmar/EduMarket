import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { DEFAULT_ZIP_LIMITS, ZipError, createZip, readZip } from '../../common/zip.js';
import { env } from '../../config/env.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Assignment } from '../assignments/models.js';
import { readCloudFile, removeCloudFile } from '../storage/service.js';
import { COURSE_ASSET_KINDS, COURSE_ASSET_MIME_TYPES, CourseAsset } from './assets.model.js';
import { getManageableCourse } from './assets.routes.js';
import { fileReferences } from './files.js';
import { LinkReport } from './linkReport.model.js';
import { checkLinks, collectLinks } from './links.js';
import { Course } from './model.js';
import { plainOutline } from './structure.js';
import { MAX_CONTAINERS } from './structure.js';
import { commitOutline, exportPackage, importedChapters, loadOutline, packageSchema } from './structure.routes.js';
import { ContentVersion } from './version.model.js';

/**
 * Course files (inventory, references, quarantine, deferred deletion), external link checks, and the self-contained course
 * archive (EduMarket format v2: files included, relative paths, SHA-256 manifest). This is not a Blackboard / IMS format.
 */
export const courseFileRoutes = Router();
const managers = [authenticate, allowRoles('teacher', 'institution', 'admin')];
export const QUARANTINE_DAYS = 30;
const MAX_LINKS = 300;

async function referencesOf(courseId: unknown) {
  const [course, versions, assignments, lessonAssets] = await Promise.all([
    Course.findById(courseId).select('chapters banner').lean(),
    ContentVersion.find({ courseId }).select('itemId version title snapshot').lean(),
    Assignment.find({ courseId }).select('title attachments').lean(),
    CourseAsset.find({ courseId, lessonId: { $ne: '' } }).select('_id lessonId').lean(),
  ]);
  return fileReferences({ chapters: plainOutline(course?.chapters), bannerAssetId: course?.banner?.assetId, versions: versions as any[], assignments: assignments as any[], lessonAssets });
}

courseFileRoutes.get('/:courseId/files', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const [assets, references] = await Promise.all([CourseAsset.find({ courseId: course._id }).sort({ createdAt: -1 }).lean(), referencesOf(course._id)]);
    res.json({ success: true, data: assets.map(asset => {
      const refs = references.get(String(asset._id)) || [];
      return {
        id: String(asset._id), name: asset.originalName, kind: asset.kind, mimeType: asset.mimeType, size: asset.size, storage: asset.storage?.provider || 'local', createdAt: (asset as any).createdAt,
        references: refs, status: asset.quarantinedAt ? 'quarantined' : refs.length ? 'used' : 'unused', quarantinedAt: asset.quarantinedAt,
        purgeAfter: asset.quarantinedAt ? new Date(new Date(asset.quarantinedAt).getTime() + QUARANTINE_DAYS * 86_400_000) : null,
      };
    }) });
  } catch (error) { next(error); }
});

async function unusedAsset(req: AuthRequest) {
  const course = await getManageableCourse(req, req.params.courseId);
  const asset = await CourseAsset.findOne({ _id: z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.assetId), courseId: course._id });
  if (!asset) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
  if ((await referencesOf(course._id)).get(String(asset._id))?.length) throw new AppError(409, 'FILE_IN_USE');
  return { course, asset };
}
courseFileRoutes.post('/:courseId/files/:assetId/quarantine', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { asset } = await unusedAsset(req);
    asset.quarantinedAt = new Date(); await asset.save();
    res.json({ success: true, data: { id: String(asset._id), quarantinedAt: asset.quarantinedAt } });
  } catch (error) { next(error); }
});
courseFileRoutes.post('/:courseId/files/:assetId/restore', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const asset = await CourseAsset.findOneAndUpdate({ _id: z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.assetId), courseId: course._id }, { $set: { quarantinedAt: null } }, { new: true }).lean();
    if (!asset) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    res.json({ success: true, data: { id: String(asset._id) } });
  } catch (error) { next(error); }
});

/** Deletes a record; the stored file goes only when no other asset (copies share files) points to it. */
async function deleteAsset(asset: any) {
  await CourseAsset.deleteOne({ _id: asset._id });
  const provider = asset.storage?.provider || 'local';
  if (provider === 'local' && asset.storageKey) {
    if (!await CourseAsset.exists({ storageKey: asset.storageKey })) await privateStorage.remove('course-assets', asset.storageKey).catch(() => undefined);
  } else if (asset.storage?.fileId && !await CourseAsset.exists({ 'storage.fileId': asset.storage.fileId })) {
    await removeCloudFile({ provider, accountId: asset.storage.accountId, fileId: asset.storage.fileId } as any).catch(() => undefined);
  }
}

/** Definitive deletion: only from quarantine, after a fresh check that nothing refers to the file anymore. */
courseFileRoutes.delete('/:courseId/files/:assetId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { course, asset } = await unusedAsset(req);
    if (!asset.quarantinedAt) throw new AppError(409, 'FILE_NOT_QUARANTINED');
    await deleteAsset(asset);
    await AuditEvent.create({ action: 'course.file.deleted', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data: { id: String(asset._id) } });
  } catch (error) { next(error); }
});

/** Purge job: quarantined for 30 days and still unused → deleted. A file used again meanwhile is released from quarantine. */
export async function purgeQuarantinedFiles(now = new Date()) {
  const due = await CourseAsset.find({ quarantinedAt: { $ne: null, $lt: new Date(now.getTime() - QUARANTINE_DAYS * 86_400_000) } }).limit(100).lean();
  let deleted = 0;
  for (const asset of due) {
    if ((await referencesOf(asset.courseId)).get(String(asset._id))?.length) { await CourseAsset.updateOne({ _id: asset._id }, { $set: { quarantinedAt: null } }); continue; }
    await deleteAsset(asset); deleted += 1;
  }
  return deleted;
}

// --- Link checks ---------------------------------------------------------------------------------------------------------

export async function runLinkCheck(courseId: unknown, trigger: 'manual' | 'scheduled') {
  const course = await Course.findById(courseId).select('chapters').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const links = collectLinks(plainOutline(course.chapters));
  const urls = [...links.keys()].slice(0, MAX_LINKS);
  const results = await checkLinks(urls, { allowPrivate: env.LINK_CHECK_ALLOW_PRIVATE === 'true' && env.NODE_ENV !== 'production', concurrency: 4, timeoutMs: 8000 });
  const report = await LinkReport.findOneAndUpdate({ courseId: course._id }, { $set: {
    checkedAt: new Date(), trigger, truncated: links.size > MAX_LINKS,
    results: results.map(result => ({ ...result, locations: links.get(result.url) || [] })).sort((a, b) => a.url.localeCompare(b.url)),
  } }, { upsert: true, new: true }).lean();
  return report!;
}
const reportDto = (report: any) => report ? { checkedAt: report.checkedAt, trigger: report.trigger, truncated: report.truncated, results: report.results, broken: report.results.filter((row: any) => ['broken', 'error'].includes(row.status)).length } : null;

courseFileRoutes.get('/:courseId/link-check', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    res.json({ success: true, data: reportDto(await LinkReport.findOne({ courseId: course._id }).lean()) });
  } catch (error) { next(error); }
});
courseFileRoutes.post('/:courseId/link-check', ...managers, rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }), async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    res.json({ success: true, data: reportDto(await runLinkCheck(course._id, 'manual')) });
  } catch (error) { next(error); }
});

/** Yearly check (EX-LIE-02): one published course per run whose last report is older than a year (or missing). */
export async function runScheduledLinkChecks(now = new Date()) {
  // The scheduler ticks every minute: at most one scheduled check per hour across the platform.
  if (await LinkReport.exists({ trigger: 'scheduled', checkedAt: { $gt: new Date(now.getTime() - 3600_000) } })) return 0;
  const recent = await LinkReport.find({ checkedAt: { $gt: new Date(now.getTime() - 365 * 86_400_000) } }).distinct('courseId');
  const course = await Course.findOne({ status: 'published', _id: { $nin: recent }, 'chapters.0': { $exists: true } }).select('_id').lean();
  if (!course) return 0;
  await runLinkCheck(course._id, 'scheduled');
  return 1;
}

// --- Archive (EduMarket format v2) -----------------------------------------------------------------------------------------

const EXTENSIONS: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'text/vtt': 'vtt' };
const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const ARCHIVE_LIMIT = 200 * 1024 * 1024;

async function assetBytes(asset: any) {
  if ((asset.storage?.provider || 'local') === 'local') return readFile(path.join(privateStorage.uploadDirectory('course-assets'), asset.storageKey));
  return readCloudFile({ provider: asset.storage.provider, accountId: asset.storage.accountId, fileId: asset.storage.fileId } as any);
}

/** ZIP with course.json, files/… (relative paths) and manifest.json (size + SHA-256 of every file). No student data. */
courseFileRoutes.get('/:courseId/export-archive', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const managed = await getManageableCourse(req, req.params.courseId);
    const [course, assets] = await Promise.all([Course.findById(managed._id).lean(), CourseAsset.find({ courseId: managed._id, quarantinedAt: null }).lean()]);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const files: Array<{ name: string; data: Buffer }> = [];
    let total = 0;
    const assetEntries = [];
    for (const asset of assets) {
      const filePath = `files/${asset._id}.${EXTENSIONS[asset.mimeType] || 'bin'}`;
      try {
        if (total + asset.size > ARCHIVE_LIMIT) throw new Error('ARCHIVE_TOO_LARGE');
        const data = await assetBytes(asset);
        total += data.length;
        files.push({ name: filePath, data });
        assetEntries.push({ id: String(asset._id), kind: asset.kind, name: asset.originalName, mimeType: asset.mimeType, size: data.length, lessonId: asset.lessonId || '', path: filePath });
      } catch (error) {
        assetEntries.push({ id: String(asset._id), kind: asset.kind, name: asset.originalName, mimeType: asset.mimeType, size: asset.size, lessonId: asset.lessonId || '', path: null, missing: (error as Error).message === 'ARCHIVE_TOO_LARGE' ? 'ARCHIVE_TOO_LARGE' : 'FILE_UNAVAILABLE' });
      }
    }
    const pkg = { ...exportPackage(course, assets), version: 2, assets: assetEntries };
    const courseJson = Buffer.from(JSON.stringify(pkg, null, 2));
    const manifest = {
      format: 'edumarket-course-archive', version: 2, createdAt: new Date().toISOString(), note: 'EduMarket archive format; not an IMS Common Cartridge or Blackboard package.',
      files: [{ path: 'course.json', size: courseJson.length, sha256: sha256(courseJson) }, ...files.map(file => ({ path: file.name, size: file.data.length, sha256: sha256(file.data) }))],
    };
    const zip = createZip([{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }, { name: 'course.json', data: courseJson }, ...files]);
    await AuditEvent.create({ action: 'course.exported', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="course-${course._id}.zip"`, 'Cache-Control': 'no-store' }).send(zip);
  } catch (error) { next(error); }
});

const archiveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ARCHIVE_LIMIT, files: 1, fields: 2, parts: 3 } }).single('archive');
const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  pdf: data => data.subarray(0, 5).toString() === '%PDF-', png: data => data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), jpg: data => data[0] === 0xff && data[1] === 0xd8,
  gif: data => data.subarray(0, 3).toString() === 'GIF', webp: data => data.subarray(8, 12).toString() === 'WEBP', zip: data => data[0] === 0x50 && data[1] === 0x4b,
  mp4: data => data.subarray(4, 8).toString() === 'ftyp', webm: data => data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), vtt: data => data.subarray(0, 6).toString().replace('﻿', '').startsWith('WEBVTT'),
};

/**
 * Imports a v2 archive: every file must be listed in the manifest with a matching size and SHA-256 (and nothing unlisted may be
 * present), file types are checked by signature, files are stored privately as new assets of this course, block references remapped.
 */
courseFileRoutes.post('/:courseId/structure/import-archive', ...managers, rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }), (req: AuthRequest, res, next) => archiveUpload(req, res, async uploadError => {
  const stored: string[] = [];
  try {
    if (uploadError) throw new AppError(uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'INVALID_ARCHIVE');
    const expectedVersion = z.coerce.number().int().min(0).parse((req.body as Record<string, unknown>)?.expectedVersion);
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw new AppError(400, 'FILE_REQUIRED');
    const { course, chapters } = await loadOutline(req);
    let entries;
    try { entries = readZip(file.buffer, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 300 * 1024 * 1024 }); } catch (cause) { throw new AppError(422, cause instanceof ZipError ? `ARCHIVE_${cause.code}` : 'ARCHIVE_INVALID'); }
    const byPath = new Map(entries.map(entry => [entry.path, entry.data]));
    let manifest: { format?: string; version?: number; files?: Array<{ path: string; size: number; sha256: string }> };
    try { manifest = JSON.parse(byPath.get('manifest.json')?.toString('utf8') || ''); } catch { throw new AppError(422, 'ARCHIVE_MANIFEST_INVALID'); }
    if (manifest.format !== 'edumarket-course-archive' || manifest.version !== 2 || !Array.isArray(manifest.files)) throw new AppError(422, 'ARCHIVE_MANIFEST_INVALID');
    const listed = new Set(manifest.files.map(entry => entry.path));
    if ([...byPath.keys()].some(entryPath => entryPath !== 'manifest.json' && !listed.has(entryPath))) throw new AppError(422, 'ARCHIVE_INTEGRITY_FAILED');
    for (const entry of manifest.files) {
      const data = byPath.get(entry.path);
      if (!data || data.length !== entry.size || sha256(data) !== entry.sha256) throw new AppError(422, 'ARCHIVE_INTEGRITY_FAILED');
    }
    let pkg;
    try { pkg = packageSchema.extend({ assets: z.array(z.object({ id: z.string().max(100), kind: z.enum(COURSE_ASSET_KINDS), name: z.string().max(180), mimeType: z.enum(COURSE_ASSET_MIME_TYPES), path: z.string().max(300).nullable() }).passthrough()).max(2000).default([]) }).parse(JSON.parse(byPath.get('course.json')!.toString('utf8'))); }
    catch { throw new AppError(422, 'ARCHIVE_PACKAGE_INVALID'); }
    if (chapters.length + pkg.chapters.length > MAX_CONTAINERS) throw new AppError(409, 'COURSE_STRUCTURE_LIMIT');
    const assetMap = new Map<string, string>();
    const skipped: Array<{ id: string; title: string; reason: string }> = [];
    const directory = privateStorage.uploadDirectory('course-assets');
    await mkdir(directory, { recursive: true });
    for (const asset of pkg.assets) {
      const data = asset.path ? byPath.get(asset.path) : undefined;
      const extension = EXTENSIONS[asset.mimeType];
      if (!data || !extension || !SIGNATURES[extension]?.(data) || ['video', 'resource'].includes(asset.kind)) { skipped.push({ id: asset.id, title: asset.name, reason: data ? 'FILE_TYPE_MISMATCH' : 'FILE_NOT_IN_PACKAGE' }); continue; }
      const storageKey = `${crypto.randomUUID()}.${extension}`;
      await writeFile(path.join(directory, storageKey), data, { flag: 'wx' });
      stored.push(storageKey);
      const created = await CourseAsset.create({ courseId: course._id, kind: asset.kind, originalName: asset.name.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `file.${extension}`, storageKey, mimeType: asset.mimeType, size: data.length, uploadedBy: req.auth!.userId });
      assetMap.set(asset.id, String(created._id));
    }
    const { imported, skipped: blockSkips } = importedChapters(pkg, assetMap);
    const data = await commitOutline(course._id, expectedVersion, [...chapters, ...imported]);
    stored.length = 0;
    res.json({ success: true, data: { ...data, report: { copiedContainers: imported.length, copiedItems: imported.reduce((count, chapter) => count + chapter.lessons.length, 0), copiedAssets: assetMap.size, skipped: [...skipped, ...blockSkips] } } });
  } catch (error) {
    // Nothing half-imported: files written for a failed import are removed with their records.
    if (stored.length) await Promise.all(stored.map(async key => { await CourseAsset.deleteMany({ storageKey: key }); await privateStorage.remove('course-assets', key).catch(() => undefined); }));
    next(error);
  }
}));
