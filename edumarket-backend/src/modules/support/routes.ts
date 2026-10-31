import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { AuditEvent } from '../admin/audit.model.js';
import { createNotification } from '../notifications/service.js';
import { Order } from '../payments/models.js';
import { SupportTicket } from './model.js';
import { sendNotificationEmail } from '../../integrations/email.js';

/** Personal support tickets for every signed-in account; the staff queue is admin-only. */
export const supportRoutes = Router();
export const adminSupportRoutes = Router();
const contactLimiter = rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 5, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED' } } });

/** Public contact form: opens a guest ticket answered by e-mail (when configured) from the admin support queue. */
supportRoutes.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), subject: z.string().trim().min(5).max(180).default('Contact form'), message: z.string().trim().min(10).max(5000) }).strict().parse(req.body);
    const ticket = await SupportTicket.create({
      requesterId: null, guest: { name: input.name, email: input.email }, subject: input.subject, category: 'other',
      messages: [{ authorId: null, authorRole: 'requester', body: input.message }],
    });
    res.status(201).json({ success: true, data: { id: String(ticket._id) } });
  } catch (error) { next(error); }
});

supportRoutes.use(authenticate, allowRoles('student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'));
adminSupportRoutes.use(authenticate, allowRoles('admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const writeLimiter = rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED' } } });

const ticketDto = (ticket: any, audience: 'requester' | 'staff') => ({
  id: String(ticket._id), subject: ticket.subject, category: ticket.category, priority: ticket.priority, status: ticket.status,
  relatedOrderId: ticket.relatedOrderId ? String(ticket.relatedOrderId) : null, createdAt: ticket.createdAt, lastActivityAt: ticket.lastActivityAt,
  messages: (ticket.messages || []).map((message: any) => ({
    id: String(message._id), authorRole: message.authorRole, body: message.body, createdAt: message.createdAt,
    authorName: audience === 'staff' || message.authorRole === 'requester' ? message.authorId?.name || ticket.guest?.name || '' : 'Support',
  })),
  ...(audience === 'staff' ? {
    requester: ticket.requesterId?.name ? { id: String(ticket.requesterId._id), name: ticket.requesterId.name, email: ticket.requesterId.email, role: ticket.requesterId.role }
      : ticket.guest?.email ? { id: '', name: ticket.guest.name, email: ticket.guest.email, role: 'visitor' } : { id: String(ticket.requesterId) },
    assignee: ticket.assigneeId?.name ? { id: String(ticket.assigneeId._id), name: ticket.assigneeId.name } : null,
  } : {}),
});

supportRoutes.get('/tickets', async (req: AuthRequest, res, next) => {
  try {
    const tickets = await SupportTicket.find({ requesterId: req.auth!.userId }).sort({ lastActivityAt: -1 }).limit(100).populate('messages.authorId', 'name').lean();
    res.json({ success: true, data: tickets.map(ticket => ticketDto(ticket, 'requester')) });
  } catch (error) { next(error); }
});

supportRoutes.post('/tickets', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({
      subject: z.string().trim().min(5).max(180), category: z.enum(['account', 'billing', 'course', 'technical', 'other']),
      message: z.string().trim().min(10).max(5000), relatedOrderId: objectId.optional(),
    }).strict().parse(req.body);
    if (input.relatedOrderId && !await Order.exists({ _id: input.relatedOrderId, studentId: req.auth!.userId })) throw new AppError(404, 'ORDER_NOT_FOUND');
    const ticket = await SupportTicket.create({
      requesterId: req.auth!.userId, subject: input.subject, category: input.category, relatedOrderId: input.relatedOrderId || null,
      priority: input.category === 'billing' || input.category === 'account' ? 'high' : 'normal',
      messages: [{ authorId: req.auth!.userId, authorRole: 'requester', body: input.message }],
    });
    await ticket.populate('messages.authorId', 'name');
    res.status(201).json({ success: true, data: ticketDto(ticket.toObject(), 'requester') });
  } catch (error) { next(error); }
});

supportRoutes.post('/tickets/:ticketId/messages', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const ticketId = objectId.safeParse(req.params.ticketId); if (!ticketId.success) throw new AppError(404, 'TICKET_NOT_FOUND');
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).strict().parse(req.body);
    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: ticketId.data, requesterId: req.auth!.userId, status: { $ne: 'closed' }, 'messages.199': { $exists: false } },
      { $push: { messages: { authorId: req.auth!.userId, authorRole: 'requester', body } }, $set: { status: 'open', lastActivityAt: new Date() } },
      { new: true },
    ).populate('messages.authorId', 'name');
    if (!ticket) {
      if (!await SupportTicket.exists({ _id: ticketId.data, requesterId: req.auth!.userId })) throw new AppError(404, 'TICKET_NOT_FOUND');
      throw new AppError(409, 'TICKET_CLOSED');
    }
    res.json({ success: true, data: ticketDto(ticket.toObject(), 'requester') });
  } catch (error) { next(error); }
});

supportRoutes.patch('/tickets/:ticketId/close', async (req: AuthRequest, res, next) => {
  try {
    const ticketId = objectId.safeParse(req.params.ticketId); if (!ticketId.success) throw new AppError(404, 'TICKET_NOT_FOUND');
    const ticket = await SupportTicket.findOneAndUpdate({ _id: ticketId.data, requesterId: req.auth!.userId }, { $set: { status: 'closed', lastActivityAt: new Date() } }, { new: true }).populate('messages.authorId', 'name');
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND');
    res.json({ success: true, data: ticketDto(ticket.toObject(), 'requester') });
  } catch (error) { next(error); }
});

adminSupportRoutes.get('/tickets', async (req, res, next) => {
  try {
    const query = z.object({ status: z.enum(['all', 'open', 'pending_user', 'resolved', 'closed']).default('open'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const filter = query.status === 'all' ? {} : { status: query.status };
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter).sort({ lastActivityAt: 1 }).skip((query.page - 1) * query.limit).limit(query.limit)
        .populate('requesterId', 'name email role').populate('assigneeId', 'name').populate('messages.authorId', 'name').lean(),
      SupportTicket.countDocuments(filter),
    ]);
    res.json({ success: true, data: tickets.map(ticket => ticketDto(ticket, 'staff')), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
});

adminSupportRoutes.post('/tickets/:ticketId/messages', async (req: AuthRequest, res, next) => {
  try {
    const ticketId = objectId.safeParse(req.params.ticketId); if (!ticketId.success) throw new AppError(404, 'TICKET_NOT_FOUND');
    const input = z.object({ body: z.string().trim().min(1).max(5000), status: z.enum(['pending_user', 'resolved']).default('pending_user') }).strict().parse(req.body);
    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: ticketId.data, status: { $ne: 'closed' }, 'messages.199': { $exists: false } },
      { $push: { messages: { authorId: req.auth!.userId, authorRole: 'staff', body: input.body } }, $set: { status: input.status, assigneeId: req.auth!.userId, lastActivityAt: new Date() } },
      { new: true },
    ).populate('requesterId', 'name email role').populate('assigneeId', 'name').populate('messages.authorId', 'name');
    if (!ticket) {
      if (!await SupportTicket.exists({ _id: ticketId.data })) throw new AppError(404, 'TICKET_NOT_FOUND');
      throw new AppError(409, 'TICKET_CLOSED');
    }
    await AuditEvent.create({ action: 'support.ticket.replied', actorId: req.auth!.userId, targetType: 'support_ticket', targetId: String(ticket._id), severity: 'info', ipAddress: req.ip });
    if (ticket.requesterId) {
      await createNotification({ userId: String((ticket.requesterId as any)._id || ticket.requesterId), type: 'system', title: 'Support replied', message: `New reply on "${ticket.subject}".`, link: '/support', template: { key: 'supportReplied', params: { subject: ticket.subject } } }).catch(() => undefined);
    } else if (ticket.guest?.email) {
      // Guests have no inbox: the reply is e-mailed when a provider is configured (otherwise staff follow up manually).
      void sendNotificationEmail({ to: ticket.guest.email, title: `Re: ${ticket.subject}`, message: input.body, link: '/contact' }).catch(error => console.error('Guest support e-mail failed', { code: (error as { code?: string }).code }));
    }
    res.json({ success: true, data: ticketDto(ticket.toObject(), 'staff') });
  } catch (error) { next(error); }
});

adminSupportRoutes.patch('/tickets/:ticketId', async (req: AuthRequest, res, next) => {
  try {
    const ticketId = objectId.safeParse(req.params.ticketId); if (!ticketId.success) throw new AppError(404, 'TICKET_NOT_FOUND');
    const input = z.object({ status: z.enum(['open', 'pending_user', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high']).optional() }).strict()
      .refine(value => Object.keys(value).length > 0).parse(req.body);
    const ticket = await SupportTicket.findByIdAndUpdate(ticketId.data, { $set: { ...input, lastActivityAt: new Date() } }, { new: true, runValidators: true })
      .populate('requesterId', 'name email role').populate('assigneeId', 'name').populate('messages.authorId', 'name');
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND');
    res.json({ success: true, data: ticketDto(ticket.toObject(), 'staff') });
  } catch (error) { next(error); }
});
