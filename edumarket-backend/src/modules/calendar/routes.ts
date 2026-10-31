import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { isValidTimeZone } from '../../common/timezone.js';
import { env } from '../../config/env.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { Conversation } from '../messaging/models.js';
import { CalendarConnection, CalendarEventModel, CalendarPreference } from './models.js';
import { conflictDetails, findConflicts, parseEventInstant } from './rules.js';
import { calendarFeed, createEvent, deleteEvent, respondToEvent, updateEvent } from './events.service.js';
import {
  completeConnect, connectionDto, disconnect, handleNotification, migrateLegacyGoogle, providerConfigured, pushEvent, refreshCalendars,
  removeRemoteEvent, resolveConflict, runCalendarSyncJob, startConnect, syncConnection, updateConnectionSettings,
} from './sync.service.js';
import { buildIcsCalendar } from './service.js';

/** Personal calendar of learners, teachers, institutions and admins, plus the external calendar connections. */
export const calendarRoutes = Router();
const providerName = z.enum(['google', 'microsoft']);
const hooks = { push: (eventId: string) => pushEvent(eventId), remove: (event: any) => removeRemoteEvent(event) };
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

// ------------------------------------------------------------------------------------------- OAuth callbacks (public)

/** Provider redirects back here; the signed `state` identifies the EduMarket user (provider OAuth ≠ EduMarket login). */
const oauthCallback = (provider: 'google' | 'microsoft') => async (req: AuthRequest, res: any) => {
  const target = new URL('/calendar', env.APP_ORIGIN);
  target.searchParams.set('provider', provider);
  try {
    const query = z.object({ code: z.string().min(1).max(4000).optional(), state: z.string().min(1).max(2000), error: z.string().max(200).optional() }).parse(req.query);
    if (query.error || !query.code) throw new AppError(400, 'CALENDAR_CONSENT_DENIED');
    await completeConnect(provider, query.code, query.state);
    target.searchParams.set('calendar', 'connected');
    // Former Google-only parameter, kept for existing links and clients.
    if (provider === 'google') target.searchParams.set('google', 'connected');
  } catch (error) {
    target.searchParams.set('calendar', 'error');
    if (provider === 'google') target.searchParams.set('google', 'error');
    target.searchParams.set('code', error instanceof AppError ? error.code : 'INVALID_OAUTH_STATE');
  }
  res.redirect(303, target.toString());
};
calendarRoutes.get('/google/callback', oauthCallback('google'));
calendarRoutes.get('/microsoft/callback', oauthCallback('microsoft'));

// ------------------------------------------------------------------------------------- provider notifications (public)

calendarRoutes.post('/webhooks/google', async (req, res) => {
  const handled = await handleNotification('google', req.get('X-Goog-Channel-ID'), req.get('X-Goog-Channel-Token')).catch(() => false);
  res.status(handled ? 200 : 404).end();
});
calendarRoutes.post('/webhooks/microsoft', async (req, res) => {
  // Subscription validation: Graph expects the token echoed as plain text within 10 seconds.
  const validationToken = req.query.validationToken;
  if (typeof validationToken === 'string') {
    if (validationToken.length > 2048) return res.status(400).end();
    return res.status(200).type('text/plain').set('X-Content-Type-Options', 'nosniff').send(validationToken);
  }
  const notifications = Array.isArray(req.body?.value) ? req.body.value.slice(0, 50) : [];
  for (const notification of notifications) await handleNotification('microsoft', notification?.subscriptionId, notification?.clientState).catch(() => false);
  res.status(202).end();
});

/** For an external scheduler (the host may sleep): same work as the in-process job, protected by a shared secret. */
calendarRoutes.post('/sync/cron', async (req, res, next) => {
  try {
    if (!env.CALENDAR_CRON_SECRET) throw new AppError(404, 'NOT_FOUND');
    const received = Buffer.from(req.get('X-Calendar-Cron-Secret') || ''), expected = Buffer.from(env.CALENDAR_CRON_SECRET);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new AppError(401, 'UNAUTHORIZED');
    res.json({ success: true, data: await runCalendarSyncJob() });
  } catch (error) { next(error); }
});

calendarRoutes.use(authenticate, allowRoles('student', 'teacher', 'institution', 'admin'));
const actor = (req: AuthRequest) => ({ id: req.auth!.userId, role: req.auth!.role });

// ------------------------------------------------------------------------------------------------------ feed & events

const rangeQuery = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
calendarRoutes.get('/feed', async (req: AuthRequest, res, next) => {
  try {
    const query = rangeQuery.parse(req.query), from = new Date(query.from), to = new Date(query.to);
    // Loaded by visible range only, never the whole history.
    if (to <= from || to.getTime() - from.getTime() > 400 * 86_400_000) throw new AppError(400, 'INVALID_RANGE');
    await migrateLegacyGoogle(req.auth!.userId);
    res.json({ success: true, data: await calendarFeed(actor(req), from, to) });
  } catch (error) { next(error); }
});

/** Former list (kept for compatibility and the .ics export): last 30 days to next year. */
async function legacyEvents(req: AuthRequest) {
  const feed = await calendarFeed(actor(req), new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + 365 * 86_400_000));
  return feed.filter(item => ['session', 'exam', 'course'].includes(String(item.kind)) && item.status !== 'available' && item.status !== 'rejected');
}
calendarRoutes.get('/events', async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: (await legacyEvents(req)).map(item => ({ id: item.id, kind: item.kind, sourceId: item.sourceId, status: item.status, mode: item.mode, title: item.title, counterpart: item.counterpart, start: item.start, end: item.end, location: item.location })) }); }
  catch (error) { next(error); }
});
calendarRoutes.get('/events.ics', async (req: AuthRequest, res, next) => {
  try {
    const events = await legacyEvents(req);
    const body = buildIcsCalendar(events.map(event => ({
      uid: String(event.id), summary: `EduMarket · ${event.title}`, description: event.counterpart ? `With ${event.counterpart}` : 'EduMarket exam',
      start: event.start as Date, end: event.end as Date, location: (event.location as string) || undefined, cancelled: event.status === 'cancelled',
    })));
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="edumarket.ics"', 'Cache-Control': 'no-store' }).send(body);
  } catch (error) { next(error); }
});

calendarRoutes.post('/events', writeLimiter, async (req: AuthRequest, res, next) => {
  try { res.status(201).json({ success: true, data: await createEvent(actor(req), req.body, hooks) }); }
  catch (error) { next(error); }
});
calendarRoutes.patch('/events/:eventId', writeLimiter, async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: await updateEvent(actor(req), String(req.params.eventId), req.body, hooks) }); }
  catch (error) { next(error); }
});
calendarRoutes.delete('/events/:eventId', writeLimiter, async (req: AuthRequest, res, next) => {
  try { await deleteEvent(actor(req), String(req.params.eventId), hooks); res.status(204).end(); }
  catch (error) { next(error); }
});
calendarRoutes.post('/events/:eventId/respond', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['accepted', 'declined']) }).strict().parse(req.body);
    res.json({ success: true, data: await respondToEvent(actor(req), String(req.params.eventId), status) });
  } catch (error) { next(error); }
});
calendarRoutes.post('/events/:eventId/resolve', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { keep } = z.object({ keep: z.enum(['local', 'remote']) }).strict().parse(req.body);
    res.json({ success: true, data: await resolveConflict(req.auth!.userId, String(req.params.eventId), keep) });
  } catch (error) { next(error); }
});
calendarRoutes.post('/events/:eventId/retry-sync', writeLimiter, async (req: AuthRequest, res, next) => {
  try {
    const event = await CalendarEventModel.findOne({ _id: z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.eventId), ownerId: req.auth!.userId, 'external.state': { $in: ['error', 'pending'] } }).select('_id').lean();
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND');
    await CalendarEventModel.updateOne({ _id: event._id }, { $set: { 'external.attempts': 0 } });
    await pushEvent(String(event._id));
    res.json({ success: true, data: await CalendarEventModel.findById(event._id).select('external.state external.error external.eventId teamsJoinUrl').lean() });
  } catch (error) { next(error); }
});

/** Overlaps shown before saving, so the user can correct or knowingly confirm. Others' events appear only as "busy". */
calendarRoutes.post('/conflicts', async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ start: z.string().max(40), end: z.string().max(40), timeZone: z.string().max(64).refine(isValidTimeZone, 'INVALID_TIMEZONE'), participantIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(50).default([]), excludeEventId: z.string().regex(/^[a-f\d]{24}$/i).optional(), excludeSessionId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).strict().parse(req.body);
    const start = parseEventInstant(input.start, input.timeZone), end = parseEventInstant(input.end, input.timeZone);
    if (end <= start) throw new AppError(400, 'INVALID_EVENT_TIME');
    res.json({ success: true, data: conflictDetails(await findConflicts(req.auth!.userId, [req.auth!.userId, ...input.participantIds], start, end, { eventId: input.excludeEventId, sessionId: input.excludeSessionId })) });
  } catch (error) { next(error); }
});

/** People the user may invite (same rule as the API check): conversation partners and course teacher/student relations. */
calendarRoutes.get('/invitees', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.auth!.userId;
    const ids = new Set<string>();
    for (const conversation of await Conversation.find({ participants: userId }).select('participants').limit(300).lean()) for (const participant of conversation.participants) ids.add(String(participant));
    if (req.auth!.role === 'teacher') {
      const courseIds = await Course.find({ $or: [{ teacherId: userId }, { coOwnerIds: userId }] }).distinct('_id');
      for (const studentId of await Enrollment.find({ courseId: { $in: courseIds } }).distinct('studentId')) ids.add(String(studentId));
    }
    if (req.auth!.role === 'student') {
      const courseIds = await Enrollment.find({ studentId: userId }).distinct('courseId');
      for (const course of await Course.find({ _id: { $in: courseIds } }).select('teacherId').lean()) ids.add(String(course.teacherId));
    }
    ids.delete(userId);
    const users = await User.find({ _id: { $in: [...ids].slice(0, 500) }, status: 'active' }).select('name role').sort({ name: 1 }).lean();
    res.json({ success: true, data: users.map(user => ({ id: String(user._id), name: user.name, role: user.role })) });
  } catch (error) { next(error); }
});

/** Courses an event can be attached to: those the user manages or follows (checked again on save). */
calendarRoutes.get('/contexts', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.auth!.userId;
    const enrolled = await Enrollment.find({ studentId: userId }).distinct('courseId');
    const courses = await Course.find({ $or: [{ teacherId: userId }, { coOwnerIds: userId }, { _id: { $in: enrolled } }] }).select('title').sort({ title: 1 }).limit(200).lean();
    res.json({ success: true, data: courses.map(course => ({ id: String(course._id), title: course.title })) });
  } catch (error) { next(error); }
});

// ------------------------------------------------------------------------------------------------------- preferences

const colorValue = z.string().regex(/^#[0-9a-f]{6}$/i);
const preferenceKey = z.string().max(600).regex(/^(sessions|personal|exams|course|pending|(google|microsoft):.+)$/);
calendarRoutes.get('/preferences', async (req: AuthRequest, res, next) => {
  try {
    const preference = await CalendarPreference.findById(req.auth!.userId).lean();
    res.json({ success: true, data: { colors: preference?.colors || {}, hidden: preference?.hidden || [], defaultView: preference?.defaultView || 'week', timeZone: preference?.timeZone || '', defaultDurationMinutes: preference?.defaultDurationMinutes || 60 } });
  } catch (error) { next(error); }
});
calendarRoutes.put('/preferences', async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({
      colors: z.record(preferenceKey, colorValue).refine(value => Object.keys(value).length <= 100, 'TOO_MANY_COLORS').optional(),
      hidden: z.array(preferenceKey).max(100).optional(), defaultView: z.enum(['month', 'week', 'day', 'agenda']).optional(),
      timeZone: z.union([z.literal(''), z.string().max(64).refine(isValidTimeZone, 'INVALID_TIMEZONE')]).optional(), defaultDurationMinutes: z.number().int().min(15).max(480).optional(),
    }).strict().parse(req.body);
    const saved = await CalendarPreference.findByIdAndUpdate(req.auth!.userId, { $set: input }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    res.json({ success: true, data: { colors: saved!.colors, hidden: saved!.hidden, defaultView: saved!.defaultView, timeZone: saved!.timeZone, defaultDurationMinutes: saved!.defaultDurationMinutes } });
  } catch (error) { next(error); }
});

// ------------------------------------------------------------------------------------------------------- connections

calendarRoutes.get('/providers', (_req, res) => {
  res.json({ success: true, data: { google: providerConfigured('google'), microsoft: providerConfigured('microsoft'), pushNotifications: !!env.CALENDAR_WEBHOOK_BASE_URL } });
});
calendarRoutes.get('/connections', async (req: AuthRequest, res, next) => {
  try {
    await migrateLegacyGoogle(req.auth!.userId);
    const connections = await CalendarConnection.find({ userId: req.auth!.userId }).sort({ provider: 1 }).lean();
    res.json({ success: true, data: connections.map(connectionDto) });
  } catch (error) { next(error); }
});
calendarRoutes.post('/connections/:provider/connect', async (req: AuthRequest, res, next) => {
  try {
    const provider = providerName.parse(req.params.provider);
    const { access } = z.object({ access: z.enum(['read', 'write']).default('write') }).strict().parse(req.body || {});
    res.json({ success: true, data: { authorizationUrl: startConnect(req.auth!.userId, provider, access) } });
  } catch (error) { next(error); }
});
calendarRoutes.patch('/connections/:connectionId', async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ syncMode: z.enum(['read_only', 'push', 'two_way']).optional(), defaultCalendarId: z.string().max(512).optional(), calendars: z.array(z.object({ id: z.string().max(512), selected: z.boolean() }).strict()).max(200).optional() }).strict().parse(req.body);
    res.json({ success: true, data: connectionDto(await updateConnectionSettings(req.auth!.userId, String(req.params.connectionId), input)) });
  } catch (error) { next(error); }
});
const ownConnection = async (req: AuthRequest) => {
  const id = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.connectionId);
  const connection = id.success && await CalendarConnection.findOne({ _id: id.data, userId: req.auth!.userId }).lean();
  if (!connection) throw new AppError(404, 'CALENDAR_CONNECTION_NOT_FOUND');
  return connection;
};
calendarRoutes.post('/connections/:connectionId/sync', async (req: AuthRequest, res, next) => {
  try {
    const connection = await ownConnection(req);
    const result = await syncConnection(String(connection._id), { manual: true });
    res.json({ success: true, data: { result, connection: connectionDto(await CalendarConnection.findById(connection._id).lean()) } });
  } catch (error) { next(error); }
});
calendarRoutes.post('/connections/:connectionId/refresh-calendars', async (req: AuthRequest, res, next) => {
  try {
    const connection = await ownConnection(req);
    await refreshCalendars(String(connection._id)).catch(() => { throw new AppError(502, 'CALENDAR_PROVIDER_ERROR'); });
    res.json({ success: true, data: connectionDto(await CalendarConnection.findById(connection._id).lean()) });
  } catch (error) { next(error); }
});
calendarRoutes.delete('/connections/:connectionId', async (req: AuthRequest, res, next) => {
  try { const connection = await ownConnection(req); await disconnect(req.auth!.userId, String(connection._id)); res.status(204).end(); }
  catch (error) { next(error); }
});

// Former Google-only endpoints, kept for existing clients.
calendarRoutes.get('/google/status', async (req: AuthRequest, res, next) => {
  try {
    await migrateLegacyGoogle(req.auth!.userId);
    const connection = await CalendarConnection.findOne({ userId: req.auth!.userId, provider: 'google' }).lean();
    res.json({ success: true, data: { configured: providerConfigured('google'), connected: !!connection && connection.status !== 'expired', connectedAt: connection?.createdAt || null } });
  } catch (error) { next(error); }
});
calendarRoutes.post('/google/connect', async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: { authorizationUrl: startConnect(req.auth!.userId, 'google', 'write') } }); }
  catch (error) { next(error); }
});
calendarRoutes.delete('/google', async (req: AuthRequest, res, next) => {
  try {
    await migrateLegacyGoogle(req.auth!.userId);
    const connection = await CalendarConnection.findOne({ userId: req.auth!.userId, provider: 'google' }).lean();
    if (connection) await disconnect(req.auth!.userId, String(connection._id));
    res.status(204).end();
  } catch (error) { next(error); }
});
