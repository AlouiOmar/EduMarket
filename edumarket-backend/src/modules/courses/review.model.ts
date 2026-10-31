import { Schema, model } from 'mongoose';

const reviewSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, trim: true, minlength: 10, maxlength: 3000, required: true },
  status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true },
  // Public answer from the course owner/manager.
  reply: { body: { type: String, trim: true, maxlength: 2000 }, authorId: { type: Schema.Types.ObjectId, ref: 'User' }, repliedAt: { type: Date } },
}, { timestamps: true, versionKey: false });
reviewSchema.index({ courseId: 1, studentId: 1 }, { unique: true });
export const CourseReview = model('CourseReview', reviewSchema);
