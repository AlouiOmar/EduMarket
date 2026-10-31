import { Router } from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { buildXlsx } from '../../common/xlsx.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { AuditEvent } from '../admin/audit.model.js';
import { User } from '../auth/model.js';
import { sanitizeRichText } from '../courses/blocks.js';
import { Course } from '../courses/model.js';
import { canManageCourse } from '../courses/service.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { recordSourceGrade } from '../gradebook/service.js';
import { objectId, parseId } from '../lms/access.js';
import {
  AnnouncementDelivery, AttendanceRecord, AttendanceSession, CourseAnnouncement, CourseDiscussion, CourseDiscussionPost, CourseGroup, CourseGroupSet,
  CourseJournal, GroupFile, JournalEntry,
} from './models.js';
import { announcementRecipients, deliverAnnouncement, randomGroups } from './service.js';

/**
 * Participation API (`/participation/:courseId/...`). Every route resolves the caller's role in the course first:
 * managers (owner, co-authors, coordinators, owning institution, admin) or enrolled students with active access.
 * Students only ever read course-wide items, items of their own groups, and their own journal entries.
 */
export const participationRoutes = Router();
participationRoutes.use(authenticate);
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const date = z.union([z.null(), z.coerce.date()]).optional();

interface Member { course: any; manager: boolean; userId: string }
async function member(req: AuthRequest, options: { manager?: boolean; write?: boolean } = {}): Promise<Member> {
  const courseId = parseId(req.params.courseId, 'COURSE_NOT_FOUND');
  const course = await Course.findById(courseId).select('title teacherId coOwnerIds accessState status').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const actor = { userId: req.auth!.userId, role: req.auth!.role };
  if (req.auth!.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED');
  if (['teacher', 'institution', 'admin'].includes(actor.role)) {
    if (actor.role === 'teacher' && !await User.exists({ _id: actor.userId, verified: true })) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    if (await canManageCourse(actor, course.teacherId, course.coOwnerIds)) return { course, manager: true, userId: actor.userId };
    throw new AppError(404, 'COURSE_NOT_FOUND');
  }
  if (options.manager) throw new AppError(403, 'FORBIDDEN');
  if (actor.role !== 'student' || course.accessState === 'private' || !await Enrollment.exists(activeAccess({ courseId, studentId: actor.userId }))) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (options.write && course.accessState === 'completed') throw new AppError(409, 'COURSE_COMPLETED');
  return { course, manager: false, userId: actor.userId };
}
const audit = (req: AuthRequest, action: string, courseId: unknown) => AuditEvent.create({ action, actorId: req.auth!.userId, targetType: 'course', targetId: String(courseId), ipAddress: req.ip }).catch(() => undefined);
const myGroupIds = async (courseId: unknown, userId: string) => (await CourseGroup.find({ courseId, memberIds: userId }).select('_id').lean()).map(group => String(group._id));
const enrolledIds = async (courseId: unknown) => new Set((await Enrollment.find({ courseId }).distinct('studentId')).map(String));
const names = async (ids: unknown[]) => new Map((await User.find({ _id: { $in: ids } }).select('name').lean()).map(user => [String(user._id), user.name]));

// --- Groups -----------------------------------------------------------------------------------------------------------------

participationRoutes.get('/:courseId/groups', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const sets = await CourseGroupSet.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const groups = await CourseGroup.find({ courseId: course._id }).sort({ name: 1 }).lean();
    const people = await names(groups.flatMap(group => group.memberIds));
    const visible = manager ? groups : groups.filter(group => group.memberIds.some(id => String(id) === userId) || sets.find(set => String(set._id) === String(group.setId))?.mode === 'self');
    res.json({ success: true, data: {
      sets: sets.map(set => ({ id: String(set._id), name: set.name, mode: set.mode, maxMembers: set.maxMembers, selfSignupOpen: set.selfSignupOpen })),
      groups: visible.map(group => {
        const mine = group.memberIds.some(id => String(id) === userId);
        return {
          id: String(group._id), setId: String(group.setId), name: group.name, memberCount: group.memberIds.length, mine,
          // Students see the names of their own group's members only.
          members: manager || mine ? group.memberIds.map(id => ({ id: String(id), name: people.get(String(id)) || '' })) : [],
        };
      }),
      ...(manager ? { students: [...(await names([...await enrolledIds(course._id)])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) } : {}),
    } });
  } catch (error) { next(error); }
});

const setSchema = z.object({ name: z.string().trim().min(1).max(120), mode: z.enum(['manual', 'random', 'self']), maxMembers: z.number().int().min(1).max(200).default(5), groupCount: z.number().int().min(1).max(100).optional() }).strict();
participationRoutes.post('/:courseId/group-sets', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = setSchema.parse(req.body);
    const set = await CourseGroupSet.create({ courseId: course._id, name: input.name, mode: input.mode, maxMembers: input.maxMembers, selfSignupOpen: input.mode === 'self' });
    const students = [...await enrolledIds(course._id)];
    const buckets = input.mode === 'random' ? randomGroups(students, input.maxMembers) : Array.from({ length: input.groupCount ?? Math.max(1, Math.ceil(students.length / input.maxMembers)) }, () => [] as string[]);
    await CourseGroup.insertMany(buckets.map((memberIds, index) => ({ courseId: course._id, setId: set._id, name: `${input.name} ${index + 1}`, memberIds })));
    res.status(201).json({ success: true, data: { id: String(set._id), groups: buckets.length } });
  } catch (error) { next(error); }
});
participationRoutes.patch('/:courseId/group-sets/:setId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = z.object({ name: z.string().trim().min(1).max(120).optional(), selfSignupOpen: z.boolean().optional(), maxMembers: z.number().int().min(1).max(200).optional() }).strict().parse(req.body);
    const set = await CourseGroupSet.findOneAndUpdate({ _id: parseId(req.params.setId), courseId: course._id }, { $set: input }, { new: true }).lean();
    if (!set) throw new AppError(404, 'GROUP_SET_NOT_FOUND');
    res.json({ success: true, data: { id: String(set._id), name: set.name, selfSignupOpen: set.selfSignupOpen, maxMembers: set.maxMembers } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/group-sets/:setId/groups', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(req.body);
    const set = await CourseGroupSet.findOne({ _id: parseId(req.params.setId), courseId: course._id }).lean();
    if (!set) throw new AppError(404, 'GROUP_SET_NOT_FOUND');
    const group = await CourseGroup.create({ courseId: course._id, setId: set._id, name, memberIds: [] });
    res.status(201).json({ success: true, data: { id: String(group._id) } });
  } catch (error) { next(error); }
});
/** Manual membership: enrolled students only, at most one group per set. */
participationRoutes.put('/:courseId/groups/:groupId/members', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const { memberIds } = z.object({ memberIds: z.array(objectId).max(200) }).strict().parse(req.body);
    const group = await CourseGroup.findOne({ _id: parseId(req.params.groupId, 'GROUP_NOT_FOUND'), courseId: course._id }).lean();
    if (!group) throw new AppError(404, 'GROUP_NOT_FOUND');
    const enrolled = await enrolledIds(course._id);
    if (memberIds.some(id => !enrolled.has(id))) throw new AppError(422, 'STUDENT_NOT_IN_COURSE');
    if (await CourseGroup.exists({ setId: group.setId, _id: { $ne: group._id }, memberIds: { $in: memberIds } })) throw new AppError(409, 'ALREADY_IN_GROUP_SET');
    await CourseGroup.updateOne({ _id: group._id }, { $set: { memberIds: [...new Set(memberIds)] } });
    res.json({ success: true, data: { id: String(group._id), memberCount: new Set(memberIds).size } });
  } catch (error) { next(error); }
});
/** Self sign-up: atomic capacity check, one group per set. */
participationRoutes.post('/:courseId/groups/:groupId/join', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req, { write: true });
    if (manager) throw new AppError(403, 'FORBIDDEN');
    const group = await CourseGroup.findOne({ _id: parseId(req.params.groupId, 'GROUP_NOT_FOUND'), courseId: course._id }).lean();
    const set = group ? await CourseGroupSet.findById(group.setId).lean() : null;
    if (!group || !set || set.mode !== 'self') throw new AppError(404, 'GROUP_NOT_FOUND');
    if (!set.selfSignupOpen) throw new AppError(409, 'GROUP_SIGNUP_CLOSED');
    if (await CourseGroup.exists({ setId: set._id, memberIds: userId })) throw new AppError(409, 'ALREADY_IN_GROUP_SET');
    const joined = await CourseGroup.updateOne({ _id: group._id, memberIds: { $ne: userId }, $expr: { $lt: [{ $size: '$memberIds' }, set.maxMembers] } }, { $push: { memberIds: userId } });
    if (!joined.modifiedCount) throw new AppError(409, 'GROUP_FULL');
    res.json({ success: true, data: { id: String(group._id) } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/groups/:groupId/leave', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { write: true });
    const group = await CourseGroup.findOne({ _id: parseId(req.params.groupId, 'GROUP_NOT_FOUND'), courseId: course._id, memberIds: userId }).lean();
    const set = group ? await CourseGroupSet.findById(group.setId).lean() : null;
    if (!group || set?.mode !== 'self' || !set.selfSignupOpen) throw new AppError(409, 'GROUP_SIGNUP_CLOSED');
    await CourseGroup.updateOne({ _id: group._id }, { $pull: { memberIds: userId } });
    res.json({ success: true, data: { id: String(group._id) } });
  } catch (error) { next(error); }
});

// Group files: shared by the members of one group (and visible to managers), stored privately, type checked by signature.
const groupUploadRoot = privateStorage.uploadDirectory('group-files');
const groupUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(groupUploadRoot, { recursive: true }).then(() => callback(null, groupUploadRoot), error => callback(error as Error, groupUploadRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single('file');
function detectGroupFile(bytes: Buffer): { extension: 'pdf' | 'zip' | 'docx' | 'png' | 'jpg'; mime: string } | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return { extension: 'pdf', mime: 'application/pdf' };
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: 'png', mime: 'image/png' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return bytes.includes(Buffer.from('word/document.xml')) ? { extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } : { extension: 'zip', mime: 'application/zip' };
  }
  return null;
}
async function groupAccess(req: AuthRequest) {
  const context = await member(req);
  const group = await CourseGroup.findOne({ _id: parseId(req.params.groupId, 'GROUP_NOT_FOUND'), courseId: context.course._id }).lean();
  if (!group || (!context.manager && !group.memberIds.some(id => String(id) === context.userId))) throw new AppError(404, 'GROUP_NOT_FOUND');
  return { ...context, group };
}
participationRoutes.get('/:courseId/groups/:groupId/files', async (req: AuthRequest, res, next) => {
  try {
    const { group } = await groupAccess(req);
    const files = await GroupFile.find({ groupId: group._id }).sort({ createdAt: -1 }).populate('uploaderId', 'name').lean();
    res.json({ success: true, data: files.map(file => ({ id: String(file._id), name: file.originalName, size: file.size, type: file.mimeType, uploadedBy: (file.uploaderId as any)?.name || '', uploaderId: String((file.uploaderId as any)?._id || file.uploaderId), createdAt: (file as any).createdAt, url: `/participation/${req.params.courseId}/groups/${group._id}/files/${file._id}` })) });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/groups/:groupId/files', writeLimiter, (req: AuthRequest, res, next) => groupUpload(req, res, async error => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  let stored = '';
  try {
    if (error) throw error instanceof multer.MulterError ? new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD') : error;
    const { group, userId, course } = await groupAccess(req);
    if (course.accessState === 'completed') throw new AppError(409, 'COURSE_COMPLETED');
    if (!file) throw new AppError(400, 'FILE_REQUIRED');
    const kind = detectGroupFile(await privateStorage.readUpload(file.path));
    if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE');
    stored = `${path.basename(file.filename, '.upload')}.${kind.extension}`;
    await privateStorage.storeUpload('group-files', stored, file.path);
    const created = await GroupFile.create({ courseId: course._id, groupId: group._id, uploaderId: userId, originalName: path.basename(file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `file.${kind.extension}`, storageKey: stored, mimeType: kind.mime, size: file.size });
    stored = '';
    res.status(201).json({ success: true, data: { id: String(created._id), name: created.originalName, size: created.size } });
  } catch (cause) {
    next(cause);
  } finally {
    if (file) await privateStorage.removeUpload(file.path).catch(() => undefined);
    if (stored) await privateStorage.remove('group-files', stored).catch(() => undefined);
  }
}));
participationRoutes.get('/:courseId/groups/:groupId/files/:fileId', async (req: AuthRequest, res, next) => {
  try {
    const { group } = await groupAccess(req);
    const file = await GroupFile.findOne({ _id: parseId(req.params.fileId), groupId: group._id }).lean();
    if (!file || !/^[a-f0-9-]{36}\.(pdf|zip|docx|png|jpg)$/.test(file.storageKey)) throw new AppError(404, 'NOT_FOUND');
    privateStorage.send('group-files', file.storageKey, res, { mimeType: file.mimeType, downloadName: file.originalName, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }, sendError => { if (sendError && !res.headersSent) next(new AppError(404, 'NOT_FOUND')); });
  } catch (error) { next(error); }
});
participationRoutes.delete('/:courseId/groups/:groupId/files/:fileId', async (req: AuthRequest, res, next) => {
  try {
    const { group, manager, userId } = await groupAccess(req);
    const file = await GroupFile.findOne({ _id: parseId(req.params.fileId), groupId: group._id }).lean();
    if (!file) throw new AppError(404, 'NOT_FOUND');
    if (!manager && String(file.uploaderId) !== userId) throw new AppError(403, 'FORBIDDEN');
    await GroupFile.deleteOne({ _id: file._id });
    await privateStorage.remove('group-files', file.storageKey).catch(() => undefined);
    res.json({ success: true, data: { id: String(file._id) } });
  } catch (error) { next(error); }
});

// --- Discussions ------------------------------------------------------------------------------------------------------------

const discussionSchema = z.object({ title: z.string().trim().min(1).max(200), prompt: z.string().max(20000).default(''), groupId: z.union([z.null(), objectId]).default(null), graded: z.boolean().default(false), points: z.number().int().min(1).max(1000).default(10), dueAt: date }).strict();
const discussionDto = (discussion: any, extra: Record<string, unknown> = {}) => ({ id: String(discussion._id), title: discussion.title, prompt: discussion.prompt, groupId: discussion.groupId ? String(discussion.groupId) : null, status: discussion.status, pinned: discussion.pinned, graded: discussion.graded, points: discussion.points, dueAt: discussion.dueAt, createdAt: discussion.createdAt, ...extra });
async function discussionAccess(req: AuthRequest, options: { write?: boolean } = {}) {
  const context = await member(req, options);
  const discussion = await CourseDiscussion.findOne({ _id: parseId(req.params.discussionId, 'DISCUSSION_NOT_FOUND'), courseId: context.course._id }).lean();
  if (!discussion) throw new AppError(404, 'DISCUSSION_NOT_FOUND');
  if (!context.manager && discussion.groupId && !(await myGroupIds(context.course._id, context.userId)).includes(String(discussion.groupId))) throw new AppError(404, 'DISCUSSION_NOT_FOUND');
  return { ...context, discussion };
}

participationRoutes.get('/:courseId/discussions', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const groups = manager ? [] : await myGroupIds(course._id, userId);
    const discussions = await CourseDiscussion.find({ courseId: course._id, ...(manager ? {} : { $or: [{ groupId: null }, { groupId: { $in: groups } }] }) }).sort({ pinned: -1, createdAt: -1 }).lean();
    const counts = await CourseDiscussionPost.aggregate<{ _id: unknown; count: number }>([{ $match: { courseId: course._id, ...(manager ? {} : { status: 'visible' }) } }, { $group: { _id: '$discussionId', count: { $sum: 1 } } }]);
    res.json({ success: true, data: discussions.map(discussion => discussionDto(discussion, { posts: counts.find(row => String(row._id) === String(discussion._id))?.count || 0 })) });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/discussions', async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { manager: true });
    const input = discussionSchema.parse(req.body);
    if (input.groupId && !await CourseGroup.exists({ _id: input.groupId, courseId: course._id })) throw new AppError(422, 'GROUP_NOT_FOUND');
    const discussion = await CourseDiscussion.create({ ...input, prompt: sanitizeRichText(input.prompt), courseId: course._id, createdBy: userId });
    res.status(201).json({ success: true, data: discussionDto(discussion) });
  } catch (error) { next(error); }
});
participationRoutes.patch('/:courseId/discussions/:discussionId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = z.object({ title: z.string().trim().min(1).max(200).optional(), prompt: z.string().max(20000).optional(), status: z.enum(['open', 'closed']).optional(), pinned: z.boolean().optional(), graded: z.boolean().optional(), points: z.number().int().min(1).max(1000).optional(), dueAt: date }).strict().parse(req.body);
    const discussion = await CourseDiscussion.findOneAndUpdate({ _id: parseId(req.params.discussionId, 'DISCUSSION_NOT_FOUND'), courseId: course._id }, { $set: { ...input, ...(input.prompt !== undefined ? { prompt: sanitizeRichText(input.prompt) } : {}) } }, { new: true }).lean();
    if (!discussion) throw new AppError(404, 'DISCUSSION_NOT_FOUND');
    res.json({ success: true, data: discussionDto(discussion) });
  } catch (error) { next(error); }
});
participationRoutes.get('/:courseId/discussions/:discussionId/posts', async (req: AuthRequest, res, next) => {
  try {
    const { discussion, manager } = await discussionAccess(req);
    const posts = await CourseDiscussionPost.find({ discussionId: discussion._id, ...(manager ? {} : { status: 'visible' }) }).sort({ pinned: -1, createdAt: 1 }).populate('authorId', 'name role').lean();
    res.json({ success: true, data: { discussion: discussionDto(discussion), posts: posts.map(post => ({
      id: String(post._id), parentId: post.parentId ? String(post.parentId) : null, body: post.body, pinned: post.pinned, editedAt: post.editedAt, createdAt: (post as any).createdAt,
      authorId: String((post.authorId as any)?._id || post.authorId), authorName: (post.authorId as any)?.name || '', authorRole: (post.authorId as any)?.role || '',
      ...(manager ? { status: post.status, moderationNote: post.moderationNote } : {}),
    })) } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/discussions/:discussionId/posts', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { discussion, manager, userId, course } = await discussionAccess(req, { write: true });
    if (discussion.status === 'closed' && !manager) throw new AppError(409, 'DISCUSSION_CLOSED');
    const { body, parentId } = z.object({ body: z.string().trim().min(1).max(20000), parentId: z.union([z.null(), objectId]).default(null) }).strict().parse(req.body);
    if (parentId && !await CourseDiscussionPost.exists({ _id: parentId, discussionId: discussion._id, status: 'visible' })) throw new AppError(422, 'POST_NOT_FOUND');
    const clean = sanitizeRichText(body);
    if (!clean.replace(/<[^>]*>/g, '').trim()) throw new AppError(400, 'POST_EMPTY');
    const post = await CourseDiscussionPost.create({ discussionId: discussion._id, courseId: course._id, authorId: userId, parentId, body: clean });
    res.status(201).json({ success: true, data: { id: String(post._id) } });
  } catch (error) { next(error); }
});
/** Authors edit their own post; managers moderate (hide with a note, pin). */
participationRoutes.patch('/:courseId/discussions/:discussionId/posts/:postId', async (req: AuthRequest, res, next) => {
  try {
    const { discussion, manager, userId } = await discussionAccess(req, { write: true });
    const input = z.object({ body: z.string().trim().min(1).max(20000).optional(), status: z.enum(['visible', 'hidden']).optional(), moderationNote: z.string().trim().max(500).optional(), pinned: z.boolean().optional() }).strict().parse(req.body);
    const post = await CourseDiscussionPost.findOne({ _id: parseId(req.params.postId, 'POST_NOT_FOUND'), discussionId: discussion._id }).lean();
    if (!post) throw new AppError(404, 'POST_NOT_FOUND');
    const own = String(post.authorId) === userId;
    if ((input.status !== undefined || input.pinned !== undefined || input.moderationNote !== undefined) && !manager) throw new AppError(403, 'FORBIDDEN');
    if (input.body !== undefined && !own) throw new AppError(403, 'FORBIDDEN');
    if (!manager && post.status === 'hidden') throw new AppError(404, 'POST_NOT_FOUND');
    const set: Record<string, unknown> = { ...input };
    if (input.body !== undefined) { set.body = sanitizeRichText(input.body); set.editedAt = new Date(); }
    await CourseDiscussionPost.updateOne({ _id: post._id }, { $set: set });
    if (input.status) await audit(req, `participation.post.${input.status}`, discussion.courseId);
    res.json({ success: true, data: { id: String(post._id) } });
  } catch (error) { next(error); }
});
/** Participation summary and grading of a graded discussion (grades go to the gradebook, unpublished). */
participationRoutes.get('/:courseId/discussions/:discussionId/participants', async (req: AuthRequest, res, next) => {
  try {
    const { discussion, manager } = await discussionAccess(req);
    if (!manager) throw new AppError(403, 'FORBIDDEN');
    const rows = await CourseDiscussionPost.aggregate<{ _id: unknown; posts: number; replies: number; last: Date }>([{ $match: { discussionId: discussion._id } }, { $group: { _id: '$authorId', posts: { $sum: { $cond: [{ $eq: ['$parentId', null] }, 1, 0] } }, replies: { $sum: { $cond: [{ $ne: ['$parentId', null] }, 1, 0] } }, last: { $max: '$createdAt' } } }]);
    const people = await names(rows.map(row => row._id));
    res.json({ success: true, data: rows.map(row => ({ studentId: String(row._id), name: people.get(String(row._id)) || '', posts: row.posts, replies: row.replies, lastPostAt: row.last })) });
  } catch (error) { next(error); }
});
const gradeSchema = z.object({ studentId: objectId, score: z.number().min(0), feedback: z.string().trim().max(4000).default('') }).strict();
participationRoutes.post('/:courseId/discussions/:discussionId/grades', async (req: AuthRequest, res, next) => {
  try {
    const { discussion, manager, course, userId } = await discussionAccess(req);
    if (!manager) throw new AppError(403, 'FORBIDDEN');
    if (!discussion.graded) throw new AppError(409, 'NOT_GRADED');
    const input = gradeSchema.parse(req.body);
    if (input.score > discussion.points) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
    if (!(await enrolledIds(course._id)).has(input.studentId)) throw new AppError(422, 'STUDENT_NOT_IN_COURSE');
    await recordSourceGrade({ courseId: course._id, kind: 'discussion', refId: String(discussion._id), studentId: input.studentId, score: input.score, feedback: input.feedback, status: 'graded', title: `Discussion : ${discussion.title}`, maxPoints: discussion.points, dueAt: discussion.dueAt, graderId: userId });
    res.json({ success: true, data: { studentId: input.studentId, score: input.score } });
  } catch (error) { next(error); }
});

// --- Journals (private) -----------------------------------------------------------------------------------------------------

const journalDto = (journal: any, extra: Record<string, unknown> = {}) => ({ id: String(journal._id), title: journal.title, instructions: journal.instructions, status: journal.status, graded: journal.graded, points: journal.points, createdAt: journal.createdAt, ...extra });
participationRoutes.get('/:courseId/journals', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const journals = await CourseJournal.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const counts = await JournalEntry.aggregate<{ _id: unknown; count: number; authors: unknown[] }>([{ $match: { courseId: course._id, ...(manager ? {} : { authorId: (await User.findById(userId).select('_id').lean())!._id }) } }, { $group: { _id: '$journalId', count: { $sum: 1 }, authors: { $addToSet: '$authorId' } } }]);
    res.json({ success: true, data: journals.map(journal => {
      const row = counts.find(candidate => String(candidate._id) === String(journal._id));
      return journalDto(journal, manager ? { entries: row?.count || 0, authors: row?.authors.length || 0 } : { myEntries: row?.count || 0 });
    }) });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/journals', async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { manager: true });
    const input = z.object({ title: z.string().trim().min(1).max(200), instructions: z.string().max(20000).default(''), graded: z.boolean().default(false), points: z.number().int().min(1).max(1000).default(10) }).strict().parse(req.body);
    const journal = await CourseJournal.create({ ...input, instructions: sanitizeRichText(input.instructions), courseId: course._id, createdBy: userId });
    res.status(201).json({ success: true, data: journalDto(journal) });
  } catch (error) { next(error); }
});
participationRoutes.patch('/:courseId/journals/:journalId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = z.object({ title: z.string().trim().min(1).max(200).optional(), instructions: z.string().max(20000).optional(), status: z.enum(['open', 'closed']).optional(), graded: z.boolean().optional(), points: z.number().int().min(1).max(1000).optional() }).strict().parse(req.body);
    const journal = await CourseJournal.findOneAndUpdate({ _id: parseId(req.params.journalId, 'JOURNAL_NOT_FOUND'), courseId: course._id }, { $set: { ...input, ...(input.instructions !== undefined ? { instructions: sanitizeRichText(input.instructions) } : {}) } }, { new: true }).lean();
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND');
    res.json({ success: true, data: journalDto(journal) });
  } catch (error) { next(error); }
});
/** Entries: a student only ever receives their own; managers may filter by student. */
participationRoutes.get('/:courseId/journals/:journalId/entries', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const journal = await CourseJournal.findOne({ _id: parseId(req.params.journalId, 'JOURNAL_NOT_FOUND'), courseId: course._id }).lean();
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND');
    const studentFilter = manager ? (typeof req.query.studentId === 'string' ? { authorId: parseId(req.query.studentId) } : {}) : { authorId: userId };
    const entries = await JournalEntry.find({ journalId: journal._id, ...studentFilter }).sort({ createdAt: 1 }).populate('authorId', 'name').lean();
    const commenters = await names(entries.flatMap(entry => entry.comments.map(comment => comment.authorId)));
    res.json({ success: true, data: { journal: journalDto(journal), entries: entries.map(entry => ({
      id: String(entry._id), authorId: String((entry.authorId as any)?._id || entry.authorId), authorName: (entry.authorId as any)?.name || '', body: entry.body, createdAt: (entry as any).createdAt,
      comments: entry.comments.map(comment => ({ authorName: commenters.get(String(comment.authorId)) || '', body: comment.body, createdAt: comment.createdAt })),
    })) } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/journals/:journalId/entries', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req, { write: true });
    if (manager) throw new AppError(403, 'FORBIDDEN');
    const journal = await CourseJournal.findOne({ _id: parseId(req.params.journalId, 'JOURNAL_NOT_FOUND'), courseId: course._id }).lean();
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND');
    if (journal.status === 'closed') throw new AppError(409, 'JOURNAL_CLOSED');
    const { body } = z.object({ body: z.string().trim().min(1).max(20000) }).strict().parse(req.body);
    const entry = await JournalEntry.create({ journalId: journal._id, courseId: course._id, authorId: userId, body: sanitizeRichText(body) });
    res.status(201).json({ success: true, data: { id: String(entry._id) } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/journal-entries/:entryId/comments', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req, { write: true });
    const entry = await JournalEntry.findOne({ _id: parseId(req.params.entryId, 'ENTRY_NOT_FOUND'), courseId: course._id }).lean();
    if (!entry || (!manager && String(entry.authorId) !== userId)) throw new AppError(404, 'ENTRY_NOT_FOUND');
    const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    await JournalEntry.updateOne({ _id: entry._id }, { $push: { comments: { authorId: userId, body, createdAt: new Date() } } });
    res.status(201).json({ success: true, data: { id: String(entry._id) } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/journals/:journalId/grades', async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { manager: true });
    const journal = await CourseJournal.findOne({ _id: parseId(req.params.journalId, 'JOURNAL_NOT_FOUND'), courseId: course._id }).lean();
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND');
    if (!journal.graded) throw new AppError(409, 'NOT_GRADED');
    const input = gradeSchema.parse(req.body);
    if (input.score > journal.points) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
    if (!(await enrolledIds(course._id)).has(input.studentId)) throw new AppError(422, 'STUDENT_NOT_IN_COURSE');
    await recordSourceGrade({ courseId: course._id, kind: 'journal', refId: String(journal._id), studentId: input.studentId, score: input.score, feedback: input.feedback, status: 'graded', title: `Journal : ${journal.title}`, maxPoints: journal.points, graderId: userId });
    res.json({ success: true, data: { studentId: input.studentId, score: input.score } });
  } catch (error) { next(error); }
});

// --- Announcements ----------------------------------------------------------------------------------------------------------

const announcementDto = (announcement: any, manager: boolean) => ({
  id: String(announcement._id), title: announcement.title, body: announcement.body, publishAt: announcement.publishAt, sentAt: announcement.sentAt, createdAt: announcement.createdAt,
  ...(manager ? { status: announcement.status, groupIds: announcement.groupIds.map(String), sendEmail: announcement.sendEmail, stats: announcement.stats } : {}),
});
participationRoutes.get('/:courseId/announcements', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const filter: Record<string, unknown> = { courseId: course._id };
    if (!manager) { filter.status = 'sent'; filter.$or = [{ groupIds: { $size: 0 } }, { groupIds: { $in: await myGroupIds(course._id, userId) } }]; }
    const announcements = await CourseAnnouncement.find(filter).sort({ sentAt: -1, publishAt: -1, createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: announcements.map(announcement => announcementDto(announcement, manager)) });
  } catch (error) { next(error); }
});
const announcementSchema = z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20000), groupIds: z.array(objectId).max(100).default([]), sendEmail: z.boolean().default(false), publishAt: date, draft: z.boolean().default(false) }).strict();
participationRoutes.post('/:courseId/announcements', async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { manager: true });
    const input = announcementSchema.parse(req.body);
    if (input.groupIds.length && await CourseGroup.countDocuments({ courseId: course._id, _id: { $in: input.groupIds } }) !== new Set(input.groupIds).size) throw new AppError(422, 'GROUP_NOT_FOUND');
    const { draft, ...values } = input;
    const announcement = await CourseAnnouncement.create({ ...values, body: sanitizeRichText(values.body), publishAt: values.publishAt ?? null, courseId: course._id, createdBy: userId, status: draft ? 'draft' : 'scheduled' });
    await audit(req, 'participation.announcement.created', course._id);
    const immediate = !draft && (!announcement.publishAt || announcement.publishAt <= new Date());
    const result = immediate ? await deliverAnnouncement(announcement._id) : announcement.toObject();
    res.status(201).json({ success: true, data: announcementDto(result ?? announcement.toObject(), true) });
  } catch (error) { next(error); }
});
participationRoutes.patch('/:courseId/announcements/:announcementId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = announcementSchema.partial().strict().parse(req.body);
    const { draft, ...values } = input;
    const set: Record<string, unknown> = { ...values, ...(values.body ? { body: sanitizeRichText(values.body) } : {}), ...(draft !== undefined ? { status: draft ? 'draft' : 'scheduled' } : {}) };
    // Sent announcements are history: they cannot be edited (a correction is a new announcement).
    const announcement = await CourseAnnouncement.findOneAndUpdate({ _id: parseId(req.params.announcementId, 'ANNOUNCEMENT_NOT_FOUND'), courseId: course._id, status: { $in: ['draft', 'scheduled'] } }, { $set: set }, { new: true }).lean();
    if (!announcement) throw new AppError(409, 'ANNOUNCEMENT_LOCKED');
    const due = announcement.status === 'scheduled' && (!announcement.publishAt || announcement.publishAt <= new Date());
    res.json({ success: true, data: announcementDto(due ? (await deliverAnnouncement(announcement._id)) ?? announcement : announcement, true) });
  } catch (error) { next(error); }
});
participationRoutes.delete('/:courseId/announcements/:announcementId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const deleted = await CourseAnnouncement.deleteOne({ _id: parseId(req.params.announcementId, 'ANNOUNCEMENT_NOT_FOUND'), courseId: course._id, status: { $in: ['draft', 'scheduled'] } });
    if (!deleted.deletedCount) throw new AppError(409, 'ANNOUNCEMENT_LOCKED');
    res.json({ success: true, data: { id: req.params.announcementId } });
  } catch (error) { next(error); }
});
participationRoutes.get('/:courseId/announcements/:announcementId/deliveries', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const announcement = await CourseAnnouncement.findOne({ _id: parseId(req.params.announcementId, 'ANNOUNCEMENT_NOT_FOUND'), courseId: course._id }).lean();
    if (!announcement) throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND');
    const deliveries = await AnnouncementDelivery.find({ announcementId: announcement._id }).populate('userId', 'name').lean();
    res.json({ success: true, data: { recipients: (await announcementRecipients(course._id, announcement.groupIds)).length, deliveries: deliveries.map(row => ({ name: (row.userId as any)?.name || '', channel: row.channel, status: row.status, error: row.error, attempts: row.attempts })) } });
  } catch (error) { next(error); }
});

// --- Attendance -------------------------------------------------------------------------------------------------------------

async function attendanceBook(courseId: unknown) {
  const [sessions, records, enrollments] = await Promise.all([
    AttendanceSession.find({ courseId }).sort({ date: 1 }).lean(),
    AttendanceRecord.find({ courseId }).lean(),
    Enrollment.find({ courseId }).populate('studentId', 'name email').lean(),
  ]);
  const students = enrollments.filter(row => row.studentId).map(row => ({ id: String((row.studentId as any)._id), name: (row.studentId as any).name, email: (row.studentId as any).email })).sort((a, b) => a.name.localeCompare(b.name));
  return { sessions, records, students };
}
participationRoutes.get('/:courseId/attendance', async (req: AuthRequest, res, next) => {
  try {
    const { course, manager, userId } = await member(req);
    const { sessions, records, students } = await attendanceBook(course._id);
    const visibleRecords = manager ? records : records.filter(record => String(record.studentId) === userId);
    const stats = (studentId: string) => {
      const own = records.filter(record => String(record.studentId) === studentId);
      return { present: own.filter(record => record.status === 'present').length, late: own.filter(record => record.status === 'late').length, absent: own.filter(record => record.status === 'absent').length, excused: own.filter(record => record.status === 'excused').length };
    };
    res.json({ success: true, data: {
      sessions: sessions.map(session => ({ id: String(session._id), title: session.title, date: session.date, syllabusEntryId: session.syllabusEntryId })),
      records: visibleRecords.map(record => ({ sessionId: String(record.sessionId), studentId: String(record.studentId), status: record.status, note: record.note })),
      ...(manager ? { students: students.map(student => ({ ...student, stats: stats(student.id) })) } : { stats: stats(userId) }),
    } });
  } catch (error) { next(error); }
});
participationRoutes.post('/:courseId/attendance/sessions', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const input = z.object({ title: z.string().trim().min(1).max(200), date: z.coerce.date(), syllabusEntryId: z.string().max(100).default('') }).strict().parse(req.body);
    const session = await AttendanceSession.create({ ...input, courseId: course._id });
    res.status(201).json({ success: true, data: { id: String(session._id) } });
  } catch (error) { next(error); }
});
participationRoutes.put('/:courseId/attendance/sessions/:sessionId/records', async (req: AuthRequest, res, next) => {
  try {
    const { course, userId } = await member(req, { manager: true });
    const { records } = z.object({ records: z.array(z.object({ studentId: objectId, status: z.enum(['present', 'absent', 'late', 'excused']), note: z.string().trim().max(300).default('') }).strict()).max(500) }).strict().parse(req.body);
    const session = await AttendanceSession.findOne({ _id: parseId(req.params.sessionId, 'SESSION_NOT_FOUND'), courseId: course._id }).lean();
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND');
    const enrolled = await enrolledIds(course._id);
    if (records.some(record => !enrolled.has(record.studentId))) throw new AppError(422, 'STUDENT_NOT_IN_COURSE');
    if (records.length) await AttendanceRecord.bulkWrite(records.map(record => ({ updateOne: { filter: { sessionId: session._id, studentId: record.studentId }, update: { $set: { courseId: course._id, status: record.status, note: record.note, recordedBy: new mongoose.Types.ObjectId(userId) } }, upsert: true } })));
    res.json({ success: true, data: { saved: records.length } });
  } catch (error) { next(error); }
});
participationRoutes.delete('/:courseId/attendance/sessions/:sessionId', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const session = await AttendanceSession.findOneAndDelete({ _id: parseId(req.params.sessionId, 'SESSION_NOT_FOUND'), courseId: course._id }).lean();
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND');
    await AttendanceRecord.deleteMany({ sessionId: session._id });
    res.json({ success: true, data: { id: String(session._id) } });
  } catch (error) { next(error); }
});
participationRoutes.get('/:courseId/attendance/export', async (req: AuthRequest, res, next) => {
  try {
    const { course } = await member(req, { manager: true });
    const format = z.enum(['csv', 'xlsx']).default('csv').parse(req.query.format);
    const { sessions, records, students } = await attendanceBook(course._id);
    const header = ['Student', 'Email', ...sessions.map(session => `${session.title} (${session.date.toISOString().slice(0, 10)})`), 'Present', 'Late', 'Absent', 'Excused'];
    const rows = students.map(student => {
      const own = records.filter(record => String(record.studentId) === student.id);
      const statusOf = (sessionId: unknown) => own.find(record => String(record.sessionId) === String(sessionId))?.status ?? '';
      return [student.name, student.email, ...sessions.map(session => statusOf(session._id)), ...(['present', 'late', 'absent', 'excused'] as const).map(status => own.filter(record => record.status === status).length)];
    });
    res.set({ 'Content-Disposition': `attachment; filename="attendance-${course._id}.${format}"`, 'Cache-Control': 'private, no-store' });
    if (format === 'xlsx') res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buildXlsx('Attendance', [header, ...rows]));
    else {
      const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
      res.type('text/csv; charset=utf-8').send('﻿' + [header, ...rows].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n');
    }
  } catch (error) { next(error); }
});
