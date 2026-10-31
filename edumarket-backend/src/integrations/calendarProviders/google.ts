import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  CalendarProviderError, httpError, providerFetch,
  type CalendarProvider, type ProviderCalendar, type ProviderChange, type ProviderEvent, type ProviderEventWrite, type ProviderTokens,
} from './types.js';

/**
 * Google Calendar API v3 through OAuth 2.0 (web server flow, offline access). Scopes are the narrowest that cover the feature:
 * list calendars + read events, or list calendars + read/write events. Notifications use `events.watch` channels.
 */
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES = {
  read: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
  write: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'],
};

const configured = () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
const requireConfigured = () => { if (!configured()) throw new CalendarProviderError('NOT_CONFIGURED'); };

async function tokenRequest(params: Record<string, string>): Promise<ProviderTokens & { refreshToken?: string }> {
  requireConfigured();
  const response = await providerFetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    // invalid_grant = refresh token revoked or expired: the user must reconnect.
    if (payload.error === 'invalid_grant') throw new CalendarProviderError('AUTH_EXPIRED', response.status);
    throw httpError(response.status || 502);
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: new Date(Date.now() + (payload.expires_in || 3600) * 1000), scopes: (payload.scope || '').split(' ').filter(Boolean) };
}

async function api<T>(accessToken: string, path: string, init: RequestInit & { allowStatus?: number[] } = {}): Promise<{ status: number; body: T }> {
  const response = await providerFetch(path.startsWith('http') ? path : `${API}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  if (response.status === 204) return { status: 204, body: undefined as T };
  const body = await response.json().catch(() => ({})) as T & { error?: { errors?: { reason?: string }[]; status?: string } };
  if (!response.ok && !init.allowStatus?.includes(response.status)) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    if (response.status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(reason)) throw new CalendarProviderError('CONSENT_REQUIRED', 403);
    throw httpError(response.status, reason);
  }
  return { status: response.status, body };
}

const dateInZone = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

type GoogleEvent = {
  id: string; etag?: string; status?: string; summary?: string; description?: string; location?: string; hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};
export function fromGoogleEvent(item: GoogleEvent): ProviderEvent {
  const allDay = !!item.start?.date && !item.start?.dateTime;
  const start = new Date(item.start?.dateTime || `${item.start?.date}T00:00:00Z`), end = new Date(item.end?.dateTime || `${item.end?.date || item.start?.date}T00:00:00Z`);
  const video = item.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri || item.hangoutLink || '';
  return {
    id: item.id, etag: item.etag || '', title: (item.summary || '').slice(0, 200) || '(sans titre)', description: (item.description || '').slice(0, 4000),
    start, end: end > start ? end : new Date(start.getTime() + 30 * 60_000), allDay, timeZone: item.start?.timeZone || '', location: (item.location || '').slice(0, 300),
    meetingUrl: video.startsWith('https://') ? video.slice(0, 1000) : '', teamsJoinUrl: '', cancelled: item.status === 'cancelled',
  };
}

export function toGoogleEvent(event: ProviderEventWrite) {
  const when = (date: Date, end = false) => event.allDay
    ? { date: dateInZone(end ? new Date(Math.max(date.getTime(), event.start.getTime() + 86_400_000)) : date, event.timeZone) }
    : { dateTime: date.toISOString(), timeZone: event.timeZone || 'UTC' };
  return {
    summary: event.title, description: event.description, location: event.location || undefined, start: when(event.start), end: when(event.end, true),
    attendees: event.sendInvites ? event.attendees.map(email => ({ email })) : undefined,
    extendedProperties: { private: { edumarket: '1' } },
  };
}

/** Google event ids are base32hex (0-9a-v): "em" + the hexadecimal EduMarket id is valid and deterministic. */
export const googleEventId = (clientId: string) => `em${clientId.toLowerCase().replace(/[^0-9a-v]/g, '')}`;

export const googleCalendarProvider: CalendarProvider = {
  name: 'google',
  configured,
  authorizationUrl(state, access) {
    requireConfigured();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.GOOGLE_REDIRECT_URI!, response_type: 'code', scope: GOOGLE_SCOPES[access].join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state }).toString();
    return url.toString();
  },
  async exchangeCode(code) {
    const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: env.GOOGLE_REDIRECT_URI! });
    if (!tokens.refreshToken) throw new CalendarProviderError('CONSENT_REQUIRED');
    return { tokens: tokens as ProviderTokens & { refreshToken: string }, account: { id: '', label: '' } };
  },
  refresh: refreshToken => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
  async revoke(refreshToken) {
    await providerFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => undefined);
  },
  async listCalendars(accessToken) {
    const calendars: ProviderCalendar[] = [];
    let pageToken = '';
    do {
      const { body } = await api<{ items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole?: string }[]; nextPageToken?: string }>(accessToken, `/users/me/calendarList?minAccessRole=reader&maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const item of body.items || []) calendars.push({ id: item.id, name: (item.summaryOverride || item.summary || item.id).slice(0, 300), color: item.backgroundColor || '', primary: !!item.primary, canEdit: ['owner', 'writer'].includes(item.accessRole || ''), teamsAvailable: false });
      pageToken = body.nextPageToken || '';
    } while (pageToken);
    return calendars;
  },
  async listChanges(accessToken, calendarId, cursor, window) {
    const changes: ProviderChange[] = [];
    let pageToken = '', nextCursor = '';
    do {
      const query = new URLSearchParams({ singleEvents: 'true', maxResults: '250', showDeleted: 'true' });
      // A sync token cannot be combined with a time range: the range is fixed by the initial full listing.
      if (cursor) query.set('syncToken', cursor); else query.set('timeMin', window.start.toISOString());
      if (pageToken) query.set('pageToken', pageToken);
      const { body } = await api<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
      for (const item of body.items || []) {
        const event = fromGoogleEvent(item);
        if (event.cancelled) changes.push({ id: item.id, removed: true });
        else if (event.start < window.end) changes.push({ id: item.id, removed: false, event });
      }
      pageToken = body.nextPageToken || '';
      nextCursor = body.nextSyncToken || nextCursor;
    } while (pageToken);
    if (!nextCursor) throw new CalendarProviderError('PROVIDER_ERROR');
    return { changes, cursor: nextCursor };
  },
  async createEvent(accessToken, calendarId, event) {
    const id = googleEventId(event.clientId);
    const { status, body } = await api<GoogleEvent>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${event.sendInvites ? 'all' : 'none'}`, { method: 'POST', body: JSON.stringify({ id, ...toGoogleEvent(event) }), allowStatus: [409] });
    if (status === 409) {
      // Already created by an earlier attempt whose response was lost: reuse it instead of duplicating.
      const existing = await this.getEvent(accessToken, calendarId, id);
      if (!existing) throw new CalendarProviderError('DUPLICATE', 409);
      return existing;
    }
    return fromGoogleEvent(body);
  },
  async updateEvent(accessToken, calendarId, eventId, event, etag) {
    const { body } = await api<GoogleEvent>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${event.sendInvites ? 'all' : 'none'}`, { method: 'PATCH', body: JSON.stringify(toGoogleEvent(event)), headers: etag ? { 'If-Match': etag } : {} });
    return fromGoogleEvent(body);
  },
  async getEvent(accessToken, calendarId, eventId) {
    const { status, body } = await api<GoogleEvent>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { allowStatus: [404, 410] });
    if (status === 404 || status === 410) return null;
    const event = fromGoogleEvent(body);
    return event.cancelled ? null : event;
  },
  async deleteEvent(accessToken, calendarId, eventId) {
    await api(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: 'DELETE', allowStatus: [404, 410] });
  },
  async watch(accessToken, calendarId, channel) {
    const channelId = randomUUID();
    const { body } = await api<{ resourceId: string; expiration?: string }>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST', body: JSON.stringify({ id: channelId, type: 'web_hook', address: channel.address, token: channel.secret, params: { ttl: String(7 * 86_400) } }),
    });
    return { channelId, resourceId: body.resourceId, expiresAt: new Date(Number(body.expiration) || Date.now() + 7 * 86_400_000) };
  },
  async renewWatch(accessToken, channel) {
    // Google channels cannot be extended: open a new one, then close the old one.
    const renewed = await this.watch(accessToken, channel.calendarId, channel);
    await this.stopWatch(accessToken, channel).catch(() => undefined);
    return renewed;
  },
  async stopWatch(accessToken, channel) {
    await api(accessToken, '/channels/stop', { method: 'POST', body: JSON.stringify({ id: channel.channelId, resourceId: channel.resourceId }), allowStatus: [404] });
  },
};
