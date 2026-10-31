import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_calendar_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.CALENDAR_WEBHOOK_BASE_URL = 'https://api.example.test/api/v1';
process.env.CALENDAR_CRON_SECRET = 'cron-secret-for-tests-0123456789abcdef';
for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_DRIVE_REDIRECT_URI', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI', 'MICROSOFT_CALENDAR_REDIRECT_URI', 'CALENDAR_TOKEN_KEY']) delete process.env[key];

let server, baseUrl, User, Course, Enrollment, Notification, Conversation, Message, TutoringSession, models, sync, events, providers, ProviderError, crypto;

/**
 * Simulated provider with the behaviour the sync relies on: incremental cursors, etags, conditional updates, idempotent creates,
 * expired cursors, revoked grants, Teams meetings. No real Google or Microsoft account is involved.
 */
function simulatedProvider(name) {
  const calendars = [
    { id: 'cal-main', name: 'Main', color: '#d50000', primary: true, canEdit: true, teamsAvailable: name === 'microsoft' },
    { id: 'cal-shared', name: 'Shared (read only)', color: '#0b8043', primary: false, canEdit: false, teamsAvailable: false },
  ];
  const events = new Map(); // `${calendarId}|${id}` -> event
  const log = []; let version = 0, tokenCounter = 0;
  const state = { revoked: false, cursorExpired: false, failNext: null, writes: 0, watches: 0, stops: 0, revokes: 0, validTokens: new Set() };
  const record = (calendarId, id, removed) => log.push({ v: ++version, calendarId, id, removed });
  const fail = op => { if (state.failNext?.op === op) { const code = state.failNext.code; state.failNext = null; throw new ProviderError(code); } };
  const token = () => { const value = `${name}-at-${++tokenCounter}`; state.validTokens.add(value); return { accessToken: value, expiresAt: new Date(Date.now() + 3600_000) }; };
  const check = accessToken => { if (state.revoked || !state.validTokens.has(accessToken)) throw new ProviderError('AUTH_EXPIRED'); };
  const put = (calendarId, event) => { const etag = `etag-${++version}`; const stored = { ...event, etag }; events.set(`${calendarId}|${event.id}`, stored); record(calendarId, event.id, false); return { ...stored }; };
  const fromWrite = (write, id) => ({ id, title: write.title, description: write.description, start: write.start, end: write.end, allDay: write.allDay, timeZone: write.timeZone, location: write.location, meetingUrl: '', teamsJoinUrl: write.teamsMeeting ? `https://teams.microsoft.com/l/meetup-join/${id}` : '', cancelled: false, attendees: write.sendInvites ? write.attendees : [] });
  return {
    state, events,
    remote: {
      create: (calendarId, fields) => put(calendarId, { id: randomUUID(), description: '', allDay: false, timeZone: 'UTC', location: '', meetingUrl: '', teamsJoinUrl: '', cancelled: false, ...fields }),
      update: (calendarId, id, fields) => put(calendarId, { ...events.get(`${calendarId}|${id}`), ...fields }),
      remove: (calendarId, id) => { events.delete(`${calendarId}|${id}`); record(calendarId, id, true); },
      list: calendarId => [...events.entries()].filter(([key]) => key.startsWith(`${calendarId}|`)).map(([, event]) => event),
    },
    provider: {
      name, configured: () => true,
      authorizationUrl: (oauthState, access) => `https://login.${name}.example/authorize?state=${encodeURIComponent(oauthState)}&access=${access}`,
      async exchangeCode(code, access) {
        if (code === 'denied') throw new ProviderError('CONSENT_REQUIRED');
        state.revoked = false;
        return { tokens: { ...token(), refreshToken: `${name}-refresh-token-secret`, scopes: [`${name}.${access}`] }, account: { id: `${name}-account`, label: `user@${name}.example` } };
      },
      async refresh() { if (state.revoked) throw new ProviderError('AUTH_EXPIRED'); return { ...token(), scopes: [] }; },
      async revoke() { state.revokes += 1; },
      async listCalendars(accessToken) { check(accessToken); return calendars.map(calendar => ({ ...calendar })); },
      async listChanges(accessToken, calendarId, cursor) {
        check(accessToken); fail('listChanges');
        if (cursor && (state.cursorExpired || !/^v\d+$/.test(cursor))) { state.cursorExpired = false; throw new ProviderError('CURSOR_EXPIRED'); }
        if (!cursor) return { changes: [...events.entries()].filter(([key]) => key.startsWith(`${calendarId}|`)).map(([, event]) => ({ id: event.id, removed: false, event: { ...event } })), cursor: `v${version}` };
        const since = Number(cursor.slice(1)), latest = new Map();
        for (const entry of log) if (entry.v > since && entry.calendarId === calendarId) latest.set(entry.id, entry);
        const changes = [...latest.values()].map(entry => { const event = events.get(`${calendarId}|${entry.id}`); return entry.removed || !event ? { id: entry.id, removed: true } : { id: entry.id, removed: false, event: { ...event } }; });
        return { changes, cursor: `v${version}` };
      },
      async createEvent(accessToken, calendarId, write) {
        check(accessToken); fail('createEvent'); state.writes += 1;
        const id = `ext-${write.clientId}`;
        // Idempotent like the real APIs (deterministic Google id / Graph transactionId).
        if (events.has(`${calendarId}|${id}`)) return { ...events.get(`${calendarId}|${id}`) };
        return put(calendarId, fromWrite(write, id));
      },
      async updateEvent(accessToken, calendarId, eventId, write, etag) {
        check(accessToken); fail('updateEvent'); state.writes += 1;
        const current = events.get(`${calendarId}|${eventId}`);
        if (!current) throw new ProviderError('NOT_FOUND');
        if (etag && etag !== current.etag) throw new ProviderError('PRECONDITION_FAILED');
        return put(calendarId, { ...fromWrite(write, eventId), teamsJoinUrl: current.teamsJoinUrl });
      },
      async getEvent(accessToken, calendarId, eventId) { check(accessToken); const event = events.get(`${calendarId}|${eventId}`); return event ? { ...event } : null; },
      async deleteEvent(accessToken, calendarId, eventId) { check(accessToken); fail('deleteEvent'); if (events.has(`${calendarId}|${eventId}`)) { events.delete(`${calendarId}|${eventId}`); record(calendarId, eventId, true); } },
      async watch(accessToken) { check(accessToken); state.watches += 1; return { channelId: `${name}-channel-${state.watches}`, resourceId: `resource-${state.watches}`, expiresAt: new Date(Date.now() + 7 * 86_400_000) }; },
      async renewWatch(accessToken, channel) { check(accessToken); return { channelId: channel.channelId, resourceId: channel.resourceId, expiresAt: new Date(Date.now() + 7 * 86_400_000) }; },
      async stopWatch() { state.stops += 1; },
    },
  };
}

describe('Calendar on MongoDB (events, sessions, conflicts, preferences, provider sync)', { skip: !mongoUri }, () => {
  before(async () => {
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, notifications, messaging, sessions, calendarModels, syncService, eventService, providerModule, typeModule, cryptoModule] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/notifications/model.js'), import('../dist/modules/messaging/models.js'), import('../dist/modules/sessions/model.js'),
      import('../dist/modules/calendar/models.js'), import('../dist/modules/calendar/sync.service.js'), import('../dist/modules/calendar/events.service.js'),
      import('../dist/integrations/calendarProviders/index.js'), import('../dist/integrations/calendarProviders/types.js'), import('../dist/integrations/googleCalendar.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; Notification = notifications.Notification; Conversation = messaging.Conversation; Message = messaging.Message;
    TutoringSession = sessions.TutoringSession; models = calendarModels; sync = syncService; events = eventService; providers = providerModule; ProviderError = typeModule.CalendarProviderError; crypto = cryptoModule;
    await Promise.all([User.init(), TutoringSession.init(), models.CalendarEventModel.init(), models.CalendarConnection.init(), models.SessionCalendarLink.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  after(async () => {
    providers?.replaceCalendarProviderForTests('google', null);
    providers?.replaceCalendarProviderForTests('microsoft', null);
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  async function account(role, email, extra = {}) {
    const password = `${role}-password-2026`;
    const user = await User.create({ name: `${role} ${email.split('@')[0]}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active', ...extra });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { user, id: String(user._id), cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = who => async (method, url, body, headers = {}) => {
    const response = await fetch(`${baseUrl}${url}`, { method, redirect: 'manual', headers: { ...(who ? { Cookie: who.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json, headers: response.headers };
  };
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const range = () => `from=${encodeURIComponent(new Date(Date.now() - 40 * 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 120 * 86_400_000).toISOString())}`;
  const feed = async who => (await api(who)('GET', `/calendar/feed?${range()}`)).body.data;
  const syncNow = async connectionId => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await sync.syncConnection(connectionId);
      if (!result.skipped) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('sync lease never released');
  };

  let teacher, student, other, stranger, T, A, B, X, courseId;
  test('setup: a verified teacher, two enrolled students and an unrelated student', async () => {
    teacher = await account('teacher', 'cal-teacher@example.test', { teacherVerification: { specialty: 'Web', credentialsSummary: 'Angular trainer', status: 'approved', submittedAt: new Date() } });
    student = await account('student', 'cal-student@example.test');
    other = await account('student', 'cal-other@example.test');
    stranger = await account('student', 'cal-stranger@example.test');
    [T, A, B, X] = [teacher, student, other, stranger].map(api);
    const course = await Course.create({ title: 'Application Côté Client', slug: 'acc-calendar', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published', chapters: [] });
    courseId = String(course._id);
    await Enrollment.create([student, other].map(learner => ({ studentId: learner.user._id, courseId, accessType: 'free' })));
  });

  let eventId;
  test('a local event is stored in UTC from a wall-clock time of its time zone, DST included', async () => {
    const winter = await A('POST', '/calendar/events', { title: 'Révision', type: 'personal', start: '2027-01-15T14:00', end: '2027-01-15T15:30', timeZone: 'Africa/Tunis' });
    assert.equal(winter.status, 201);
    assert.equal(new Date(winter.body.data.start).toISOString(), '2027-01-15T13:00:00.000Z');
    assert.equal(winter.body.data.timeZone, 'Africa/Tunis');
    const summer = await A('POST', '/calendar/events', { title: 'Été', start: '2027-07-15T10:00', end: '2027-07-15T11:00', timeZone: 'Europe/Paris' });
    assert.equal(new Date(summer.body.data.start).toISOString(), '2027-07-15T08:00:00.000Z');
    const autumn = await A('POST', '/calendar/events', { title: 'Hiver', start: '2027-11-15T10:00', end: '2027-11-15T11:00', timeZone: 'Europe/Paris' });
    assert.equal(new Date(autumn.body.data.start).toISOString(), '2027-11-15T09:00:00.000Z');
    assert.equal((await A('POST', '/calendar/events', { title: 'Bad', start: '2027-01-15T14:00', end: '2027-01-15T13:00', timeZone: 'Africa/Tunis' })).body.error.code, 'INVALID_EVENT_TIME');
    assert.equal((await A('POST', '/calendar/events', { title: 'Bad', start: '2027-01-15T14:00', end: '2027-01-15T15:00', timeZone: 'Mars/Olympus' })).status, 400);
    assert.equal((await A('POST', '/calendar/events', { title: 'Bad', start: '2027-01-15T14:00', end: '2027-01-15T15:00', timeZone: 'UTC', mode: 'online', meetingUrl: 'http://insecure.example' })).status, 400);
  });

  test('create, read in the feed, move with a revision check, delete', async () => {
    const created = await A('POST', '/calendar/events', { title: 'Bloc de travail', type: 'personal', start: `${day(3)}T09:00`, end: `${day(3)}T10:00`, timeZone: 'UTC', mode: 'in_person', location: 'Bibliothèque', reminderMinutes: [30] });
    assert.equal(created.status, 201);
    eventId = created.body.data._id;
    const item = (await feed(student)).find(entry => entry.sourceId === eventId);
    assert.equal(item.kind, 'event'); assert.equal(item.calendarKey, 'personal'); assert.equal(item.location, 'Bibliothèque');
    assert.deepEqual(item.permissions, { edit: true, move: true, resize: true, delete: true, respond: false });
    const moved = await A('PATCH', `/calendar/events/${eventId}`, { expectedRevision: 0, start: `${day(3)}T11:00`, end: `${day(3)}T12:30`, timeZone: 'UTC' });
    assert.equal(moved.status, 200);
    assert.equal(new Date(moved.body.data.end).toISOString(), `${day(3)}T12:30:00.000Z`);
    assert.equal(moved.body.data.revision, 1);
    const stale = await A('PATCH', `/calendar/events/${eventId}`, { expectedRevision: 0, title: 'Écrasement' });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'EVENT_REVISION_CONFLICT');
    assert.equal((await B('PATCH', `/calendar/events/${eventId}`, { expectedRevision: 1, title: 'Intrus' })).status, 404);
    const extra = await A('POST', '/calendar/events', { title: 'À supprimer', start: `${day(4)}T09:00`, end: `${day(4)}T10:00`, timeZone: 'UTC' });
    assert.equal((await A('DELETE', `/calendar/events/${extra.body.data._id}`)).status, 204);
    assert.equal(await models.CalendarEventModel.countDocuments({ _id: extra.body.data._id }), 0);
  });

  test('overlaps are explained and can be confirmed; others are only shown as busy', async () => {
    const clash = await A('POST', '/calendar/events', { title: 'Chevauchement', start: `${day(3)}T12:00`, end: `${day(3)}T13:00`, timeZone: 'UTC' });
    assert.equal(clash.status, 409); assert.equal(clash.body.error.code, 'EVENT_CONFLICT');
    assert.equal(clash.body.error.details.conflicts.length, 1);
    assert.equal(clash.body.error.details.conflicts[0].title, 'Bloc de travail');
    assert.equal(clash.body.error.details.conflicts[0].mine, true);
    const confirmed = await A('POST', '/calendar/events', { title: 'Chevauchement voulu', start: `${day(3)}T12:00`, end: `${day(3)}T13:00`, timeZone: 'UTC', allowOverlap: true });
    assert.equal(confirmed.status, 201);
    const busy = await T('POST', '/calendar/conflicts', { start: `${day(3)}T12:15`, end: `${day(3)}T12:45`, timeZone: 'UTC', participantIds: [student.id] });
    assert.equal(busy.status, 200);
    assert.ok(busy.body.data.conflicts.length >= 1);
    assert.ok(busy.body.data.conflicts.every(conflict => !conflict.title && !conflict.id && conflict.mine === false), 'details of the student agenda are never disclosed');
  });

  test('participants: only reachable people, invitations on request, answers notify the owner', async () => {
    const refused = await A('POST', '/calendar/events', { title: 'Inconnu', start: `${day(5)}T09:00`, end: `${day(5)}T10:00`, timeZone: 'UTC', participantIds: [stranger.id] });
    assert.equal(refused.status, 404); assert.equal(refused.body.error.code, 'PARTICIPANT_NOT_FOUND');
    const silent = await T('POST', '/calendar/events', { title: 'Brouillon de réunion', type: 'meeting', start: `${day(5)}T09:00`, end: `${day(5)}T10:00`, timeZone: 'UTC', participantIds: [student.id] });
    assert.equal(silent.status, 201);
    assert.equal((await feed(student)).some(item => item.sourceId === silent.body.data._id), false, 'not invited yet: not shown');
    const before = await Notification.countDocuments({ userId: student.user._id });
    const invited = await T('POST', '/calendar/events', { title: 'Point projet', type: 'meeting', start: `${day(6)}T09:00`, end: `${day(6)}T10:00`, timeZone: 'UTC', participantIds: [student.id], notifyParticipants: true });
    assert.equal(invited.status, 201);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await Notification.countDocuments({ userId: student.user._id }), before + 1);
    const seen = (await feed(student)).find(item => item.sourceId === invited.body.data._id);
    assert.equal(seen.isOwner, false); assert.equal(seen.permissions.respond, true); assert.equal(seen.permissions.edit, false);
    assert.equal((await A('PATCH', `/calendar/events/${invited.body.data._id}`, { expectedRevision: 0, title: 'Pris en main' })).status, 403);
    assert.equal((await A('DELETE', `/calendar/events/${invited.body.data._id}`)).status, 403);
    const answer = await A('POST', `/calendar/events/${invited.body.data._id}/respond`, { status: 'accepted' });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.data.participants[0].status, 'accepted');
    assert.equal((await X('POST', `/calendar/events/${invited.body.data._id}/respond`, { status: 'accepted' })).status, 404);
    // Deleting an event people were invited to keeps it as cancelled for them.
    assert.equal((await T('DELETE', `/calendar/events/${invited.body.data._id}`)).status, 204);
    assert.equal((await models.CalendarEventModel.findById(invited.body.data._id).lean()).status, 'cancelled');
  });

  test('an event created from a chat message must come from one of the user\'s conversations', async () => {
    const conversation = await Conversation.create({ participants: [teacher.user._id, student.user._id], participantKey: [teacher.id, student.id].sort().join(':') });
    const message = await Message.create({ conversationId: conversation._id, senderId: student.user._id, text: 'On se voit demain à 14h ?', readBy: [student.user._id] });
    assert.equal((await X('POST', '/calendar/events', { title: 'Espion', start: `${day(7)}T14:00`, end: `${day(7)}T15:00`, timeZone: 'UTC', sourceMessageId: String(message._id) })).body.error.code, 'MESSAGE_NOT_FOUND');
    const ok = await A('POST', '/calendar/events', { title: 'Rendez-vous', type: 'appointment', start: `${day(7)}T14:00`, end: `${day(7)}T15:00`, timeZone: 'UTC', sourceMessageId: String(message._id), participantIds: [teacher.id] });
    assert.equal(ok.status, 201);
    // A conversation also makes the stranger invitable once it exists.
    const invitees = await A('GET', '/calendar/invitees');
    assert.ok(invitees.body.data.some(user => user.id === teacher.id));
    assert.equal(invitees.body.data.some(user => user.id === stranger.id), false);
  });

  test('tutoring sessions: slots move from the calendar, proposals are answered by the student, rules unchanged', async () => {
    const slot = await T('POST', '/sessions/availability', { startAt: `${day(10)}T10:00`, endAt: `${day(10)}T11:00`, timeZone: 'Africa/Tunis', type: 'online', price: 0 });
    assert.equal(slot.status, 201);
    assert.equal(new Date(slot.body.data.startAt).toISOString(), `${day(10)}T09:00:00.000Z`);
    const clash = await T('POST', '/sessions/availability', { startAt: `${day(10)}T09:30:00Z`, endAt: `${day(10)}T10:30:00Z`, type: 'online', price: 0 });
    assert.equal(clash.status, 409); assert.equal(clash.body.error.code, 'SESSION_TIME_CONFLICT'); assert.ok(clash.body.error.details.conflicts.length);
    const moved = await T('PATCH', `/sessions/${slot.body.data._id}/time`, { startAt: `${day(10)}T14:00`, endAt: `${day(10)}T15:30`, timeZone: 'Africa/Tunis' });
    assert.equal(moved.status, 200); assert.equal(new Date(moved.body.data.endAt).toISOString(), `${day(10)}T14:30:00.000Z`);
    assert.equal((await A('POST', '/sessions/availability', { startAt: `${day(11)}T10:00:00Z`, endAt: `${day(11)}T11:00:00Z`, type: 'online', price: 0 })).status, 403);
    assert.equal((await A('PATCH', `/sessions/${slot.body.data._id}/time`, { startAt: `${day(10)}T16:00:00Z`, endAt: `${day(10)}T17:00:00Z` })).status, 403);

    assert.equal((await T('POST', '/sessions/proposals', { studentId: stranger.id, startAt: `${day(12)}T10:00:00Z`, endAt: `${day(12)}T11:00:00Z`, type: 'online', subject: 'Signals' })).status, 404);
    const proposal = await T('POST', '/sessions/proposals', { studentId: student.id, startAt: `${day(12)}T10:00`, endAt: `${day(12)}T11:00`, timeZone: 'UTC', type: 'online', subject: 'Signals et RxJS' });
    assert.equal(proposal.status, 201); assert.equal(proposal.body.data.status, 'pending'); assert.equal(proposal.body.data.proposedBy, 'teacher'); assert.equal(proposal.body.data.price, 0);
    const studentView = (await feed(student)).find(item => item.sourceId === proposal.body.data._id);
    assert.equal(studentView.permissions.respond, true); assert.equal(studentView.calendarKey, 'pending');
    assert.equal((await T('PATCH', `/sessions/${proposal.body.data._id}/status`, { status: 'confirmed' })).status, 403, 'a teacher cannot accept their own proposal');
    assert.equal((await B('PATCH', `/sessions/${proposal.body.data._id}/status`, { status: 'confirmed' })).status, 403);
    const accepted = await A('PATCH', `/sessions/${proposal.body.data._id}/status`, { status: 'confirmed' });
    assert.equal(accepted.status, 200); assert.equal(accepted.body.data.status, 'confirmed');
    assert.equal((await T('PATCH', `/sessions/${proposal.body.data._id}/time`, { startAt: `${day(12)}T15:00:00Z`, endAt: `${day(12)}T16:00:00Z` })).body.error.code, 'SESSION_NOT_MOVABLE');

    // A student booking still needs the teacher's answer (existing rule).
    const booked = await A('POST', `/sessions/${slot.body.data._id}/book`, { subject: 'Questions' });
    assert.equal(booked.status, 201);
    assert.equal((await A('PATCH', `/sessions/${slot.body.data._id}/status`, { status: 'confirmed' })).status, 403);
    assert.equal((await T('DELETE', `/sessions/${slot.body.data._id}`)).body.error.code, 'SESSION_NOT_DELETABLE');
    const free = await T('POST', '/sessions/availability', { startAt: `${day(13)}T10:00:00Z`, endAt: `${day(13)}T11:00:00Z`, type: 'in_person', price: 0, venue: 'Salle B' });
    assert.equal((await T('DELETE', `/sessions/${free.body.data._id}`)).status, 204);
  });

  test('tutoring ↔ calendar: one record per slot, distinct states in the feed, payment and move rules kept, no duplicate on double submit', async () => {
    // Published from the calendar popup (wall-clock time + zone, optional subject): a single TutoringSession.
    const published = await T('POST', '/sessions/availability', { startAt: `${day(40)}T09:00`, endAt: `${day(40)}T10:00`, timeZone: 'Africa/Tunis', type: 'in_person', price: 30, venue: 'Salle A', subject: 'Bac maths', notes: 'Apporter les annales' });
    assert.equal(published.status, 201);
    const slotId = published.body.data._id;
    assert.equal(await TutoringSession.countDocuments({ teacherId: teacher.user._id, startAt: new Date(`${day(40)}T08:00:00.000Z`) }), 1);
    const listed = (await T('GET', '/sessions')).body.data.find(session => session._id === slotId);
    assert.equal(listed.status, 'available'); assert.equal(listed.subject, 'Bac maths'); assert.equal(listed.price, 30);
    let item = (await feed(teacher)).find(entry => entry.sourceId === slotId);
    assert.equal(item.id, `session-${slotId}`); assert.equal(item.calendarKey, 'slots'); assert.equal(item.status, 'available'); assert.equal(item.subject, 'Bac maths');
    assert.equal(item.price, 30); assert.equal(item.mode, 'in_person'); assert.equal(item.location, 'Salle A');
    assert.equal(item.permissions.move, true, 'an open slot can be moved');
    assert.ok(!(await feed(student)).some(entry => entry.sourceId === slotId), 'open slots are not in students\' calendars');

    // Double submission (double click / network retry): exactly one slot is created.
    const twice = await Promise.all([1, 2].map(() => T('POST', '/sessions/availability', { startAt: `${day(41)}T09:00`, endAt: `${day(41)}T10:00`, timeZone: 'UTC', type: 'online', price: 0 })));
    assert.deepEqual(twice.map(response => response.status).sort(), [201, 409]);
    assert.equal(await TutoringSession.countDocuments({ teacherId: teacher.user._id, startAt: new Date(`${day(41)}T09:00:00.000Z`) }), 1);

    // A paid checkout in progress holds the slot: shown to the teacher as awaiting payment, not yet to the student; it cannot be accepted.
    await TutoringSession.updateOne({ _id: slotId }, { $set: { status: 'pending', studentId: student.user._id, subject: 'Dérivées', paymentStatus: 'awaiting_payment', reservationExpiresAt: new Date(Date.now() + 15 * 60_000) } });
    item = (await feed(teacher)).find(entry => entry.sourceId === slotId);
    assert.equal(item.calendarKey, 'pending'); assert.equal(item.paymentStatus, 'awaiting_payment'); assert.equal(item.permissions.move, false);
    assert.ok(!(await feed(student)).some(entry => entry.sourceId === slotId));
    assert.equal((await T('PATCH', `/sessions/${slotId}/status`, { status: 'confirmed' })).body.error.code, 'SESSION_PAYMENT_PENDING');
    assert.equal((await T('PATCH', `/sessions/${slotId}/time`, { startAt: `${day(40)}T12:00`, endAt: `${day(40)}T13:00`, timeZone: 'UTC' })).body.error.code, 'SESSION_NOT_MOVABLE');

    // Paid: the request is the same record, now in both calendars; the teacher accepts it on the Tutoring page.
    await TutoringSession.updateOne({ _id: slotId }, { $set: { paymentStatus: 'paid', reservationExpiresAt: null } });
    item = (await feed(student)).find(entry => entry.sourceId === slotId);
    assert.equal(item.calendarKey, 'pending'); assert.equal(item.permissions.respond, false, 'a student does not answer their own request');
    assert.equal((await A('PATCH', `/sessions/${slotId}/status`, { status: 'confirmed' })).status, 403);
    assert.equal((await B('PATCH', `/sessions/${slotId}/status`, { status: 'confirmed' })).status, 403);
    const accepted = await T('PATCH', `/sessions/${slotId}/status`, { status: 'confirmed' });
    assert.equal(accepted.status, 200);
    const [teacherItem, studentItem] = [(await feed(teacher)).find(entry => entry.sourceId === slotId), (await feed(student)).find(entry => entry.sourceId === slotId)];
    assert.equal(teacherItem.status, 'confirmed'); assert.equal(teacherItem.calendarKey, 'sessions'); assert.equal(studentItem.status, 'confirmed');
    assert.equal(teacherItem.permissions.move, false, 'a confirmed session is not moved from the calendar');
    assert.equal((await T('PATCH', `/sessions/${slotId}/time`, { startAt: `${day(40)}T12:00`, endAt: `${day(40)}T13:00`, timeZone: 'UTC' })).body.error.code, 'SESSION_NOT_MOVABLE');
    assert.equal(await TutoringSession.countDocuments({ teacherId: teacher.user._id, startAt: new Date(`${day(40)}T08:00:00.000Z`) }), 1, 'still a single record');
    assert.equal((await feed(teacher)).filter(entry => entry.sourceId === slotId).length, 1, 'no duplicate in the calendar');

    // A refused request stays visible as refused (not as an open slot).
    const second = await T('POST', '/sessions/availability', { startAt: `${day(42)}T09:00`, endAt: `${day(42)}T10:00`, timeZone: 'UTC', type: 'online', price: 0 });
    assert.equal((await A('POST', `/sessions/${second.body.data._id}/book`, { subject: 'Limites' })).status, 201);
    assert.equal((await feed(teacher)).find(entry => entry.sourceId === second.body.data._id).calendarKey, 'pending');
    assert.equal((await T('PATCH', `/sessions/${second.body.data._id}/status`, { status: 'rejected' })).status, 200);
    item = (await feed(teacher)).find(entry => entry.sourceId === second.body.data._id);
    assert.equal(item.status, 'rejected'); assert.equal(item.calendarKey, 'sessions');
  });

  test('feed: range required and bounded, authentication required', async () => {
    assert.equal((await A('GET', '/calendar/feed')).status, 400);
    assert.equal((await A('GET', `/calendar/feed?from=${new Date().toISOString()}&to=${new Date(Date.now() + 500 * 86_400_000).toISOString()}`)).body.error.code, 'INVALID_RANGE');
    assert.equal((await api(null)('GET', `/calendar/feed?${range()}`)).status, 401);
  });

  test('reminders are sent once per offset', async () => {
    const soon = await A('POST', '/calendar/events', { title: 'Rappel', start: new Date(Date.now() + 5 * 60_000).toISOString(), end: new Date(Date.now() + 35 * 60_000).toISOString(), timeZone: 'UTC', reminderMinutes: [10, 60], allowOverlap: true });
    assert.equal(soon.status, 201);
    const before = await Notification.countDocuments({ userId: student.user._id, 'template.key': 'calendarReminder' });
    await events.sendDueEventReminders();
    await events.sendDueEventReminders();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await Notification.countDocuments({ userId: student.user._id, 'template.key': 'calendarReminder' }), before + 1);
    assert.deepEqual((await models.CalendarEventModel.findById(soon.body.data._id).lean()).remindersSent.sort(), [10, 60]);
  });

  test('preferences: colors and hidden calendars are validated and never touch event data', async () => {
    assert.equal((await A('PUT', '/calendar/preferences', { colors: { sessions: 'red' } })).status, 400);
    assert.equal((await A('PUT', '/calendar/preferences', { colors: { 'evil:key': '#ffffff' } })).status, 400);
    const saved = await A('PUT', '/calendar/preferences', { colors: { sessions: '#1d4ed8', 'google:cal-main': '#ea580c' }, hidden: ['exams'], defaultView: 'month', timeZone: 'Africa/Tunis' });
    assert.equal(saved.status, 200);
    const read = await A('GET', '/calendar/preferences');
    assert.equal(read.body.data.colors.sessions, '#1d4ed8'); assert.deepEqual(read.body.data.hidden, ['exams']); assert.equal(read.body.data.defaultView, 'month');
    assert.equal((await models.CalendarEventModel.findById(eventId).lean()).title, 'Bloc de travail');
  });

  // --------------------------------------------------------------------------------------------------- providers

  let google, microsoft, googleConnection;
  test('without provider configuration the calendar keeps working and connecting says why', async () => {
    const status = await A('GET', '/calendar/providers');
    assert.deepEqual(status.body.data, { google: false, microsoft: false, pushNotifications: true });
    const refused = await A('POST', '/calendar/connections/google/connect', { access: 'write' });
    assert.equal(refused.status, 503); assert.equal(refused.body.error.code, 'GOOGLE_CALENDAR_NOT_CONFIGURED');
    assert.equal((await A('POST', '/calendar/connections/microsoft/connect', {})).body.error.code, 'MICROSOFT_CALENDAR_NOT_CONFIGURED');
    assert.equal((await A('GET', `/calendar/feed?${range()}`)).status, 200);
  });

  test('OAuth connection: signed state bound to the user and provider, tokens encrypted and never returned', async () => {
    google = simulatedProvider('google'); microsoft = simulatedProvider('microsoft');
    providers.replaceCalendarProviderForTests('google', google.provider);
    providers.replaceCalendarProviderForTests('microsoft', microsoft.provider);
    google.remote.create('cal-main', { title: 'Dentiste', start: new Date(`${day(8)}T08:00:00Z`), end: new Date(`${day(8)}T09:00:00Z`) });
    google.remote.create('cal-main', { title: 'Sport', start: new Date(`${day(9)}T18:00:00Z`), end: new Date(`${day(9)}T19:00:00Z`) });
    google.remote.create('cal-shared', { title: 'Réunion équipe', start: new Date(`${day(9)}T10:00:00Z`), end: new Date(`${day(9)}T11:00:00Z`) });

    const start = await A('POST', '/calendar/connections/google/connect', { access: 'write' });
    assert.equal(start.status, 200);
    const state = new URL(start.body.data.authorizationUrl).searchParams.get('state');
    const forged = await api(null)('GET', `/calendar/google/callback?code=ok&state=${encodeURIComponent(state.slice(0, -2) + 'xx')}`);
    const outcome = response => Object.fromEntries(new URL(response.headers.get('location')).searchParams);
    assert.equal(forged.status, 303); assert.equal(outcome(forged).calendar, 'error'); assert.equal(outcome(forged).code, 'INVALID_OAUTH_STATE');
    const wrongProvider = await api(null)('GET', `/calendar/microsoft/callback?code=ok&state=${encodeURIComponent(state)}`);
    assert.equal(outcome(wrongProvider).code, 'INVALID_OAUTH_STATE');
    const denied = await api(null)('GET', `/calendar/google/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    assert.equal(outcome(denied).code, 'CALENDAR_CONSENT_DENIED');
    const done = await api(null)('GET', `/calendar/google/callback?code=ok&state=${encodeURIComponent(state)}`);
    assert.equal(outcome(done).calendar, 'connected'); assert.equal(outcome(done).google, 'connected', 'former parameter kept');

    const list = await A('GET', '/calendar/connections');
    assert.equal(list.body.data.length, 1);
    googleConnection = list.body.data[0];
    assert.equal(googleConnection.provider, 'google'); assert.equal(googleConnection.accountLabel, 'user@google.example');
    assert.deepEqual(googleConnection.calendars.map(calendar => [calendar.id, calendar.selected, calendar.canEdit]), [['cal-main', true, true], ['cal-shared', false, false]]);
    assert.equal(JSON.stringify(list.body).includes('refresh-token-secret'), false);
    const stored = await models.CalendarConnection.findById(googleConnection.id).select('+refreshToken').lean();
    assert.notEqual(stored.refreshToken, 'google-refresh-token-secret');
    assert.equal(crypto.decryptToken(stored.refreshToken), 'google-refresh-token-secret');
    assert.equal((await B('GET', '/calendar/connections')).body.data.length, 0, 'connections are personal');
  });

  test('initial and repeated pulls import external events once, read-only outside two-way mode', async () => {
    await syncNow(googleConnection.id);
    await syncNow(googleConnection.id);
    const imported = (await feed(student)).filter(item => item.kind === 'external');
    assert.deepEqual(imported.map(item => item.title).sort(), ['Dentiste', 'Sport']);
    assert.ok(imported.every(item => item.calendarKey === 'google:cal-main' && !item.permissions.edit && !item.permissions.move));
    assert.equal(await models.CalendarEventModel.countDocuments({ source: 'google' }), 2);
    assert.equal(google.state.watches, 1, 'one notification channel for the selected calendar');
  });

  test('incremental pull applies remote updates and deletions', async () => {
    const [dentist] = google.remote.list('cal-main').filter(event => event.title === 'Dentiste');
    google.remote.update('cal-main', dentist.id, { title: 'Dentiste (déplacé)', start: new Date(`${day(8)}T10:00:00Z`), end: new Date(`${day(8)}T11:00:00Z`) });
    const [sport] = google.remote.list('cal-main').filter(event => event.title === 'Sport');
    google.remote.remove('cal-main', sport.id);
    await syncNow(googleConnection.id);
    const titles = (await feed(student)).filter(item => item.kind === 'external').map(item => item.title);
    assert.deepEqual(titles, ['Dentiste (déplacé)']);
  });

  let pushedId;
  test('push: an event created for the Google calendar is written once, and its echo is not re-imported', async () => {
    const created = await A('POST', '/calendar/events', { title: 'Soutenance', type: 'meeting', start: `${day(14)}T09:00`, end: `${day(14)}T10:00`, timeZone: 'UTC', destination: { provider: 'google', calendarId: 'cal-main' } });
    assert.equal(created.status, 201);
    pushedId = created.body.data._id;
    assert.equal(created.body.data.external.state, 'synced');
    assert.ok(created.body.data.external.eventId);
    await syncNow(googleConnection.id);
    await syncNow(googleConnection.id);
    assert.equal(await models.CalendarEventModel.countDocuments({ title: 'Soutenance' }), 1, 'no duplicate after repeated syncs');
    assert.equal(google.remote.list('cal-main').filter(event => event.title === 'Soutenance').length, 1);
    await sync.pushEvent(pushedId, { force: true });
    assert.equal(google.remote.list('cal-main').filter(event => event.title === 'Soutenance').length, 1, 'retrying never duplicates on the provider');
    assert.equal((await A('POST', '/calendar/events', { title: 'Lecture seule', start: `${day(15)}T09:00`, end: `${day(15)}T10:00`, timeZone: 'UTC', destination: { provider: 'google', calendarId: 'cal-shared' } })).body.error.code, 'CALENDAR_READ_ONLY');
    assert.equal((await A('POST', '/calendar/events', { title: 'Teams', start: `${day(15)}T09:00`, end: `${day(15)}T10:00`, timeZone: 'UTC', destination: { provider: 'google', calendarId: 'cal-main' }, teamsMeeting: true })).body.error.code, 'TEAMS_NOT_AVAILABLE');
    assert.equal((await A('POST', '/calendar/events', { title: 'Teams', start: `${day(15)}T09:00`, end: `${day(15)}T10:00`, timeZone: 'UTC', teamsMeeting: true })).body.error.code, 'TEAMS_REQUIRES_MICROSOFT_CALENDAR');
  });

  test('a provider failure is reported on the event and retried by the job without duplicates', async () => {
    google.state.failNext = { op: 'createEvent', code: 'NETWORK' };
    const created = await A('POST', '/calendar/events', { title: 'Réseau instable', start: `${day(16)}T09:00`, end: `${day(16)}T10:00`, timeZone: 'UTC', destination: { provider: 'google', calendarId: 'cal-main' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.external.state, 'error'); assert.equal(created.body.data.external.error, 'NETWORK');
    await sync.runCalendarSyncJob();
    const after = await models.CalendarEventModel.findById(created.body.data._id).lean();
    assert.equal(after.external.state, 'synced');
    assert.equal(google.remote.list('cal-main').filter(event => event.title === 'Réseau instable').length, 1);
  });

  test('two-way: imported events become editable on writable calendars only; edits reach the provider', async () => {
    const read = await A('PATCH', `/calendar/connections/${googleConnection.id}`, { syncMode: 'two_way', calendars: [{ id: 'cal-shared', selected: true }] });
    assert.equal(read.status, 200);
    await syncNow(googleConnection.id);
    const items = (await feed(student)).filter(item => item.kind === 'external');
    const dentist = items.find(item => item.title === 'Dentiste (déplacé)'), team = items.find(item => item.title === 'Réunion équipe');
    assert.equal(dentist.permissions.edit, true);
    assert.equal(team.permissions.edit, false, 'shared calendar without write access stays read-only');
    assert.equal((await A('PATCH', `/calendar/events/${team.sourceId}`, { expectedRevision: team.revision, title: 'Modifié' })).status, 403);
    const edited = await A('PATCH', `/calendar/events/${dentist.sourceId}`, { expectedRevision: dentist.revision, title: 'Dentiste confirmé' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.external.state, 'synced');
    assert.equal(google.remote.list('cal-main').some(event => event.title === 'Dentiste confirmé'), true);
    await syncNow(googleConnection.id);
    assert.equal((await models.CalendarEventModel.findById(dentist.sourceId).lean()).title, 'Dentiste confirmé', 'echo of our own write is ignored');
  });

  test('conflict: both sides changed → flagged, nothing overwritten until the owner chooses', async () => {
    const local = await models.CalendarEventModel.findOne({ title: 'Dentiste confirmé' }).lean();
    google.state.failNext = { op: 'updateEvent', code: 'NETWORK' };
    const edited = await A('PATCH', `/calendar/events/${local._id}`, { expectedRevision: local.revision, title: 'Version EduMarket' });
    assert.equal(edited.body.data.external.state, 'error');
    google.remote.update('cal-main', local.external.eventId, { title: 'Version Google' });
    await syncNow(googleConnection.id);
    const flagged = await models.CalendarEventModel.findById(local._id).lean();
    assert.equal(flagged.external.state, 'conflict'); assert.equal(flagged.title, 'Version EduMarket'); assert.equal(flagged.external.conflict.title, 'Version Google');
    // The retry job leaves conflicts alone: the provider keeps its version.
    await sync.runCalendarSyncJob();
    assert.equal(google.remote.list('cal-main').find(event => event.id === local.external.eventId).title, 'Version Google');
    assert.equal((await B('POST', `/calendar/events/${local._id}/resolve`, { keep: 'remote' })).status, 404);
    const resolved = await A('POST', `/calendar/events/${local._id}/resolve`, { keep: 'remote' });
    assert.equal(resolved.status, 200); assert.equal(resolved.body.data.title, 'Version Google'); assert.equal(resolved.body.data.external.state, 'synced');
    const conflictAgain = await models.CalendarEventModel.findById(pushedId).lean();
    google.state.failNext = { op: 'updateEvent', code: 'NETWORK' };
    await A('PATCH', `/calendar/events/${pushedId}`, { expectedRevision: conflictAgain.revision, title: 'Soutenance (salle 2)' });
    google.remote.update('cal-main', conflictAgain.external.eventId, { title: 'Soutenance (Google)' });
    await syncNow(googleConnection.id);
    const keepLocal = await A('POST', `/calendar/events/${pushedId}/resolve`, { keep: 'local' });
    assert.equal(keepLocal.body.data.external.state, 'synced');
    assert.equal(google.remote.list('cal-main').find(event => event.id === conflictAgain.external.eventId).title, 'Soutenance (salle 2)');
  });

  test('an expired cursor triggers a full listing that also removes events deleted meanwhile', async () => {
    const team = google.remote.list('cal-shared')[0];
    google.remote.remove('cal-shared', team.id);
    google.state.cursorExpired = true;
    await syncNow(googleConnection.id);
    assert.equal(await models.CalendarEventModel.countDocuments({ title: 'Réunion équipe' }), 0);
    const connection = await models.CalendarConnection.findById(googleConnection.id).lean();
    assert.equal(connection.status, 'connected'); assert.equal(connection.lastError, '');
  });

  test('a network failure during a pull is visible and the next run resumes from the saved cursor', async () => {
    google.state.failNext = { op: 'listChanges', code: 'NETWORK' };
    await syncNow(googleConnection.id);
    let connection = await models.CalendarConnection.findById(googleConnection.id).lean();
    assert.equal(connection.status, 'error'); assert.equal(connection.lastError, 'NETWORK');
    google.remote.create('cal-main', { title: 'Après panne', start: new Date(`${day(17)}T08:00:00Z`), end: new Date(`${day(17)}T09:00:00Z`) });
    await syncNow(googleConnection.id);
    connection = await models.CalendarConnection.findById(googleConnection.id).lean();
    assert.equal(connection.status, 'connected');
    assert.equal(await models.CalendarEventModel.countDocuments({ title: 'Après panne' }), 1);
  });

  test('notifications: only a known channel with the right secret triggers a pull; Graph validation is echoed', async () => {
    const connection = await models.CalendarConnection.findById(googleConnection.id).select('+channels +webhookSecret').lean();
    const channel = connection.channels[0];
    const guest = api(null);
    assert.equal((await guest('POST', '/calendar/webhooks/google', undefined, { 'X-Goog-Channel-ID': channel.channelId, 'X-Goog-Channel-Token': 'wrong-secret' })).status, 404);
    assert.equal((await guest('POST', '/calendar/webhooks/google', undefined, { 'X-Goog-Channel-ID': 'unknown', 'X-Goog-Channel-Token': connection.webhookSecret })).status, 404);
    assert.equal((await guest('POST', '/calendar/webhooks/google', undefined, { 'X-Goog-Channel-ID': channel.channelId, 'X-Goog-Channel-Token': connection.webhookSecret, 'X-Goog-Resource-State': 'exists' })).status, 200);
    const validation = await fetch(`${baseUrl}/calendar/webhooks/microsoft?validationToken=${encodeURIComponent('Validation: Token<1>')}`, { method: 'POST' });
    assert.equal(validation.status, 200); assert.match(validation.headers.get('content-type'), /text\/plain/); assert.equal(await validation.text(), 'Validation: Token<1>');
    assert.equal((await guest('POST', '/calendar/webhooks/microsoft', { value: [{ subscriptionId: 'nope', clientState: 'nope' }] })).status, 202);
  });

  test('cron endpoint requires the shared secret', async () => {
    assert.equal((await api(null)('POST', '/calendar/sync/cron', undefined, { 'X-Calendar-Cron-Secret': 'wrong' })).status, 401);
    const ok = await api(null)('POST', '/calendar/sync/cron', undefined, { 'X-Calendar-Cron-Secret': process.env.CALENDAR_CRON_SECRET });
    assert.equal(ok.status, 200); assert.equal(typeof ok.body.data.pulled, 'number');
  });

  let microsoftConnection;
  test('Microsoft: a Teams meeting is reported only once Graph returns its join URL; tutoring sessions are pushed and removed', async () => {
    const start = await T('POST', '/calendar/connections/microsoft/connect', { access: 'write' });
    const state = new URL(start.body.data.authorizationUrl).searchParams.get('state');
    assert.match((await api(null)('GET', `/calendar/microsoft/callback?code=ok&state=${encodeURIComponent(state)}`)).headers.get('location'), /calendar=connected/);
    microsoftConnection = (await T('GET', '/calendar/connections')).body.data[0];
    assert.equal(microsoftConnection.calendars.find(calendar => calendar.id === 'cal-main').teamsAvailable, true);
    const meeting = await T('POST', '/calendar/events', { title: 'Classe virtuelle', type: 'meeting', mode: 'online', start: `${day(20)}T09:00`, end: `${day(20)}T10:00`, timeZone: 'Africa/Tunis', destination: { provider: 'microsoft', calendarId: 'cal-main' }, teamsMeeting: true });
    assert.equal(meeting.status, 201);
    assert.match(meeting.body.data.teamsJoinUrl, /^https:\/\/teams\.microsoft\.com\//);
    microsoft.state.failNext = { op: 'createEvent', code: 'FORBIDDEN' };
    const failed = await T('POST', '/calendar/events', { title: 'Teams refusé', type: 'meeting', mode: 'online', start: `${day(21)}T09:00`, end: `${day(21)}T10:00`, timeZone: 'UTC', destination: { provider: 'microsoft', calendarId: 'cal-main' }, teamsMeeting: true });
    assert.equal(failed.body.data.teamsJoinUrl, ''); assert.equal(failed.body.data.external.state, 'error');

    const slot = await T('POST', '/sessions/availability', { startAt: `${day(22)}T10:00:00Z`, endAt: `${day(22)}T11:00:00Z`, type: 'online', price: 0 });
    await A('POST', `/sessions/${slot.body.data._id}/book`, { subject: 'Tests unitaires' });
    assert.equal((await T('PATCH', `/sessions/${slot.body.data._id}/status`, { status: 'confirmed' })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 300));
    const links = await models.SessionCalendarLink.find({ sessionId: slot.body.data._id }).lean();
    assert.equal(links.length, 2, 'teacher (Microsoft) and student (Google) copies');
    assert.equal(microsoft.remote.list('cal-main').filter(event => event.title === 'EduMarket · Tests unitaires').length, 1);
    await syncNow(microsoftConnection.id);
    assert.equal(await models.CalendarEventModel.countDocuments({ title: 'EduMarket · Tests unitaires' }), 0, 'session copies are never imported back');
    assert.equal((await A('PATCH', `/sessions/${slot.body.data._id}/status`, { status: 'cancelled' })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await models.SessionCalendarLink.countDocuments({ sessionId: slot.body.data._id }), 0);
    assert.equal(microsoft.remote.list('cal-main').filter(event => event.title === 'EduMarket · Tests unitaires').length, 0);
  });

  test('revoked access: the connection shows "expired", manual sync explains it, local calendar unaffected', async () => {
    google.state.revoked = true;
    await models.CalendarConnection.updateOne({ _id: googleConnection.id }, { $set: { accessTokenExpiresAt: new Date(0), lastSyncStartedAt: new Date(0) } });
    await syncNow(googleConnection.id).catch(() => undefined);
    const status = (await A('GET', '/calendar/connections')).body.data[0];
    assert.equal(status.status, 'expired');
    const manual = await A('POST', `/calendar/connections/${googleConnection.id}/sync`);
    assert.equal(manual.status, 409); assert.equal(manual.body.error.code, 'CALENDAR_AUTH_EXPIRED');
    assert.equal((await A('POST', '/calendar/events', { title: 'Toujours possible', start: `${day(25)}T09:00`, end: `${day(25)}T10:00`, timeZone: 'UTC' })).status, 201);
  });

  test('disconnect removes imported copies and tokens but keeps EduMarket events', async () => {
    assert.equal((await B('DELETE', `/calendar/connections/${googleConnection.id}`)).status, 404);
    assert.equal((await A('DELETE', `/calendar/connections/${googleConnection.id}`)).status, 204);
    assert.equal(await models.CalendarConnection.countDocuments({ _id: googleConnection.id }), 0);
    assert.equal(await models.CalendarEventModel.countDocuments({ ownerId: student.user._id, source: 'google' }), 0);
    const kept = await models.CalendarEventModel.findById(pushedId).lean();
    assert.equal(kept.title, 'Soutenance (salle 2)'); assert.equal(kept.external, undefined);
  });

  test('a Google connection made before multi-calendar sync is migrated without reconnecting', async () => {
    await User.updateOne({ _id: other.user._id }, { $set: { googleCalendar: { refreshToken: crypto.encryptToken('legacy-refresh'), connectedAt: new Date('2026-09-01') } } });
    const session = await TutoringSession.create({ teacherId: teacher.user._id, studentId: other.user._id, startAt: new Date(`${day(30)}T10:00:00Z`), endAt: new Date(`${day(30)}T11:00:00Z`), type: 'online', price: 0, status: 'confirmed', googleEventIds: { [other.id]: 'legacy-event-id' } });
    const list = await B('GET', '/calendar/connections');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].calendars[0].id, 'primary');
    assert.equal((await User.findById(other.user._id).select('+googleCalendar').lean()).googleCalendar, undefined);
    const link = await models.SessionCalendarLink.findOne({ sessionId: session._id }).lean();
    assert.equal(link.eventId, 'legacy-event-id');
    const status = await B('GET', '/calendar/google/status');
    assert.equal(status.body.data.connected, true);
  });
});
