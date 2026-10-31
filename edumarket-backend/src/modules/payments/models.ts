import { Schema, model } from 'mongoose';

/** Amounts are integer minor units (cents). Line prices and commission are snapshotted at checkout. */
const orderItemSchema = new Schema({
  itemType: { type: String, enum: ['course', 'exam', 'session', 'subscription'], required: true },
  itemId: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, required: true, maxlength: 250 },
  // Subscription periods have no direct seller: revenue is distributed when the period is settled.
  sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: function (this: { itemType?: string }) { return this.itemType !== 'subscription'; } },
  // Affiliation snapshot: share of the seller amount owed to the teacher's institution at purchase time.
  institutionId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  institutionSharePercent: { type: Number, min: 0, max: 50, default: 0 },
  institutionAmount: { type: Number, min: 0, default: 0 },
  subscriptionPlan: { type: String, enum: ['monthly', 'yearly'], default: undefined },
  unitAmount: { type: Number, required: true, min: 0 },
  commissionRate: { type: Number, required: true, min: 0, max: 100 },
  platformFee: { type: Number, required: true, min: 0 },
  sellerAmount: { type: Number, required: true, min: 0 },
}, { _id: false });

const orderSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true, validate: (items: unknown[]) => items.length > 0 && items.length <= 20 },
  currency: { type: String, required: true, lowercase: true, minlength: 3, maxlength: 3 },
  totalAmount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
  provider: { type: String, enum: ['sandbox', 'stripe', 'offline'], required: true },
  // How the order was settled: online through the provider, or offline (cash, cheque, bank transfer) recorded by an admin.
  paymentMethod: { type: String, enum: ['online', 'cash', 'cheque', 'bank_transfer'], default: 'online' },
  offlinePayment: {
    reference: { type: String, trim: true, maxlength: 120 },
    bankName: { type: String, trim: true, maxlength: 120 },
    payerName: { type: String, trim: true, maxlength: 120 },
    receivedAt: { type: Date },
    note: { type: String, trim: true, maxlength: 1000 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    recordedAt: { type: Date },
    // Scan or photo of the cheque / receipt, kept in private storage (admin and buyer access only).
    proof: {
      storageKey: { type: String, match: /^[a-f0-9-]{36}\.(pdf|png|jpg)$/ },
      originalName: { type: String, maxlength: 180 },
      mimeType: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg'] },
      size: { type: Number, min: 1, max: 10 * 1024 * 1024 },
      uploadedAt: { type: Date },
    },
  },
  providerSessionId: { type: String, maxlength: 200 },
  providerPaymentId: { type: String, maxlength: 200 },
  checkoutUrl: { type: String, maxlength: 2000, default: '' },
  idempotencyKey: { type: String, maxlength: 100 },
  expiresAt: { type: Date, required: true },
  paidAt: { type: Date },
  invoiceNumber: { type: String, maxlength: 40 },
  failureReason: { type: String, maxlength: 200, default: '' },
  refund: {
    refundId: { type: String, maxlength: 200 },
    reason: { type: String, maxlength: 1000 },
    refundedAt: { type: Date },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
}, { timestamps: true, versionKey: false });
orderSchema.index({ providerSessionId: 1 }, { unique: true, partialFilterExpression: { providerSessionId: { $type: 'string' } } });
orderSchema.index({ invoiceNumber: 1 }, { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } });
orderSchema.index({ studentId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
orderSchema.index({ 'items.sellerId': 1, status: 1 });
orderSchema.index({ status: 1, expiresAt: 1 });

/** Processed provider events; the unique key makes webhook redelivery a no-op. */
const paymentEventSchema = new Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true, maxlength: 200 },
  kind: { type: String, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
}, { timestamps: true, versionKey: false });
paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

/**
 * Seller ledger. Credits: `sale` (direct seller), `affiliation_share` (institution part of an affiliated teacher's sale),
 * `subscription_share` (prorated subscription revenue). Each credit type has a `<type>_refund` (or `refund` for sales) debit.
 * Unique per order, item and entry type, so retries never double-credit.
 */
export const LEDGER_CREDIT_TYPES = ['sale', 'affiliation_share', 'subscription_share'] as const;
export const reversalType = (type: string) => type === 'sale' ? 'refund' : `${type}_refund`;
const ledgerEntrySchema = new Schema({
  sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  itemType: { type: String, enum: ['course', 'exam', 'session', 'subscription'], required: true },
  itemId: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, required: true, maxlength: 250 },
  type: { type: String, enum: ['sale', 'refund', 'affiliation_share', 'affiliation_share_refund', 'subscription_share', 'subscription_share_refund'], required: true },
  grossAmount: { type: Number, required: true },
  platformFee: { type: Number, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  availableAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });
ledgerEntrySchema.index({ orderId: 1, itemId: 1, type: 1 }, { unique: true });

/** Manual payouts processed by the finance team; at most one open request per seller prevents overdrawn balances. */
const payoutRequestSchema = new Schema({
  sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true },
  status: { type: String, enum: ['requested', 'paid', 'rejected'], default: 'requested', index: true },
  reference: { type: String, maxlength: 120, default: '' },
  note: { type: String, maxlength: 1000, default: '' },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  processedAt: { type: Date },
}, { timestamps: true, versionKey: false });
payoutRequestSchema.index({ sellerId: 1 }, { unique: true, partialFilterExpression: { status: 'requested' }, name: 'one_open_payout_per_seller' });

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } }, { versionKey: false });

export const Order = model('Order', orderSchema);
export const PaymentEvent = model('PaymentEvent', paymentEventSchema);
export const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
export const PayoutRequest = model('PayoutRequest', payoutRequestSchema);
export const Counter = model('Counter', counterSchema);
