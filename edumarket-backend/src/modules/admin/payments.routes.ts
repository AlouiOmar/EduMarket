import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { getPaymentProvider } from '../../integrations/payments.js';
import { Order, PayoutRequest } from '../payments/models.js';
import { orderDto, payoutDto } from '../payments/routes.js';
import { processPayout, refundOrder } from '../payments/service.js';

/** Financial administration is admin-only; moderators never inherit these permissions. */
export const adminPaymentRoutes = Router();
adminPaymentRoutes.use(authenticate, allowRoles('admin'));
const objectId = z.string().regex(/^[a-f\d]{24}$/i);

adminPaymentRoutes.get('/summary', async (_req, res, next) => {
  try {
    const [totals] = await Order.aggregate<{ gross: number; fees: number; paidOrders: number }>([
      { $match: { status: 'paid' } }, { $unwind: '$items' },
      { $group: { _id: '$_id', gross: { $first: '$totalAmount' }, fees: { $sum: '$items.platformFee' } } },
      { $group: { _id: null, gross: { $sum: '$gross' }, fees: { $sum: '$fees' }, paidOrders: { $sum: 1 } } },
    ]);
    const [refunds] = await Order.aggregate<{ total: number; count: number }>([{ $match: { status: 'refunded' } }, { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }]);
    const payouts = await PayoutRequest.aggregate<{ _id: string; total: number; count: number }>([{ $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } }]);
    const provider = getPaymentProvider();
    res.json({ success: true, data: {
      currency: env.PAYMENT_CURRENCY, provider: provider?.name || null,
      grossRevenue: totals?.gross || 0, platformFees: totals?.fees || 0, paidOrders: totals?.paidOrders || 0,
      refundedAmount: refunds?.total || 0, refundedOrders: refunds?.count || 0,
      pendingPayouts: payouts.find(row => row._id === 'requested')?.total || 0, pendingPayoutCount: payouts.find(row => row._id === 'requested')?.count || 0,
      paidPayouts: payouts.find(row => row._id === 'paid')?.total || 0,
    } });
  } catch (error) { next(error); }
});

adminPaymentRoutes.get('/orders', async (req, res, next) => {
  try {
    const query = z.object({ status: z.enum(['all', 'pending', 'paid', 'failed', 'refunded']).default('all'), provider: z.enum(['all', 'offline', 'online']).default('all'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const filter: Record<string, unknown> = query.status === 'all' ? {} : { status: query.status };
    if (query.provider === 'offline') filter.provider = 'offline';
    if (query.provider === 'online') filter.provider = { $ne: 'offline' };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).populate('studentId', 'name email').populate('items.sellerId', 'name').populate('offlinePayment.recordedBy', 'name').lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ success: true, data: orders.map(order => orderDto(order, 'admin')), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (error) { next(error); }
});

adminPaymentRoutes.post('/orders/:orderId/refund', async (req: AuthRequest, res, next) => {
  try {
    const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
    const { reason } = z.object({ reason: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
    const order = await refundOrder(orderId.data, reason, { userId: req.auth!.userId, ip: req.ip });
    const populated = await Order.findById(order._id).populate('studentId', 'name email').populate('items.sellerId', 'name').lean();
    res.json({ success: true, data: orderDto(populated, 'admin') });
  } catch (error) { next(error); }
});

adminPaymentRoutes.get('/payouts', async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['all', 'requested', 'paid', 'rejected']).default('requested') }).parse(req.query);
    const payouts = await PayoutRequest.find(status === 'all' ? {} : { status }).sort({ createdAt: 1 }).limit(200).populate('sellerId', 'name email role').lean();
    res.json({ success: true, data: payouts.map(payoutDto) });
  } catch (error) { next(error); }
});

adminPaymentRoutes.patch('/payouts/:payoutId', async (req: AuthRequest, res, next) => {
  try {
    const payoutId = objectId.safeParse(req.params.payoutId); if (!payoutId.success) throw new AppError(404, 'PAYOUT_NOT_FOUND');
    const input = z.object({ status: z.enum(['paid', 'rejected']), reference: z.string().trim().max(120).optional(), note: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const payout = await processPayout(payoutId.data, input.status, input, { userId: req.auth!.userId, ip: req.ip });
    res.json({ success: true, data: payoutDto((await payout.populate('sellerId', 'name email role')).toObject()) });
  } catch (error) { next(error); }
});
