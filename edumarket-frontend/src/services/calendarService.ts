import { apiRequest } from './apiClient';

type Envelope<T> = { data: T };
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type FeedKind = 'session' | 'exam' | 'course' | 'event' | 'external';
export interface FeedPermissions { edit: boolean; move: boolean; resize: boolean; delete: boolean; respond: boolean }
export interface FeedParticipant { id: string; name: string; status: string; invited?: boolean }
export interface FeedItem {
  id: string; kind: FeedKind; sourceId: string; calendarKey: string; title: string; description: string;
  start: string; end: string; allDay: boolean; timeZone: string | null; status: string; type: string; mode: 'online' | 'in_person' | 'none';
  location: string; meetingUrl?: string; teamsJoinUrl?: string; courseId?: string | null; reminderMinutes?: number[]; revision?: number; source?: string;
  subject?: string; price?: number; paymentStatus?: string; proposedBy?: 'teacher' | 'student' | null;
  counterpart: string; participants: FeedParticipant[]; owner?: { id: string; name: string }; isOwner: boolean; myStatus?: string | null;
  sync?: { provider: 'google' | 'microsoft'; calendarId: string; state: 'pending' | 'synced' | 'error' | 'conflict' | 'remote_deleted'; error: string | null; teamsRequested: boolean; hasConflict: boolean } | null;
  permissions: FeedPermissions;
}
export interface CalendarPreferences { colors: Record<string, string>; hidden: string[]; defaultView: 'month' | 'week' | 'day' | 'agenda'; timeZone: string; defaultDurationMinutes: number }
export interface ProviderCalendar { id: string; name: string; color: string; primary: boolean; canEdit: boolean; selected: boolean; teamsAvailable: boolean }
export interface CalendarConnection {
  id: string; provider: 'google' | 'microsoft'; accountLabel: string; access: 'read' | 'write'; status: 'connected' | 'syncing' | 'error' | 'expired';
  syncMode: 'read_only' | 'push' | 'two_way'; defaultCalendarId: string; lastSyncAt: string | null; lastError: string | null; calendars: ProviderCalendar[]; pushNotifications: boolean; connectedAt: string;
}
export interface ProvidersStatus { google: boolean; microsoft: boolean; pushNotifications: boolean }
export interface Invitee { id: string; name: string; role: string }
export interface Conflict { kind: 'session' | 'event' | 'participant'; id?: string; title?: string; start: string; end: string; userId?: string; mine: boolean }

export interface EventPayload {
  title: string; description: string; type: 'appointment' | 'meeting' | 'personal' | 'other'; start: string; end: string; timeZone: string; allDay: boolean;
  mode: 'online' | 'in_person' | 'none'; location: string; meetingUrl: string; participantIds: string[]; courseId: string | null; reminderMinutes: number[];
  destination: { provider: 'edumarket' | 'google' | 'microsoft'; calendarId: string }; teamsMeeting: boolean; sendExternalInvites: boolean;
  notifyParticipants: boolean; allowOverlap: boolean; sourceMessageId: string | null;
}

export const calendarService = {
  feed: async (from: Date, to: Date) => (await apiRequest<Envelope<FeedItem[]>>(`/calendar/feed?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)).data,
  createEvent: async (payload: EventPayload) => (await apiRequest<Envelope<Record<string, any>>>('/calendar/events', json('POST', payload))).data,
  updateEvent: async (id: string, payload: Partial<EventPayload> & { expectedRevision: number }) => (await apiRequest<Envelope<Record<string, any>>>(`/calendar/events/${encodeURIComponent(id)}`, json('PATCH', payload))).data,
  deleteEvent: async (id: string) => { await apiRequest<void>(`/calendar/events/${encodeURIComponent(id)}`, json('DELETE')); },
  respond: async (id: string, status: 'accepted' | 'declined') => (await apiRequest<Envelope<unknown>>(`/calendar/events/${encodeURIComponent(id)}/respond`, json('POST', { status }))).data,
  resolveConflict: async (id: string, keep: 'local' | 'remote') => (await apiRequest<Envelope<unknown>>(`/calendar/events/${encodeURIComponent(id)}/resolve`, json('POST', { keep }))).data,
  retrySync: async (id: string) => (await apiRequest<Envelope<unknown>>(`/calendar/events/${encodeURIComponent(id)}/retry-sync`, json('POST'))).data,
  conflicts: async (payload: { start: string; end: string; timeZone: string; participantIds: string[]; excludeEventId?: string; excludeSessionId?: string }) => (await apiRequest<Envelope<{ conflicts: Conflict[] }>>('/calendar/conflicts', json('POST', payload))).data.conflicts,
  invitees: async () => (await apiRequest<Envelope<Invitee[]>>('/calendar/invitees')).data,
  contexts: async () => (await apiRequest<Envelope<{ id: string; title: string }[]>>('/calendar/contexts')).data,
  preferences: async () => (await apiRequest<Envelope<CalendarPreferences>>('/calendar/preferences')).data,
  savePreferences: async (payload: Partial<CalendarPreferences>) => (await apiRequest<Envelope<CalendarPreferences>>('/calendar/preferences', json('PUT', payload))).data,
  providers: async () => (await apiRequest<Envelope<ProvidersStatus>>('/calendar/providers')).data,
  connections: async () => (await apiRequest<Envelope<CalendarConnection[]>>('/calendar/connections')).data,
  connect: async (provider: 'google' | 'microsoft', access: 'read' | 'write') => (await apiRequest<Envelope<{ authorizationUrl: string }>>(`/calendar/connections/${provider}/connect`, json('POST', { access }))).data.authorizationUrl,
  updateConnection: async (id: string, payload: { syncMode?: CalendarConnection['syncMode']; defaultCalendarId?: string; calendars?: { id: string; selected: boolean }[] }) => (await apiRequest<Envelope<CalendarConnection>>(`/calendar/connections/${encodeURIComponent(id)}`, json('PATCH', payload))).data,
  syncConnection: async (id: string) => (await apiRequest<Envelope<{ connection: CalendarConnection }>>(`/calendar/connections/${encodeURIComponent(id)}/sync`, json('POST'))).data.connection,
  refreshCalendars: async (id: string) => (await apiRequest<Envelope<CalendarConnection>>(`/calendar/connections/${encodeURIComponent(id)}/refresh-calendars`, json('POST'))).data,
  disconnect: async (id: string) => { await apiRequest<void>(`/calendar/connections/${encodeURIComponent(id)}`, json('DELETE')); },
  // Tutoring sessions (existing rules on the server).
  createSlot: async (payload: { startAt: string; endAt: string; timeZone: string; type: 'online' | 'in_person'; price: number; venue?: string; subject?: string; notes?: string }) => (await apiRequest<Envelope<unknown>>('/sessions/availability', json('POST', payload))).data,
  proposeSession: async (payload: { studentId: string; startAt: string; endAt: string; timeZone: string; type: 'online' | 'in_person'; venue?: string; subject: string; notes?: string; allowOverlap?: boolean }) => (await apiRequest<Envelope<unknown>>('/sessions/proposals', json('POST', payload))).data,
  moveSession: async (id: string, payload: { startAt: string; endAt: string; timeZone?: string }) => (await apiRequest<Envelope<unknown>>(`/sessions/${encodeURIComponent(id)}/time`, json('PATCH', payload))).data,
  deleteSlot: async (id: string) => { await apiRequest<void>(`/sessions/${encodeURIComponent(id)}`, json('DELETE')); },
  answerSession: async (id: string, status: 'confirmed' | 'rejected' | 'cancelled') => (await apiRequest<Envelope<unknown>>(`/sessions/${encodeURIComponent(id)}/status`, json('PATCH', { status }))).data,
  availability: async (from: Date, to: Date, teacherId?: string) => (await apiRequest<Envelope<Record<string, any>[]>>(`/sessions/availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${teacherId ? `&teacherId=${encodeURIComponent(teacherId)}` : ''}`)).data,
  book: async (slotId: string, subject: string, notes?: string) => (await apiRequest<Envelope<unknown>>(`/sessions/${encodeURIComponent(slotId)}/book`, json('POST', { subject, notes }))).data,
};
