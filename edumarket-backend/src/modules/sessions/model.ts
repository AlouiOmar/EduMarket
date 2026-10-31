import mongoose, { Schema } from 'mongoose';

const sessionSchema = new Schema({
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  startAt: { type: Date, required: true }, endAt: { type: Date, required: true },
  type: { type: String, enum: ['online', 'in_person'], required: true },
  price: { type: Number, required: true, min: 0, max: 100000 },
  subject: { type: String, trim: true, maxlength: 160, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  venue: { type: String, trim: true, maxlength: 200, default: '' },
  status: { type: String, enum: ['available', 'pending', 'confirmed', 'rejected', 'completed', 'cancelled'], default: 'available', index: true },
  jitsiRoomId: { type: String, default: '' },
  paymentStatus: { type: String, enum: ['not_required', 'awaiting_payment', 'paid', 'refunded'], default: 'not_required' },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  reservationExpiresAt: { type: Date, default: null },
  googleEventIds: { type: Map, of: String, default: undefined },
  // IANA zone the times were entered in (display only; instants stay UTC). Absent on sessions created before the calendar.
  timeZone: { type: String, maxlength: 64, default: undefined },
  // 'teacher' when a teacher proposed this session to a student: the student, not the teacher, accepts or declines it.
  proposedBy: { type: String, enum: ['student', 'teacher'], default: undefined },
}, { timestamps: true, versionKey: false });
sessionSchema.index({ teacherId: 1, startAt: 1 }, { unique: true });
sessionSchema.index({ startAt: 1, endAt: 1 });
export const TutoringSession = mongoose.model('TutoringSession', sessionSchema);

const teacherScheduleLockSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });
export const TeacherScheduleLock = mongoose.model('TeacherScheduleLock', teacherScheduleLockSchema);
