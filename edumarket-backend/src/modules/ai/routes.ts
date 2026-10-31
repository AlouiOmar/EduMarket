import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { aiStatus, chat } from '../../integrations/aiProvider.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Enrollment } from '../enrollments/model.js';
import { recordSourceGrade } from '../gradebook/service.js';
import { managedCourse, objectId, parseId, studentCourse, withinWindow } from '../lms/access.js';
import { AiActivity, AiConversation } from './models.js';

/**
 * AI conversation API (`/ai/...`). Managers create activities and read transcripts; students must acknowledge the data notice
 * before their first message. Limits: turns per conversation, message length, per-student rate limit. Provider errors never
 * store half a turn. Grades go to the gradebook unpublished.
 */
export const aiRoutes = Router();
aiRoutes.use(authenticate);
const managers = allowRoles('teacher', 'institution', 'admin');
const students = allowRoles('student');
const messageLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: req => (req as AuthRequest).auth?.userId || req.ip || 'anonymous' });
const date = z.union([z.null(), z.coerce.date()]).optional();

/** Platform rules always sent before the teacher's instructions. */
const PLATFORM_RULES = [
  'You are a teaching assistant inside the EduMarket learning platform, talking with a student.',
  'Follow the teacher instructions below. Answer in the language the student writes in.',
  'Do not ask for or store personal data. Do not claim to grade the student: the teacher grades.',
].join('\n');

/** What students are told before they start (also returned to managers to show what students see). */
const dataNotice = (activity: { retentionDays: number }) => ({
  collected: ['messages', 'timestamps', 'token_counts'], visibleTo: 'course_teachers', retentionDays: activity.retentionDays, provider: aiStatus().provider,
});

const activitySchema = z.object({
  title: z.string().trim().min(1).max(200), instructions: z.string().trim().max(4000).default(''), systemPrompt: z.string().trim().min(10).max(8000),
  maxTurns: z.number().int().min(1).max(100).default(15), retentionDays: z.number().int().min(1).max(730).default(180),
  graded: z.boolean().default(false), points: z.number().int().min(1).max(1000).default(10), availableFrom: date, availableUntil: date,
}).strict();
const managerDto = (activity: any) => ({ id: String(activity._id), title: activity.title, instructions: activity.instructions, systemPrompt: activity.systemPrompt, maxTurns: activity.maxTurns, retentionDays: activity.retentionDays, graded: activity.graded, points: activity.points, status: activity.status, availableFrom: activity.availableFrom, availableUntil: activity.availableUntil, dataNotice: dataNotice(activity) });
const studentDto = (activity: any) => ({ id: String(activity._id), title: activity.title, instructions: activity.instructions, maxTurns: activity.maxTurns, graded: activity.graded, points: activity.points, status: activity.status, availableUntil: activity.availableUntil, dataNotice: dataNotice(activity) });

aiRoutes.get('/status', (_req, res) => { res.json({ success: true, data: aiStatus() }); });

aiRoutes.get('/:courseId/activities', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const activities = await AiActivity.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const counts = await AiConversation.aggregate<{ _id: unknown; count: number }>([{ $match: { courseId: course._id } }, { $group: { _id: '$activityId', count: { $sum: 1 } } }]);
    res.json({ success: true, data: { status: aiStatus(), activities: activities.map(activity => ({ ...managerDto(activity), conversations: counts.find(row => String(row._id) === String(activity._id))?.count || 0 })) } });
  } catch (error) { next(error); }
});
aiRoutes.post('/:courseId/activities', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const activity = await AiActivity.create({ ...activitySchema.parse(req.body), courseId: course._id, createdBy: req.auth!.userId });
    res.status(201).json({ success: true, data: managerDto(activity) });
  } catch (error) { next(error); }
});
aiRoutes.patch('/:courseId/activities/:activityId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const input = activitySchema.partial().extend({ status: z.enum(['draft', 'published', 'closed']).optional() }).strict().parse(req.body);
    if (input.status === 'published' && !aiStatus().configured) throw new AppError(503, 'AI_PROVIDER_NOT_CONFIGURED');
    const activity = await AiActivity.findOneAndUpdate({ _id: parseId(req.params.activityId, 'AI_ACTIVITY_NOT_FOUND'), courseId: course._id }, { $set: input }, { new: true }).lean();
    if (!activity) throw new AppError(404, 'AI_ACTIVITY_NOT_FOUND');
    res.json({ success: true, data: managerDto(activity) });
  } catch (error) { next(error); }
});
aiRoutes.get('/:courseId/activities/:activityId/conversations', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const conversations = await AiConversation.find({ courseId: course._id, activityId: parseId(req.params.activityId, 'AI_ACTIVITY_NOT_FOUND') }).populate('studentId', 'name').sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: conversations.map(conversation => ({ id: String(conversation._id), studentId: String((conversation.studentId as any)?._id || conversation.studentId), studentName: (conversation.studentId as any)?.name || '', turns: conversation.messages.filter(message => message.role === 'user').length, status: conversation.status, submittedAt: conversation.submittedAt, updatedAt: (conversation as any).updatedAt, deleteAfter: conversation.deleteAfter })) });
  } catch (error) { next(error); }
});
/** Transcript for authorized managers; every read is audited (personal data). */
aiRoutes.get('/:courseId/conversations/:conversationId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const conversation = await AiConversation.findOne({ _id: parseId(req.params.conversationId, 'AI_CONVERSATION_NOT_FOUND'), courseId: course._id }).populate('studentId', 'name').lean();
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND');
    await AuditEvent.create({ action: 'ai.transcript.read', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data: { id: String(conversation._id), studentName: (conversation.studentId as any)?.name || '', messages: conversation.messages, status: conversation.status, consentAt: conversation.consentAt, deleteAfter: conversation.deleteAfter } });
  } catch (error) { next(error); }
});
aiRoutes.post('/:courseId/activities/:activityId/grades', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const activity = await AiActivity.findOne({ _id: parseId(req.params.activityId, 'AI_ACTIVITY_NOT_FOUND'), courseId: course._id }).lean();
    if (!activity) throw new AppError(404, 'AI_ACTIVITY_NOT_FOUND');
    if (!activity.graded) throw new AppError(409, 'NOT_GRADED');
    const input = z.object({ studentId: objectId, score: z.number().min(0), feedback: z.string().trim().max(4000).default('') }).strict().parse(req.body);
    if (input.score > activity.points) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
    if (!await Enrollment.exists({ courseId: course._id, studentId: input.studentId })) throw new AppError(422, 'STUDENT_NOT_IN_COURSE');
    await recordSourceGrade({ courseId: course._id, kind: 'ai_conversation', refId: String(activity._id), studentId: input.studentId, score: input.score, feedback: input.feedback, status: 'graded', title: `IA : ${activity.title}`, maxPoints: activity.points, dueAt: activity.availableUntil, graderId: req.auth!.userId });
    res.json({ success: true, data: { studentId: input.studentId, score: input.score } });
  } catch (error) { next(error); }
});

// --- Students ---------------------------------------------------------------------------------------------------------------

const ownConversation = (activityId: unknown, studentId: string) => AiConversation.findOne({ activityId, studentId }).lean();
const conversationDto = (conversation: any) => conversation ? { id: String(conversation._id), messages: conversation.messages, status: conversation.status, consentAt: conversation.consentAt, deleteAfter: conversation.deleteAfter } : null;

aiRoutes.get('/:courseId/student/activities', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId);
    const activities = await AiActivity.find({ courseId: course._id, status: { $in: ['published', 'closed'] } }).sort({ createdAt: 1 }).lean();
    const conversations = await AiConversation.find({ courseId: course._id, studentId: req.auth!.userId }).lean();
    res.json({ success: true, data: { status: aiStatus(), activities: activities.map(activity => ({
      ...studentDto(activity), open: activity.status === 'published' && withinWindow(activity),
      conversation: conversationDto(conversations.find(conversation => String(conversation.activityId) === String(activity._id))),
    })) } });
  } catch (error) { next(error); }
});

async function openActivity(req: AuthRequest) {
  const course = await studentCourse(req, req.params.courseId, { write: true });
  const activity = await AiActivity.findOne({ _id: parseId(req.params.activityId, 'AI_ACTIVITY_NOT_FOUND'), courseId: course._id, status: 'published' }).lean();
  if (!activity) throw new AppError(404, 'AI_ACTIVITY_NOT_FOUND');
  if (!withinWindow(activity)) throw new AppError(409, 'AI_ACTIVITY_NOT_OPEN');
  return { course, activity };
}

/** Explicit acknowledgement of the data notice; creates the (empty) conversation with its retention date. */
aiRoutes.post('/:courseId/student/activities/:activityId/consent', students, async (req: AuthRequest, res, next) => {
  try {
    const { course, activity } = await openActivity(req);
    const { accepted } = z.object({ accepted: z.literal(true) }).strict().parse(req.body);
    const now = new Date();
    await AiConversation.updateOne({ activityId: activity._id, studentId: req.auth!.userId }, { $setOnInsert: { courseId: course._id, consentAt: now, deleteAfter: new Date(now.getTime() + activity.retentionDays * 86_400_000), messages: [] } }, { upsert: true });
    res.json({ success: true, data: { accepted, conversation: conversationDto(await ownConversation(activity._id, req.auth!.userId)) } });
  } catch (error) { next(error); }
});

aiRoutes.post('/:courseId/student/activities/:activityId/messages', students, messageLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { activity } = await openActivity(req);
    const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    const conversation = await ownConversation(activity._id, req.auth!.userId);
    if (!conversation) throw new AppError(409, 'AI_CONSENT_REQUIRED');
    if (conversation.status === 'submitted') throw new AppError(409, 'AI_CONVERSATION_SUBMITTED');
    const turns = conversation.messages.filter(message => message.role === 'user').length;
    if (turns >= activity.maxTurns) throw new AppError(409, 'AI_TURN_LIMIT_REACHED');
    const history = conversation.messages.map(message => ({ role: message.role as 'user' | 'assistant', content: message.content || '' }));
    // The provider is called first: a failure stores nothing (no half turn), the student can retry.
    const answer = await chat(`${PLATFORM_RULES}\n\nTeacher instructions:\n${activity.systemPrompt}`, [...history, { role: 'user', content }]);
    const now = new Date();
    const updated = await AiConversation.findOneAndUpdate(
      { _id: conversation._id, status: 'active', $expr: { $eq: [{ $size: '$messages' }, conversation.messages.length] } },
      { $push: { messages: { $each: [{ role: 'user', content, at: now }, { role: 'assistant', content: answer.text.slice(0, 20000), at: new Date(), outputTokens: answer.outputTokens ?? undefined }] } } },
      { new: true },
    ).lean();
    if (!updated) throw new AppError(409, 'AI_CONVERSATION_CONFLICT');
    res.json({ success: true, data: { conversation: conversationDto(updated), turnsLeft: activity.maxTurns - turns - 1 } });
  } catch (error) { next(error); }
});

aiRoutes.post('/:courseId/student/activities/:activityId/submit', students, async (req: AuthRequest, res, next) => {
  try {
    const course = await studentCourse(req, req.params.courseId, { write: true });
    const activityId = parseId(req.params.activityId, 'AI_ACTIVITY_NOT_FOUND');
    const conversation = await AiConversation.findOneAndUpdate({ courseId: course._id, activityId, studentId: req.auth!.userId, status: 'active' }, { $set: { status: 'submitted', submittedAt: new Date() } }, { new: true }).lean();
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND');
    const activity = await AiActivity.findById(activityId).lean();
    if (activity?.graded) await recordSourceGrade({ courseId: course._id, kind: 'ai_conversation', refId: String(activityId), studentId: req.auth!.userId, score: null, status: 'pending', title: `IA : ${activity.title}`, maxPoints: activity.points, dueAt: activity.availableUntil });
    res.json({ success: true, data: conversationDto(conversation) });
  } catch (error) { next(error); }
});

/** Retention job: transcripts past their retention date are deleted (grades already recorded stay in the gradebook). */
export async function purgeExpiredTranscripts(now = new Date()) {
  const result = await AiConversation.deleteMany({ deleteAfter: { $lt: now } });
  return result.deletedCount;
}
