import mongoose, { Schema } from 'mongoose';

/** Result of the last external link check of a course (on demand, or yearly by the background job). */
const linkReportSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, unique: true },
  checkedAt: { type: Date, required: true },
  trigger: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
  results: { type: [{ _id: false, url: String, status: String, httpStatus: Number, finalUrl: String, error: String, locations: [{ _id: false, itemId: String, title: String, containerTitle: String }] }], default: [] },
  truncated: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false });
export const LinkReport = mongoose.model('LinkReport', linkReportSchema);
