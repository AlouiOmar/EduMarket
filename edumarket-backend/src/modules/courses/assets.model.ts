import mongoose, { Schema } from 'mongoose';

/**
 * Files attached to a course. `video`/`resource` belong to a lesson (legacy lesson media); the block kinds are referenced by id
 * from lesson blocks, module thumbnails or the course banner, so they may be shared by duplicated items of the same course.
 */
export const COURSE_ASSET_KINDS = ['video', 'resource', 'image', 'block_video', 'block_file', 'caption'] as const;
export const COURSE_ASSET_MIME_TYPES = ['video/mp4', 'video/webm', 'application/pdf', 'application/zip', 'application/x-zip-compressed', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/vtt'] as const;
export const COURSE_ASSET_KEY = /^[a-f0-9-]{36}\.(mp4|webm|pdf|zip|png|jpg|webp|gif|vtt)$/;

const courseAssetSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  // Empty for block, thumbnail and banner assets.
  lessonId: { type: String, maxlength: 100, default: '' },
  kind: { type: String, enum: COURSE_ASSET_KINDS, required: true },
  originalName: { type: String, required: true, maxlength: 180 },
  // Local private storage key; empty when the file lives on the uploader's Google Drive / OneDrive (`storage`).
  storageKey: { type: String, required: function (this: any) { return !this.storage?.provider || this.storage.provider === 'local'; }, match: COURSE_ASSET_KEY },
  storage: {
    provider: { type: String, enum: ['local', 'google_drive', 'onedrive'], default: 'local' },
    accountId: { type: Schema.Types.ObjectId, ref: 'StorageAccount', default: null, index: true },
    fileId: { type: String, maxlength: 300, default: '' },
  },
  mimeType: { type: String, enum: COURSE_ASSET_MIME_TYPES, required: true },
  size: { type: Number, required: true, min: 1, max: 250 * 1024 * 1024 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Unused file set aside by an author; deleted by the purge job only if still unused after the delay.
  quarantinedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

courseAssetSchema.index({ courseId: 1, lessonId: 1, kind: 1 });
courseAssetSchema.index({ courseId: 1, lessonId: 1 }, { unique: true, partialFilterExpression: { kind: 'video' } });

export const CourseAsset = mongoose.model('CourseAsset', courseAssetSchema);
