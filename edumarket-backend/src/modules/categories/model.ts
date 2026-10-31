import { Schema, model } from 'mongoose';

/** Admin-managed catalogue taxonomy. Courses store the category slug; labels are localized per UI language. */
const categorySchema = new Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 80 },
  names: {
    fr: { type: String, required: true, trim: true, maxlength: 100 },
    en: { type: String, required: true, trim: true, maxlength: 100 },
    ar: { type: String, required: true, trim: true, maxlength: 100 },
  },
  active: { type: Boolean, default: true, index: true },
  order: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });

export const Category = model('Category', categorySchema);
