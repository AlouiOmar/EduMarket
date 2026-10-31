import mongoose, { Schema } from 'mongoose';

const sessionReviewSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'TutoringSession', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, trim: true, minlength: 10, maxlength: 2000, required: true },
}, { timestamps: true, versionKey: false });
sessionReviewSchema.index({ sessionId: 1 }, { unique: true });
sessionReviewSchema.index({ studentId: 1, createdAt: -1 });

export const SessionReview = mongoose.model('SessionReview', sessionReviewSchema);
