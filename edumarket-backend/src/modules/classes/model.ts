import { Schema, model } from 'mongoose';

/**
 * A class (group of students) owned by a teacher or an institution. Courses assigned to a class are opened to its
 * members without payment; courses marked `restricted` are only visible to the members of the classes they are assigned to
 * (e.g. "3rd year engineering" only sees 3rd-year material).
 */
const classGroupSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerRole: { type: String, enum: ['teacher', 'institution'], required: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  level: { type: String, trim: true, maxlength: 80, default: '' },
  academicYear: { type: String, trim: true, maxlength: 20, default: '' },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  studentIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], validate: (ids: unknown[]) => ids.length <= 500 },
  courseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Course' }], default: [], validate: (ids: unknown[]) => ids.length <= 100 },
  joinCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
  joinEnabled: { type: Boolean, default: true },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
classGroupSchema.index({ studentIds: 1, archivedAt: 1 });
classGroupSchema.index({ courseIds: 1, archivedAt: 1 });
export const ClassGroup = model('ClassGroup', classGroupSchema);
