import { Schema, model } from 'mongoose';

const ticketMessageSchema = new Schema({
  authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  authorRole: { type: String, enum: ['requester', 'staff'], required: true },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const supportTicketSchema = new Schema({
  // Visitors use the public contact form: no account, only a contact address stored on the ticket.
  requesterId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  guest: { name: { type: String, trim: true, maxlength: 100 }, email: { type: String, trim: true, lowercase: true, maxlength: 254 } },
  subject: { type: String, required: true, trim: true, minlength: 5, maxlength: 180 },
  category: { type: String, enum: ['account', 'billing', 'course', 'technical', 'other'], required: true },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  status: { type: String, enum: ['open', 'pending_user', 'resolved', 'closed'], default: 'open', index: true },
  assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  relatedOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  // Bounded thread: tickets requiring longer exchanges are closed and reopened as a new ticket.
  messages: { type: [ticketMessageSchema], default: [], validate: (messages: unknown[]) => messages.length <= 200 },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false });
supportTicketSchema.index({ status: 1, lastActivityAt: -1 });

export const SupportTicket = model('SupportTicket', supportTicketSchema);
