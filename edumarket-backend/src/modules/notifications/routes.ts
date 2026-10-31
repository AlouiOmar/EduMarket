import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Notification } from './model.js';
import { subscribeUserEvents } from '../../integrations/userEvents.js';

export const notificationRoutes = Router();
notificationRoutes.use(authenticate, allowRoles('student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'));
notificationRoutes.get('/events', (req: AuthRequest, res) => {
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  subscribeUserEvents(req.auth!.userId, res);
});
notificationRoutes.get('/', async (req: AuthRequest, res, next) => {
  try {
    const rows = await Notification.find({ userId: req.auth!.userId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: rows.map(row => ({ id: String(row._id), userId: String(row.userId), type: row.type, title: row.title, message: row.message, timestamp: row.createdAt, read: Boolean(row.readAt), link: row.link || undefined, template: row.template?.key ? { key: row.template.key, params: row.template.params || {} } : undefined })) });
  } catch (error) { next(error); }
});
notificationRoutes.patch('/read-all', async (req: AuthRequest, res, next) => {
  try { await Notification.updateMany({ userId: req.auth!.userId, readAt: null }, { $set: { readAt: new Date() } }); res.json({ success: true, data: { updated: true } }); }
  catch (error) { next(error); }
});
notificationRoutes.patch('/:notificationId/read', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.notificationId);
    if (!id.success) throw new AppError(404, 'NOTIFICATION_NOT_FOUND');
    const row = await Notification.findOneAndUpdate({ _id: id.data, userId: req.auth!.userId }, { $set: { readAt: new Date() } }, { new: true }).lean();
    if (!row) throw new AppError(404, 'NOTIFICATION_NOT_FOUND');
    res.json({ success: true, data: { id: String(row._id), read: true } });
  } catch (error) { next(error); }
});
