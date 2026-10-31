import mongoose, { Schema } from 'mongoose';

const quizAttemptSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  lessonId: { type: String, required: true },
  quizId: { type: String, required: true },
  answers: { type: [{ questionId: String, selectedOptionIndex: Number }], default: [] },
  score: { type: Number, min: 0, max: 100, required: true },
  passed: { type: Boolean, required: true, index: true },
  correctCount: { type: Number, min: 0, required: true },
  totalQuestions: { type: Number, min: 1, required: true },
}, { timestamps: true, versionKey: false });

quizAttemptSchema.index({ studentId: 1, courseId: 1, lessonId: 1, createdAt: -1 });

export const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);
