import mongoose, { Schema } from 'mongoose';

/** Imported SCORM packages (files extracted under the private storage area `scorm-packages/<packageId>/`) and learner attempts. */
const packageSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, maxlength: 200 },
  version: { type: String, enum: ['1.2', '2004'], required: true },
  identifier: { type: String, default: '', maxlength: 200 },
  launchPath: { type: String, required: true, maxlength: 1000 },
  fileCount: { type: Number, required: true },
  totalSize: { type: Number, required: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

const attemptSchema = new Schema({
  packageId: { type: Schema.Types.ObjectId, ref: 'ScormPackage', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  itemId: { type: String, required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Accepted runtime values only (see manifest.ts › validateCmi).
  cmi: { type: Schema.Types.Mixed, default: {} },
  completed: { type: Boolean, default: false },
  passed: { type: Boolean, default: null },
  scorePercent: { type: Number, default: null },
  sessions: { type: Number, default: 0 },
  lastCommitAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false, minimize: false });
attemptSchema.index({ packageId: 1, itemId: 1, studentId: 1 }, { unique: true });

export const ScormPackage = mongoose.model('ScormPackage', packageSchema);
export const ScormAttempt = mongoose.model('ScormAttempt', attemptSchema);
