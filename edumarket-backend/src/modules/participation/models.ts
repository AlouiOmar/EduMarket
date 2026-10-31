import mongoose, { Schema } from 'mongoose';

/**
 * Participation and communication inside a course: groups (with their own files and discussions), discussions, private journals,
 * announcements (immediate or scheduled, deduplicated deliveries) and attendance.
 */
const groupSetSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  // manual: the teacher assigns; random: members drawn at creation; self: students join a group while sign-up is open.
  mode: { type: String, enum: ['manual', 'random', 'self'], default: 'manual' },
  maxMembers: { type: Number, min: 1, max: 200, default: 5 },
  selfSignupOpen: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false });

const groupSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  setId: { type: Schema.Types.ObjectId, ref: 'CourseGroupSet', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  memberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
}, { timestamps: true, versionKey: false });
groupSchema.index({ courseId: 1, memberIds: 1 });

const groupFileSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'CourseGroup', required: true, index: true },
  uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  originalName: { type: String, required: true, maxlength: 180 },
  storageKey: { type: String, required: true, match: /^[a-f0-9-]{36}\.(pdf|zip|docx|png|jpg)$/ },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
}, { timestamps: true, versionKey: false });

const discussionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  // Group discussion: visible to the members of this group (and to course managers) only.
  groupId: { type: Schema.Types.ObjectId, ref: 'CourseGroup', default: null },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  prompt: { type: String, default: '', maxlength: 20000 },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  pinned: { type: Boolean, default: false },
  graded: { type: Boolean, default: false },
  points: { type: Number, min: 1, max: 1000, default: 10 },
  dueAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });

const postSchema = new Schema({
  discussionId: { type: Schema.Types.ObjectId, ref: 'CourseDiscussion', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  parentId: { type: Schema.Types.ObjectId, ref: 'CourseDiscussionPost', default: null },
  body: { type: String, required: true, maxlength: 20000 },
  // Moderation: hidden posts stay visible to managers (with the reason), never to students.
  status: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  moderationNote: { type: String, default: '', maxlength: 500 },
  pinned: { type: Boolean, default: false },
  editedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
postSchema.index({ discussionId: 1, createdAt: 1 });

const journalSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  instructions: { type: String, default: '', maxlength: 20000 },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  graded: { type: Boolean, default: false },
  points: { type: Number, min: 1, max: 1000, default: 10 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });
// Private entries: only their author and the course managers can read them.
const journalEntrySchema = new Schema({
  journalId: { type: Schema.Types.ObjectId, ref: 'CourseJournal', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, maxlength: 20000 },
  comments: { type: [{ authorId: { type: Schema.Types.ObjectId, ref: 'User' }, body: { type: String, maxlength: 4000 }, createdAt: Date }], default: [] },
}, { timestamps: true, versionKey: false });
journalEntrySchema.index({ journalId: 1, authorId: 1, createdAt: 1 });

const announcementSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, maxlength: 20000 },
  // Empty: every enrolled student; otherwise members of these course groups.
  groupIds: { type: [{ type: Schema.Types.ObjectId, ref: 'CourseGroup' }], default: [] },
  sendEmail: { type: Boolean, default: false },
  publishAt: { type: Date, default: null },
  status: { type: String, enum: ['draft', 'scheduled', 'sending', 'sent'], default: 'draft', index: true },
  sentAt: { type: Date, default: null },
  stats: { recipients: { type: Number, default: 0 }, emailsSent: { type: Number, default: 0 }, emailsFailed: { type: Number, default: 0 }, emailsSkipped: { type: Number, default: 0 } },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: false });
announcementSchema.index({ status: 1, publishAt: 1 });
// One row per recipient and channel: a retried or concurrent delivery never notifies twice.
const deliverySchema = new Schema({
  announcementId: { type: Schema.Types.ObjectId, ref: 'CourseAnnouncement', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: String, enum: ['in_app', 'email'], required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' },
  error: { type: String, default: '', maxlength: 120 },
  attempts: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });
deliverySchema.index({ announcementId: 1, userId: 1, channel: 1 }, { unique: true });

const attendanceSessionSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  date: { type: Date, required: true },
  syllabusEntryId: { type: String, default: '' },
}, { timestamps: true, versionKey: false });
const attendanceRecordSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['present', 'absent', 'late', 'excused'], required: true },
  note: { type: String, default: '', maxlength: 300 },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });
attendanceRecordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

export const CourseGroupSet = mongoose.model('CourseGroupSet', groupSetSchema);
export const CourseGroup = mongoose.model('CourseGroup', groupSchema);
export const GroupFile = mongoose.model('GroupFile', groupFileSchema);
export const CourseDiscussion = mongoose.model('CourseDiscussion', discussionSchema);
export const CourseDiscussionPost = mongoose.model('CourseDiscussionPost', postSchema);
export const CourseJournal = mongoose.model('CourseJournal', journalSchema);
export const JournalEntry = mongoose.model('JournalEntry', journalEntrySchema);
export const CourseAnnouncement = mongoose.model('CourseAnnouncement', announcementSchema);
export const AnnouncementDelivery = mongoose.model('AnnouncementDelivery', deliverySchema);
export const AttendanceSession = mongoose.model('AttendanceSession', attendanceSessionSchema);
export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);
