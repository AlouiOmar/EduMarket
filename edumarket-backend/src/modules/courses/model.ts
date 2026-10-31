import mongoose, { Schema } from 'mongoose';

const courseSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  subtitle: { type: String, default: '', maxlength: 240 },
  description: { type: String, required: true, maxlength: 12000 },
  category: { type: String, required: true, maxlength: 100 },
  level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  price: { type: Number, min: 0, default: 0 },
  rating: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 },
  studentsCount: { type: Number, min: 0, default: 0 },
  tags: { type: [String], default: [] },
  // Course outline (two levels): containers (learning modules or folders) holding content items (`lessons`, kept as Mixed).
  // The array order is the persisted position; `order` mirrors it. A missing visibility means "visible" (content created before
  // per-item publication). Structural writes go through structure.routes.ts and bump `structureVersion` (optimistic locking).
  chapters: { type: [{
    id: String, title: String, order: Number, lessons: [Schema.Types.Mixed],
    kind: { type: String, enum: ['module', 'folder'], default: 'module' },
    description: { type: String, default: '', maxlength: 4000 },
    visibility: { type: String, enum: ['hidden', 'visible'] },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    // Sequential modules unlock each item once the previous one is completed.
    sequential: { type: Boolean, default: false },
    thumbnail: { assetId: { type: String, default: '' }, alt: { type: String, default: '', maxlength: 300 } },
  }], default: [] },
  structureVersion: { type: Number, min: 0, default: 0 },
  courseCode: { type: String, trim: true, maxlength: 40, default: '' },
  // Teaching access, independent from catalogue moderation: private hides the content from students, completed makes it read-only.
  accessState: { type: String, enum: ['open', 'private', 'completed'], default: 'open' },
  settings: {
    language: { type: String, enum: ['fr', 'en', 'ar'], default: 'fr' },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    notifyStudents: { type: Boolean, default: true },
    // IANA time zone used to read local dates typed by teachers (publication, availability). Null: dates are sent as UTC instants.
    timezone: { type: String, maxlength: 64, default: null },
  },
  banner: { assetId: { type: String, default: '' }, alt: { type: String, default: '', maxlength: 300 } },
  // Course programme (sessions); feeds the calendar of enrolled students.
  syllabus: { type: [{ _id: false, id: String, title: { type: String, maxlength: 240 }, description: { type: String, maxlength: 2000, default: '' }, startsAt: Date, durationMinutes: { type: Number, min: 0, max: 1440, default: 90 } }], default: [] },
  copiedFrom: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
  // Templates ("modèles") produce independent class instances; an instance keeps the link used to compare and pull template changes.
  isTemplate: { type: Boolean, default: false, index: true },
  templateLink: { type: Schema.Types.Mixed, default: undefined },
  hasCertification: { type: Boolean, default: false },
  certificationPathway: { type: String, enum: ['learning_and_quiz', 'online_exam', 'in_person_exam', 'both'], default: 'learning_and_quiz' },
  prerequisites: { type: [String], default: [] },
  learningOutcomes: { type: [String], default: [] },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Verified teachers who co-author the course. Sales stay credited to the primary owner (teacherId).
  coOwnerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
  // `restricted`: hidden from the public catalogue, opened only to members of the classes the course is assigned to.
  visibility: { type: String, enum: ['public', 'restricted'], default: 'public', index: true },
  status: { type: String, enum: ['draft', 'pending_review', 'published', 'rejected', 'suspended'], default: 'draft', index: true },
  review: {
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
  },
}, { timestamps: true, versionKey: false });
courseSchema.index({ title: 'text', subtitle: 'text', description: 'text' });
export const Course = mongoose.model('Course', courseSchema);
