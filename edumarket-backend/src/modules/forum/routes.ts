import { Router } from 'express';
import { AuditEvent } from '../admin/audit.model.js';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { authenticate, allowRoles, optionalAuthenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { ForumPost, ForumReply, ForumReport, ForumVote } from './models.js';

export const forumRoutes = Router();
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const writers = ['student', 'teacher', 'institution'] as const;
const reportLimit = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const roles: Record<string, string> = { student: 'Student', teacher: 'Teacher', institution: 'Institution' };
const postDto = (post: any, voted = false) => ({ id: String(post._id), title: post.title, content: post.content, category: post.category, authorId: String(post.authorId?._id || post.authorId), authorName: post.authorId?.name || '', authorAvatar: '', authorRole: roles[post.authorId?.role] || post.authorId?.role || '', createdAt: post.createdAt, upvotes: post.upvotes, repliesCount: post.repliesCount, isSolved: Boolean(post.solvedReplyId), solvedReplyId: post.solvedReplyId ? String(post.solvedReplyId) : undefined, viewsCount: post.viewsCount, tags: post.tags || [], isUpvoted: voted });
const replyDto = (reply: any, solutionId?: string) => ({ id: String(reply._id), postId: String(reply.postId), authorId: String(reply.authorId?._id || reply.authorId), authorName: reply.authorId?.name || '', authorAvatar: '', authorRole: roles[reply.authorId?.role] || reply.authorId?.role || '', content: reply.content, createdAt: reply.createdAt, upvotes: reply.upvotes, isSolution: solutionId === String(reply._id) });
const participant = (row: { participants?: unknown[] }, userId: string) => row.participants?.some(value => String((value as { _id?: unknown })._id || value) === userId);

forumRoutes.get('/posts', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ category: z.string().trim().max(100).optional(), search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const filter: Record<string, unknown> = { status: 'published' };
    if (query.category && query.category !== 'all') filter.category = query.category;
    if (query.search) filter.$text = { $search: query.search };
    const rows = await ForumPost.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).populate('authorId', 'name role').lean();
    const votes = req.auth ? await ForumVote.find({ userId: req.auth.userId, targetType: 'post', targetId: { $in: rows.map(row => row._id) } }).select('targetId').lean() : [];
    const voted = new Set(votes.map(vote => String(vote.targetId)));
    res.json({ success: true, data: rows.map(row => postDto(row, voted.has(String(row._id)))), total: await ForumPost.countDocuments(filter) });
  } catch (error) { next(error); }
});

forumRoutes.get('/posts/:postId', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.postId); if (!parsedId.success) throw new AppError(404, 'POST_NOT_FOUND');
    const post = await ForumPost.findOneAndUpdate({ _id: parsedId.data, status: 'published' }, { $inc: { viewsCount: 1 } }, { new: true }).populate('authorId', 'name role').lean();
    if (!post) throw new AppError(404, 'POST_NOT_FOUND');
    const voted = req.auth ? Boolean(await ForumVote.exists({ userId: req.auth.userId, targetType: 'post', targetId: parsedId.data })) : false;
    res.json({ success: true, data: postDto(post, voted) });
  } catch (error) { next(error); }
});

forumRoutes.get('/posts/:postId/replies', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.postId); if (!parsedId.success) throw new AppError(404, 'POST_NOT_FOUND');
    const post = await ForumPost.findOne({ _id: parsedId.data, status: 'published' }).select('solvedReplyId').lean();
    if (!post) throw new AppError(404, 'POST_NOT_FOUND');
    const replies = await ForumReply.find({ postId: parsedId.data, status: 'published' }).sort({ createdAt: 1 }).populate('authorId', 'name role').lean();
    res.json({ success: true, data: replies.map(reply => replyDto(reply, post.solvedReplyId ? String(post.solvedReplyId) : undefined)) });
  } catch (error) { next(error); }
});

forumRoutes.post('/posts', authenticate, allowRoles(...writers), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ title: z.string().trim().min(5).max(180), content: z.string().trim().min(10).max(12000), category: z.string().trim().min(1).max(100), tags: z.array(z.string().trim().max(40)).max(10).optional() }).strict().parse(req.body);
    const post = await ForumPost.create({ ...input, authorId: req.auth!.userId });
    res.status(201).json({ success: true, data: postDto(await post.populate('authorId', 'name role')) });
  } catch (error) { next(error); }
});

forumRoutes.post('/posts/:postId/replies', authenticate, allowRoles(...writers), async (req: AuthRequest, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.postId); if (!parsedId.success) throw new AppError(404, 'POST_NOT_FOUND');
    const { content } = z.object({ content: z.string().trim().min(2).max(8000) }).strict().parse(req.body);
    if (!await ForumPost.exists({ _id: parsedId.data, status: 'published' })) throw new AppError(404, 'POST_NOT_FOUND');
    const reply = await ForumReply.create({ postId: parsedId.data, authorId: req.auth!.userId, content });
    await ForumPost.updateOne({ _id: parsedId.data, status: 'published' }, { $inc: { repliesCount: 1 } });
    res.status(201).json({ success: true, data: replyDto(await reply.populate('authorId', 'name role')) });
  } catch (error) { next(error); }
});

forumRoutes.post('/posts/:postId/upvote', authenticate, allowRoles(...writers), async (req: AuthRequest, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.postId); if (!parsedId.success) throw new AppError(404, 'POST_NOT_FOUND');
    if (!await ForumPost.exists({ _id: parsedId.data, status: 'published' })) throw new AppError(404, 'POST_NOT_FOUND');
    let created = false;
    try { await ForumVote.create({ userId: req.auth!.userId, targetType: 'post', targetId: parsedId.data }); created = true; } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    if (created) await ForumPost.updateOne({ _id: parsedId.data }, { $inc: { upvotes: 1 } });
    const post = await ForumPost.findById(parsedId.data).select('upvotes').lean();
    res.json({ success: true, data: { upvotes: post?.upvotes || 0, isUpvoted: true } });
  } catch (error) { next(error); }
});

forumRoutes.patch('/posts/:postId/solution/:replyId', authenticate, allowRoles(...writers), async (req: AuthRequest, res, next) => {
  try {
    const postId = idSchema.safeParse(req.params.postId), replyId = idSchema.safeParse(req.params.replyId);
    if (!postId.success || !replyId.success) throw new AppError(404, 'POST_NOT_FOUND');
    const post = await ForumPost.findOne({ _id: postId.data, status: 'published' });
    if (!post) throw new AppError(404, 'POST_NOT_FOUND');
    if (String(post.authorId) !== req.auth!.userId) throw new AppError(403, 'FORBIDDEN');
    if (!await ForumReply.exists({ _id: replyId.data, postId: postId.data, status: 'published' })) throw new AppError(404, 'REPLY_NOT_FOUND');
    post.solvedReplyId = replyId.data as any; await post.save();
    res.json({ success: true, data: { solvedReplyId: replyId.data } });
  } catch (error) { next(error); }
});

forumRoutes.post('/posts/:postId/report', authenticate, reportLimit, async (req: AuthRequest, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.postId); if (!parsedId.success) throw new AppError(404, 'POST_NOT_FOUND');
    const { reason } = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
    if (!await ForumPost.exists({ _id: parsedId.data, status: 'published' })) throw new AppError(404, 'POST_NOT_FOUND');
    await ForumReport.create({ targetType: 'post', targetId: parsedId.data, reporterId: req.auth!.userId, reason });
    res.status(201).json({ success: true, data: { reported: true } });
  } catch (error) { next(error); }
});

forumRoutes.get('/reports', authenticate, allowRoles('moderator', 'admin'), async (_req, res, next) => {
  try {
    const reports = await ForumReport.find({ status: 'open' }).sort({ createdAt: 1 }).limit(100).populate('reporterId', 'name role').lean();
    res.json({ success: true, data: reports.map(report => ({ id: String(report._id), targetType: report.targetType, targetId: String(report.targetId), reporter: report.reporterId, reason: report.reason, createdAt: report.createdAt })) });
  } catch (error) { next(error); }
});

forumRoutes.patch('/reports/:reportId', authenticate, allowRoles('moderator', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const reportId = idSchema.safeParse(req.params.reportId); if (!reportId.success) throw new AppError(404, 'REPORT_NOT_FOUND');
    const input = z.object({ decision: z.enum(['actioned', 'dismissed']), note: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const report = await ForumReport.findOneAndUpdate({ _id: reportId.data, status: 'open' }, { $set: { status: input.decision, reviewNote: input.note || '', reviewedBy: req.auth!.userId, reviewedAt: new Date() } }, { new: true });
    if (!report) throw new AppError(404, 'REPORT_NOT_FOUND');
    await AuditEvent.create({ action: `moderation.forum_report.${input.decision}`, actorId: req.auth!.userId, targetType: `forum_${report.targetType}`, targetId: String(report.targetId), severity: input.decision === 'actioned' ? 'warning' : 'info', ipAddress: req.ip });
    if (input.decision === 'actioned') {
      if (report.targetType === 'post') await ForumPost.updateOne({ _id: report.targetId }, { $set: { status: 'hidden' } });
      else {
        const reply = await ForumReply.findById(report.targetId).select('postId');
        if (reply) {
          await ForumReply.updateOne({ _id: reply._id }, { $set: { status: 'hidden' } });
          await ForumPost.updateOne({ _id: reply.postId, solvedReplyId: reply._id }, { $set: { solvedReplyId: null } });
        }
      }
    }
    res.json({ success: true, data: { id: String(report._id), status: report.status } });
  } catch (error) { next(error); }
});
