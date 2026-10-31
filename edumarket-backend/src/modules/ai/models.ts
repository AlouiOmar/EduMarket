import mongoose, { Schema } from 'mongoose';

/**
 * AI conversation activities. The teacher defines the pedagogical instructions and limits; students converse with the configured
 * provider through the server; transcripts are kept for `retentionDays` (then purged by a job) and readable by course managers.
 */
const activitySchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  // Shown to students: what the conversation is about.
  instructions: { type: String, default: '', maxlength: 4000 },
  // Sent to the provider only (role, pedagogical rules, what not to reveal). Never returned to students.
  systemPrompt: { type: String, required: true, maxlength: 8000 },
  maxTurns: { type: Number, min: 1, max: 100, default: 15 },
  retentionDays: { type: Number, min: 1, max: 730, default: 180 },
  graded: { type: Boolean, default: false },
  points: { type: Number, min: 1, max: 1000, default: 10 },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
  availableFrom: { type: Date, default: null },
  availableUntil: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

const conversationSchema = new Schema({
  activityId: { type: Schema.Types.ObjectId, ref: 'AiActivity', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  consentAt: { type: Date, required: true },
  messages: { type: [{ _id: false, role: { type: String, enum: ['user', 'assistant'], required: true }, content: { type: String, maxlength: 20000 }, at: Date, outputTokens: Number }], default: [] },
  status: { type: String, enum: ['active', 'submitted'], default: 'active' },
  submittedAt: { type: Date, default: null },
  deleteAfter: { type: Date, required: true, index: true },
}, { timestamps: true, versionKey: false });
conversationSchema.index({ activityId: 1, studentId: 1 }, { unique: true });

export const AiActivity = mongoose.model('AiActivity', activitySchema);
export const AiConversation = mongoose.model('AiConversation', conversationSchema);
