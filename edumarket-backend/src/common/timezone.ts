/**
 * Course time zones (IANA names such as "Africa/Tunis"). Dates are stored as UTC instants; a local wall-clock value typed by a
 * teacher ("2026-11-02T08:30", no offset) is interpreted in the course time zone, DST included.
 */
export function isValidTimeZone(zone: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/** Offset (ms) of `zone` at `instant`: local wall clock minus UTC. */
function zoneOffset(instant: number, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant / 1000) * 1000;
}

export const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Converts a local wall-clock time of `zone` to the UTC instant. In a DST gap the time is shifted forward, as clocks are. */
export function zonedLocalToUtc(local: string, zone: string) {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) throw new RangeError('INVALID_LOCAL_DATE_TIME');
  const [, year, month, day, hour, minute, second = '0'] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let instant = wall - zoneOffset(wall, zone);
  // A second pass settles instants close to a DST transition.
  instant = wall - zoneOffset(instant, zone);
  return new Date(instant);
}

/**
 * Date input of a course form: null, an ISO instant with offset, or a local wall-clock value interpreted in the course time zone
 * (or as UTC when the course has none, so the result never depends on the server's own zone).
 */
export function courseDate(value: unknown, zone?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') throw new RangeError('INVALID_DATE');
  if (LOCAL_DATE_TIME.test(value)) return zonedLocalToUtc(value, zone && isValidTimeZone(zone) ? zone : 'UTC');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('INVALID_DATE');
  return date;
}
