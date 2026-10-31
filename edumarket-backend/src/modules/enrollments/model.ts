import mongoose, { Schema } from 'mongoose';

const enrollmentSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  completedLessonIds: { type: [String], default: [] },
  enrolledAt: { type: Date, default: Date.now },
  lastAccessedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  // How access was obtained; subscription access ends with the subscription period (null = permanent access).
  // `class`: granted by membership of a class the course is assigned to; expired (not deleted) when membership ends.
  accessType: { type: String, enum: ['free', 'purchase', 'subscription', 'class'], default: 'purchase' },
  accessExpiresAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

/** Filter fragment for enrollments that currently grant access (permanent, or subscription period not yet ended). */
export const activeAccess = <T extends Record<string, unknown>>(filter: T) => ({ ...filter, $or: [{ accessExpiresAt: null }, { accessExpiresAt: { $gt: new Date() } }] });
