import type { CalendarConnection, CalendarPreferences, FeedItem } from '../../services/calendarService';

/**
 * Display colours per calendar. They are only defaults the user can change; they never change event data. Each default keeps
 * white text above 4.5:1, and every colour is paired with a text label (status, source), so colour is never the only cue.
 */
export const DEFAULT_COLORS: Record<string, string> = {
  sessions: '#1d4ed8', // EduMarket tutoring sessions — blue
  pending: '#b45309', // awaiting confirmation — amber
  personal: '#15803d', // EduMarket events — green
  exams: '#be123c',
  course: '#0f766e',
  google: '#c2410c', // Google calendars — orange
  microsoft: '#6d28d9', // Outlook / Teams — violet
};

export interface CalendarSource { key: string; label: string; provider?: 'google' | 'microsoft'; defaultColor: string }

/** Calendars holding tutoring data (open slots, requests, sessions), toggled together by the "Tutoring" filter. */
export const TUTORING_KEYS = ['slots', 'sessions', 'pending'];

export function calendarSources(connections: CalendarConnection[], labels: (key: string) => string, withSlots = false): CalendarSource[] {
  const base = [...(withSlots ? ['slots'] : []), 'sessions', 'pending', 'personal', 'exams', 'course'].map(key => ({ key, label: labels(key), defaultColor: DEFAULT_COLORS[key] }));
  const external = connections.flatMap(connection => connection.calendars.filter(calendar => calendar.selected || connection.defaultCalendarId === calendar.id).map(calendar => ({
    key: `${connection.provider}:${calendar.id}`, label: `${calendar.name}`, provider: connection.provider, defaultColor: DEFAULT_COLORS[connection.provider],
  })));
  return [...base, ...external];
}

export function colorFor(key: string, preferences: CalendarPreferences | null) {
  return preferences?.colors?.[key] || DEFAULT_COLORS[key] || DEFAULT_COLORS[key.split(':')[0]] || DEFAULT_COLORS.personal;
}

function luminance(hex: string) {
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** Black or white, whichever contrasts more with a user-chosen colour. */
export const textOn = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) && luminance(hex) > 0.179 ? '#0f172a' : '#ffffff');

/** Business state (independent of the display colour). */
export function visualState(item: FeedItem): 'cancelled' | 'pending' | 'tentative' | 'completed' | 'normal' {
  if (['cancelled', 'rejected'].includes(item.status)) return 'cancelled';
  if (item.kind === 'session' && item.status === 'completed') return 'completed';
  if (item.status === 'pending' || item.myStatus === 'pending') return 'pending';
  if (item.status === 'available') return 'tentative';
  return 'normal';
}
