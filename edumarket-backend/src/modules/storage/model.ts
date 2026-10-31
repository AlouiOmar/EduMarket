import { Schema, model } from 'mongoose';

/**
 * A Google Drive or OneDrive account paired by a teacher or an institution. Several accounts can be paired; the default
 * one receives new uploads and, when it is full, the next account with enough free space is used automatically.
 */
const storageAccountSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, enum: ['google_drive', 'onedrive'], required: true },
  accountEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  displayName: { type: String, trim: true, maxlength: 160, default: '' },
  // AES-256-GCM encrypted; never returned by the API.
  refreshToken: { type: String, required: true, select: false },
  folderId: { type: String, required: true, maxlength: 200 },
  quota: { total: { type: Number, default: null }, used: { type: Number, default: 0 }, checkedAt: { type: Date, default: null } },
  isDefault: { type: Boolean, default: false },
  status: { type: String, enum: ['connected', 'reconnect_required'], default: 'connected' },
  connectedAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false });
storageAccountSchema.index({ ownerId: 1, provider: 1, accountEmail: 1 }, { unique: true });
export const StorageAccount = model('StorageAccount', storageAccountSchema);
