import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { requirePaymentProvider, getPaymentProvider, type ProviderEvent } from '../../integrations/payments.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { Exam, ExamAttempt, ExamRegistration } from '../exams/models.js';
import { TutoringSession } from '../sessions/model.js';
import { PlatformSettings } from '../admin/settings.model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { User } from '../auth/model.js';
import { createNotification, type NotificationTemplate } from '../notifications/service.js';
import { Counter, LEDGER_CREDIT_TYPES, LedgerEntry, Order, PaymentEvent, PayoutRequest, reversalType } from './models.js';
import { activateSubscriptionPeriod, revokeSubscriptionPeriod } from '../subscriptions/service.js';
import { PUBLIC_COURSE_FILTER, hasClassAccess, syncClassAccess } from '../classes/service.js';

type ItemType = 'course' | 'exam' | 'session' | 'subscription';
export interface PricedItem { itemType: ItemType; itemId: mongoose.Types.ObjectId; title: string; sellerId?: mongoose.Types.ObjectId; unitAmount: number; subscriptionPlan?: 'monthly' | 'yearly' }
interface Actor { userId: string; ip?: string }

const CHECKOUT_TTL_MS = 35 * 60_000;
const RESERVATION_TTL_MS = 40 * 60_000;
export const toMinorUnits = (amount: number) => Math.round(amount * 100);

export async function currentCommissionRate() {
  const settings = mongoose.connection.readyState === 1 ? await PlatformSettings.findById('global').select('commissionRate').lean() : null;
  return settings?.commissionRate ?? 20;
}

const notify = (userId: unknown, title: string, message: string, link: string, template?: NotificationTemplate) =>
  createNotification({ userId: String(userId), type: 'purchase', title, message, link, template }).catch(() => undefined);

async function nextInvoiceNumber(date: Date) {
  const year = date.getUTCFullYear();
  const counter = await Counter.findOneAndUpdate({ _id: `invoice-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `INV-${year}-${String(counter.seq).padStart(6, '0')}`;
}

/** Affiliation agreed between a teacher and an institution, applied to the teacher's seller amount. */
export async function affiliationOf(sellerId: unknown) {
  const seller = await User.findById(sellerId).select('role institutionId institutionRevenueShare').lean();
  if (seller?.role !== 'teacher' || !seller.institutionId || !(seller.institutionRevenueShare > 0)) return null;
  return { institutionId: seller.institutionId, percent: seller.institutionRevenueShare };
}

/** Server-side pricing snapshot (commission, affiliation share) shared by online and offline orders. */
async function priceLines(items: PricedItem[]) {
  const rate = await currentCommissionRate();
  return Promise.all(items.map(async item => {
    // Subscription revenue is held by the platform until the period is settled and distributed to sellers.
    if (item.itemType === 'subscription') return { ...item, commissionRate: rate, platformFee: item.unitAmount, sellerAmount: 0 };
    const platformFee = Math.round(item.unitAmount * rate / 100);
    const sellerAmount = item.unitAmount - platformFee;
    const affiliation = await affiliationOf(item.sellerId);
    return {
      ...item, commissionRate: rate, platformFee, sellerAmount,
      ...(affiliation ? { institutionId: affiliation.institutionId, institutionSharePercent: affiliation.percent, institutionAmount: Math.round(sellerAmount * affiliation.percent / 100) } : {}),
    };
  }));
}

export async function createProviderOrder(student: { _id: unknown; email: string }, items: PricedItem[], idempotencyKey?: string, onFailure?: () => Promise<unknown>) {
  const provider = requirePaymentProvider();
  const lines = await priceLines(items);
  const order = await Order.create({
    studentId: student._id, items: lines, currency: env.PAYMENT_CURRENCY, totalAmount: lines.reduce((sum, line) => sum + line.unitAmount, 0),
    provider: provider.name, idempotencyKey, expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
  });
  try {
    const origin = env.APP_ORIGIN.replace(/\/$/, '');
    const checkout = await provider.createCheckout({
      orderId: String(order._id), currency: order.currency, customerEmail: student.email, expiresAt: order.expiresAt,
      lines: lines.map(line => ({ name: line.title, unitAmount: line.unitAmount, quantity: 1 as const })),
      successUrl: `${origin}/checkout/complete?order=${order._id}`, cancelUrl: `${origin}/checkout?cancelled=${order._id}`,
    });
    order.providerSessionId = checkout.sessionId; order.checkoutUrl = checkout.url;
    await order.save();
    return order;
  } catch (error) {
    await Order.updateOne({ _id: order._id }, { $set: { status: 'failed', failureReason: 'PROVIDER_CHECKOUT_FAILED' } });
    await onFailure?.();
    throw error;
  }
}

async function reuseIdempotentOrder(studentId: string, idempotencyKey?: string) {
  if (!idempotencyKey) return null;
  const existing = await Order.findOne({ studentId, idempotencyKey });
  if (!existing) return null;
  if (existing.status === 'pending' && existing.expiresAt > new Date() && existing.checkoutUrl) return existing;
  throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED');
}

async function loadStudent(studentId: string) {
  const student = await User.findById(studentId).select('email');
  if (!student) throw new AppError(401, 'USER_NOT_FOUND');
  return student;
}

export async function startCourseCheckout(studentId: string, courseIds: string[], idempotencyKey?: string) {
  requirePaymentProvider();
  const reused = await reuseIdempotentOrder(studentId, idempotencyKey); if (reused) return reused;
  const student = await loadStudent(studentId);
  return createProviderOrder(student, await courseItems(studentId, courseIds), idempotencyKey);
}

/** Validated, server-priced course lines (public paid courses the student does not own yet). */
export async function courseItems(studentId: string, courseIds: string[]): Promise<PricedItem[]> {
  const uniqueIds = [...new Set(courseIds)];
  const courses = await Course.find({ _id: { $in: uniqueIds }, ...PUBLIC_COURSE_FILTER }).select('title price teacherId').lean();
  if (courses.length !== uniqueIds.length) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (courses.some(course => !(course.price > 0))) throw new AppError(422, 'FREE_COURSE_NOT_PURCHASABLE');
  // Subscription access expires, so it does not block buying permanent access.
  if (await Enrollment.exists({ studentId, courseId: { $in: uniqueIds }, accessExpiresAt: null })) throw new AppError(409, 'ALREADY_ENROLLED');
  return courses.map(course => ({
    itemType: 'course' as const, itemId: course._id, title: course.title, sellerId: course.teacherId as mongoose.Types.ObjectId, unitAmount: toMinorUnits(course.price),
  }));
}

export async function startExamCheckout(studentId: string, examId: string, idempotencyKey?: string) {
  requirePaymentProvider();
  const reused = await reuseIdempotentOrder(studentId, idempotencyKey); if (reused) return reused;
  const student = await loadStudent(studentId);
  return createProviderOrder(student, [await examItem(studentId, examId)], idempotencyKey);
}

/** Validated, server-priced paid exam registration line. */
export async function examItem(studentId: string, examId: string): Promise<PricedItem> {
  const exam = await Exam.findOne({ _id: examId, status: 'published' }).select('title fee type date location registeredCount creatorId courseId').lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND');
  if (await Course.exists({ _id: exam.courseId, visibility: 'restricted' }) && !await hasClassAccess(studentId, exam.courseId)) throw new AppError(404, 'EXAM_NOT_FOUND');
  if (!(exam.fee > 0)) throw new AppError(422, 'FREE_EXAM_NOT_PURCHASABLE');
  if (exam.date && exam.date <= new Date()) throw new AppError(409, 'EXAM_CLOSED');
  if (exam.type === 'in_person' && exam.location?.capacity && exam.registeredCount >= exam.location.capacity) throw new AppError(409, 'EXAM_FULL');
  if (await ExamRegistration.exists({ examId, studentId })) throw new AppError(409, 'ALREADY_REGISTERED');
  return { itemType: 'exam', itemId: exam._id, title: exam.title, sellerId: exam.creatorId as mongoose.Types.ObjectId, unitAmount: toMinorUnits(exam.fee) };
}

/** Paid tutoring slots are reserved for the buyer while the provider checkout is open. */
export async function startSessionCheckout(studentId: string, sessionId: string, booking: { subject: string; notes?: string }, idempotencyKey?: string) {
  requirePaymentProvider();
  const reused = await reuseIdempotentOrder(studentId, idempotencyKey); if (reused) return reused;
  const student = await loadStudent(studentId);
  const session = await TutoringSession.findOneAndUpdate(
    { _id: sessionId, status: 'available', price: { $gt: 0 }, startAt: { $gt: new Date() }, teacherId: { $ne: studentId } },
    { $set: { status: 'pending', studentId, subject: booking.subject, notes: booking.notes || '', paymentStatus: 'awaiting_payment', reservationExpiresAt: new Date(Date.now() + RESERVATION_TTL_MS) } },
    { new: true },
  ).populate('teacherId', 'name');
  if (!session) throw new AppError(409, 'SESSION_UNAVAILABLE');
  const release = () => releaseSessionReservation(String(session._id));
  const title = `Tutoring · ${(session.teacherId as any)?.name || ''} · ${session.startAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const order = await createProviderOrder(student, [{ itemType: 'session', itemId: session._id, title, sellerId: (session.teacherId as any)._id, unitAmount: toMinorUnits(session.price) }], idempotencyKey, release);
  await TutoringSession.updateOne({ _id: session._id, paymentStatus: 'awaiting_payment' }, { $set: { orderId: order._id } });
  return order;
}

async function releaseSessionReservation(sessionId: string, orderId?: unknown) {
  await TutoringSession.updateOne(
    { _id: sessionId, paymentStatus: 'awaiting_payment', ...(orderId ? { orderId } : {}) },
    { $set: { status: 'available', studentId: null, subject: '', notes: '', paymentStatus: 'not_required', orderId: null, reservationExpiresAt: null } },
  );
}

/** Grants purchased access. Every step is idempotent so webhook redelivery cannot duplicate access or ledger credits. */
async function fulfillOrder(order: any): Promise<string[]> {
  const unavailable: string[] = [];
  const availableAt = new Date((order.paidAt?.getTime() || Date.now()) + env.PAYOUT_HOLD_DAYS * 86_400_000);
  for (const item of order.items) {
    if (item.itemType === 'subscription') {
      await activateSubscriptionPeriod(order, item);
      continue;
    } else if (item.itemType === 'course') {
      const result = await Enrollment.updateOne({ studentId: order.studentId, courseId: item.itemId }, {
        $set: { accessType: 'purchase', accessExpiresAt: null }, $setOnInsert: { enrolledAt: new Date(), lastAccessedAt: new Date() },
      }, { upsert: true });
      if (result.upsertedCount) await Course.updateOne({ _id: item.itemId }, { $inc: { studentsCount: 1 } });
    } else if (item.itemType === 'exam') {
      if (!await ExamRegistration.exists({ examId: item.itemId, studentId: order.studentId })) {
        const exam = await Exam.findById(item.itemId).select('type location').lean();
        const capacity = exam?.type === 'in_person' ? exam.location?.capacity : undefined;
        const reserved = capacity
          ? await Exam.findOneAndUpdate({ _id: item.itemId, registeredCount: { $lt: capacity } }, { $inc: { registeredCount: 1 } })
          : await Exam.findOneAndUpdate({ _id: item.itemId }, { $inc: { registeredCount: 1 } });
        if (!reserved) { unavailable.push(String(item.itemId)); continue; }
        try { await ExamRegistration.create({ examId: item.itemId, studentId: order.studentId }); }
        catch (error) {
          await Exam.updateOne({ _id: item.itemId }, { $inc: { registeredCount: -1 } });
          if ((error as { code?: number }).code !== 11000) throw error;
        }
      }
    } else if (item.itemType === 'session') {
      const owned = { _id: item.itemId, studentId: order.studentId, orderId: order._id };
      const session = await TutoringSession.findOneAndUpdate({ ...owned, paymentStatus: 'awaiting_payment' }, { $set: { paymentStatus: 'paid', reservationExpiresAt: null } }, { new: true })
        || await TutoringSession.findOne({ ...owned, paymentStatus: 'paid' });
      if (!session) { unavailable.push(String(item.itemId)); continue; }
    }
    const institutionAmount = item.institutionAmount || 0;
    await LedgerEntry.updateOne({ orderId: order._id, itemId: item.itemId, type: 'sale' }, {
      $setOnInsert: { sellerId: item.sellerId, itemType: item.itemType, title: item.title, grossAmount: item.unitAmount, platformFee: item.platformFee, amount: item.sellerAmount - institutionAmount, currency: order.currency, availableAt },
    }, { upsert: true });
    if (institutionAmount > 0 && item.institutionId) {
      await LedgerEntry.updateOne({ orderId: order._id, itemId: item.itemId, type: 'affiliation_share' }, {
        $setOnInsert: { sellerId: item.institutionId, itemType: item.itemType, title: item.title, grossAmount: item.unitAmount, platformFee: 0, amount: institutionAmount, currency: order.currency, availableAt },
      }, { upsert: true });
    }
  }
  return unavailable;
}

/**
 * Moves an order matching `filter` to paid, numbers its invoice, grants access, credits sellers and notifies.
 * Shared by provider webhooks and offline payments recorded by an admin; safe to call again for an already paid order.
 */
export async function markOrderPaid(filter: Record<string, unknown>, set: Record<string, unknown>) {
  const paidAt = new Date();
  const transitioned = await Order.findOneAndUpdate(filter, { $set: { status: 'paid', paidAt, failureReason: '', ...set } }, { new: true });
  const current = transitioned || await Order.findById(filter._id);
  if (transitioned) {
    transitioned.invoiceNumber = await nextInvoiceNumber(paidAt);
    await transitioned.save();
  }
  if (current?.status === 'paid') {
    const unavailable = await fulfillOrder(current);
    if (transitioned) {
      await notify(current.studentId, 'Payment confirmed', `Your payment for ${current.items.length} item(s) was confirmed.`, '/student/orders', { key: 'paymentConfirmed', params: { count: current.items.length } });
      const beneficiaries = new Set(current.items.flatMap((item: any) => [item.sellerId, item.institutionAmount > 0 ? item.institutionId : null]).filter(Boolean).map(String));
      for (const sellerId of beneficiaries) await notify(sellerId, 'New sale', 'A learner purchased one of your offers.', '/teacher/revenue', { key: 'newSale' });
      for (const item of current.items.filter((line: any) => line.itemType === 'session')) {
        await createNotification({ userId: String(item.sellerId), type: 'session', title: 'New tutoring request', message: 'A student paid for one of your tutoring slots and awaits confirmation.', link: '/teacher/tutoring', template: { key: 'paidTutoringRequest' } }).catch(() => undefined);
      }
    }
    if (unavailable.length) await refundOrder(String(current._id), 'ITEM_UNAVAILABLE_AFTER_PAYMENT', null);
  }
  return { order: current, transitioned: !!transitioned };
}

export async function handleProviderEvent(providerName: 'sandbox' | 'stripe', event: ProviderEvent) {
  if (await PaymentEvent.exists({ provider: providerName, eventId: event.id })) return { duplicate: true };
  let orderId: unknown;
  if (event.kind === 'payment_succeeded') {
    const order = await Order.findOne({ provider: providerName, providerSessionId: event.sessionId });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
    orderId = order._id;
    if (event.amountTotal !== order.totalAmount || event.currency.toLowerCase() !== order.currency) {
      await Order.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'failed', failureReason: 'AMOUNT_MISMATCH' } });
      await AuditEvent.create({ action: 'payment.amount_mismatch', actorId: order.studentId, targetType: 'order', targetId: String(order._id), severity: 'critical' });
    } else {
      await markOrderPaid({ _id: order._id, status: { $in: ['pending', 'failed'] }, failureReason: { $ne: 'AMOUNT_MISMATCH' } }, { providerPaymentId: event.paymentId, paymentMethod: 'online' });
    }
  } else if (event.kind === 'payment_failed') {
    const order = await Order.findOneAndUpdate({ provider: providerName, providerSessionId: event.sessionId, status: 'pending' }, { $set: { status: 'failed', failureReason: 'PAYMENT_FAILED_OR_EXPIRED' } }, { new: true });
    if (order) {
      orderId = order._id;
      for (const item of order.items.filter((line: any) => line.itemType === 'session')) await releaseSessionReservation(String(item.itemId), order._id);
    }
  }
  try { await PaymentEvent.create({ provider: providerName, eventId: event.id, kind: event.kind, orderId }); }
  catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  return { duplicate: false };
}

export async function refundOrder(orderId: string, reason: string, actor: Actor | null) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
  if (order.status !== 'paid' || (order.provider !== 'offline' && !order.providerPaymentId)) throw new AppError(409, 'ORDER_NOT_REFUNDABLE');
  let refundId: string;
  if (order.provider === 'offline') refundId = `offline-refund-${order._id}`; // returned in cash/transfer by the finance team
  else {
    const provider = getPaymentProvider();
    if (!provider || provider.name !== order.provider) throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
    ({ refundId } = await provider.refund(order.providerPaymentId!, order.totalAmount, `refund-${order._id}`));
  }
  const refunded = await Order.findOneAndUpdate({ _id: order._id, status: 'paid' }, {
    $set: { status: 'refunded', refund: { refundId, reason, refundedAt: new Date(), refundedBy: actor?.userId } },
  }, { new: true });
  if (!refunded) throw new AppError(409, 'ORDER_NOT_REFUNDABLE');
  for (const item of refunded.items as any[]) {
    if (item.itemType === 'subscription') await revokeSubscriptionPeriod(refunded._id);
  }
  await reverseLedgerForOrder(refunded._id);
  for (const item of refunded.items as any[]) {
    if (item.itemType === 'subscription') continue;
    if (item.itemType === 'course') {
      const removed = await Enrollment.deleteOne({ studentId: refunded.studentId, courseId: item.itemId, accessType: { $nin: ['subscription', 'class'] } });
      if (removed.deletedCount) await Course.updateOne({ _id: item.itemId, studentsCount: { $gt: 0 } }, { $inc: { studentsCount: -1 } });
      // A class membership covering the course keeps (or restores) access after the refund.
      if (removed.deletedCount) await syncClassAccess({ studentIds: [refunded.studentId], courseIds: [item.itemId] });
    } else if (item.itemType === 'exam') {
      const attempted = await ExamAttempt.exists({ examId: item.itemId, studentId: refunded.studentId });
      if (!attempted) {
        const removed = await ExamRegistration.deleteOne({ examId: item.itemId, studentId: refunded.studentId });
        if (removed.deletedCount) await Exam.updateOne({ _id: item.itemId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });
      }
    } else {
      await TutoringSession.updateOne({ _id: item.itemId, orderId: refunded._id }, { $set: { paymentStatus: 'refunded' } });
      await TutoringSession.updateOne({ _id: item.itemId, orderId: refunded._id, status: { $in: ['pending', 'confirmed'] } }, { $set: { status: 'cancelled' } });
    }
  }
  if (actor) await AuditEvent.create({ action: 'payment.order.refunded', actorId: actor.userId, targetType: 'order', targetId: String(refunded._id), severity: 'warning', ipAddress: actor.ip || '' });
  await notify(refunded.studentId, 'Refund issued', 'A refund was issued for one of your orders.', '/student/orders', { key: 'refundIssued' });
  return refunded;
}

/** Debits every credit recorded for an order (sales, affiliation shares, subscription shares). Idempotent. */
export async function reverseLedgerForOrder(orderId: unknown) {
  const credits = await LedgerEntry.find({ orderId, type: { $in: [...LEDGER_CREDIT_TYPES] } }).lean();
  for (const credit of credits) {
    await LedgerEntry.updateOne({ orderId, itemId: credit.itemId, type: reversalType(credit.type), sellerId: credit.sellerId }, {
      $setOnInsert: { itemType: credit.itemType, title: credit.title, grossAmount: -credit.grossAmount, platformFee: -credit.platformFee, amount: -credit.amount, currency: credit.currency, availableAt: new Date() },
    }, { upsert: true });
  }
}

/** Refunds a paid tutoring booking when the slot is rejected or cancelled before it takes place. */
export async function refundCancelledSession(session: { _id: unknown; orderId?: unknown; paymentStatus?: string }) {
  if (session.paymentStatus === 'awaiting_payment' && session.orderId) {
    await Order.updateOne({ _id: session.orderId, status: 'pending' }, { $set: { status: 'failed', failureReason: 'SESSION_CANCELLED' } });
    await releaseSessionReservation(String(session._id), session.orderId);
    return;
  }
  if (session.paymentStatus !== 'paid' || !session.orderId) return;
  try { await refundOrder(String(session.orderId), 'SESSION_CANCELLED', null); }
  catch (error) { console.error('Automatic session refund failed', { sessionId: String(session._id), code: (error as AppError).code }); }
}

/** Expires abandoned checkouts and releases tutoring slots held for them. */
export async function expireAbandonedCheckouts(now = new Date()) {
  const expiredSessions = await TutoringSession.find({ paymentStatus: 'awaiting_payment', reservationExpiresAt: { $lte: now } }).select('_id orderId').lean();
  for (const session of expiredSessions) {
    await releaseSessionReservation(String(session._id), session.orderId);
    if (session.orderId) await Order.updateOne({ _id: session.orderId, status: 'pending' }, { $set: { status: 'failed', failureReason: 'CHECKOUT_EXPIRED' } });
  }
  const orders = await Order.updateMany({ status: 'pending', expiresAt: { $lte: new Date(now.getTime() - 5 * 60_000) } }, { $set: { status: 'failed', failureReason: 'CHECKOUT_EXPIRED' } });
  return { releasedSessions: expiredSessions.length, expiredOrders: orders.modifiedCount };
}

export async function getSellerBalance(sellerId: string) {
  const id = new mongoose.Types.ObjectId(sellerId);
  const now = new Date();
  const [ledger] = await LedgerEntry.aggregate<{ earned: number; refunded: number; pending: number; matured: number; platformFees: number }>([
    { $match: { sellerId: id } },
    { $group: {
      _id: null,
      earned: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
      refunded: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
      pending: { $sum: { $cond: [{ $and: [{ $gt: ['$amount', 0] }, { $gt: ['$availableAt', now] }] }, '$amount', 0] } },
      matured: { $sum: { $cond: [{ $lte: ['$availableAt', now] }, '$amount', 0] } },
      platformFees: { $sum: '$platformFee' },
    } },
  ]);
  const payouts = await PayoutRequest.aggregate<{ _id: string; total: number }>([{ $match: { sellerId: id, status: { $in: ['requested', 'paid'] } } }, { $group: { _id: '$status', total: { $sum: '$amount' } } }]);
  const requested = payouts.find(row => row._id === 'requested')?.total || 0;
  const paidOut = payouts.find(row => row._id === 'paid')?.total || 0;
  return {
    currency: env.PAYMENT_CURRENCY, earned: ledger?.earned || 0, refunded: -(ledger?.refunded || 0), pending: ledger?.pending || 0,
    platformFees: ledger?.platformFees || 0, requestedPayouts: requested, paidOut,
    available: Math.max(0, (ledger?.matured || 0) - requested - paidOut), payoutMinimum: env.PAYOUT_MINIMUM_CENTS, holdDays: env.PAYOUT_HOLD_DAYS,
  };
}

export async function requestPayout(sellerId: string) {
  const balance = await getSellerBalance(sellerId);
  if (balance.available < Math.max(1, balance.payoutMinimum)) throw new AppError(422, 'PAYOUT_BELOW_MINIMUM');
  try {
    const payout = await PayoutRequest.create({ sellerId, amount: balance.available, currency: balance.currency });
    await AuditEvent.create({ action: 'payment.payout.requested', actorId: sellerId, targetType: 'payout', targetId: String(payout._id), severity: 'info' });
    return payout;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError(409, 'PAYOUT_ALREADY_REQUESTED');
    throw error;
  }
}

export async function processPayout(payoutId: string, decision: 'paid' | 'rejected', details: { reference?: string; note?: string }, actor: Actor) {
  if (decision === 'paid' && !details.reference?.trim()) throw new AppError(422, 'PAYOUT_REFERENCE_REQUIRED');
  const payout = await PayoutRequest.findOneAndUpdate({ _id: payoutId, status: 'requested' }, {
    $set: { status: decision, reference: details.reference?.trim() || '', note: details.note?.trim() || '', processedBy: actor.userId, processedAt: new Date() },
  }, { new: true });
  if (!payout) {
    if (!await PayoutRequest.exists({ _id: payoutId })) throw new AppError(404, 'PAYOUT_NOT_FOUND');
    throw new AppError(409, 'PAYOUT_ALREADY_PROCESSED');
  }
  await AuditEvent.create({ action: `payment.payout.${decision}`, actorId: actor.userId, targetType: 'payout', targetId: String(payout._id), severity: 'warning', ipAddress: actor.ip || '' });
  await notify(payout.sellerId, decision === 'paid' ? 'Payout sent' : 'Payout request rejected', decision === 'paid' ? 'Your payout was processed by the finance team.' : 'Your payout request was rejected. Contact support for details.', '/teacher/revenue', { key: decision === 'paid' ? 'payoutSent' : 'payoutRejected' });
  return payout;
}

// ---------------------------------------------------------------- offline payments (cash, cheque, bank transfer)

export const OFFLINE_METHODS = ['cash', 'cheque', 'bank_transfer'] as const;
export type OfflineMethod = typeof OFFLINE_METHODS[number];
export interface OfflinePaymentInput {
  method: OfflineMethod; reference?: string; bankName?: string; payerName?: string; receivedAt?: Date; note?: string;
  proof?: { storageKey: string; originalName: string; mimeType: string; size: number };
}

/** Pending order paid outside the platform; it stays open OFFLINE_PAYMENT_DAYS days and needs no payment provider. */
export async function createOfflineOrder(studentId: unknown, items: PricedItem[], method: OfflineMethod) {
  if (!items.length) throw new AppError(400, 'ORDER_ITEMS_REQUIRED');
  if (items.some(item => item.itemType === 'session')) throw new AppError(422, 'OFFLINE_SESSION_NOT_SUPPORTED');
  const lines = await priceLines(items);
  return Order.create({
    studentId, items: lines, currency: env.PAYMENT_CURRENCY, totalAmount: lines.reduce((sum, line) => sum + line.unitAmount, 0),
    provider: 'offline', paymentMethod: method, expiresAt: new Date(Date.now() + env.OFFLINE_PAYMENT_DAYS * 86_400_000),
  });
}

/**
 * Records an offline payment received by the finance team and grants access exactly like an online payment.
 * Only open offline orders (pending, or expired without payment) can be settled; cancelled requests cannot.
 */
export async function recordOfflinePayment(orderId: string, input: OfflinePaymentInput, actor: Actor) {
  const offlinePayment = {
    reference: input.reference || '', bankName: input.bankName || '', payerName: input.payerName || '', note: input.note || '',
    receivedAt: input.receivedAt || new Date(), recordedBy: actor.userId, recordedAt: new Date(),
    ...(input.proof ? { proof: { ...input.proof, uploadedAt: new Date() } } : {}),
  };
  const { order, transitioned } = await markOrderPaid(
    { _id: orderId, provider: 'offline', $or: [{ status: 'pending' }, { status: 'failed', failureReason: 'CHECKOUT_EXPIRED' }] },
    { paymentMethod: input.method, providerPaymentId: `offline-${orderId}`, offlinePayment },
  );
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
  if (!transitioned) throw new AppError(409, 'ORDER_NOT_PAYABLE_OFFLINE');
  await AuditEvent.create({ action: `payment.offline.${input.method}`, actorId: actor.userId, targetType: 'order', targetId: String(order._id), severity: 'warning', ipAddress: actor.ip || '' });
  return order;
}

/** Cancels an open offline request (by its buyer or an admin). */
export async function cancelOfflineOrder(orderId: string, studentId?: string) {
  const order = await Order.findOneAndUpdate({ _id: orderId, provider: 'offline', status: 'pending', ...(studentId ? { studentId } : {}) }, { $set: { status: 'failed', failureReason: 'CANCELLED' } }, { new: true });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND');
  return order;
}

