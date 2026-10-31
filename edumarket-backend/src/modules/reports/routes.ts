import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { AuditEvent } from '../admin/audit.model.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { CourseReview } from '../courses/review.model.js';
import { Conversation, Message } from '../messaging/models.js';
import { createNotification } from '../notifications/service.js';
import { setCourseSuspension } from '../courses/service.js';
import { ContentReport, REPORT_REASONS, REPORT_TARGETS } from './model.js';

/** Signed-in users report content; moderators and admins review the queue. Actions reuse the owning module's rules. */
export const reportRoutes = Router();
export const reportModerationRoutes = Router();
reportRoutes.use(authenticate, allowRoles('student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'));
reportModerationRoutes.use(authenticate, allowRoles('moderator', 'admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const reportLimiter = rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED' } } });

/** Resolves the reported target and checks that the reporter may see it; returns a bounded snapshot. */
async function resolveTarget(targetType: typeof REPORT_TARGETS[number], targetId: string, reporterId: string) {
  if (targetType === 'course') {
    const course = await Course.findOne({ _id: targetId, status: 'published' }).select('title description teacherId').lean();
    if (!course) return null;
    return { title: course.title, excerpt: course.description.slice(0, 1000), ownerId: course.teacherId };
  }
  if (targetType === 'course_review') {
    const review = await CourseReview.findOne({ _id: targetId, status: 'published' }).populate('courseId', 'title').lean();
    if (!review) return null;
    return { title: (review.courseId as any)?.title || '', excerpt: review.comment.slice(0, 1000), ownerId: review.studentId };
  }
  if (targetType === 'message') {
    // Only a conversation participant can report a message, and only messages sent by the other participant.
    const message = await Message.findOne({ _id: targetId, hiddenAt: null, senderId: { $ne: reporterId } }).lean();
    if (!message || !await Conversation.exists({ _id: message.conversationId, participants: reporterId })) return null;
    return { title: '', excerpt: (message.text || message.attachment?.name || '').slice(0, 1000), ownerId: message.senderId };
  }
  const user = await User.findOne({ _id: targetId, status: { $ne: 'suspended' } }).select('name headline bio').lean();
  if (!user || String(user._id) === reporterId) return null;
  return { title: user.name, excerpt: `${user.headline || ''} ${user.bio || ''}`.trim().slice(0, 1000), ownerId: user._id };
}

reportRoutes.post('/', reportLimiter, async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ targetType: z.enum(REPORT_TARGETS), targetId: objectId, reason: z.enum(REPORT_REASONS), details: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const snapshot = await resolveTarget(input.targetType, input.targetId, req.auth!.userId);
    if (!snapshot) throw new AppError(404, 'REPORT_TARGET_NOT_FOUND');
    try {
      const report = await ContentReport.create({ ...input, reporterId: req.auth!.userId, snapshot });
      res.status(201).json({ success: true, data: { id: String(report._id), status: report.status } });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new AppError(409, 'REPORT_ALREADY_OPEN');
      throw error;
    }
  } catch (error) { next(error); }
});

const reportDto = (report: any) => ({
  id: String(report._id), targetType: report.targetType, targetId: String(report.targetId), reason: report.reason, details: report.details,
  snapshot: { title: report.snapshot?.title || '', excerpt: report.snapshot?.excerpt || '', ownerName: report.snapshot?.ownerId?.name || '' },
  reporter: report.reporterId?.name ? { id: String(report.reporterId._id), name: report.reporterId.name } : null,
  status: report.status, decisionNote: report.decisionNote, createdAt: report.createdAt, reviewedAt: report.reviewedAt || null,
});

reportModerationRoutes.get('/', async (req, res, next) => {
  try {
    const query = z.object({ status: z.enum(['open', 'escalated', 'actioned', 'dismissed', 'all']).default('open'), targetType: z.enum(REPORT_TARGETS).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const filter: Record<string, unknown> = query.status === 'all' ? {} : { status: query.status };
    if (query.targetType) filter.targetType = query.targetType;
    const [reports, total] = await Promise.all([
      ContentReport.find(filter).sort({ createdAt: 1 }).skip((query.page - 1) * 25).limit(25).populate('reporterId', 'name').populate('snapshot.ownerId', 'name').lean(),
      ContentReport.countDocuments(filter),
    ]);
    res.json({ success: true, data: reports.map(reportDto), pagination: { page: query.page, limit: 25, total, pages: Math.ceil(total / 25) } });
  } catch (error) { next(error); }
});

/**
 * `actioned` applies the module rule for the target: course suspension, review hiding or message hiding.
 * Accounts are never suspended by moderators: a user report is escalated to administrators instead.
 */
reportModerationRoutes.patch('/:reportId', async (req: AuthRequest, res, next) => {
  try {
    const reportId = objectId.safeParse(req.params.reportId); if (!reportId.success) throw new AppError(404, 'REPORT_NOT_FOUND');
    const input = z.object({ decision: z.enum(['actioned', 'dismissed']), note: z.string().trim().max(1000).default('') }).strict().parse(req.body);
    const report = await ContentReport.findOne({ _id: reportId.data, status: { $in: ['open', 'escalated'] } });
    if (!report) throw new AppError(404, 'REPORT_NOT_FOUND');
    const actor = { userId: req.auth!.userId, role: req.auth!.role, ip: req.ip };
    let status: 'actioned' | 'dismissed' | 'escalated' = input.decision;
    if (input.decision === 'actioned') {
      if (report.targetType === 'course') {
        if (await Course.exists({ _id: report.targetId, status: 'published' })) await setCourseSuspension(String(report.targetId), true, input.note || `Report: ${report.reason}`, actor);
      } else if (report.targetType === 'course_review') {
        await CourseReview.updateOne({ _id: report.targetId }, { $set: { status: 'hidden' } });
      } else if (report.targetType === 'message') {
        await Message.updateOne({ _id: report.targetId }, { $set: { hiddenAt: new Date() } });
      } else if (req.auth!.role !== 'admin') {
        status = 'escalated';
        const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').lean();
        await Promise.all(admins.map(admin => createNotification({ userId: String(admin._id), type: 'system', title: 'User report escalated', message: 'A moderator escalated a user report for account review.', link: '/admin/users', template: { key: 'userReportEscalated' } }).catch(() => undefined)));
      }
    }
    const updated = await ContentReport.findOneAndUpdate({ _id: report._id, status: report.status }, { $set: { status, decisionNote: input.note, reviewedBy: req.auth!.userId, reviewedAt: new Date() } }, { new: true })
      .populate('reporterId', 'name').populate('snapshot.ownerId', 'name');
    if (!updated) throw new AppError(409, 'REPORT_ALREADY_PROCESSED');
    // Other open reports on the same target are resolved by the same decision.
    if (status !== 'escalated') await ContentReport.updateMany({ targetType: report.targetType, targetId: report.targetId, status: 'open' }, { $set: { status, decisionNote: input.note, reviewedBy: req.auth!.userId, reviewedAt: new Date() } });
    await AuditEvent.create({ action: `moderation.report.${status}`, actorId: req.auth!.userId, targetType: report.targetType, targetId: String(report.targetId), severity: status === 'dismissed' ? 'info' : 'warning', ipAddress: req.ip });
    void createNotification({ userId: String(report.reporterId), type: 'system', title: 'Report reviewed', message: 'Thank you: the moderation team reviewed your report.', link: '/notifications', template: { key: 'reportReviewed' } }).catch(() => undefined);
    res.json({ success: true, data: reportDto(updated.toObject()) });
  } catch (error) { next(error); }
});
