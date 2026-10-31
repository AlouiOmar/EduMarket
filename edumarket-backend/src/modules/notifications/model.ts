import { Schema, model } from 'mongoose';

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['purchase', 'subscription', 'session', 'course', 'exam', 'message', 'certificate', 'account', 'system'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  link: { type: String, trim: true, maxlength: 300, default: '' },
  readAt: { type: Date, default: null },
  // Translation key + parameters rendered by the client (title/message stay as an English fallback and for e-mail).
  template: { key: { type: String, maxlength: 80 }, params: { type: Schema.Types.Mixed, default: undefined } },
}, { timestamps: true, versionKey: false });
notificationSchema.index({ userId: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);
