import { afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Real adapters, simulated network: every request is recorded and answered by `respond`; no Google or Microsoft account is used.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://api.example.test/api/v1/calendar/google/callback';
process.env.MICROSOFT_CLIENT_ID = 'microsoft-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-client-secret';
process.env.MICROSOFT_CALENDAR_REDIRECT_URI = 'https://api.example.test/api/v1/calendar/microsoft/callback';

let google, microsoft, ProviderError, crypto;
const realFetch = globalThis.fetch;
let requests = [], respond = () => json(200, {});
function json(status, body, headers = {}) { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }

before(async () => {
  ({ googleCalendarProvider: google } = await import('../dist/integrations/calendarProviders/google.js'));
  ({ microsoftCalendarProvider: microsoft } = await import('../dist/integrations/calendarProviders/microsoft.js'));
  ({ CalendarProviderError: ProviderError } = await import('../dist/integrations/calendarProviders/types.js'));
  crypto = await import('../dist/integrations/googleCalendar.js');
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method || 'GET', headers: Object.fromEntries(Object.entries(init.headers || {})), body: init.body ? String(init.body) : '' };
    requests.push(request);
    return respond(request);
  };
});
afterEach(() => { requests = []; respond = () => json(200, {}); });
process.on('exit', () => { globalThis.fetch = realFetch; });

const write = (overrides = {}) => ({ clientId: '6720f1a2b3c4d5e6f7a8b9c0', title: 'Soutenance', description: 'Salle 2', start: new Date('2027-01-15T13:00:00Z'), end: new Date('2027-01-15T14:00:00Z'), allDay: false, timeZone: 'Africa/Tunis', location: 'Campus', attendees: ['amira@example.test'], sendInvites: false, teamsMeeting: false, ...overrides });

describe('Google Calendar adapter', () => {
  test('authorization asks the narrowest scopes for the chosen access, offline, with the signed state', () => {
    const read = new URL(google.authorizationUrl('signed-state', 'read'));
    assert.equal(read.origin + read.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(read.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly');
    assert.equal(read.searchParams.get('access_type'), 'offline');
    assert.equal(read.searchParams.get('state'), 'signed-state');
    assert.equal(read.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
    assert.equal(read.searchParams.has('client_secret'), false);
    assert.match(new URL(google.authorizationUrl('s', 'write')).searchParams.get('scope'), /auth\/calendar\.events( |$)/);
  });

  test('token exchange keeps the refresh token; a revoked grant becomes AUTH_EXPIRED', async () => {
    respond = () => json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'a b' });
    const { tokens } = await google.exchangeCode('code-1', 'write');
    assert.equal(tokens.refreshToken, 'refresh-1'); assert.deepEqual(tokens.scopes, ['a', 'b']);
    assert.match(requests[0].body, /client_secret=google-client-secret/);
    assert.match(requests[0].body, /grant_type=authorization_code/);
    respond = () => json(400, { error: 'invalid_grant' });
    await assert.rejects(google.refresh('refresh-1'), error => error instanceof ProviderError && error.code === 'AUTH_EXPIRED');
  });

  test('calendar list: pagination, edit rights from the access role; old scope → CONSENT_REQUIRED', async () => {
    respond = request => request.url.includes('pageToken=p2')
      ? json(200, { items: [{ id: 'team@group.calendar.google.com', summary: 'Équipe', accessRole: 'reader' }] })
      : json(200, { items: [{ id: 'me@example.test', summary: 'Moi', primary: true, accessRole: 'owner', backgroundColor: '#d50000' }], nextPageToken: 'p2' });
    const calendars = await google.listCalendars('token');
    assert.deepEqual(calendars.map(calendar => [calendar.id, calendar.primary, calendar.canEdit]), [['me@example.test', true, true], ['team@group.calendar.google.com', false, false]]);
    assert.equal(requests[0].headers.Authorization, 'Bearer token');
    respond = () => json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
    await assert.rejects(google.listCalendars('token'), error => error.code === 'CONSENT_REQUIRED');
  });

  test('incremental listing: time range only on the first call, sync token after, deletions and all-day events, 410 → CURSOR_EXPIRED', async () => {
    respond = request => request.url.includes('pageToken=n2')
      ? json(200, { items: [{ id: 'gone', status: 'cancelled' }], nextSyncToken: 'sync-2' })
      : json(200, { items: [
        { id: 'a', etag: '"1"', summary: 'Cours', start: { dateTime: '2026-11-02T14:00:00+01:00', timeZone: 'Africa/Tunis' }, end: { dateTime: '2026-11-02T15:00:00+01:00' }, hangoutLink: 'https://meet.google.com/abc' },
        { id: 'b', etag: '"2"', summary: 'Férié', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
      ], nextPageToken: 'n2' });
    const window = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-10-01T00:00:00Z') };
    const first = await google.listChanges('token', 'me@example.test', null, window);
    assert.equal(first.cursor, 'sync-2');
    assert.match(requests[0].url, /timeMin=2026-10-01/); assert.doesNotMatch(requests[0].url, /syncToken/);
    assert.match(requests[0].url, /singleEvents=true/);
    const [course, holiday, gone] = first.changes;
    assert.equal(course.event.start.toISOString(), '2026-11-02T13:00:00.000Z'); assert.equal(course.event.meetingUrl, 'https://meet.google.com/abc'); assert.equal(course.event.timeZone, 'Africa/Tunis');
    assert.equal(holiday.event.allDay, true);
    assert.deepEqual(gone, { id: 'gone', removed: true });
    requests = [];
    respond = () => json(200, { items: [], nextSyncToken: 'sync-3' });
    await google.listChanges('token', 'me@example.test', 'sync-2', window);
    assert.match(requests[0].url, /syncToken=sync-2/); assert.doesNotMatch(requests[0].url, /timeMin/);
    respond = () => json(410, { error: { errors: [{ reason: 'fullSyncRequired' }] } });
    await assert.rejects(google.listChanges('token', 'me@example.test', 'old', window), error => error.code === 'CURSOR_EXPIRED');
  });

  test('create: deterministic id, invitations only on request; a duplicate returns the existing event', async () => {
    respond = () => json(200, { id: 'em6720f1a2b3c4d5e6f7a8b9c0', etag: '"9"', summary: 'Soutenance', start: { dateTime: '2027-01-15T13:00:00Z' }, end: { dateTime: '2027-01-15T14:00:00Z' } });
    await google.createEvent('token', 'primary', write());
    const sent = JSON.parse(requests[0].body);
    assert.equal(sent.id, 'em6720f1a2b3c4d5e6f7a8b9c0');
    assert.match(requests[0].url, /sendUpdates=none/);
    assert.equal(sent.attendees, undefined, 'no attendee e-mail sent without explicit choice');
    assert.deepEqual(sent.start, { dateTime: '2027-01-15T13:00:00.000Z', timeZone: 'Africa/Tunis' });
    requests = [];
    await google.createEvent('token', 'primary', write({ sendInvites: true }));
    assert.match(requests[0].url, /sendUpdates=all/);
    assert.deepEqual(JSON.parse(requests[0].body).attendees, [{ email: 'amira@example.test' }]);
    requests = [];
    respond = request => request.method === 'POST' ? json(409, { error: { errors: [{ reason: 'duplicate' }] } }) : json(200, { id: 'em6720f1a2b3c4d5e6f7a8b9c0', etag: '"9"', start: { dateTime: '2027-01-15T13:00:00Z' }, end: { dateTime: '2027-01-15T14:00:00Z' } });
    const existing = await google.createEvent('token', 'primary', write());
    assert.equal(existing.id, 'em6720f1a2b3c4d5e6f7a8b9c0');
    assert.equal(requests.length, 2);
  });

  test('update is conditional on the etag (412 → PRECONDITION_FAILED); delete tolerates an already deleted event', async () => {
    respond = () => json(412, { error: { errors: [{ reason: 'conditionNotMet' }] } });
    await assert.rejects(google.updateEvent('token', 'primary', 'evt', write(), '"3"'), error => error.code === 'PRECONDITION_FAILED');
    assert.equal(requests[0].headers['If-Match'], '"3"');
    assert.equal(requests[0].method, 'PATCH');
    respond = () => json(410, {});
    await google.deleteEvent('token', 'primary', 'evt');
    respond = () => json(500, {});
    await assert.rejects(google.deleteEvent('token', 'primary', 'evt'), error => error.code === 'PROVIDER_ERROR');
  });

  test('watch channel carries the secret token; a network failure is NETWORK', async () => {
    respond = () => json(200, { resourceId: 'res-1', expiration: String(Date.now() + 3600_000) });
    const channel = await google.watch('token', 'me@example.test', { address: 'https://api.example.test/api/v1/calendar/webhooks/google', secret: 'channel-secret' });
    const body = JSON.parse(requests[0].body);
    assert.equal(body.type, 'web_hook'); assert.equal(body.token, 'channel-secret'); assert.equal(body.id, channel.channelId);
    respond = () => { throw new TypeError('fetch failed'); };
    await assert.rejects(google.listCalendars('token'), error => error.code === 'NETWORK');
  });
});

describe('Microsoft Graph adapter', () => {
  test('authorization: delegated scopes per access level, calendar redirect URI', () => {
    const url = new URL(microsoft.authorizationUrl('state', 'read'));
    assert.equal(url.origin, 'https://login.microsoftonline.com');
    assert.equal(url.searchParams.get('scope'), 'offline_access User.Read Calendars.Read');
    assert.equal(url.searchParams.get('redirect_uri'), process.env.MICROSOFT_CALENDAR_REDIRECT_URI);
    assert.equal(new URL(microsoft.authorizationUrl('state', 'write')).searchParams.get('scope'), 'offline_access User.Read Calendars.ReadWrite');
  });

  test('code exchange requests the consented scopes and labels the account; consent errors are explicit', async () => {
    respond = request => request.url.includes('/token') ? json(200, { access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600, scope: 'Calendars.Read' }) : json(200, { id: 'user-1', mail: 'prof@school.example' });
    const { account } = await microsoft.exchangeCode('code', 'read');
    assert.equal(account.label, 'prof@school.example');
    assert.match(decodeURIComponent(requests[0].body), /scope=offline_access\+User\.Read\+Calendars\.Read/);
    respond = () => json(400, { error: 'interaction_required' });
    await assert.rejects(microsoft.refresh('ms-refresh'), error => error.code === 'CONSENT_REQUIRED');
  });

  test('calendars expose Teams availability; delta follows next links to the delta link and reads removals', async () => {
    respond = () => json(200, { value: [
      { id: 'cal-1', name: 'Calendrier', isDefaultCalendar: true, canEdit: true, allowedOnlineMeetingProviders: ['teamsForBusiness'] },
      { id: 'cal-2', name: 'Anniversaires', canEdit: false, allowedOnlineMeetingProviders: [] },
    ] });
    const calendars = await microsoft.listCalendars('token');
    assert.deepEqual(calendars.map(calendar => [calendar.id, calendar.teamsAvailable, calendar.canEdit]), [['cal-1', true, true], ['cal-2', false, false]]);
    requests = [];
    respond = request => request.url.includes('skiptoken')
      ? json(200, { value: [{ id: 'old', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=d1' })
      : json(200, { value: [{ id: 'evt', '@odata.etag': 'W/"1"', subject: 'Réunion', start: { dateTime: '2026-11-02T13:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-02T14:00:00.0000000', timeZone: 'UTC' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$skiptoken=s1' });
    const result = await microsoft.listChanges('token', 'cal-1', null, { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-10-01T00:00:00Z') });
    assert.match(requests[0].url, /calendarView\/delta\?startDateTime=2026-10-01/);
    assert.match(requests[0].headers.Prefer, /outlook\.timezone="UTC"/);
    assert.equal(result.cursor, 'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=d1');
    assert.equal(result.changes[0].event.start.toISOString(), '2026-11-02T13:00:00.000Z');
    assert.equal(result.changes[0].event.teamsJoinUrl, 'https://teams.microsoft.com/l/meetup-join/x');
    assert.deepEqual(result.changes[1], { id: 'old', removed: true });
  });

  test('a stored cursor pointing outside Graph is refused (no token sent elsewhere); expired delta → CURSOR_EXPIRED', async () => {
    await assert.rejects(microsoft.listChanges('token', 'cal-1', 'https://attacker.example/steal', { start: new Date(), end: new Date() }), error => error.code === 'PROVIDER_ERROR');
    assert.equal(requests.length, 0);
    respond = () => json(410, { error: { code: 'SyncStateNotFound' } });
    await assert.rejects(microsoft.listChanges('token', 'cal-1', 'https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=old', { start: new Date(), end: new Date() }), error => error.code === 'CURSOR_EXPIRED');
  });

  test('create: transactionId for retries, Teams only when asked, attendees only with invitations', async () => {
    respond = () => json(201, { id: 'evt', '@odata.etag': 'W/"2"', subject: 'Soutenance', start: { dateTime: '2027-01-15T13:00:00.0000000' }, end: { dateTime: '2027-01-15T14:00:00.0000000' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/y' } });
    const created = await microsoft.createEvent('token', 'cal-1', write({ teamsMeeting: true }));
    const sent = JSON.parse(requests[0].body);
    assert.equal(sent.transactionId, '6720f1a2b3c4d5e6f7a8b9c0');
    assert.equal(sent.isOnlineMeeting, true); assert.equal(sent.onlineMeetingProvider, 'teamsForBusiness');
    assert.equal(sent.attendees, undefined);
    assert.deepEqual(sent.start, { dateTime: '2027-01-15T13:00:00.000', timeZone: 'UTC' });
    assert.equal(created.teamsJoinUrl, 'https://teams.microsoft.com/l/meetup-join/y');
    requests = [];
    await microsoft.createEvent('token', 'cal-1', write({ sendInvites: true }));
    const plain = JSON.parse(requests[0].body);
    assert.equal(plain.isOnlineMeeting, undefined);
    assert.deepEqual(plain.attendees, [{ emailAddress: { address: 'amira@example.test' }, type: 'required' }]);
  });

  test('subscriptions carry the client state and stay under the Outlook maximum lifetime', async () => {
    respond = () => json(201, { id: 'sub-1', expirationDateTime: new Date(Date.now() + 4200 * 60_000).toISOString() });
    const channel = await microsoft.watch('token', 'cal-1', { address: 'https://api.example.test/api/v1/calendar/webhooks/microsoft', secret: 'client-state' });
    const body = JSON.parse(requests[0].body);
    assert.equal(body.clientState, 'client-state'); assert.equal(body.resource, 'me/calendars/cal-1/events');
    assert.ok(new Date(body.expirationDateTime).getTime() - Date.now() <= 4230 * 60_000);
    assert.equal(channel.channelId, 'sub-1');
  });
});

describe('Token encryption', () => {
  test('tokens are encrypted with authenticated encryption and cannot be altered', () => {
    const sealed = crypto.encryptToken('refresh-token-value');
    assert.equal(sealed.includes('refresh-token-value'), false);
    assert.equal(crypto.decryptToken(sealed), 'refresh-token-value');
    assert.notEqual(crypto.encryptToken('refresh-token-value'), sealed, 'random IV');
    const [iv, tag, data] = sealed.split('.');
    const tampered = [iv, tag, Buffer.from(Buffer.from(data, 'base64url').map((byte, index) => index === 0 ? byte ^ 1 : byte)).toString('base64url')].join('.');
    assert.throws(() => crypto.decryptToken(tampered));
  });
});
