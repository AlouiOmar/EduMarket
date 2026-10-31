import mongoose, { Schema } from 'mongoose';

/**
 * Application file of an independent teacher. The account itself stays the existing `User` (same authentication, role
 * `unverified_teacher` while applying); approval writes the existing teacher fields of that user (role, verified,
 * teacherVerification), so every server-side teacher check applies unchanged. Institutional teachers never have one.
 */
export const APPLICATION_STATUSES = ['draft', 'submitted', 'under_review', 'additional_information_required', 'resubmitted', 'approved', 'rejected', 'suspended'] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const DOCUMENT_TYPES = ['identity', 'cv', 'diploma', 'work_certificate', 'experience_certificate', 'professional_certification', 'training_certificate', 'portfolio', 'other'] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export const DOCUMENT_STATUSES = ['pending_review', 'verified', 'rejected', 'replacement_requested'] as const;
export const IDENTITY_DOCUMENT_TYPES = ['national_id', 'passport', 'residence_permit', 'driving_licence', 'other_official'] as const;

const text = (max: number) => ({ type: String, trim: true, maxlength: max, default: '' });

const degreeSchema = new Schema({
  level: { type: String, enum: ['', 'secondary', 'bachelor', 'master', 'doctorate', 'engineering', 'professional', 'other'], default: '' },
  title: text(200), specialty: text(160), institution: text(200), country: text(2), year: { type: Number, min: 1950, max: 2100, default: null },
  highest: { type: Boolean, default: false },
}, { _id: true });
const certificationSchema = new Schema({ name: text(200), issuer: text(200), year: { type: Number, min: 1950, max: 2100, default: null }, kind: { type: String, enum: ['certification', 'training'], default: 'certification' } }, { _id: true });
const experienceSchema = new Schema({
  kind: { type: String, enum: ['professional', 'teaching'], default: 'professional' },
  title: text(160), organization: text(200), startDate: { type: Date, default: null }, endDate: { type: Date, default: null }, current: { type: Boolean, default: false }, description: text(2000),
}, { _id: true });

const reviewSchema = new Schema({
  status: { type: String, enum: DOCUMENT_STATUSES, required: true },
  // Shown to the candidate (reason of a refusal or of a replacement request).
  comment: text(1000),
  by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, required: true },
}, { _id: false });
const documentSchema = new Schema({
  type: { type: String, enum: DOCUMENT_TYPES, required: true },
  degreeId: { type: Schema.Types.ObjectId, default: null },
  originalName: { type: String, required: true, maxlength: 180 },
  storageKey: { type: String, required: true, match: /^[a-f0-9]{32}\.(pdf|png|jpg)$/ },
  mimeType: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg'], required: true },
  size: { type: Number, required: true, min: 1 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  uploadedAt: { type: Date, required: true },
  status: { type: String, enum: DOCUMENT_STATUSES, default: 'pending_review' },
  adminComment: text(1000),
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviews: { type: [reviewSchema], default: [] },
  // A replaced document stays in the file (verification history) but no longer counts; `replacedBy` points to its successor.
  replacedBy: { type: Schema.Types.ObjectId, default: null },
  // Set when the retention job removed the file itself (metadata kept).
  purgedAt: { type: Date, default: null },
}, { _id: true });

const historySchema = new Schema({
  at: { type: Date, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, enum: ['candidate', 'admin', 'system'], required: true },
  action: { type: String, required: true, maxlength: 80 },
  from: { type: String, default: null }, to: { type: String, default: null },
  // Candidate-facing explanation (never an internal note).
  message: text(2000),
}, { _id: false });
const requestSchema = new Schema({
  at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  items: { type: [String], default: [] },
  resolvedAt: { type: Date, default: null },
}, { _id: true });
const internalNoteSchema = new Schema({ at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', required: true }, text: { type: String, required: true, trim: true, maxlength: 2000 } }, { _id: true });

const applicationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reference: { type: String, default: null },
  status: { type: String, enum: APPLICATION_STATUSES, default: 'draft', index: true },
  // Optimistic concurrency: every write states the revision it read.
  revision: { type: Number, default: 0, min: 0 },
  personal: {
    firstName: text(60), lastName: text(60), phone: text(32), country: text(2), city: text(100), preferredLanguage: { type: String, enum: ['fr', 'en', 'ar'], default: 'fr' },
    birthDate: { type: Date, default: null }, nationality: text(2), address: text(300),
  },
  identity: {
    documentType: { type: String, enum: ['', ...IDENTITY_DOCUMENT_TYPES], default: '' },
    // AES-256-GCM ciphertext; only the last characters are kept in clear for display.
    documentNumberEncrypted: { type: String, default: '', select: false },
    documentNumberLast4: { type: String, maxlength: 4, default: '' },
    issuingCountry: text(2), issuingAuthority: text(160), issuedAt: { type: Date, default: null }, expiresAt: { type: Date, default: null },
  },
  academic: { degrees: { type: [degreeSchema], default: [] }, certifications: { type: [certificationSchema], default: [] } },
  professional: {
    headline: text(160), bio: text(4000), specialties: { type: [String], default: [] }, expertise: { type: [String], default: [] }, subjects: { type: [String], default: [] },
    teachingLanguages: { type: [String], default: [] }, yearsOfExperience: { type: Number, min: 0, max: 70, default: null },
    experiences: { type: [experienceSchema], default: [] }, skills: { type: [String], default: [] }, portfolioUrl: text(500), linkedinUrl: text(500),
  },
  documents: { type: [documentSchema], default: [] },
  requests: { type: [requestSchema], default: [] },
  history: { type: [historySchema], default: [] },
  internalNotes: { type: [internalNoteSchema], default: [], select: false },
  termsAcceptedAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  lastSubmittedAt: { type: Date, default: null },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  decisionAt: { type: Date, default: null },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // Candidate-facing reason of a refusal or a suspension.
  decisionReason: text(2000),
  // Refusal category (internal statistics) — not shown in public responses.
  decisionCategory: { type: String, enum: ['', 'incomplete', 'unverifiable', 'insufficient_qualification', 'policy', 'other'], default: '' },
  // Previous refused application of the same account (new application after the waiting period).
  previousApplicationId: { type: Schema.Types.ObjectId, default: null },
  purgedAt: { type: Date, default: null },
  // True for the account's current application; false once refused (kept as history), so a new one can start later.
  open: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false });
applicationSchema.index({ reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: 'string' } } });
// One open application per account (refused or purged ones are kept as history).
applicationSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true } });
applicationSchema.index({ status: 1, submittedAt: -1 });
applicationSchema.index({ userId: 1, createdAt: -1 });
applicationSchema.index({ 'personal.country': 1 });

export const TeacherApplication = mongoose.model('TeacherApplication', applicationSchema);
