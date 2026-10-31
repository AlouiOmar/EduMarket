import mongoose, { Schema } from 'mongoose';

/**
 * Archived publications of a content item: one record per published version (snapshot of the content fields as students saw
 * them). Version 0 is the legacy content that was live before the draft/publish lifecycle, archived on its first republication.
 * Records are append-only: restoring an old version copies it into the draft, it never rewrites history.
 */
const contentVersionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  itemId: { type: String, required: true, maxlength: 100 },
  version: { type: Number, required: true, min: 0 },
  title: { type: String, default: '', maxlength: 240 },
  snapshot: { type: Schema.Types.Mixed, required: true },
  quizId: { type: String, default: '' },
  publishedAt: { type: Date, required: true },
  publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // `scheduled`: published by the background job at the planned time; `legacy`: content live before versioning.
  origin: { type: String, enum: ['manual', 'scheduled', 'legacy', 'visibility'], default: 'manual' },
}, { timestamps: true, versionKey: false });
contentVersionSchema.index({ courseId: 1, itemId: 1, version: 1 }, { unique: true });
export const ContentVersion = mongoose.model('ContentVersion', contentVersionSchema);
