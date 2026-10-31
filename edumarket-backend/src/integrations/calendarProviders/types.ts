/**
 * Common contract of the external calendar providers (Google Calendar API v3, Microsoft Graph). It unifies operations, identifiers
 * and errors; differences stay explicit through capabilities (Teams meetings only exist on Microsoft calendars that allow them).
 */
export type ProviderName = 'google' | 'microsoft';
export type ProviderAccess = 'read' | 'write';

export interface ProviderTokens { accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string[] }
export interface ProviderAccount { id: string; label: string }
export interface ProviderCalendar { id: string; name: string; color: string; primary: boolean; canEdit: boolean; teamsAvailable: boolean }

export interface ProviderEvent {
  id: string; etag: string; title: string; description: string; start: Date; end: Date; allDay: boolean; timeZone: string;
  location: string; meetingUrl: string; teamsJoinUrl: string; cancelled: boolean;
}
export type ProviderChange = { id: string; removed: true } | { id: string; removed: false; event: ProviderEvent };

export interface ProviderEventWrite {
  /** Stable id derived from the EduMarket record: retrying a create never duplicates the event. */
  clientId: string;
  title: string; description: string; start: Date; end: Date; allDay: boolean; timeZone: string; location: string;
  /** E-mail invitations are sent by the provider only when the user explicitly asked for it. */
  attendees: string[]; sendInvites: boolean;
  teamsMeeting: boolean;
}

export type ProviderErrorCode =
  | 'AUTH_EXPIRED' | 'CONSENT_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'CURSOR_EXPIRED'
  | 'DUPLICATE' | 'RATE_LIMITED' | 'NETWORK' | 'PROVIDER_ERROR' | 'NOT_CONFIGURED';

/** Never carries tokens nor response bodies: only a code safe to store and show. */
export class CalendarProviderError extends Error {
  constructor(public code: ProviderErrorCode, public status = 0) { super(code); }
}

export interface CalendarProvider {
  name: ProviderName;
  configured(): boolean;
  authorizationUrl(state: string, access: ProviderAccess): string;
  exchangeCode(code: string, access: ProviderAccess): Promise<{ tokens: ProviderTokens & { refreshToken: string }; account: ProviderAccount }>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  revoke(refreshToken: string): Promise<void>;
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;
  /** All changes since `cursor` (or a full listing of `window` when null), following every page. Throws CURSOR_EXPIRED. */
  listChanges(accessToken: string, calendarId: string, cursor: string | null, window: { start: Date; end: Date }): Promise<{ changes: ProviderChange[]; cursor: string }>;
  createEvent(accessToken: string, calendarId: string, event: ProviderEventWrite): Promise<ProviderEvent>;
  /** `etag` makes the update conditional: PRECONDITION_FAILED when the event changed on the provider side. */
  updateEvent(accessToken: string, calendarId: string, eventId: string, event: ProviderEventWrite, etag?: string): Promise<ProviderEvent>;
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<ProviderEvent | null>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  watch(accessToken: string, calendarId: string, channel: { address: string; secret: string }): Promise<{ channelId: string; resourceId: string; expiresAt: Date }>;
  renewWatch(accessToken: string, channel: { channelId: string; resourceId: string; calendarId: string; address: string; secret: string }): Promise<{ channelId: string; resourceId: string; expiresAt: Date }>;
  stopWatch(accessToken: string, channel: { channelId: string; resourceId: string }): Promise<void>;
}

/** Maps an HTTP failure of a provider API to a stable code. */
export function httpError(status: number, reason = ''): CalendarProviderError {
  if (status === 401) return new CalendarProviderError('AUTH_EXPIRED', status);
  if (status === 403 && /rate|quota/i.test(reason)) return new CalendarProviderError('RATE_LIMITED', status);
  if (status === 403) return new CalendarProviderError('FORBIDDEN', status);
  if (status === 404) return new CalendarProviderError('NOT_FOUND', status);
  if (status === 409) return new CalendarProviderError('DUPLICATE', status);
  if (status === 410) return new CalendarProviderError('CURSOR_EXPIRED', status);
  if (status === 412) return new CalendarProviderError('PRECONDITION_FAILED', status);
  if (status === 429) return new CalendarProviderError('RATE_LIMITED', status);
  return new CalendarProviderError('PROVIDER_ERROR', status);
}

/** fetch with a timeout; a network failure becomes NETWORK (retried later by the sync job). */
export async function providerFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch { throw new CalendarProviderError('NETWORK'); }
  finally { clearTimeout(timer); }
}
