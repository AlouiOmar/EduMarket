import mongoose, { Schema } from 'mongoose';

/**
 * Assessments of a course: question banks ("séries de questions"), tests built from fixed or randomly drawn questions,
 * rubrics reusable by assignments, and forms (surveys, optionally anonymous, never graded).
 *
 * Integrity: an attempt stores a snapshot of the questions it was given (prompt, options, answer key, points). Editing or deleting
 * a bank question afterwards never changes past attempts, their answers or their scores.
 */
export const QUESTION_TYPES = ['single', 'multiple', 'true_false', 'short', 'essay'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

const bankSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  copiedFrom: { type: Schema.Types.ObjectId, ref: 'QuestionBank', default: null },
}, { timestamps: true, versionKey: false });

const optionSchema = new Schema({ id: { type: String, required: true, maxlength: 40 }, text: { type: String, required: true, maxlength: 1000 } }, { _id: false });
const questionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  bankId: { type: Schema.Types.ObjectId, ref: 'QuestionBank', required: true, index: true },
  type: { type: String, enum: QUESTION_TYPES, required: true },
  prompt: { type: String, required: true, maxlength: 20000 },
  options: { type: [optionSchema], default: [] },
  // single / multiple: ids of the correct options; true_false: ['true'] or ['false']; short: accepted answers.
  correct: { type: [String], default: [] },
  caseSensitive: { type: Boolean, default: false },
  points: { type: Number, min: 0, max: 1000, default: 1 },
  chapter: { type: String, trim: true, default: '', maxlength: 120 },
  difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
  explanation: { type: String, default: '', maxlength: 4000 },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
questionSchema.index({ bankId: 1, chapter: 1, difficulty: 1 });

const sectionSchema = new Schema({
  kind: { type: String, enum: ['fixed', 'random'], required: true },
  questionIds: { type: [Schema.Types.ObjectId], default: [] },
  bankId: { type: Schema.Types.ObjectId, ref: 'QuestionBank', default: null },
  count: { type: Number, min: 1, max: 200, default: 1 },
  chapter: { type: String, default: '', maxlength: 120 },
  difficulty: { type: String, enum: ['', ...DIFFICULTIES], default: '' },
}, { _id: false });
const testSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  instructions: { type: String, default: '', maxlength: 20000 },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft', index: true },
  availableFrom: { type: Date, default: null },
  availableUntil: { type: Date, default: null },
  timeLimitMinutes: { type: Number, min: 0, max: 600, default: 0 },
  maxAttempts: { type: Number, min: 1, max: 20, default: 1 },
  shuffleQuestions: { type: Boolean, default: false },
  shuffleOptions: { type: Boolean, default: false },
  sections: { type: [sectionSchema], default: [] },
  // Grade kept in the gradebook when several attempts are allowed.
  gradePolicy: { type: String, enum: ['best', 'last'], default: 'best' },
  // Correct answers are shown to the student only once the grade is published and this option is on.
  showCorrectAnswers: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

const snapshotSchema = new Schema({
  questionId: { type: String, required: true }, type: { type: String, enum: QUESTION_TYPES, required: true }, prompt: String,
  options: { type: [optionSchema], default: [] }, correct: { type: [String], default: [] }, caseSensitive: Boolean, points: Number, explanation: String,
}, { _id: false });
const answerSchema = new Schema({ questionId: { type: String, required: true }, optionIds: { type: [String], default: [] }, text: { type: String, default: '', maxlength: 20000 }, savedAt: Date }, { _id: false });
const manualSchema = new Schema({ questionId: { type: String, required: true }, score: { type: Number, min: 0 }, feedback: { type: String, default: '', maxlength: 4000 } }, { _id: false });
const attemptSchema = new Schema({
  testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  number: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['in_progress', 'needs_grading', 'graded'], default: 'in_progress' },
  startedAt: { type: Date, required: true },
  deadlineAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  autoSubmitted: { type: Boolean, default: false },
  questions: { type: [snapshotSchema], default: [] },
  answers: { type: [answerSchema], default: [] },
  autoScores: { type: [{ _id: false, questionId: String, score: Number }], default: [] },
  manual: { type: [manualSchema], default: [] },
  score: { type: Number, default: null },
  maxScore: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });
attemptSchema.index({ testId: 1, studentId: 1, number: 1 }, { unique: true });
// At most one attempt in progress per student and test (resume instead of restarting).
attemptSchema.index({ testId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { status: 'in_progress' } });

const levelSchema = new Schema({ id: { type: String, required: true }, title: { type: String, required: true, maxlength: 200 }, points: { type: Number, min: 0, max: 1000, required: true }, description: { type: String, default: '', maxlength: 2000 } }, { _id: false });
const criterionSchema = new Schema({ id: { type: String, required: true }, title: { type: String, required: true, maxlength: 200 }, description: { type: String, default: '', maxlength: 2000 }, levels: { type: [levelSchema], default: [] } }, { _id: false });
const rubricSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  criteria: { type: [criterionSchema], default: [] },
  visibleToStudents: { type: Boolean, default: true },
  copiedFrom: { type: Schema.Types.ObjectId, ref: 'Rubric', default: null },
}, { timestamps: true, versionKey: false });

const formQuestionSchema = new Schema({
  id: { type: String, required: true }, type: { type: String, enum: ['single', 'multiple', 'text', 'scale'], required: true },
  prompt: { type: String, required: true, maxlength: 2000 }, options: { type: [String], default: [] }, required: { type: Boolean, default: false },
}, { _id: false });
const formSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 4000 },
  questions: { type: [formQuestionSchema], default: [] },
  anonymous: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
  availableFrom: { type: Date, default: null },
  availableUntil: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
const formResponseSchema = new Schema({
  formId: { type: Schema.Types.ObjectId, ref: 'Form', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  // Anonymous forms never store the respondent: only a keyed hash that prevents answering twice.
  respondentId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  respondentKey: { type: String, required: true },
  answers: { type: [{ _id: false, questionId: String, values: [String] }], default: [] },
}, { timestamps: true, versionKey: false });
formResponseSchema.index({ formId: 1, respondentKey: 1 }, { unique: true });

export const QuestionBank = mongoose.model('QuestionBank', bankSchema);
export const BankQuestion = mongoose.model('BankQuestion', questionSchema);
export const Test = mongoose.model('Test', testSchema);
export const TestAttempt = mongoose.model('TestAttempt', attemptSchema);
export const Rubric = mongoose.model('Rubric', rubricSchema);
export const Form = mongoose.model('Form', formSchema);
export const FormResponse = mongoose.model('FormResponse', formResponseSchema);
