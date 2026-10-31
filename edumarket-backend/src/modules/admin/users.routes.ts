import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { AuditEvent } from './audit.model.js';
import { InstitutionProfile } from '../institutions/profile.model.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { Order } from '../payments/models.js';
import { SupportTicket } from '../support/model.js';
import { ContentReport } from '../reports/model.js';
import { Certificate } from '../certificates/model.js';

export const adminUserRoutes = Router();
adminUserRoutes.use(authenticate, allowRoles('admin'));

const userDto = (user: any) => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role,
  verified: !!user.verified, status: user.status || 'active', createdAt: user.createdAt,
});

adminUserRoutes.get('/', async (req, res, next) => {
  try {
    const query = z.object({ search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).parse(req.query);
    const filter = query.search ? { $or: [{ name: { $regex: query.search, $options: 'i' } }, { email: { $regex: query.search, $options: 'i' } }] } : {};
    const users = await User.find(filter).select('name email role verified status createdAt').sort({ createdAt: -1 }).limit(query.limit).lean();
    res.json({ success: true, data: users.map(userDto), total: users.length });
  } catch (error) { next(error); }
});

adminUserRoutes.get('/audit', async (_req, res, next) => {
  try {
    const events = await AuditEvent.find().sort({ createdAt: -1 }).limit(100).populate('actorId', 'name').lean();
    res.json({ success: true, data: events.map(event => ({ id: String(event._id), action: event.action, performedBy: (event.actorId as any)?.name || 'Admin', target: `${event.targetType}:${event.targetId}`, ipAddress: event.ipAddress, timestamp: event.createdAt, severity: event.severity })) });
  } catch (error) { next(error); }
});

/** Account detail for administrators: profile, affiliation, activity counters and recent audit trail. */
adminUserRoutes.get('/:userId', async (req, res, next) => {
  try {
    const userId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.userId); if (!userId.success) throw new AppError(404, 'USER_NOT_FOUND');
    const user = await User.findById(userId.data).select('name email role verified status createdAt headline phone institutionId institutionRole institutionRevenueShare teacherVerification.status').populate('institutionId', 'name').lean();
    if (!user) throw new AppError(404, 'USER_NOT_FOUND');
    const [enrollments, certificates, courses, orders, tickets, reportsAgainst, audit] = await Promise.all([
      Enrollment.countDocuments({ studentId: user._id }), Certificate.countDocuments({ studentId: user._id }),
      Course.aggregate<{ _id: string; count: number }>([{ $match: { teacherId: user._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate<{ _id: string; count: number; amount: number }>([{ $match: { studentId: user._id } }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }]),
      SupportTicket.countDocuments({ requesterId: user._id }), ContentReport.countDocuments({ 'snapshot.ownerId': user._id }),
      AuditEvent.find({ $or: [{ targetId: String(user._id) }, { actorId: user._id }] }).sort({ createdAt: -1 }).limit(15).populate('actorId', 'name').lean(),
    ]);
    const institution = user.institutionId as any;
    res.json({ success: true, data: {
      ...userDto(user), headline: user.headline || '', phone: user.phone || '', teacherVerificationStatus: (user as any).teacherVerification?.status || null,
      affiliation: institution ? { institutionId: String(institution._id), institutionName: institution.name, internalRole: user.institutionRole || 'teacher', revenueSharePercent: user.institutionRevenueShare || 0 } : null,
      stats: {
        enrollments, certificates, supportTickets: tickets, reportsAgainst,
        coursesByStatus: Object.fromEntries(courses.map(row => [row._id, row.count])),
        ordersByStatus: Object.fromEntries(orders.map(row => [row._id, { count: row.count, amount: row.amount }])),
      },
      audit: audit.map(event => ({ id: String(event._id), action: event.action, actor: (event.actorId as any)?.name || '', severity: event.severity, createdAt: event.createdAt })),
    } });
  } catch (error) { next(error); }
});

adminUserRoutes.patch('/:userId/role', async (req: AuthRequest, res, next) => {
  try {
    const userId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.userId);
    const { role } = z.object({ role: z.enum(['student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin']) }).strict().parse(req.body);
    if (userId === req.auth!.userId && role !== 'admin') throw new AppError(409, 'CANNOT_REMOVE_OWN_ADMIN_ROLE');
    const user = await User.findById(userId).select('name email role verified status createdAt teacherVerification');
    if (!user) throw new AppError(404, 'USER_NOT_FOUND');
    if (user.teacherVerification?.status === 'pending') throw new AppError(409, 'VERIFICATION_REVIEW_REQUIRED');
    if (role === 'teacher' && (!user.verified || user.teacherVerification?.status !== 'approved')) throw new AppError(403, 'TEACHER_VERIFICATION_REQUIRED');
    if (role === 'institution' && !await InstitutionProfile.exists({ ownerId: userId, status: 'approved' })) throw new AppError(403, 'INSTITUTION_VERIFICATION_REQUIRED');
    user.role = role;
    if (role !== 'teacher' && role !== 'institution') user.verified = false;
    await user.save();
    if (role !== 'institution') await InstitutionProfile.updateOne({ ownerId: userId, status: 'approved' }, { $set: { status: 'rejected', reviewNote: 'Institution access revoked by administrator', reviewedBy: req.auth!.userId, reviewedAt: new Date() } });
    await AuditEvent.create({ action: 'user.role.updated', actorId: req.auth!.userId, targetType: 'user', targetId: userId, severity: 'warning', ipAddress: req.ip });
    res.json({ success: true, data: userDto(user.toObject()) });
  } catch (error) { next(error); }
});

adminUserRoutes.patch('/:userId/status', async (req: AuthRequest, res, next) => {
  try {
    const userId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.userId);
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).strict().parse(req.body);
    if (userId === req.auth!.userId && status === 'suspended') throw new AppError(409, 'CANNOT_SUSPEND_OWN_ACCOUNT');
    const user = await User.findByIdAndUpdate(userId, { status }, { new: true, runValidators: true }).select('name email role verified status createdAt').lean();
    if (!user) throw new AppError(404, 'USER_NOT_FOUND');
    await AuditEvent.create({ action: 'user.status.updated', actorId: req.auth!.userId, targetType: 'user', targetId: userId, severity: status === 'suspended' ? 'critical' : 'warning', ipAddress: req.ip });
    res.json({ success: true, data: userDto(user) });
  } catch (error) { next(error); }
});
