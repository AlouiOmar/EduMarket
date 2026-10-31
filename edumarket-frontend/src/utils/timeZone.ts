/**
 * IANA time-zone helpers without a date library (same algorithm as the backend `common/timezone.ts`). Instants are UTC;
 * a "wall" value is the date/time a person reads on a clock in a given zone.
 */
export const browserTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export function isValidTimeZone(zone: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

export interface WallTime { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

/** Wall clock of `zone` at `instant` (weekday: 0 = Sunday). */
export function wallTime(instant: Date, zone: string): WallTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, weekday };
}

function zoneOffset(instant: number, zone: string) {
  const wall = wallTime(new Date(instant), zone);
  const seconds = new Date(instant).getUTCSeconds();
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, seconds) - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of a wall-clock time in `zone`; in a DST gap the time moves forward like clocks do. */
export function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - zoneOffset(wall, zone);
  instant = wall - zoneOffset(instant, zone);
  return new Date(instant);
}

/** Adds days to a calendar date (no time-zone effect). */
export function addDays(date: { year: number; month: number; day: number }, days: number) {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay() };
}

const pad = (value: number) => String(value).padStart(2, '0');
export const isoDate = (date: { year: number; month: number; day: number }) => `${date.year}-${pad(date.month)}-${pad(date.day)}`;
export const isoTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** "YYYY-MM-DDTHH:mm" in `zone`, the value of a datetime-local input and of the API wall-clock dates. */
export function toWallInput(instant: Date, zone: string) {
  const wall = wallTime(instant, zone);
  return `${isoDate(wall)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function fromWallInput(value: string, zone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return zonedWallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), zone);
}

/** Common zones offered first in pickers; any valid IANA zone is accepted. */
export const COMMON_TIME_ZONES = ['Africa/Tunis', 'Africa/Algiers', 'Africa/Casablanca', 'Africa/Cairo', 'Europe/Paris', 'Europe/London', 'Europe/Brussels', 'America/Montreal', 'America/New_York', 'Asia/Dubai', 'Asia/Riyadh', 'UTC'];
