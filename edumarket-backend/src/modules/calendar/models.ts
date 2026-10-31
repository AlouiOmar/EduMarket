import mongoose, { Schema } from 'mongoose';

/**
 * Calendar events that are not tutoring sessions: appointments, meetings, personal events (`source: 'edumarket'`), and events
 * imported from a connected Google or Microsoft calendar (`source: 'google' | 'microsoft'`). Instants are stored in UTC with
 * the IANA zone they were entered in. Tutoring sessions stay in `TutoringSession`; the calendar feed merges both.
 */
const participantSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  // Set when the EduMarket invitation was sent ("Enregistrer et envoyer les invitations"); null = not invited yet.
  invitedAt: { type: Date, default: null },
  respondedAt: { type: Date, default: null },
}, { _id: false });

const externalLinkSchema = new Schema({
  connectionId: { type: Schema.Types.ObjectId, ref: 'CalendarConnection', required: true },
  provider: { type: String, enum: ['google', 'microsoft'], required: true },
  calendarId: { type: String, required: true, maxlength: 512 },
  // Provider event id; empty while the first push has not been confirmed.
  eventId: { type: String, maxlength: 1024, default: '' },
  etag: { type: String, maxlength: 512, default: '' },
  // `revision` of the local event last written to (or read from) the provider: a higher local revision means unsent changes.
  syncedRevision: { type: Number, default: -1 },
  state: { type: String, enum: ['pending', 'synced', 'error', 'conflict', 'remote_deleted'], default: 'pending' },
  error: { type: String, maxlength: 80, default: '' },
  attempts: { type: Number, default: 0 },
  lastSyncedAt: { type: Date, default: null },
  // Remote version kept when both sides changed, until the owner chooses which one to keep.
  conflict: { type: Schema.Types.Mixed, default: undefined },
  sendInvites: { type: Boolean, default: false },
  teamsMeeting: { type: Boolean, default: false },
}, { _id: false });

const calendarEventSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: String, enum: ['edumarket', 'google', 'microsoft'], default: 'edumarket' },
  title: { type: String, trim: true, maxlength: 200, required: true },
  description: { type: String, trim: true, maxlength: 4000, default: '' },
  type: { type: String, enum: ['appointment', 'meeting', 'personal', 'other'], default: 'personal' },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  allDay: { type: Boolean, default: false },
  timeZone: { type: String, maxlength: 64, default: 'UTC' },
  mode: { type: String, enum: ['online', 'in_person', 'none'], default: 'none' },
  location: { type: String, trim: true, maxlength: 300, default: '' },
  meetingUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  // Teams join URL confirmed by Microsoft Graph (never a pasted link).
  teamsJoinUrl: { type: String, maxlength: 2000, default: '' },
  participants: { type: [participantSchema], default: [] },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
  reminderMinutes: { type: [Number], default: [] },
  remindersSent: { type: [Number], default: [] },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  sourceMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  revision: { type: Number, default: 0 },
  // Imported events: false when the calendar or the connection does not allow writing back.
  readOnly: { type: Boolean, default: false },
  external: { type: externalLinkSchema, default: undefined },
}, { timestamps: true, versionKey: false });
calendarEventSchema.index({ ownerId: 1, start: 1, end: 1 });
calendarEventSchema.index({ 'participants.userId': 1, start: 1 });
calendarEventSchema.index({ 'external.connectionId': 1, 'external.calendarId': 1, 'external.eventId': 1 }, { unique: true, partialFilterExpression: { 'external.eventId': { $gt: '' } } });
calendarEventSchema.index({ 'external.state': 1, 'external.attempts': 1 }, { partialFilterExpression: { 'external.state': { $in: ['pending', 'error'] } } });
calendarEventSchema.index({ status: 1, start: 1 }, { partialFilterExpression: { 'reminderMinutes.0': { $exists: true } } });
export const CalendarEventModel = mongoose.model('CalendarEvent', calendarEventSchema);

/** Display preferences: never part of the event data. Keys: `sessions`, `personal`, `exams`, `course`, `pending`, `google:<calendarId>`, `microsoft:<calendarId>`. */
const preferenceSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  colors: { type: Map, of: String, default: {} },
  hidden: { type: [String], default: [] },
  defaultView: { type: String, enum: ['month', 'week', 'day', 'agenda'], default: 'week' },
  timeZone: { type: String, maxlength: 64, default: '' },
  defaultDurationMinutes: { type: Number, min: 15, max: 480, default: 60 },
}, { timestamps: true, versionKey: false });
export const CalendarPreference = mongoose.model('CalendarPreference', preferenceSchema);

/**
 * OAuth connection to a calendar provider. Tokens are AES-256-GCM encrypted and never selected by default nor returned.
 * `syncMode`: `read_only` (display only), `push` (EduMarket → provider), `two_way` (also edit imported events).
 */
const providerCalendarSchema = new Schema({
  id: { type: String, required: true, maxlength: 512 },
  name: { type: String, maxlength: 300, default: '' },
  color: { type: String, maxlength: 16, default: '' },
  primary: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  teamsAvailable: { type: Boolean, default: false },
  // Incremental sync cursor: Google `nextSyncToken`, Microsoft `@odata.deltaLink`.
  cursor: { type: String, maxlength: 8000, default: '', select: false },
  windowStart: { type: Date, default: null },
}, { _id: false });

const connectionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: String, enum: ['google', 'microsoft'], required: true },
  accountId: { type: String, maxlength: 320, default: '' },
  accountLabel: { type: String, maxlength: 320, default: '' },
  scopes: { type: [String], default: [] },
  access: { type: String, enum: ['read', 'write'], default: 'write' },
  refreshToken: { type: String, required: true, select: false },
  accessToken: { type: String, default: '', select: false },
  accessTokenExpiresAt: { type: Date, default: null, select: false },
  status: { type: String, enum: ['connected', 'syncing', 'error', 'expired'], default: 'connected' },
  syncMode: { type: String, enum: ['read_only', 'push', 'two_way'], default: 'push' },
  defaultCalendarId: { type: String, maxlength: 512, default: '' },
  calendars: { type: [providerCalendarSchema], default: [] },
  lastSyncAt: { type: Date, default: null },
  lastSyncStartedAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 80, default: '' },
  // Push notification channel (Google `events.watch`) or Graph subscription, renewed before expiry.
  channels: { type: [new Schema({ calendarId: String, channelId: String, resourceId: String, expiresAt: Date }, { _id: false })], default: [], select: false },
  // Secret echoed by the provider in each notification (Google channel token / Graph clientState).
  webhookSecret: { type: String, default: '', select: false },
}, { timestamps: true, versionKey: false });
connectionSchema.index({ userId: 1, provider: 1 }, { unique: true });
connectionSchema.index({ status: 1, lastSyncAt: 1 });
export const CalendarConnection = mongoose.model('CalendarConnection', connectionSchema);

/** External copy of a tutoring session in a participant's connected calendar (EduMarket stays the source of truth). */
const sessionLinkSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'TutoringSession', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  connectionId: { type: Schema.Types.ObjectId, ref: 'CalendarConnection', required: true },
  calendarId: { type: String, required: true, maxlength: 512 },
  eventId: { type: String, required: true, maxlength: 1024 },
}, { timestamps: true, versionKey: false });
sessionLinkSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
sessionLinkSchema.index({ connectionId: 1, calendarId: 1, eventId: 1 }, { unique: true });
export const SessionCalendarLink = mongoose.model('SessionCalendarLink', sessionLinkSchema);
