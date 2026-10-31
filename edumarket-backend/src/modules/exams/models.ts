import { Schema, model } from 'mongoose';

const questionSchema = new Schema({ id: { type: String, required: true }, question: { type: String, required: true }, options: [{ type: String, required: true }], correctOptionIndex: { type: Number, required: true }, explanation: { type: String, default: '' } }, { _id: false });
const examSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, required: true, maxlength: 4000 },
  type: { type: String, enum: ['online', 'in_person'], required: true },
  fee: { type: Number, min: 0, max: 100000, default: 0 },
  durationMinutes: { type: Number, min: 1, max: 360, required: true },
  passPercentage: { type: Number, min: 0, max: 100, required: true },
  date: { type: Date },
  location: { venue: { type: String, maxlength: 200 }, address: { type: String, maxlength: 300 }, city: { type: String, maxlength: 100 }, capacity: { type: Number, min: 1 } },
  registeredCount: { type: Number, min: 0, default: 0 },
  questions: { type: [questionSchema], default: [] },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
}, { timestamps: true, versionKey: false });

const examRegistrationSchema = new Schema({ examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true }, studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, registeredAt: { type: Date, default: Date.now } }, { versionKey: false });
examRegistrationSchema.index({ examId: 1, studentId: 1 }, { unique: true });

const examAttemptSchema = new Schema({ examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true }, studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, startedAt: { type: Date, required: true }, submittedAt: { type: Date }, answers: [{ questionId: String, selectedOptionIndex: Number }], score: { type: Number }, passed: { type: Boolean } }, { timestamps: true, versionKey: false });
examAttemptSchema.index({ examId: 1, studentId: 1 }, { unique: true });
const inPersonResultSchema = new Schema({ examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true }, studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, score: { type: Number, min: 0, max: 100, required: true }, passed: { type: Boolean, required: true }, feedback: { type: String, maxlength: 2000, default: '' }, gradedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, gradedAt: { type: Date, required: true } }, { timestamps: true, versionKey: false });
inPersonResultSchema.index({ examId: 1, studentId: 1 }, { unique: true });

export const Exam = model('Exam', examSchema);
export const ExamRegistration = model('ExamRegistration', examRegistrationSchema);
export const ExamAttempt = model('ExamAttempt', examAttemptSchema);
export const InPersonExamResult = model('InPersonExamResult', inPersonResultSchema);
