import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { cancelSubscription, getSubscriptionStatus, startSubscriptionCheckout, subscriptionOffer } from './service.js';

export const subscriptionRoutes = Router();

subscriptionRoutes.get('/offer', async (_req, res, next) => {
  try { res.json({ success: true, data: await subscriptionOffer() }); }
  catch (error) { next(error); }
});

subscriptionRoutes.use(authenticate, allowRoles('student'));

subscriptionRoutes.get('/me', async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: await getSubscriptionStatus(req.auth!.userId) }); }
  catch (error) { next(error); }
});

subscriptionRoutes.post('/checkout', async (req: AuthRequest, res, next) => {
  try {
    const { plan } = z.object({ plan: z.enum(['monthly', 'yearly']) }).strict().parse(req.body);
    const header = req.header('idempotency-key');
    const key = header === undefined ? undefined : z.string().trim().min(8).max(100).regex(/^[\w-]+$/).safeParse(header);
    if (key && !key.success) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY');
    const order = await startSubscriptionCheckout(req.auth!.userId, plan, key?.data);
    res.status(201).json({ success: true, data: { orderId: String(order._id), status: order.status, provider: order.provider, checkoutUrl: order.checkoutUrl, totalAmount: order.totalAmount, currency: order.currency, expiresAt: order.expiresAt } });
  } catch (error) { next(error); }
});

subscriptionRoutes.post('/me/cancel', async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: await cancelSubscription(req.auth!.userId) }); }
  catch (error) { next(error); }
});
