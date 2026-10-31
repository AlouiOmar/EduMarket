import { Schema, model } from 'mongoose';

const conversationSchema = new Schema({
  participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
  participantKey: { type: String, required: true, unique: true },
  lastMessageText: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now },
  lastSenderId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

const messageAttachmentSchema = new Schema({
  name: { type: String, trim: true, maxlength: 180, required: true },
  storageKey: { type: String, match: /^[a-f0-9-]{36}\.(pdf|zip|docx|webm|ogg|m4a)$/, required: true },
  mimeType: { type: String, enum: ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'audio/webm', 'audio/ogg', 'audio/mp4'], required: true },
  size: { type: Number, min: 1, max: 10 * 1024 * 1024, required: true },
  uploadedAt: { type: Date, required: true },
  kind: { type: String, enum: ['document', 'voice'], default: 'document' },
  durationSeconds: { type: Number, min: 1, max: 60 },
}, { _id: true, id: false });

const messageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, trim: true, maxlength: 5000, default: '' },
  attachment: { type: messageAttachmentSchema, default: undefined },
  readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  // Set by moderation after a confirmed report: content and attachment are no longer served.
  hiddenAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
messageSchema.index({ conversationId: 1, createdAt: -1 });

export const Conversation = model('Conversation', conversationSchema);
export const Message = model('Message', messageSchema);
