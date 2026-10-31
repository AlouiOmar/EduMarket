import mongoose, { Schema } from 'mongoose';

const platformSettingsSchema = new Schema({
  _id: { type: String, default: 'global' },
  commissionRate: { type: Number, required: true, min: 0, max: 50, default: 20 },
  maintenanceMode: { type: Boolean, required: true, default: false },
  subscription: {
    enabled: { type: Boolean, default: false },
    monthlyPrice: { type: Number, min: 1, max: 10000, default: 29 },
    yearlyPrice: { type: Number, min: 1, max: 100000, default: 279 },
  },
  // Offline payments: students can request to pay by cash, cheque or bank transfer; an admin records the payment.
  offlinePayments: {
    enabled: { type: Boolean, default: true },
    instructions: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
