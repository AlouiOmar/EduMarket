import mongoose, { Schema } from 'mongoose';

const lessonActivitySchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  lessonId: { type: String, required: true },
  completedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, versionKey: false });
lessonActivitySchema.index({ studentId: 1, courseId: 1, lessonId: 1 }, { unique: true });
lessonActivitySchema.index({ studentId: 1, completedAt: -1 });

export const LessonActivity = mongoose.model('LessonActivity', lessonActivitySchema);
