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
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { Course } from './model.js';
import { COURSE_ASSET_KEY, CourseAsset } from './assets.model.js';
import { canManageCourse } from './service.js';
import { studentCanAccessAsset } from './structure.js';
import { Assignment } from '../assignments/models.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { removeCloudFile, streamCloudFile, uploadToOwnerDrive } from '../storage/service.js';

export const courseAssetRoutes = Router();
const storageRoot = privateStorage.uploadDirectory('course-assets');
const courseIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const lessonIdSchema = z.string().trim().min(1).max(100);
const assetIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const assetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

type UploadKind = 'video' | 'resource' | 'image' | 'block_video' | 'block_file' | 'caption';
type Extension = 'mp4' | 'webm' | 'pdf' | 'zip' | 'png' | 'jpg' | 'webp' | 'gif' | 'vtt';
const MB = 1024 * 1024;
/** Accepted declared types and size per kind; the content signature is checked again after upload. */
const uploadRules: Record<UploadKind, { types: string[]; maxSize: number }> = {
  video: { types: ['video/mp4', 'video/webm'], maxSize: 250 * MB },
  block_video: { types: ['video/mp4', 'video/webm'], maxSize: 250 * MB },
  resource: { types: ['application/pdf', 'application/zip', 'application/x-zip-compressed'], maxSize: 25 * MB },
  block_file: { types: ['application/pdf', 'application/zip', 'application/x-zip-compressed'], maxSize: 25 * MB },
  image: { types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSize: 5 * MB },
  // Browsers often send .vtt files without a type; the WEBVTT header is what is trusted.
  caption: { types: ['text/vtt', 'application/octet-stream', ''], maxSize: 1 * MB },
};

const makeUpload = (kind: UploadKind) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(storageRoot, { recursive: true }).then(() => callback(null, storageRoot), error => callback(error as Error, storageRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: uploadRules[kind].maxSize, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, callback) => {
    if (!uploadRules[kind].types.includes(file.mimetype)) return callback(new AppError(415, 'UNSUPPORTED_COURSE_ASSET_TYPE'));
    if (kind === 'caption' && !/\.vtt$/i.test(file.originalname)) return callback(new AppError(415, 'UNSUPPORTED_COURSE_ASSET_TYPE'));
    callback(null, true);
  },
}).single('file');

const receiveFile = (kind: UploadKind | ((req: AuthRequest) => UploadKind)) => (req: AuthRequest, res: any, next: (error?: unknown) => void) => {
  let resolved: UploadKind;
  try { resolved = typeof kind === 'function' ? kind(req) : kind; } catch (error) { return next(error); }
  makeUpload(resolved)(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'COURSE_ASSET_TOO_LARGE' : 'INVALID_COURSE_ASSET_UPLOAD'));
    next(error instanceof AppError ? error : new AppError(400, 'INVALID_COURSE_ASSET_UPLOAD'));
  });
};

const mediaKindSchema = z.enum(['image', 'block_video', 'block_file', 'caption']);
const mediaKindOf = (req: AuthRequest) => {
  const kind = mediaKindSchema.safeParse(req.query.kind);
  if (!kind.success) throw new AppError(400, 'INVALID_COURSE_ASSET_KIND');
  return kind.data;
};

export async function getManageableCourse(req: AuthRequest, rawCourseId: unknown) {
  const parsedId = courseIdSchema.safeParse(rawCourseId);
  if (!parsedId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
  const course = await Course.findById(parsedId.data).select('teacherId coOwnerIds chapters status');
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (req.auth!.role === 'teacher') {
    const teacher = await User.findById(req.auth!.userId).select('verified');
    if (!teacher?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
  }
  if (!await canManageCourse({ userId: req.auth!.userId, role: req.auth!.role }, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
  return course;
}

const sanitizeName = (name: string, extension: string) => path.basename(name).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `course-file.${extension}`;
const assetDto = (asset: any) => ({
  id: String(asset._id), name: asset.originalName, type: asset.mimeType, size: asset.size, kind: asset.kind,
  url: `/courses/${asset.courseId}/assets/${asset._id}`,
});

/** Detects the real file type from its first bytes; the declared MIME type alone is never trusted. */
function detectExtension(kind: UploadKind, mimeType: string, signature: Buffer): Extension | undefined {
  const ascii = (start: number, end: number) => signature.toString('ascii', start, end);
  const video = kind === 'video' || kind === 'block_video', file = kind === 'resource' || kind === 'block_file';
  if (video && mimeType === 'video/mp4' && signature.length >= 8 && ascii(4, 8) === 'ftyp') return 'mp4';
  if (video && mimeType === 'video/webm' && signature.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (file && mimeType === 'application/pdf' && ascii(0, 5) === '%PDF-') return 'pdf';
  if (file && ['application/zip', 'application/x-zip-compressed'].includes(mimeType) && signature.length >= 4 && signature[0] === 0x50 && signature[1] === 0x4b && [0x03, 0x05, 0x07].includes(signature[2]) && [0x04, 0x06, 0x08].includes(signature[3])) return 'zip';
  if (kind === 'image' && mimeType === 'image/png' && signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (kind === 'image' && mimeType === 'image/jpeg' && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) return 'jpg';
  if (kind === 'image' && mimeType === 'image/gif' && /^GIF8[79]a$/.test(ascii(0, 6))) return 'gif';
  if (kind === 'image' && mimeType === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (kind === 'caption') {
    const text = signature.toString('utf8').replace(/^﻿/, '');
    if (text.startsWith('WEBVTT')) return 'vtt';
  }
  return undefined;
}

async function uploadCourseAsset(req: AuthRequest, res: any, next: (error?: unknown) => void, kind: UploadKind) {
  let persisted = false;
  let storedKey: string | undefined;
  let cloudRef: Parameters<typeof removeCloudFile>[0] | undefined;
  try {
    if (!req.file) throw new AppError(400, 'COURSE_ASSET_REQUIRED');
    const course = await getManageableCourse(req, req.params.courseId);
    const legacy = kind === 'video' || kind === 'resource';
    let lessonId = '';
    if (legacy) {
      const parsed = lessonIdSchema.safeParse(req.params.lessonId);
      if (!parsed.success || !course.chapters.some(chapter => chapter.lessons.some(lesson => lesson.id === parsed.data))) throw new AppError(404, 'LESSON_NOT_FOUND');
      lessonId = parsed.data;
    }
    const previous = kind === 'video' ? await CourseAsset.findOne({ courseId: course._id, lessonId, kind }).lean() : null;
    if (kind === 'resource' && await CourseAsset.countDocuments({ courseId: course._id, lessonId, kind }) >= 25) throw new AppError(409, 'COURSE_RESOURCE_LIMIT_REACHED');
    if (!legacy && await CourseAsset.countDocuments({ courseId: course._id, lessonId: '' }) >= 2000) throw new AppError(409, 'COURSE_RESOURCE_LIMIT_REACHED');

    const signature = await privateStorage.readUploadPrefix(req.file.path, 16);
    const extension = detectExtension(kind, req.file.mimetype, signature);
    if (!extension) throw new AppError(415, 'INVALID_COURSE_ASSET_CONTENT');
    const mimeType = kind === 'caption' ? 'text/vtt' : req.file.mimetype;

    const originalName = sanitizeName(req.file.originalname, extension);
    // Storage target: `?storage=local`, a paired account id, or (default) the uploader's default drive when one is paired.
    // Images and captions stay local: they are small and embedded in pages.
    const target = kind === 'image' || kind === 'caption' ? 'local' : z.union([z.literal('local'), z.literal('default'), assetIdSchema]).default('default').parse(req.query.storage);
    const cloud = target === 'local' ? null : await uploadToOwnerDrive(req.auth!.userId, { name: originalName, mimeType, path: req.file.path, size: req.file.size }, target === 'default' ? undefined : target);
    if (cloud) cloudRef = cloud;
    let storageKey = '';
    if (!cloud) {
      storageKey = `${path.basename(req.file.filename, '.upload')}.${extension}`;
      storedKey = storageKey;
      await privateStorage.storeUpload('course-assets', storageKey, req.file.path);
    }
    const record = {
      courseId: course._id, lessonId, kind, originalName,
      storageKey: cloud ? undefined : storageKey, mimeType, size: req.file.size, uploadedBy: req.auth!.userId,
      storage: cloud ? { provider: cloud.provider, accountId: cloud.accountId, fileId: cloud.fileId } : { provider: 'local', accountId: null, fileId: '' },
    };
    const asset = kind === 'video'
      ? await CourseAsset.findOneAndUpdate({ courseId: course._id, lessonId, kind }, { $set: record }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true })
      : await CourseAsset.create(record);
    persisted = true;
    // Copied courses share file references: a replaced file is only removed when no other asset still points to it.
    if (previous?.storage?.provider && previous.storage.provider !== 'local' && previous.storage.fileId !== record.storage.fileId && !await CourseAsset.exists({ 'storage.fileId': previous.storage.fileId })) await removeCloudFile(previous.storage as any).catch(() => undefined);
    else if (previous?.storageKey && previous.storageKey !== storageKey && COURSE_ASSET_KEY.test(previous.storageKey) && !await CourseAsset.exists({ storageKey: previous.storageKey })) await privateStorage.remove('course-assets', previous.storageKey).catch(() => undefined);
    res.status(previous ? 200 : 201).json({ success: true, data: assetDto(asset) });
  } catch (error) { next(error); }
  finally {
    if (req.file && !persisted) {
      if (storedKey) await privateStorage.remove('course-assets', storedKey).catch(() => undefined);
      if (cloudRef) await removeCloudFile(cloudRef).catch(() => undefined);
    }
    // The temporary upload is always removed (after a cloud upload it was only a staging copy).
    if (req.file) await privateStorage.removeUpload(req.file.path).catch(() => undefined);
  }
}

courseAssetRoutes.post('/:courseId/lessons/:lessonId/assets/video', authenticate, allowRoles('teacher', 'institution', 'admin'), assetLimiter, receiveFile('video'), (req: AuthRequest, res, next) => uploadCourseAsset(req, res, next, 'video'));
courseAssetRoutes.post('/:courseId/lessons/:lessonId/assets/resources', authenticate, allowRoles('teacher', 'institution', 'admin'), assetLimiter, receiveFile('resource'), (req: AuthRequest, res, next) => uploadCourseAsset(req, res, next, 'resource'));
/** Media referenced by lesson blocks, module thumbnails and the course banner: `?kind=image|block_video|block_file|caption`. */
courseAssetRoutes.post('/:courseId/media', authenticate, allowRoles('teacher', 'institution', 'admin'), assetLimiter, receiveFile(mediaKindOf), (req: AuthRequest, res, next) => uploadCourseAsset(req, res, next, mediaKindOf(req)));

/** Course banner, public for catalogue cards of published courses; managers see it in any state. */
courseAssetRoutes.get('/:courseId/banner', async (req, res, next) => {
  try {
    const courseId = courseIdSchema.safeParse(req.params.courseId);
    if (!courseId.success) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    const course = await Course.findOne({ _id: courseId.data, status: 'published', visibility: 'public' }).select('banner').lean();
    const asset = course?.banner?.assetId ? await CourseAsset.findOne({ _id: course.banner.assetId, courseId: courseId.data, kind: 'image' }).lean() : null;
    if (!asset?.storageKey || !COURSE_ASSET_KEY.test(asset.storageKey)) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    privateStorage.send('course-assets', asset.storageKey, res, { mimeType: asset.mimeType, headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' } }, error => { if (error && !res.headersSent) next(new AppError(404, 'COURSE_ASSET_NOT_FOUND')); });
  } catch (error) { next(error); }
});

courseAssetRoutes.get('/:courseId/assets/:assetId', authenticate, allowRoles('student', 'teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const courseId = courseIdSchema.safeParse(req.params.courseId), assetId = assetIdSchema.safeParse(req.params.assetId);
    if (!courseId.success || !assetId.success) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    const [course, asset] = await Promise.all([
      Course.findById(courseId.data).select('teacherId coOwnerIds status accessState chapters banner').lean(),
      CourseAsset.findOne({ _id: assetId.data, courseId: courseId.data }).lean(),
    ]);
    if (!course || !asset) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    let allowed = req.auth!.role === 'admin' || String(course.teacherId) === req.auth!.userId;
    if (!allowed && req.auth!.role === 'teacher') {
      const teacher = await User.findById(req.auth!.userId).select('verified');
      if (!teacher?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    }
    if (!allowed && req.auth!.role !== 'student') allowed = await canManageCourse({ userId: req.auth!.userId, role: req.auth!.role }, course.teacherId, course.coOwnerIds);
    // Students: published and not private course, active enrollment, and the file must belong to content they can open now.
    if (!allowed && req.auth!.role === 'student' && course.status === 'published' && course.accessState !== 'private') {
      const enrollment = await Enrollment.findOne(activeAccess({ studentId: req.auth!.userId, courseId: courseId.data })).select('completedLessonIds').lean();
      allowed = !!enrollment && (studentCanAccessAsset(course as any, asset, { completedIds: enrollment.completedLessonIds })
        // Attachments of a published assignment of this course.
        || !!await Assignment.exists({ courseId: courseId.data, status: 'published', 'attachments.assetId': String(asset._id) }));
    }
    if (!allowed) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    const download = asset.kind === 'resource' || asset.kind === 'block_file';
    const headers = { 'Content-Type': asset.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' };
    if (asset.storage?.provider && asset.storage.provider !== 'local') {
      await streamCloudFile(asset.storage as any, req, res, headers, download ? asset.originalName : undefined);
      return;
    }
    if (!asset.storageKey || !COURSE_ASSET_KEY.test(asset.storageKey)) throw new AppError(404, 'COURSE_ASSET_NOT_FOUND');
    privateStorage.send('course-assets', asset.storageKey, res, { mimeType: asset.mimeType, ...(download ? { downloadName: asset.originalName } : {}), headers }, error => { if (error && !res.headersSent) next(new AppError(404, 'COURSE_ASSET_NOT_FOUND')); });
  } catch (error) { next(error); }
});
