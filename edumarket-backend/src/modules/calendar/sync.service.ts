import { randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { calendarProvider, CalendarProviderError, type ProviderAccess, type ProviderCalendar, type ProviderEvent, type ProviderEventWrite, type ProviderName } from '../../integrations/calendarProviders/index.js';
import { decryptToken, encryptToken } from '../../integrations/googleCalendar.js';
import { User } from '../auth/model.js';
import { TutoringSession } from '../sessions/model.js';
import { CalendarConnection, CalendarEventModel, SessionCalendarLink } from './models.js';

/**
 * CalendarSyncService: everything between EduMarket and the connected Google / Microsoft calendars.
 * - Pull: incremental (Google sync token, Graph delta link), resumed from the stored cursor; a full listing when the cursor expired.
 * - Push: EduMarket events whose destination is an external calendar, and confirmed tutoring sessions of users in push/two-way mode.
 *   Creates are idempotent (deterministic Google id, Graph `transactionId`), updates are conditional on the stored etag.
 * - Loops: a pulled change whose etag equals the one stored after our own write is our echo and is ignored.
 * - Conflicts: both sides changed → the event is flagged and the owner chooses (nothing is overwritten silently).
 * No token, secret or event content is ever logged.
 */
const SYNC_WINDOW_PAST_DAYS = 30, SYNC_WINDOW_FUTURE_DAYS = 365;
const STALE_LOCK_MS = 10 * 60_000, MIN_MANUAL_INTERVAL_MS = 30_000, MAX_PUSH_ATTEMPTS = 5;
const sameId = (left: unknown, right: unknown) => String(left) === String(right);
const errorCode = (error: unknown) => error instanceof CalendarProviderError ? error.code : error instanceof AppError ? error.code : 'PROVIDER_ERROR';
const syncWindow = (now = new Date()) => ({ start: new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 86_400_000), end: new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 86_400_000) });

export const providerConfigured = (provider: ProviderName) => calendarProvider(provider).configured();

// ---------------------------------------------------------------------------------------------------------------- connection

export function connectionDto(connection: any) {
  return {
    id: String(connection._id), provider: connection.provider, accountLabel: connection.accountLabel || '', access: connection.access, scopes: connection.scopes,
    status: connection.status, syncMode: connection.syncMode, defaultCalendarId: connection.defaultCalendarId, lastSyncAt: connection.lastSyncAt, lastError: connection.lastError || null,
    calendars: (connection.calendars || []).map((calendar: any) => ({ id: calendar.id, name: calendar.name, color: calendar.color, primary: calendar.primary, canEdit: calendar.canEdit, selected: calendar.selected, teamsAvailable: calendar.teamsAvailable })),
    pushNotifications: !!env.CALENDAR_WEBHOOK_BASE_URL, connectedAt: connection.createdAt,
  };
}

/** Moves a Google connection made before multi-calendar sync (User.googleCalendar) to a CalendarConnection, keeping its token. */
export async function migrateLegacyGoogle(userId: string) {
  const user = await User.findOne({ _id: userId, googleCalendar: { $exists: true } }).select('+googleCalendar').lean();
  if (!user?.googleCalendar) return;
  if (!await CalendarConnection.exists({ userId, provider: 'google' })) {
    try {
      await CalendarConnection.create({
        userId, provider: 'google', access: 'write', scopes: ['https://www.googleapis.com/auth/calendar.events'], refreshToken: user.googleCalendar.refreshToken,
        syncMode: 'push', defaultCalendarId: 'primary', calendars: [{ id: 'primary', name: 'Google Calendar', primary: true, canEdit: true, selected: false }],
        webhookSecret: randomBytes(24).toString('base64url'), createdAt: user.googleCalendar.connectedAt,
      });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const connection = await CalendarConnection.findOne({ userId, provider: 'google' }).select('_id').lean();
    const sessions = await TutoringSession.find({ [`googleEventIds.${userId}`]: { $exists: true } }).select('googleEventIds').lean();
    for (const session of sessions) {
      const eventId = (session.googleEventIds as unknown as Record<string, string>)?.[userId];
      if (eventId) await SessionCalendarLink.updateOne({ sessionId: session._id, userId }, { $setOnInsert: { connectionId: connection!._id, calendarId: 'primary', eventId } }, { upsert: true }).catch(() => undefined);
    }
  }
  await User.updateOne({ _id: userId }, { $unset: { googleCalendar: '' } });
}

export function startConnect(userId: string, provider: ProviderName, access: ProviderAccess) {
  const implementation = calendarProvider(provider);
  if (!implementation.configured()) throw new AppError(503, provider === 'google' ? 'GOOGLE_CALENDAR_NOT_CONFIGURED' : 'MICROSOFT_CALENDAR_NOT_CONFIGURED');
  // The OAuth state binds the callback to this EduMarket user and request; it is signed and expires after 10 minutes.
  const state = jwt.sign({ sub: userId, purpose: 'calendar-connect', provider, access, nonce: randomBytes(12).toString('base64url') }, env.JWT_SECRET, { expiresIn: '10m' });
  return implementation.authorizationUrl(state, access);
}

export async function completeConnect(provider: ProviderName, code: string, state: string) {
  let claims: jwt.JwtPayload;
  try { claims = jwt.verify(state, env.JWT_SECRET) as jwt.JwtPayload; } catch { throw new AppError(400, 'INVALID_OAUTH_STATE'); }
  if (claims.purpose !== 'calendar-connect' || claims.provider !== provider || typeof claims.sub !== 'string' || !['read', 'write'].includes(claims.access)) throw new AppError(400, 'INVALID_OAUTH_STATE');
  const user = await User.findOne({ _id: claims.sub, status: { $ne: 'suspended' } }).select('_id').lean();
  if (!user) throw new AppError(400, 'INVALID_OAUTH_STATE');
  const access = claims.access as ProviderAccess;
  const { tokens, account } = await calendarProvider(provider).exchangeCode(code, access).catch(error => { throw new AppError(502, errorCode(error) === 'CONSENT_REQUIRED' ? 'CALENDAR_CONSENT_REQUIRED' : 'CALENDAR_PROVIDER_ERROR'); });
  const existing = await CalendarConnection.findOne({ userId: user._id, provider }).select('+webhookSecret').lean();
  const connection = await CalendarConnection.findOneAndUpdate({ userId: user._id, provider }, {
    $set: {
      access, scopes: tokens.scopes, refreshToken: encryptToken(tokens.refreshToken), accessToken: encryptToken(tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt,
      status: 'connected', lastError: '', ...(account.label ? { accountLabel: account.label, accountId: account.id } : {}),
      // Read-only consent cannot push: the mode follows what was granted.
      ...(access === 'read' ? { syncMode: 'read_only' } : existing?.syncMode === 'read_only' || !existing ? { syncMode: 'push' } : {}),
      ...(existing?.webhookSecret ? {} : { webhookSecret: randomBytes(24).toString('base64url') }),
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await User.updateOne({ _id: user._id }, { $unset: { googleCalendar: '' } });
  await refreshCalendars(String(connection._id)).catch(() => undefined);
  void syncConnection(String(connection._id)).catch(() => undefined);
  return connection;
}

/** Runs `operation` with a valid access token, refreshing it (and a rotated refresh token) when needed. */
async function withAccessToken<T>(connectionId: unknown, operation: (accessToken: string, connection: any) => Promise<T>): Promise<T> {
  const connection = await CalendarConnection.findById(connectionId).select('+refreshToken +accessToken +accessTokenExpiresAt').lean();
  if (!connection) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  if (connection.status === 'expired') throw new CalendarProviderError('AUTH_EXPIRED');
  const provider = calendarProvider(connection.provider);
  const refresh = async () => {
    try {
      const tokens = await provider.refresh(decryptToken(connection.refreshToken));
      await CalendarConnection.updateOne({ _id: connection._id }, { $set: { accessToken: encryptToken(tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt, ...(tokens.refreshToken ? { refreshToken: encryptToken(tokens.refreshToken) } : {}) } });
      return tokens.accessToken;
    } catch (error) {
      if (errorCode(error) === 'AUTH_EXPIRED' || errorCode(error) === 'CONSENT_REQUIRED') await CalendarConnection.updateOne({ _id: connection._id }, { $set: { status: 'expired', lastError: 'AUTH_EXPIRED' } });
      throw error;
    }
  };
  let accessToken = connection.accessToken && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000 ? decryptToken(connection.accessToken) : await refresh();
  try { return await operation(accessToken, connection); }
  catch (error) {
    // A token revoked or expired early: refresh once, then retry.
    if (errorCode(error) !== 'AUTH_EXPIRED') throw error;
    accessToken = await refresh();
    return operation(accessToken, connection);
  }
}

export async function refreshCalendars(connectionId: string) {
  const connection = await CalendarConnection.findById(connectionId).select('+calendars.cursor').lean();
  if (!connection) return;
  let listed: ProviderCalendar[];
  try { listed = await withAccessToken(connectionId, accessToken => calendarProvider(connection.provider).listCalendars(accessToken)); }
  catch (error) {
    // Connections made with the older Google scope cannot list calendars: keep the primary one and ask for a reconnection.
    if (errorCode(error) === 'CONSENT_REQUIRED') { await CalendarConnection.updateOne({ _id: connectionId }, { $set: { lastError: 'CONSENT_REQUIRED' } }); return; }
    throw error;
  }
  const previous = new Map<string, any>(connection.calendars.map(calendar => [calendar.id, calendar]));
  const primary = listed.find(calendar => calendar.primary);
  // The legacy "primary" alias becomes the real calendar id, with its links.
  if (primary && previous.has('primary') && !previous.has(primary.id)) {
    previous.set(primary.id, { ...previous.get('primary')!, id: primary.id });
    await SessionCalendarLink.updateMany({ connectionId, calendarId: 'primary' }, { $set: { calendarId: primary.id } });
    await CalendarEventModel.updateMany({ 'external.connectionId': connectionId, 'external.calendarId': 'primary' }, { $set: { 'external.calendarId': primary.id } });
  }
  const calendars = listed.map(calendar => {
    const known = previous.get(calendar.id);
    return { ...calendar, selected: known ? known.selected : calendar.primary, cursor: known?.cursor || '', windowStart: known?.windowStart || null };
  });
  const removed = [...previous.keys()].filter(id => id !== 'primary' && !listed.some(calendar => calendar.id === id));
  if (removed.length) await CalendarEventModel.deleteMany({ ownerId: connection.userId, source: connection.provider, 'external.connectionId': connectionId, 'external.calendarId': { $in: removed } });
  const defaultCalendarId = calendars.some(calendar => calendar.id === connection.defaultCalendarId && calendar.canEdit) ? connection.defaultCalendarId : (calendars.find(calendar => calendar.primary && calendar.canEdit) || calendars.find(calendar => calendar.canEdit))?.id || '';
  await CalendarConnection.updateOne({ _id: connectionId }, { $set: { calendars, defaultCalendarId, ...(primary && !connection.accountLabel && connection.provider === 'google' ? { accountLabel: primary.id } : {}), ...(connection.lastError === 'CONSENT_REQUIRED' ? { lastError: '' } : {}) } });
}

export async function updateConnectionSettings(userId: string, connectionId: string, input: { syncMode?: 'read_only' | 'push' | 'two_way'; defaultCalendarId?: string; calendars?: { id: string; selected: boolean }[] }) {
  if (!mongoose.isValidObjectId(connectionId)) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  const connection = await CalendarConnection.findOne({ _id: connectionId, userId }).lean();
  if (!connection) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  if (input.syncMode && input.syncMode !== 'read_only' && connection.access !== 'write') throw new AppError(409, 'CALENDAR_WRITE_CONSENT_REQUIRED');
  if (input.defaultCalendarId && !connection.calendars.some(calendar => calendar.id === input.defaultCalendarId && calendar.canEdit)) throw new AppError(400, 'CALENDAR_NOT_WRITABLE');
  const set: Record<string, unknown> = {};
  if (input.syncMode) set.syncMode = input.syncMode;
  if (input.defaultCalendarId) set.defaultCalendarId = input.defaultCalendarId;
  const deselected: string[] = [];
  if (input.calendars) for (const change of input.calendars) {
    const index = connection.calendars.findIndex(calendar => calendar.id === change.id);
    if (index < 0) throw new AppError(400, 'CALENDAR_NOT_FOUND');
    set[`calendars.${index}.selected`] = change.selected;
    if (!change.selected && connection.calendars[index].selected) { deselected.push(change.id); set[`calendars.${index}.cursor`] = ''; }
  }
  await CalendarConnection.updateOne({ _id: connectionId }, { $set: set });
  // Events of a calendar the user stops showing are no longer kept in EduMarket.
  if (deselected.length) await CalendarEventModel.deleteMany({ ownerId: userId, source: connection.provider, 'external.connectionId': connection._id, 'external.calendarId': { $in: deselected } });
  // Imported events follow the new mode at once (read-only unless two-way on a writable calendar).
  const fresh = await CalendarConnection.findById(connectionId).lean();
  for (const calendar of fresh!.calendars) {
    await CalendarEventModel.updateMany({ source: fresh!.provider, 'external.connectionId': fresh!._id, 'external.calendarId': calendar.id }, { $set: { readOnly: !(fresh!.syncMode === 'two_way' && fresh!.access === 'write' && calendar.canEdit) } });
  }
  if (input.calendars?.some(change => change.selected)) void syncConnection(connectionId).catch(() => undefined);
  return fresh;
}

/** Disconnects: stops notifications, revokes the grant when the provider allows it, removes imported copies and tokens. Events in the provider calendar are left untouched. */
export async function disconnect(userId: string, connectionId: string) {
  if (!mongoose.isValidObjectId(connectionId)) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  const connection = await CalendarConnection.findOne({ _id: connectionId, userId }).select('+refreshToken +channels').lean();
  if (!connection) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  const provider = calendarProvider(connection.provider);
  if (connection.channels?.length && connection.status !== 'expired') {
    await withAccessToken(connection._id, async accessToken => { for (const channel of connection.channels) await provider.stopWatch(accessToken, { channelId: channel.channelId!, resourceId: channel.resourceId! }).catch(() => undefined); }).catch(() => undefined);
  }
  await provider.revoke(decryptToken(connection.refreshToken)).catch(() => undefined);
  await CalendarEventModel.deleteMany({ ownerId: userId, source: connection.provider, 'external.connectionId': connection._id });
  await CalendarEventModel.updateMany({ ownerId: userId, source: 'edumarket', 'external.connectionId': connection._id }, { $unset: { external: '' }, $set: { teamsJoinUrl: '' } });
  await SessionCalendarLink.deleteMany({ connectionId: connection._id });
  await CalendarConnection.deleteOne({ _id: connection._id });
}

// ---------------------------------------------------------------------------------------------------------------------- pull

const importedFields = (event: ProviderEvent) => ({
  title: event.title, description: event.description, start: event.start, end: event.end, allDay: event.allDay, timeZone: event.timeZone || 'UTC',
  location: event.location, meetingUrl: event.meetingUrl, teamsJoinUrl: event.teamsJoinUrl, mode: event.meetingUrl || event.teamsJoinUrl ? 'online' : event.location ? 'in_person' : 'none',
});
const conflictSnapshot = (event: ProviderEvent) => ({ ...importedFields(event), etag: event.etag, start: event.start.toISOString(), end: event.end.toISOString() });

async function applyChange(connection: any, calendar: any, change: { id: string; removed: boolean; event?: ProviderEvent }, seen?: Set<string>) {
  const key = { 'external.connectionId': connection._id, 'external.calendarId': calendar.id, 'external.eventId': change.id };
  seen?.add(change.id);
  if (await SessionCalendarLink.exists({ connectionId: connection._id, calendarId: calendar.id, eventId: change.id })) {
    // Copies of tutoring sessions: EduMarket is the source of truth; a deletion on the provider side only detaches the copy.
    if (change.removed) await SessionCalendarLink.deleteOne({ connectionId: connection._id, calendarId: calendar.id, eventId: change.id });
    return;
  }
  const local = await CalendarEventModel.findOne(key).lean();
  if (change.removed) {
    if (!local) return;
    if (local.source === 'edumarket') await CalendarEventModel.updateOne({ _id: local._id }, { $set: { 'external.state': 'remote_deleted', 'external.lastSyncedAt': new Date() } });
    else await CalendarEventModel.deleteOne({ _id: local._id });
    return;
  }
  const remote = change.event!;
  const readOnly = !(connection.syncMode === 'two_way' && connection.access === 'write' && calendar.canEdit);
  if (!local) {
    try {
      await CalendarEventModel.create({ ownerId: connection.userId, source: connection.provider, type: 'other', ...importedFields(remote), readOnly, external: { connectionId: connection._id, provider: connection.provider, calendarId: calendar.id, eventId: remote.id, etag: remote.etag, syncedRevision: 0, state: 'synced', lastSyncedAt: new Date() } });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    return;
  }
  // Our own write coming back (same etag): nothing changed on the provider side.
  if (local.external?.etag && local.external.etag === remote.etag) return;
  const unsentLocalChanges = local.revision > (local.external?.syncedRevision ?? -1);
  if (unsentLocalChanges) {
    await CalendarEventModel.updateOne({ _id: local._id }, { $set: { 'external.state': 'conflict', 'external.conflict': conflictSnapshot(remote) } });
    return;
  }
  // EduMarket-origin events take remote edits only in two-way mode; in push mode EduMarket stays authoritative.
  if (local.source === 'edumarket' && connection.syncMode !== 'two_way') {
    await CalendarEventModel.updateOne({ _id: local._id }, { $set: { 'external.etag': remote.etag, 'external.lastSyncedAt': new Date() } });
    return;
  }
  const fields = local.source === 'edumarket' ? { title: remote.title, description: remote.description, start: remote.start, end: remote.end, location: remote.location } : importedFields(remote);
  await CalendarEventModel.updateOne({ _id: local._id, revision: local.revision }, {
    $set: { ...fields, ...(local.source === 'edumarket' ? {} : { readOnly }), 'external.etag': remote.etag, 'external.state': 'synced', 'external.syncedRevision': local.revision + 1, 'external.lastSyncedAt': new Date() },
    $inc: { revision: 1 }, $unset: { 'external.conflict': '' },
  });
}

/** Incremental pull of every selected calendar of a connection. Concurrent calls are serialised by a lease on the connection. */
export async function syncConnection(connectionId: string, options: { manual?: boolean; now?: Date } = {}) {
  const now = options.now || new Date();
  const lease = await CalendarConnection.findOneAndUpdate(
    { _id: connectionId, status: { $ne: 'expired' }, $or: [{ status: { $ne: 'syncing' } }, { lastSyncStartedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } }], ...(options.manual ? { $and: [{ $or: [{ lastSyncStartedAt: null }, { lastSyncStartedAt: { $lt: new Date(now.getTime() - MIN_MANUAL_INTERVAL_MS) } }] }] } : {}) },
    { $set: { status: 'syncing', lastSyncStartedAt: now } }, { new: true },
  ).select('+calendars.cursor').lean();
  if (!lease) {
    if (options.manual) {
      const current = await CalendarConnection.findById(connectionId).select('status').lean();
      if (!current) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
      if (current.status === 'expired') throw new AppError(409, 'CALENDAR_AUTH_EXPIRED');
      throw new AppError(429, 'CALENDAR_SYNC_TOO_FREQUENT');
    }
    return { skipped: true };
  }
  const provider = calendarProvider(lease.provider);
  const counts = { created: 0, updated: 0, removed: 0 };
  try {
    if (!lease.calendars.length) await refreshCalendars(connectionId);
    const connection = await CalendarConnection.findById(connectionId).select('+calendars.cursor').lean();
    for (const [index, calendar] of connection!.calendars.entries()) {
      if (!calendar.selected) continue;
      const window = syncWindow(now);
      let cursor: string | null = calendar.cursor || null;
      let result: Awaited<ReturnType<typeof provider.listChanges>>;
      let seen: Set<string> | undefined;
      try { result = await withAccessToken(connectionId, accessToken => provider.listChanges(accessToken, calendar.id, cursor, window)); }
      catch (error) {
        if (errorCode(error) !== 'CURSOR_EXPIRED') throw error;
        // Expired cursor: full listing again, then remove imported events that no longer exist.
        cursor = null;
        result = await withAccessToken(connectionId, accessToken => provider.listChanges(accessToken, calendar.id, null, window));
      }
      if (!cursor) seen = new Set();
      for (const change of result.changes) {
        await applyChange(connection, calendar, change, seen);
        counts[change.removed ? 'removed' : 'updated'] += 1;
      }
      if (seen) {
        const stale = await CalendarEventModel.deleteMany({ ownerId: connection!.userId, source: connection!.provider, 'external.connectionId': connection!._id, 'external.calendarId': calendar.id, 'external.eventId': { $nin: [...seen] } });
        counts.removed += stale.deletedCount;
      }
      // The cursor is saved after the changes are applied: an interruption replays them (applying a change is idempotent).
      await CalendarConnection.updateOne({ _id: connectionId, 'calendars.id': calendar.id }, { $set: { [`calendars.${index}.cursor`]: result.cursor, [`calendars.${index}.windowStart`]: window.start } });
    }
    await CalendarConnection.updateOne({ _id: connectionId }, { $set: { status: 'connected', lastSyncAt: new Date(), lastError: '' } });
    await ensureNotificationChannels(connectionId).catch(() => undefined);
    return { skipped: false, ...counts };
  } catch (error) {
    const code = errorCode(error);
    await CalendarConnection.updateOne({ _id: connectionId }, { $set: { status: code === 'AUTH_EXPIRED' ? 'expired' : 'error', lastError: code } });
    if (options.manual) throw new AppError(code === 'AUTH_EXPIRED' ? 409 : 502, code === 'AUTH_EXPIRED' ? 'CALENDAR_AUTH_EXPIRED' : 'CALENDAR_SYNC_FAILED', 'CALENDAR_SYNC_FAILED', { reason: code });
    return { skipped: false, error: code };
  }
}

// ---------------------------------------------------------------------------------------------------------------------- push

async function eventWrite(event: any, clientId: string): Promise<ProviderEventWrite> {
  const attendees = event.external?.sendInvites && event.participants?.length
    ? (await User.find({ _id: { $in: event.participants.filter((participant: any) => participant.status !== 'declined').map((participant: any) => participant.userId) } }).select('email').lean()).map(user => user.email)
    : [];
  const description = [event.description, event.meetingUrl ? `\n${event.meetingUrl}` : ''].join('').trim();
  return { clientId, title: event.title, description, start: event.start, end: event.end, allDay: event.allDay, timeZone: event.timeZone, location: event.location || '', attendees, sendInvites: !!event.external?.sendInvites, teamsMeeting: !!event.external?.teamsMeeting };
}

/** Writes an EduMarket event (or a two-way imported event) to its provider calendar. Never throws: the state is stored on the event. */
export async function pushEvent(eventId: string, options: { force?: boolean } = {}) {
  const event = await CalendarEventModel.findById(eventId).lean();
  if (!event?.external || event.status === 'cancelled') return;
  if (event.external.state === 'synced' && event.external.syncedRevision >= event.revision && !options.force) return;
  if (event.external.state === 'conflict' && !options.force) return;
  if (event.external.state === 'remote_deleted' && !options.force) return;
  const connection = await CalendarConnection.findById(event.external.connectionId).lean();
  if (!connection) return;
  const provider = calendarProvider(event.external.provider);
  const revision = event.revision;
  try {
    const write = await eventWrite(event, String(event._id));
    const remote = await withAccessToken(connection._id, async accessToken => {
      if (!event.external!.eventId || event.external!.state === 'remote_deleted') {
        const created = await provider.createEvent(accessToken, event.external!.calendarId, write);
        // Graph may return the meeting before its join URL is ready: read it back once.
        if (write.teamsMeeting && !created.teamsJoinUrl) return (await provider.getEvent(accessToken, event.external!.calendarId, created.id)) || created;
        return created;
      }
      return provider.updateEvent(accessToken, event.external!.calendarId, event.external!.eventId, write, options.force ? undefined : event.external!.etag || undefined);
    });
    await CalendarEventModel.updateOne({ _id: event._id }, {
      $set: { 'external.eventId': remote.id, 'external.etag': remote.etag, 'external.state': revision === event.revision ? 'synced' : 'pending', 'external.syncedRevision': revision, 'external.error': '', 'external.attempts': 0, 'external.lastSyncedAt': new Date(), ...(remote.teamsJoinUrl ? { teamsJoinUrl: remote.teamsJoinUrl } : {}) },
      $unset: { 'external.conflict': '' },
    });
    // Changes saved while the request was in flight are pushed by the next call.
    const latest = await CalendarEventModel.findById(event._id).select('revision').lean();
    if (latest && latest.revision > revision) await CalendarEventModel.updateOne({ _id: event._id }, { $set: { 'external.state': 'pending' } });
  } catch (error) {
    const code = errorCode(error);
    if (code === 'PRECONDITION_FAILED' || code === 'NOT_FOUND') {
      const remote = code === 'NOT_FOUND' ? null : await withAccessToken(connection._id, accessToken => provider.getEvent(accessToken, event.external!.calendarId, event.external!.eventId)).catch(() => null);
      await CalendarEventModel.updateOne({ _id: event._id }, remote
        ? { $set: { 'external.state': 'conflict', 'external.conflict': conflictSnapshot(remote), 'external.error': '' } }
        : { $set: { 'external.state': 'remote_deleted', 'external.error': '' } });
      return;
    }
    await CalendarEventModel.updateOne({ _id: event._id }, { $set: { 'external.state': 'error', 'external.error': code }, $inc: { 'external.attempts': 1 } });
  }
}

/** Removes the provider copy before a local deletion; a provider failure keeps the event. */
export async function removeRemoteEvent(event: { external?: any; _id: unknown }) {
  if (!event.external?.eventId) return;
  const connection = await CalendarConnection.findById(event.external.connectionId).lean();
  if (!connection) return;
  try { await withAccessToken(connection._id, accessToken => calendarProvider(event.external.provider).deleteEvent(accessToken, event.external.calendarId, event.external.eventId)); }
  catch (error) { throw new AppError(502, errorCode(error) === 'AUTH_EXPIRED' ? 'CALENDAR_AUTH_EXPIRED' : 'CALENDAR_PROVIDER_ERROR'); }
}

/** The owner settles a conflict: keep the EduMarket version (written to the provider) or take the provider version. */
export async function resolveConflict(userId: string, eventId: string, keep: 'local' | 'remote') {
  if (!mongoose.isValidObjectId(eventId)) throw new AppError(404, 'EVENT_NOT_FOUND');
  const event = await CalendarEventModel.findOne({ _id: eventId, ownerId: userId, 'external.state': { $in: ['conflict', 'remote_deleted'] } }).lean();
  if (!event?.external) throw new AppError(404, 'EVENT_NOT_FOUND');
  if (keep === 'local') {
    await pushEvent(eventId, { force: true });
  } else if (event.external.state === 'remote_deleted') {
    await CalendarEventModel.deleteOne({ _id: event._id });
    return null;
  } else {
    const snapshot = event.external.conflict as Record<string, any>;
    await CalendarEventModel.updateOne({ _id: event._id }, {
      $set: { title: snapshot.title, description: snapshot.description, start: new Date(snapshot.start), end: new Date(snapshot.end), location: snapshot.location, 'external.etag': snapshot.etag, 'external.state': 'synced', 'external.syncedRevision': event.revision + 1 },
      $inc: { revision: 1 }, $unset: { 'external.conflict': '' },
    });
  }
  return CalendarEventModel.findById(eventId).lean();
}

// -------------------------------------------------------------------------------------------------------- tutoring sessions

async function writableConnection(userId: string) {
  await migrateLegacyGoogle(userId);
  return CalendarConnection.find({ userId, status: { $ne: 'expired' }, access: 'write', syncMode: { $in: ['push', 'two_way'] }, defaultCalendarId: { $gt: '' } }).lean();
}

/** Adds a confirmed tutoring session to each participant's connected calendars (default calendar); failures never block the session. */
export async function pushSession(sessionId: string) {
  const session = await TutoringSession.findById(sessionId).populate('teacherId', 'name').populate('studentId', 'name').lean();
  if (!session || session.status !== 'confirmed') return;
  const teacher = session.teacherId as unknown as { _id: unknown; name: string }, student = session.studentId as unknown as { _id: unknown; name: string } | null;
  for (const participant of [teacher, student].filter(Boolean) as { _id: unknown; name: string }[]) {
    const userId = String(participant._id);
    for (const connection of await writableConnection(userId)) {
      if (await SessionCalendarLink.exists({ sessionId: session._id, userId, connectionId: connection._id })) continue;
      try {
        const counterpart = sameId(userId, teacher?._id) ? student?.name : teacher?.name;
        const remote = await withAccessToken(connection._id, accessToken => calendarProvider(connection.provider).createEvent(accessToken, connection.defaultCalendarId, {
          clientId: `${session._id}${userId.slice(-8)}`, title: `EduMarket · ${session.subject || 'Tutoring session'}`, description: `Tutoring session with ${counterpart || 'EduMarket'}. Join from your EduMarket sessions page.`,
          start: session.startAt, end: session.endAt, allDay: false, timeZone: session.timeZone || 'UTC', location: session.type === 'in_person' ? session.venue : '', attendees: [], sendInvites: false, teamsMeeting: false,
        }));
        await SessionCalendarLink.create({ sessionId: session._id, userId, connectionId: connection._id, calendarId: connection.defaultCalendarId, eventId: remote.id }).catch(() => undefined);
      } catch (error) { console.error('Calendar session sync failed', { sessionId, provider: connection.provider, code: errorCode(error) }); }
    }
  }
}

export async function removeSession(sessionId: string) {
  const links = await SessionCalendarLink.find({ sessionId }).lean();
  for (const link of links) {
    const connection = await CalendarConnection.findById(link.connectionId).lean();
    if (!connection) { await SessionCalendarLink.deleteOne({ _id: link._id }); continue; }
    try {
      await withAccessToken(connection._id, accessToken => calendarProvider(connection.provider).deleteEvent(accessToken, link.calendarId, link.eventId));
      await SessionCalendarLink.deleteOne({ _id: link._id });
    } catch (error) { console.error('Calendar session removal failed', { sessionId, provider: connection.provider, code: errorCode(error) }); }
  }
}

// ---------------------------------------------------------------------------------------------------- push notifications

const webhookAddress = (provider: ProviderName) => `${env.CALENDAR_WEBHOOK_BASE_URL!.replace(/\/$/, '')}/calendar/webhooks/${provider}`;

/** Opens or renews provider notification channels for the selected calendars (only with a public HTTPS base URL). */
export async function ensureNotificationChannels(connectionId: string) {
  if (!env.CALENDAR_WEBHOOK_BASE_URL) return;
  const connection = await CalendarConnection.findById(connectionId).select('+channels +webhookSecret').lean();
  if (!connection || connection.status === 'expired') return;
  const provider = calendarProvider(connection.provider);
  const selected = connection.calendars.filter(calendar => calendar.selected).map(calendar => calendar.id);
  const renewBefore = Date.now() + 24 * 3600_000;
  const channels = await withAccessToken(connection._id, async accessToken => {
    const kept = [];
    for (const channel of connection.channels || []) {
      if (!selected.includes(channel.calendarId!)) { await provider.stopWatch(accessToken, { channelId: channel.channelId!, resourceId: channel.resourceId! }).catch(() => undefined); continue; }
      if (channel.expiresAt && channel.expiresAt.getTime() > renewBefore) { kept.push(channel); continue; }
      kept.push({ calendarId: channel.calendarId, ...await provider.renewWatch(accessToken, { channelId: channel.channelId!, resourceId: channel.resourceId!, calendarId: channel.calendarId!, address: webhookAddress(connection.provider), secret: connection.webhookSecret }) });
    }
    for (const calendarId of selected) {
      if (kept.some(channel => channel.calendarId === calendarId)) continue;
      kept.push({ calendarId, ...await provider.watch(accessToken, calendarId, { address: webhookAddress(connection.provider), secret: connection.webhookSecret }) });
    }
    return kept;
  });
  await CalendarConnection.updateOne({ _id: connectionId }, { $set: { channels } });
}

const sameSecret = (expected: string, received: unknown) => {
  if (typeof received !== 'string' || !expected) return false;
  const left = Buffer.from(expected), right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * A provider notification only says "something changed": the matching connection is found by channel id, the shared secret
 * is checked in constant time, and an incremental pull runs (the payload itself is never trusted as event data).
 */
export async function handleNotification(provider: ProviderName, channelId: unknown, secret: unknown) {
  if (typeof channelId !== 'string' || channelId.length > 300) return false;
  const connection = await CalendarConnection.findOne({ provider, 'channels.channelId': channelId }).select('+webhookSecret').lean();
  if (!connection || !sameSecret(connection.webhookSecret, secret)) return false;
  void syncConnection(String(connection._id)).catch(() => undefined);
  return true;
}

// ------------------------------------------------------------------------------------------------------------------- jobs

/**
 * Periodic work (in-process scheduler, or POST /calendar/sync/cron from an external scheduler when the host sleeps):
 * pull connections not synced for 15 minutes, retry failed pushes with a bounded number of attempts, renew channels.
 */
export async function runCalendarSyncJob(now = new Date()) {
  const due = await CalendarConnection.find({ status: { $in: ['connected', 'error', 'syncing'] }, $or: [{ lastSyncAt: null }, { lastSyncAt: { $lt: new Date(now.getTime() - 15 * 60_000) } }] }).select('_id').limit(20).lean();
  for (const connection of due) await syncConnection(String(connection._id), { now }).catch(() => undefined);
  const pending = await CalendarEventModel.find({ 'external.state': { $in: ['pending', 'error'] }, 'external.attempts': { $lt: MAX_PUSH_ATTEMPTS }, status: 'confirmed' }).select('_id').limit(50).lean();
  for (const event of pending) await pushEvent(String(event._id));
  return { pulled: due.length, pushed: pending.length };
}
