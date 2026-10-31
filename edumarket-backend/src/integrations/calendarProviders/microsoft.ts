import { env } from '../../config/env.js';
import {
  CalendarProviderError, httpError, providerFetch,
  type CalendarProvider, type ProviderCalendar, type ProviderChange, type ProviderEvent, type ProviderEventWrite, type ProviderTokens,
} from './types.js';

/**
 * Microsoft 365 / Outlook calendars through Microsoft Graph (Microsoft identity platform, delegated permissions). Teams meetings
 * are not a separate calendar: they are Outlook events created with `isOnlineMeeting`, possible only on calendars whose
 * `allowedOnlineMeetingProviders` include `teamsForBusiness` (work or school accounts). The join URL is stored only once Graph
 * returns it.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const MICROSOFT_SCOPES = {
  read: ['offline_access', 'User.Read', 'Calendars.Read'],
  write: ['offline_access', 'User.Read', 'Calendars.ReadWrite'],
};
const configured = () => !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_CALENDAR_REDIRECT_URI);
const requireConfigured = () => { if (!configured()) throw new CalendarProviderError('NOT_CONFIGURED'); };
const authority = () => `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0`;

async function tokenRequest(params: Record<string, string>): Promise<ProviderTokens> {
  requireConfigured();
  const response = await providerFetch(`${authority()}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!, ...params }),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    if (payload.error === 'invalid_grant') throw new CalendarProviderError('AUTH_EXPIRED', response.status);
    if (payload.error === 'consent_required' || payload.error === 'interaction_required') throw new CalendarProviderError('CONSENT_REQUIRED', response.status);
    throw httpError(response.status || 502);
  }
  // Microsoft rotates refresh tokens: the new one replaces the stored one.
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: new Date(Date.now() + (payload.expires_in || 3600) * 1000), scopes: (payload.scope || '').split(' ').filter(Boolean) };
}

/** Delta and next links come from Graph; they are still checked before being followed with the user's token. */
const assertGraphUrl = (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'graph.microsoft.com') throw new CalendarProviderError('PROVIDER_ERROR');
  return url;
};

async function graph<T>(accessToken: string, path: string, init: RequestInit & { allowStatus?: number[] } = {}): Promise<{ status: number; body: T }> {
  const url = path.startsWith('http') ? assertGraphUrl(path) : `${GRAPH}${path}`;
  const response = await providerFetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', Prefer: 'outlook.timezone="UTC", odata.maxpagesize=100', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  if (response.status === 204 || response.status === 202) return { status: response.status, body: undefined as T };
  const body = await response.json().catch(() => ({})) as T & { error?: { code?: string } };
  if (!response.ok && !init.allowStatus?.includes(response.status)) {
    const code = body?.error?.code || '';
    if (response.status === 410 || /syncStateNotFound|resyncRequired/i.test(code)) throw new CalendarProviderError('CURSOR_EXPIRED', response.status);
    if (response.status === 403 && /AccessDenied|ErrorAccessDenied/i.test(code)) throw new CalendarProviderError('CONSENT_REQUIRED', 403);
    throw httpError(response.status, code);
  }
  return { status: response.status, body };
}

type GraphEvent = {
  id: string; '@odata.etag'?: string; changeKey?: string; '@removed'?: unknown; subject?: string; bodyPreview?: string; isAllDay?: boolean; isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string }; originalStartTimeZone?: string;
  location?: { displayName?: string }; onlineMeeting?: { joinUrl?: string } | null; onlineMeetingUrl?: string | null;
};
const utc = (value?: string) => new Date(value ? (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`) : 0);
export function fromGraphEvent(item: GraphEvent): ProviderEvent {
  const start = utc(item.start?.dateTime), end = utc(item.end?.dateTime);
  const joinUrl = item.onlineMeeting?.joinUrl || '';
  return {
    id: item.id, etag: item['@odata.etag'] || item.changeKey || '', title: (item.subject || '').slice(0, 200) || '(sans titre)', description: (item.bodyPreview || '').slice(0, 4000),
    start, end: end > start ? end : new Date(start.getTime() + 30 * 60_000), allDay: !!item.isAllDay, timeZone: item.originalStartTimeZone || '',
    location: (item.location?.displayName || '').slice(0, 300), meetingUrl: '', teamsJoinUrl: joinUrl.startsWith('https://') ? joinUrl.slice(0, 2000) : '', cancelled: !!item.isCancelled,
  };
}

const wallClock = (date: Date, timeZone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T00:00:00`;
};
export function toGraphEvent(event: ProviderEventWrite, creating: boolean) {
  const when = (date: Date) => event.allDay ? { dateTime: wallClock(date, event.timeZone), timeZone: event.timeZone || 'UTC' } : { dateTime: date.toISOString().replace('Z', ''), timeZone: 'UTC' };
  const allDayEnd = event.allDay ? new Date(Math.max(event.end.getTime(), event.start.getTime() + 86_400_000)) : event.end;
  return {
    subject: event.title, body: { contentType: 'text', content: event.description }, start: when(event.start), end: when(allDayEnd), isAllDay: event.allDay,
    location: { displayName: event.location || '' },
    ...(event.sendInvites ? { attendees: event.attendees.map(address => ({ emailAddress: { address }, type: 'required' })) } : {}),
    ...(creating ? { transactionId: event.clientId } : {}),
    ...(creating && event.teamsMeeting ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
  };
}

export const microsoftCalendarProvider: CalendarProvider = {
  name: 'microsoft',
  configured,
  authorizationUrl(state, access) {
    requireConfigured();
    const url = new URL(`${authority()}/authorize`);
    url.search = new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID!, redirect_uri: env.MICROSOFT_CALENDAR_REDIRECT_URI!, response_type: 'code', response_mode: 'query', scope: MICROSOFT_SCOPES[access].join(' '), prompt: 'select_account', state }).toString();
    return url.toString();
  },
  async exchangeCode(code, access) {
    const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: env.MICROSOFT_CALENDAR_REDIRECT_URI!, scope: MICROSOFT_SCOPES[access].join(' ') });
    if (!tokens.refreshToken) throw new CalendarProviderError('CONSENT_REQUIRED');
    const { body } = await graph<{ id?: string; mail?: string; userPrincipalName?: string }>(tokens.accessToken, '/me?$select=id,mail,userPrincipalName');
    return { tokens: tokens as ProviderTokens & { refreshToken: string }, account: { id: body.id || '', label: (body.mail || body.userPrincipalName || '').slice(0, 320) } };
  },
  // Scopes are not re-requested on refresh: the token keeps what the user consented to.
  refresh: refreshToken => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
  // Graph has no per-application refresh-token revocation for delegated users; the stored tokens are deleted and the user can
  // remove the consent from their Microsoft account (documented).
  async revoke() { /* no API equivalent */ },
  async listCalendars(accessToken) {
    const calendars: ProviderCalendar[] = [];
    let next = '/me/calendars?$select=id,name,hexColor,isDefaultCalendar,canEdit,allowedOnlineMeetingProviders&$top=100';
    while (next) {
      const { body } = await graph<{ value?: { id: string; name?: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean; allowedOnlineMeetingProviders?: string[] }[]; '@odata.nextLink'?: string }>(accessToken, next);
      for (const item of body.value || []) calendars.push({ id: item.id, name: (item.name || 'Calendar').slice(0, 300), color: item.hexColor || '', primary: !!item.isDefaultCalendar, canEdit: !!item.canEdit, teamsAvailable: (item.allowedOnlineMeetingProviders || []).includes('teamsForBusiness') });
      next = body['@odata.nextLink'] || '';
    }
    return calendars;
  },
  async listChanges(accessToken, calendarId, cursor, window) {
    const changes: ProviderChange[] = [];
    let next = cursor || `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(window.start.toISOString())}&endDateTime=${encodeURIComponent(window.end.toISOString())}`;
    let deltaLink = '';
    while (next) {
      const { body } = await graph<{ value?: GraphEvent[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(accessToken, next);
      for (const item of body.value || []) {
        if (item['@removed']) { changes.push({ id: item.id, removed: true }); continue; }
        const event = fromGraphEvent(item);
        changes.push(event.cancelled ? { id: item.id, removed: true } : { id: item.id, removed: false, event });
      }
      next = body['@odata.nextLink'] || '';
      deltaLink = body['@odata.deltaLink'] || deltaLink;
    }
    if (!deltaLink) throw new CalendarProviderError('PROVIDER_ERROR');
    return { changes, cursor: deltaLink };
  },
  async createEvent(accessToken, calendarId, event) {
    const { body } = await graph<GraphEvent>(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(toGraphEvent(event, true)) });
    return fromGraphEvent(body);
  },
  async updateEvent(accessToken, _calendarId, eventId, event, etag) {
    const { body } = await graph<GraphEvent>(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(toGraphEvent(event, false)), headers: etag ? { 'If-Match': etag } : {} });
    return fromGraphEvent(body);
  },
  async getEvent(accessToken, _calendarId, eventId) {
    const { status, body } = await graph<GraphEvent>(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { allowStatus: [404] });
    if (status === 404) return null;
    const event = fromGraphEvent(body);
    return event.cancelled ? null : event;
  },
  async deleteEvent(accessToken, _calendarId, eventId) {
    await graph(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', allowStatus: [404] });
  },
  async watch(accessToken, calendarId, channel) {
    // Outlook event subscriptions last at most 4230 minutes; the sync job renews them before they expire.
    const expiresAt = new Date(Date.now() + 4200 * 60_000);
    const { body } = await graph<{ id: string; expirationDateTime?: string }>(accessToken, '/subscriptions', {
      method: 'POST', body: JSON.stringify({ changeType: 'created,updated,deleted', notificationUrl: channel.address, resource: `me/calendars/${calendarId}/events`, expirationDateTime: expiresAt.toISOString(), clientState: channel.secret }),
    });
    return { channelId: body.id, resourceId: body.id, expiresAt: new Date(body.expirationDateTime || expiresAt) };
  },
  async renewWatch(accessToken, channel) {
    const expiresAt = new Date(Date.now() + 4200 * 60_000);
    const { body } = await graph<{ id: string; expirationDateTime?: string }>(accessToken, `/subscriptions/${encodeURIComponent(channel.channelId)}`, { method: 'PATCH', body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }) });
    return { channelId: body.id || channel.channelId, resourceId: body.id || channel.resourceId, expiresAt: new Date(body.expirationDateTime || expiresAt) };
  },
  async stopWatch(accessToken, channel) {
    await graph(accessToken, `/subscriptions/${encodeURIComponent(channel.channelId)}`, { method: 'DELETE', allowStatus: [404] });
  },
};
