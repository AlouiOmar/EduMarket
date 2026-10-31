import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles } from '../../common/auth.js';
import { AuditEvent } from './audit.model.js';

export const adminAuditRoutes = Router();
adminAuditRoutes.use(authenticate, allowRoles('admin'));

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

adminAuditRoutes.get('/', async (req, res, next) => {
  try {
    const query = z.object({
      action: z.string().trim().max(100).optional(), severity: z.enum(['info', 'warning', 'critical']).optional(),
      targetType: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = { $regex: `^${escapeRegex(query.action)}` };
    if (query.severity) filter.severity = query.severity;
    if (query.targetType) filter.targetType = query.targetType;
    const [events, total] = await Promise.all([
      AuditEvent.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).populate('actorId', 'name role').lean(),
      AuditEvent.countDocuments(filter),
    ]);
    res.json({ success: true, data: events.map(event => ({
      id: String(event._id), action: event.action, performedBy: (event.actorId as any)?.name || '', actorRole: (event.actorId as any)?.role || '',
      targetType: event.targetType, targetId: event.targetId, target: `${event.targetType}:${event.targetId}`,
      ipAddress: event.ipAddress, severity: event.severity, timestamp: event.createdAt,
    })), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
});
