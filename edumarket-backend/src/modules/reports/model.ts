import { Schema, model } from 'mongoose';

/**
 * Reports on platform content outside the forum (forum posts keep their dedicated report flow).
 * `snapshot` keeps the reported text at report time so moderators see what was reported, and only that.
 */
export const REPORT_TARGETS = ['course', 'course_review', 'message', 'user'] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'copyright', 'misinformation', 'other'] as const;

const reportSchema = new Schema({
  targetType: { type: String, enum: REPORT_TARGETS, required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, trim: true, maxlength: 1000, default: '' },
  snapshot: { title: { type: String, maxlength: 250, default: '' }, excerpt: { type: String, maxlength: 1000, default: '' }, ownerId: { type: Schema.Types.ObjectId, ref: 'User' } },
  status: { type: String, enum: ['open', 'actioned', 'dismissed', 'escalated'], default: 'open', index: true },
  decisionNote: { type: String, trim: true, maxlength: 1000, default: '' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
}, { timestamps: true, versionKey: false });
// One open report per reporter and target: repeated clicks do not flood the queue.
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
reportSchema.index({ status: 1, createdAt: 1 });

export const ContentReport = model('ContentReport', reportSchema);
