import mongoose, { Schema } from 'mongoose';

/**
 * Course gradebook ("Carnet de notes").
 *
 * Categories carry a relative weight; columns belong to a category and may be linked to a graded activity (assignment, lesson
 * quiz, test, discussion, journal, SCORM package, AI conversation). Entries hold the working grade and, separately, the
 * published grade: students only ever see `published`, so a correction stays private until the teacher publishes it again.
 */
const categorySchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  // Relative weight (normalized over the categories that have at least one counted grade).
  weight: { type: Number, min: 0, max: 1000, default: 1 },
  order: { type: Number, default: 0 },
  key: { type: String, default: '', maxlength: 40 },
}, { timestamps: true, versionKey: false });
categorySchema.index({ courseId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $gt: '' } } });

export const SOURCE_KINDS = ['manual', 'assignment', 'lesson_quiz', 'test', 'discussion', 'journal', 'scorm', 'ai_conversation', 'lti'] as const;
const columnSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'GradeCategory', required: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  maxPoints: { type: Number, required: true, min: 0.01, max: 10000 },
  source: { kind: { type: String, enum: SOURCE_KINDS, default: 'manual' }, refId: { type: String, default: '', maxlength: 100 } },
  dueAt: { type: Date, default: null },
  countsInFinal: { type: Boolean, default: true },
  // Missing grades are excluded from averages unless the teacher explicitly counts them as 0 after the due date.
  missingAsZero: { type: Boolean, default: false },
  // `manual`: grades are published by the teacher (default); `auto`: automatically graded results are published at once.
  releaseMode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  order: { type: Number, default: 0 },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
columnSchema.index({ courseId: 1, 'source.kind': 1, 'source.refId': 1 }, { unique: true, partialFilterExpression: { 'source.refId': { $gt: '' } } });

const publishedSchema = new Schema({ score: { type: Number, default: null }, feedback: { type: String, default: '' }, excused: { type: Boolean, default: false }, at: { type: Date } }, { _id: false });
const entrySchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  columnId: { type: Schema.Types.ObjectId, ref: 'GradeColumn', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // null = no grade yet (never confused with 0).
  score: { type: Number, default: null, min: 0 },
  // `pending`: work submitted, awaiting grading. `graded`: grade set, not published (or changed since publication).
  status: { type: String, enum: ['not_graded', 'pending', 'graded', 'published'], default: 'not_graded' },
  feedback: { type: String, default: '', maxlength: 4000 },
  excused: { type: Boolean, default: false },
  // Individual exceptions: extended due date and extra attempts for this student.
  exception: { dueAt: { type: Date, default: null }, extraAttempts: { type: Number, min: 0, max: 20, default: 0 } },
  published: { type: publishedSchema, default: null },
  gradedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  gradedAt: { type: Date, default: null },
  // Set when a teacher overrides a grade synchronized from an activity; later synchronizations keep the override.
  overridden: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false });
entrySchema.index({ columnId: 1, studentId: 1 }, { unique: true });
entrySchema.index({ courseId: 1, studentId: 1 });

export const GradeCategory = mongoose.model('GradeCategory', categorySchema);
export const GradeColumn = mongoose.model('GradeColumn', columnSchema);
export const GradeEntry = mongoose.model('GradeEntry', entrySchema);
