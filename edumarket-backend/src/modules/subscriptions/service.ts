import mongoose from 'mongoose';
import { AppError } from '../../common/errors.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { LessonActivity } from '../enrollments/lesson-activity.model.js';
import { User } from '../auth/model.js';
import { getSettings } from '../admin/settings.routes.js';
import { createNotification, type NotificationTemplate } from '../notifications/service.js';
import { LedgerEntry } from '../payments/models.js';
import { affiliationOf, createProviderOrder, reverseLedgerForOrder, toMinorUnits } from '../payments/service.js';
import { requirePaymentProvider } from '../../integrations/payments.js';
import { Subscription, SubscriptionPeriod } from './models.js';

export type Plan = 'monthly' | 'yearly';
const addPlan = (date: Date, plan: Plan) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + (plan === 'monthly' ? 1 : 12));
  return next;
};
const notify = (userId: unknown, title: string, message: string, template?: NotificationTemplate, link = '/student/subscription') =>
  createNotification({ userId: String(userId), type: 'subscription', title, message, link, template }).catch(() => undefined);

export async function subscriptionOffer() {
  const { subscription } = await getSettings();
  return { enabled: subscription.enabled, monthlyPrice: subscription.monthlyPrice, yearlyPrice: subscription.yearlyPrice };
}

export async function getSubscriptionStatus(studentId: string) {
  const [subscription, periods] = await Promise.all([
    Subscription.findOne({ studentId }).lean(),
    SubscriptionPeriod.find({ studentId }).sort({ startsAt: -1 }).limit(24).lean(),
  ]);
  const active = !!subscription && subscription.currentPeriodEnd > new Date();
  return {
    active, plan: subscription?.plan || null, currentPeriodEnd: subscription?.currentPeriodEnd || null, cancelledAt: subscription?.cancelledAt || null,
    periods: periods.map(period => ({ id: String(period._id), orderId: String(period.orderId), plan: period.plan, startsAt: period.startsAt, endsAt: period.endsAt, amount: period.amount, currency: period.currency, status: period.status })),
  };
}

export async function startSubscriptionCheckout(studentId: string, plan: Plan, idempotencyKey?: string) {
  requirePaymentProvider();
  const student = await User.findById(studentId).select('email');
  if (!student) throw new AppError(401, 'USER_NOT_FOUND');
  return createProviderOrder(student, [await subscriptionItem(plan)], idempotencyKey);
}

/** Server-priced subscription line. The item id identifies the future period, created when the payment is confirmed. */
export async function subscriptionItem(plan: Plan) {
  const offer = await subscriptionOffer();
  if (!offer.enabled) throw new AppError(409, 'SUBSCRIPTIONS_DISABLED');
  return {
    itemType: 'subscription' as const, itemId: new mongoose.Types.ObjectId(), subscriptionPlan: plan,
    title: plan === 'monthly' ? 'EduMarket subscription · 1 month' : 'EduMarket subscription · 12 months',
    unitAmount: toMinorUnits(plan === 'monthly' ? offer.monthlyPrice : offer.yearlyPrice),
  };
}

async function syncSubscriptionAccess(studentId: unknown) {
  const latest = await SubscriptionPeriod.findOne({ studentId, status: 'active' }).sort({ endsAt: -1 }).lean();
  const end = latest && latest.endsAt > new Date() ? latest.endsAt : new Date();
  await Subscription.updateOne({ studentId }, { $set: { currentPeriodEnd: end } });
  await Enrollment.updateMany({ studentId, accessType: 'subscription' }, { $set: { accessExpiresAt: end } });
  return end;
}

/** Called by order fulfillment. Idempotent per order: one period per paid order, chained after the current one. */
export async function activateSubscriptionPeriod(order: any, item: any) {
  if (await SubscriptionPeriod.exists({ orderId: order._id })) return;
  const plan = item.subscriptionPlan as Plan;
  const latest = await SubscriptionPeriod.findOne({ studentId: order.studentId, status: 'active' }).sort({ endsAt: -1 }).lean();
  const startsAt = latest && latest.endsAt > new Date() ? latest.endsAt : new Date();
  try {
    await SubscriptionPeriod.create({ studentId: order.studentId, orderId: order._id, plan, startsAt, endsAt: addPlan(startsAt, plan), amount: item.unitAmount, currency: order.currency, commissionRate: item.commissionRate });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
  await Subscription.updateOne({ studentId: order.studentId }, { $set: { plan, cancelledAt: null }, $setOnInsert: { currentPeriodEnd: new Date() } }, { upsert: true });
  const end = await syncSubscriptionAccess(order.studentId);
  await notify(order.studentId, 'Subscription active', `Your subscription gives access to the paid catalogue until ${end.toISOString().slice(0, 10)}.`, { key: 'subscriptionActive', params: { date: end.toISOString() } });
}

/** Called by refunds: the refunded period stops granting access; later chained periods keep their dates. */
export async function revokeSubscriptionPeriod(orderId: unknown) {
  const period = await SubscriptionPeriod.findOneAndUpdate({ orderId, status: 'active' }, { $set: { status: 'refunded' } }, { new: true });
  if (period) await syncSubscriptionAccess(period.studentId);
}

export async function cancelSubscription(studentId: string) {
  const subscription = await Subscription.findOneAndUpdate({ studentId, cancelledAt: null }, { $set: { cancelledAt: new Date() } }, { new: true });
  if (!subscription) {
    if (!await Subscription.exists({ studentId })) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND');
    throw new AppError(409, 'SUBSCRIPTION_ALREADY_CANCELLED');
  }
  return getSubscriptionStatus(studentId);
}

/** Enrolls an active subscriber in a paid published course; access follows the subscription period. */
export async function enrollWithSubscription(studentId: string, courseId: string) {
  const subscription = await Subscription.findOne({ studentId, currentPeriodEnd: { $gt: new Date() } }).lean();
  if (!subscription) throw new AppError(402, 'PAYMENT_REQUIRED');
  const existing = await Enrollment.findOne({ studentId, courseId });
  if (existing && existing.accessExpiresAt == null) return existing;
  const result = await Enrollment.findOneAndUpdate(
    { studentId, courseId },
    { $set: { accessType: 'subscription', accessExpiresAt: subscription.currentPeriodEnd }, $setOnInsert: { enrolledAt: new Date(), lastAccessedAt: new Date() } },
    { upsert: true, new: true, includeResultMetadata: true },
  );
  if (!result.lastErrorObject?.updatedExisting) await Course.updateOne({ _id: courseId }, { $inc: { studentsCount: 1 } });
  return result.value!;
}

/** Splits `total` proportionally to `weights` (largest remainder), so the parts always sum to `total`. */
export function prorate(total: number, weights: number[]) {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const raw = weights.map(weight => total * weight / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((acc, part) => acc + part, 0);
  raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => { if (remainder > 0) { parts[index] += 1; remainder -= 1; } });
  return parts;
}

/**
 * Settles ended periods: the seller pool (amount minus the platform commission snapshot) is shared between the courses
 * of subscription enrollments in proportion to lessons completed during the period. Periods without activity stay with
 * the platform. Each period is claimed atomically; ledger writes are idempotent.
 */
export async function settleEndedSubscriptionPeriods(now = new Date()) {
  const due = await SubscriptionPeriod.find({ status: 'active', settledAt: null, endsAt: { $lte: now } }).limit(50).lean();
  let settled = 0;
  for (const candidate of due) {
    const period = await SubscriptionPeriod.findOneAndUpdate({ _id: candidate._id, status: 'active', settledAt: null }, { $set: { settledAt: now } }, { new: true });
    if (!period) continue;
    const subscribedCourses = await Enrollment.find({ studentId: period.studentId, accessType: 'subscription' }).select('courseId').lean();
    const activity = await LessonActivity.aggregate<{ _id: mongoose.Types.ObjectId; lessons: number }>([
      { $match: { studentId: period.studentId, courseId: { $in: subscribedCourses.map(row => row.courseId) }, completedAt: { $gte: period.startsAt, $lt: period.endsAt } } },
      { $group: { _id: '$courseId', lessons: { $sum: 1 } } },
    ]);
    const pool = period.amount - Math.round(period.amount * period.commissionRate / 100);
    const shares = prorate(pool, activity.map(row => row.lessons));
    let distributed = 0;
    for (const [index, row] of activity.entries()) {
      if (!shares[index]) continue;
      const course = await Course.findById(row._id).select('title teacherId').lean();
      if (!course) continue;
      const affiliation = await affiliationOf(course.teacherId);
      const institutionAmount = affiliation ? Math.round(shares[index] * affiliation.percent / 100) : 0;
      const base = { orderId: period.orderId, itemId: course._id };
      const entry = { itemType: 'subscription', title: course.title, grossAmount: shares[index], platformFee: 0, currency: period.currency, availableAt: now };
      await LedgerEntry.updateOne({ ...base, type: 'subscription_share' }, { $setOnInsert: { ...entry, sellerId: course.teacherId, amount: shares[index] - institutionAmount } }, { upsert: true });
      if (institutionAmount > 0) await LedgerEntry.updateOne({ ...base, type: 'affiliation_share' }, { $setOnInsert: { ...entry, sellerId: affiliation!.institutionId, amount: institutionAmount } }, { upsert: true });
      distributed += shares[index];
    }
    await SubscriptionPeriod.updateOne({ _id: period._id }, { $set: { distributedAmount: distributed } });
    // A refund racing with settlement must still cancel the credits written above.
    if (await SubscriptionPeriod.exists({ _id: period._id, status: 'refunded' })) await reverseLedgerForOrder(period.orderId);
    settled += 1;
  }
  return settled;
}

/** Sends one renewal reminder per period end, three days ahead, unless the learner cancelled. */
export async function sendRenewalReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const subscriptions = await Subscription.find({ cancelledAt: null, currentPeriodEnd: { $gt: now, $lte: soon } }).lean();
  for (const subscription of subscriptions) {
    const claimed = await Subscription.updateOne({ _id: subscription._id, reminderSentForPeriodEnd: { $ne: subscription.currentPeriodEnd } }, { $set: { reminderSentForPeriodEnd: subscription.currentPeriodEnd } });
    if (claimed.modifiedCount) await notify(subscription.studentId, 'Subscription ending soon', `Your subscription ends on ${subscription.currentPeriodEnd.toISOString().slice(0, 10)}. Renew it to keep access to the paid catalogue.`, { key: 'subscriptionEnding', params: { date: subscription.currentPeriodEnd.toISOString() } });
  }
  return subscriptions.length;
}
