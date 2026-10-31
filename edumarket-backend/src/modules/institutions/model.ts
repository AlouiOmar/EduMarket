import { Schema, model } from 'mongoose';

const invitationSchema = new Schema({
  institutionId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'ended'], default: 'pending', index: true },
  revenueSharePercent: { type: Number, min: 0, max: 50, default: 0 },
  endedAt: { type: Date },
  respondedAt: { type: Date },
}, { timestamps: true, versionKey: false });
invitationSchema.index({ institutionId: 1, teacherId: 1 }, { unique: true });
export const InstitutionInvitation = model('InstitutionInvitation', invitationSchema);
