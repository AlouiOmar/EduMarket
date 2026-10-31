import express, { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { getPaymentProvider, requirePaymentProvider } from '../../integrations/payments.js';
import { LedgerEntry, Order, PayoutRequest } from './models.js';
import { getSettings } from '../admin/settings.routes.js';
import { currentCommissionRate, getSellerBalance, handleProviderEvent, requestPayout, startCourseCheckout, startExamCheckout, startSessionCheckout } from './service.js';

export const paymentRoutes = Router();
export const paymentWebhookRoutes = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idempotencyKey = (req: AuthRequest) => {
  const value = req.header('idempotency-key');
  if (value === undefined) return undefined;
  const parsed = z.string().trim().min(8).max(100).regex(/^[\w-]+$/).safeParse(value);
  if (!parsed.success) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY');
  return parsed.data;
};
const checkoutLimiter = rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED' } } });

export const orderDto = (order: any, audience: 'buyer' | 'admin' = 'buyer') => ({
  id: String(order._id), status: order.status, currency: order.currency, totalAmount: order.totalAmount, provider: order.provider,
  items: order.items.map((item: any) => ({
    itemType: item.itemType, itemId: String(item.itemId), title: item.title, unitAmount: item.unitAmount,
    ...(audience === 'admin' ? { sellerId: String(item.sellerId?._id || item.sellerId), sellerName: item.sellerId?.name || '', platformFee: item.platformFee, sellerAmount: item.sellerAmount, commissionRate: item.commissionRate } : {}),
  })),
  checkoutUrl: order.status === 'pending' && order.expiresAt > new Date() ? order.checkoutUrl : undefined,
  invoiceNumber: order.invoiceNumber || null, paidAt: order.paidAt || null, createdAt: order.createdAt, failureReason: order.failureReason || '',
  refund: order.refund?.refundedAt ? { refundedAt: order.refund.refundedAt, reason: order.refund.reason } : null,
  paymentMethod: order.paymentMethod || 'online', expiresAt: order.expiresAt,
  offlinePayment: order.provider === 'offline' && order.offlinePayment?.recordedAt ? {
    reference: order.offlinePayment.reference || '', receivedAt: order.offlinePayment.receivedAt, hasProof: !!order.offlinePayment.proof?.storageKey,
    ...(audience === 'admin' ? { bankName: order.offlinePayment.bankName || '', payerName: order.offlinePayment.payerName || '', note: order.offlinePayment.note || '', recordedBy: order.offlinePayment.recordedBy?.name || '', recordedAt: order.offlinePayment.recordedAt } : {}),
  } : null,
  ...(audience === 'admin' ? { student: order.studentId?.name ? { id: String(order.studentId._id), name: order.studentId.name, email: order.studentId.email } : { id: String(order.studentId) } } : {}),
});

const checkoutResponse = (order: any) => ({ success: true, data: { orderId: String(order._id), status: order.status, provider: order.provider, checkoutUrl: order.checkoutUrl, totalAmount: order.totalAmount, currency: order.currency, expiresAt: order.expiresAt } });

paymentRoutes.get('/config', async (_req, res, next) => {
  try {
    const provider = getPaymentProvider();
    const offline = (await getSettings()).offlinePayments;
    res.json({ success: true, data: { enabled: !!provider, provider: provider?.name || null, sandbox: provider?.name === 'sandbox', currency: env.PAYMENT_CURRENCY, commissionRate: await currentCommissionRate(), offline: { enabled: offline.enabled, instructions: offline.instructions } } });
  } catch (error) { next(error); }
});

paymentRoutes.use(authenticate);

paymentRoutes.post('/checkout', allowRoles('student'), checkoutLimiter, async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({
      courseIds: z.array(objectId).min(1).max(20),
      paymentMethod: z.enum(['card', 'paypal', 'transfer']).optional(),
    }).strict().parse(req.body);
    const order = await startCourseCheckout(req.auth!.userId, input.courseIds, idempotencyKey(req));
    res.status(201).json(checkoutResponse(order));
  } catch (error) { next(error); }
});

paymentRoutes.post('/checkout/exams/:examId', allowRoles('student'), checkoutLimiter, async (req: AuthRequest, res, next) => {
  try {
    const examId = objectId.safeParse(req.params.examId); if (!examId.success) throw new AppError(404, 'EXAM_NOT_FOUND');
    const order = await startExamCheckout(req.auth!.userId, examId.data, idempotencyKey(req));
    res.status(201).json(checkoutResponse(order));
  } catch (error) { next(error); }
});

paymentRoutes.post('/checkout/sessions/:sessionId', allowRoles('student'), checkoutLimiter, async (req: AuthRequest, res, next) => {
  try {
    const sessionId = objectId.safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'SESSION_NOT_FOUND');
    const input = z.object({ subject: z.string().trim().min(1).max(160), notes: z.string().trim().max(2000).optional() }).strict().parse(req.body);
    const order = await startSessionCheckout(req.auth!.userId, sessionId.data, input, idempotencyKey(req));
    res.status(201).json(checkoutResponse(order));
  } catch (error) { next(error); }
});

paymentRoutes.get('/orders/mine', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const orders = await Order.find({ studentId: req.auth!.userId, status: { $in: ['pending', 'paid', 'refunded', 'failed'] } }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: orders.map(order => orderDto(order)) });
  } catch (error) { next(error); }
});

const loadVisibleOrder = async (req: AuthRequest) => {
  const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
  const order = await Order.findById(orderId.data).populate('items.sellerId', 'name').populate('studentId', 'name email').lean();
  // Non-owners receive the same 404 as missing orders so identifiers cannot be probed.
  if (!order || (req.auth!.role !== 'admin' && String((order.studentId as any)?._id || order.studentId) !== req.auth!.userId)) throw new AppError(404, 'ORDER_NOT_FOUND');
  return order;
};

paymentRoutes.get('/orders/:orderId', allowRoles('student', 'admin'), async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: orderDto(await loadVisibleOrder(req), req.auth!.role === 'admin' ? 'admin' : 'buyer') }); }
  catch (error) { next(error); }
});

paymentRoutes.get('/orders/:orderId/invoice', allowRoles('student', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const order = await loadVisibleOrder(req);
    if (!order.invoiceNumber) throw new AppError(409, 'INVOICE_NOT_AVAILABLE');
    const student = order.studentId as any;
    res.json({ success: true, data: {
      invoiceNumber: order.invoiceNumber, issuedAt: order.paidAt, status: order.status, currency: order.currency, totalAmount: order.totalAmount,
      buyer: { name: student?.name || '', email: student?.email || '' },
      lines: order.items.map((item: any) => ({ description: item.title, itemType: item.itemType, seller: item.sellerId?.name || '', amount: item.unitAmount })),
      refund: order.refund?.refundedAt ? { refundedAt: order.refund.refundedAt } : null,
      paymentMethod: order.paymentMethod || 'online', paymentReference: order.offlinePayment?.reference || '',
      pricesIncludeTax: true,
    } });
  } catch (error) { next(error); }
});

/** Development-only checkout confirmation. It reuses the exact webhook handler path with a server-built event. */
paymentRoutes.post('/sandbox/sessions/:sessionId/:outcome', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const provider = requirePaymentProvider();
    if (provider.name !== 'sandbox' || env.NODE_ENV === 'production') throw new AppError(404, 'NOT_FOUND');
    const outcome = z.enum(['complete', 'fail']).safeParse(req.params.outcome); if (!outcome.success) throw new AppError(404, 'NOT_FOUND');
    const sessionId = z.string().regex(/^sbx_cs_[a-f0-9]{36}$/).safeParse(req.params.sessionId); if (!sessionId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
    const order = await Order.findOne({ provider: 'sandbox', providerSessionId: sessionId.data, studentId: req.auth!.userId });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
    if (order.status !== 'pending') throw new AppError(409, 'ORDER_NOT_PENDING');
    const eventId = `sbx_evt_${randomBytes(12).toString('hex')}`;
    await handleProviderEvent('sandbox', outcome.data === 'complete'
      ? { id: eventId, kind: 'payment_succeeded', sessionId: sessionId.data, paymentId: `sbx_pi_${randomBytes(12).toString('hex')}`, amountTotal: order.totalAmount, currency: order.currency }
      : { id: eventId, kind: 'payment_failed', sessionId: sessionId.data });
    const updated = await Order.findById(order._id).lean();
    res.json({ success: true, data: orderDto(updated) });
  } catch (error) { next(error); }
});

paymentRoutes.get('/earnings', allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const [balance, entries] = await Promise.all([
      getSellerBalance(req.auth!.userId),
      LedgerEntry.find({ sellerId: req.auth!.userId }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    res.json({ success: true, data: { balance, entries: entries.map(entry => ({
      id: String(entry._id), type: entry.type, itemType: entry.itemType, title: entry.title, grossAmount: entry.grossAmount,
      platformFee: entry.platformFee, amount: entry.amount, currency: entry.currency, availableAt: entry.availableAt, createdAt: entry.createdAt,
    })) } });
  } catch (error) { next(error); }
});

const payoutDto = (payout: any) => ({ id: String(payout._id), amount: payout.amount, currency: payout.currency, status: payout.status, reference: payout.reference, note: payout.note, createdAt: payout.createdAt, processedAt: payout.processedAt || null,
  ...(payout.sellerId?.name ? { seller: { id: String(payout.sellerId._id), name: payout.sellerId.name, email: payout.sellerId.email, role: payout.sellerId.role } } : {}) });

paymentRoutes.get('/payouts/mine', allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const payouts = await PayoutRequest.find({ sellerId: req.auth!.userId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: payouts.map(payoutDto) });
  } catch (error) { next(error); }
});

paymentRoutes.post('/payouts', allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    z.object({}).strict().parse(req.body || {});
    res.status(201).json({ success: true, data: payoutDto((await requestPayout(req.auth!.userId)).toObject()) });
  } catch (error) { next(error); }
});

export { payoutDto };

paymentWebhookRoutes.post('/:provider', express.raw({ type: '*/*', limit: '256kb' }), async (req, res, next) => {
  try {
    const provider = requirePaymentProvider();
    if (req.params.provider !== provider.name) throw new AppError(404, 'NOT_FOUND');
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD');
    let event;
    try { event = provider.verifyWebhook(req.body, req.headers); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD'); }
    const result = await handleProviderEvent(provider.name, event);
    res.json({ success: true, data: { received: true, duplicate: result.duplicate } });
  } catch (error) { next(error); }
});
