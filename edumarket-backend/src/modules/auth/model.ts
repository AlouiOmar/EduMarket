import mongoose, { Schema } from 'mongoose';
import type { Role } from '../../common/auth.js';

export interface UserRecord {
  name: string; email: string; passwordHash: string; role: Role; verified: boolean; emailVerified: boolean;
  emailVerificationTokenHash?: string; emailVerificationExpiresAt?: Date;
  passwordResetTokenHash?: string; passwordResetExpiresAt?: Date;
  headline: string; bio: string; phone: string;
  institutionId?: mongoose.Types.ObjectId;
  institutionRevenueShare: number;
  institutionRole: 'teacher' | 'coordinator' | 'examiner';
  teacherType?: 'independent' | 'institutional';
  favoriteCourseIds: mongoose.Types.ObjectId[];
  authVersion: number;
  notificationPreferences: { sessions: boolean; messages: boolean; courseActivity: boolean; email: boolean };
  status: 'active' | 'suspended' | 'pending';
  googleCalendar?: { refreshToken: string; connectedAt: Date };
  teacherVerification?: { specialty: string; registrationNumber: string; credentialsSummary: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; submittedAt: Date; reviewedAt?: Date; reviewedBy?: mongoose.Types.ObjectId; reviewNote: string; documents: { _id?: mongoose.Types.ObjectId; originalName: string; storageKey: string; mimeType: string; size: number; uploadedAt: Date }[] };
  createdAt: Date; updatedAt: Date;
}

const teacherEvidenceDocumentSchema = new Schema({
  originalName: { type: String, required: true, maxlength: 180 },
  storageKey: { type: String, required: true, match: /^[a-f0-9-]{36}\.(pdf|png|jpg)$/ },
  mimeType: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg'], required: true },
  size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  uploadedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: false });

const teacherVerificationSchema = new Schema({
  specialty: { type: String, required: true, trim: true, maxlength: 160 },
  registrationNumber: { type: String, trim: true, maxlength: 80, default: '' },
  credentialsSummary: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], required: true },
  submittedAt: { type: Date, required: true },
  reviewedAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
  documents: { type: [teacherEvidenceDocumentSchema], default: [] },
}, { _id: false });

const userSchema = new Schema<UserRecord>({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  headline: { type: String, trim: true, maxlength: 160, default: '' },
  bio: { type: String, trim: true, maxlength: 2000, default: '' },
  phone: { type: String, trim: true, maxlength: 32, default: '' },
  institutionId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  // Percentage of an affiliated teacher's seller amount credited to the institution (agreed in the accepted invitation).
  institutionRevenueShare: { type: Number, min: 0, max: 50, default: 0 },
  // Internal role granted by the institution: coordinators co-manage institution courses, examiners grade institution exams.
  institutionRole: { type: String, enum: ['teacher', 'coordinator', 'examiner'], default: 'teacher' },
  // `independent`: approved through an EduMarket teacher application; `institutional`: managed by an institution. Set by the server only.
  teacherType: { type: String, enum: ['independent', 'institutional'], default: undefined },
  favoriteCourseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Course' }], default: [] },
  authVersion: { type: Number, min: 0, default: 0 },
  notificationPreferences: {
    sessions: { type: Boolean, default: true },
    messages: { type: Boolean, default: true },
    courseActivity: { type: Boolean, default: true },
    // E-mail copies of in-app notifications are opt-in.
    email: { type: Boolean, default: false },
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'], default: 'student' },
  verified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: true },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: { type: Date, select: false },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  status: { type: String, enum: ['active', 'pending', 'suspended'], default: 'active' },
  teacherVerification: { type: teacherVerificationSchema, default: undefined },
  googleCalendar: {
    type: new Schema({ refreshToken: { type: String, required: true }, connectedAt: { type: Date, required: true } }, { _id: false }),
    default: undefined, select: false,
  },
}, { timestamps: true, versionKey: false });

export const User = mongoose.model<UserRecord>('User', userSchema);
