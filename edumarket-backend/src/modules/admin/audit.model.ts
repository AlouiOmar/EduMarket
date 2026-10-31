import mongoose, { Schema } from 'mongoose';

const auditSchema = new Schema({
  action: { type: String, required: true, maxlength: 100 },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, required: true, maxlength: 80 },
  targetId: { type: String, required: true, maxlength: 100 },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
  ipAddress: { type: String, maxlength: 64, default: '' },
}, { timestamps: true, versionKey: false });
 auditSchema.index({ createdAt: -1 });
export const AuditEvent = mongoose.model('AuditEvent', auditSchema);
