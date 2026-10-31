import { Schema, model } from 'mongoose';

const assignmentSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 180 },
  instructions: { type: String, required: true, trim: true, minlength: 5, maxlength: 12000 },
  dueAt: { type: Date, required: true },
  points: { type: Number, required: true, min: 1, max: 1000, default: 100 },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'published', index: true },
  // Late work: accepted until `lateUntil` (null = refused after the due date), with a flat penalty applied when grading.
  lateUntil: { type: Date, default: null },
  latePenaltyPercent: { type: Number, min: 0, max: 100, default: 0 },
  // 0 = legacy behaviour (resubmission replaces the work until it is graded); n > 0 = n attempts, history kept, regrading allowed.
  maxAttempts: { type: Number, min: 0, max: 20, default: 0 },
  rubricId: { type: Schema.Types.ObjectId, ref: 'Rubric', default: null },
  allowLinks: { type: Boolean, default: true },
  // Instruction attachments: course files (uploaded through the course media endpoint), downloadable by enrolled students.
  attachments: { type: [{ _id: false, assetId: String, name: String }], default: [] },
}, { timestamps: true, versionKey: false });
assignmentSchema.index({ courseId: 1, status: 1, dueAt: 1 });

const assignmentFileSchema = new Schema({
  originalName: { type: String, required: true, maxlength: 180 },
  storageKey: { type: String, required: true, match: /^[a-f0-9-]{36}\.(pdf|zip|docx)$/ },
  mimeType: { type: String, enum: ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], required: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
  uploadedAt: { type: Date, required: true, default: Date.now },
});

const submissionSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  answerText: { type: String, trim: true, maxlength: 12000, default: '' },
  files: { type: [assignmentFileSchema], default: [] },
  status: { type: String, enum: ['submitted', 'graded'], default: 'submitted', index: true },
  submittedAt: { type: Date, default: Date.now },
  score: { type: Number, min: 0 },
  feedback: { type: String, trim: true, maxlength: 4000, default: '' },
  gradedAt: { type: Date },
  graderId: { type: Schema.Types.ObjectId, ref: 'User' },
  links: { type: [{ type: String, maxlength: 2000 }], default: [], validate: (links: unknown[]) => links.length <= 5 },
  late: { type: Boolean, default: false },
  attemptCount: { type: Number, min: 1, default: 1 },
  // Previous attempts (multi-attempt assignments): what was submitted and how it was graded.
  history: { type: [{ _id: false, answerText: String, links: [String], files: [assignmentFileSchema], submittedAt: Date, late: Boolean, score: Number, feedback: String }], default: [] },
  rubricRatings: { type: [{ _id: false, criterionId: String, levelId: String }], default: [] },
  rawScore: { type: Number, min: 0 },
  penaltyPercent: { type: Number, min: 0, max: 100, default: 0 },
}, { timestamps: true, versionKey: false });
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ studentId: 1, submittedAt: -1 });

export const Assignment = model('Assignment', assignmentSchema);
export const AssignmentSubmission = model('AssignmentSubmission', submissionSchema);
