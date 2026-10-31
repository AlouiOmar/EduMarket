import { Schema, model } from 'mongoose';

const certificateSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  issuedAt: { type: Date, required: true, default: Date.now },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, trim: true, maxlength: 500, default: '' },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });
certificateSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
export const Certificate = model('Certificate', certificateSchema);
