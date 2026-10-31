import { Schema, model } from 'mongoose';

const profileSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, required: true, trim: true, minlength: 30, maxlength: 4000 },
  country: { type: String, required: true, trim: true, maxlength: 100 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  website: { type: String, trim: true, maxlength: 300, default: '' },
  contactEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  logo: { type: String, trim: true, maxlength: 1000, default: '' },
  banner: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
}, { timestamps: true, versionKey: false });

export const InstitutionProfile = model('InstitutionProfile', profileSchema);
