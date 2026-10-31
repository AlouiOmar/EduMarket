import { Schema, model } from 'mongoose';

/**
 * Prepaid subscriptions: each paid period (monthly or yearly) is one `SubscriptionPeriod` created by a confirmed order.
 * Periods are chained; access to subscription enrollments lasts until `currentPeriodEnd`. There is no automatic debit:
 * learners renew explicitly (a reminder notification is sent before the end).
 */
const subscriptionSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  plan: { type: String, enum: ['monthly', 'yearly'], required: true },
  currentPeriodEnd: { type: Date, required: true, index: true },
  cancelledAt: { type: Date, default: null },
  reminderSentForPeriodEnd: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

const subscriptionPeriodSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  plan: { type: String, enum: ['monthly', 'yearly'], required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true },
  commissionRate: { type: Number, required: true, min: 0, max: 100 },
  status: { type: String, enum: ['active', 'refunded'], default: 'active', index: true },
  settledAt: { type: Date, default: null },
  distributedAmount: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });
subscriptionPeriodSchema.index({ status: 1, settledAt: 1, endsAt: 1 });

export const Subscription = model('Subscription', subscriptionSchema);
export const SubscriptionPeriod = model('SubscriptionPeriod', subscriptionPeriodSchema);
