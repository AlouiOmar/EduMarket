import { pushSession, removeSession } from './sync.service.js';

/** Adds a confirmed session to the participants' connected calendars (Google, Microsoft); failures never block the session workflow. */
export async function syncConfirmedSession(sessionId: string) {
  await pushSession(sessionId).catch(error => console.error('Calendar session sync failed', { sessionId, name: (error as Error).name }));
}

export async function removeSessionFromCalendars(sessionId: string) {
  await removeSession(sessionId).catch(error => console.error('Calendar session removal failed', { sessionId, name: (error as Error).name }));
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, match => `\\${match}`);
const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,74}/g)!.join('\r\n ');

export function buildIcsCalendar(events: Array<{ uid: string; summary: string; description: string; start: Date; end: Date; location?: string; cancelled?: boolean }>) {
  const now = icsDate(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EduMarket//Sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:EduMarket'];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}@edumarket`, `DTSTAMP:${now}`, `DTSTART:${icsDate(event.start)}`, `DTEND:${icsDate(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`, `DESCRIPTION:${icsText(event.description)}`, ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
