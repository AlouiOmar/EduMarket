import { env } from '../../config/env.js';
import { googleCalendarProvider } from './google.js';
import { microsoftCalendarProvider } from './microsoft.js';
import type { CalendarProvider, ProviderName } from './types.js';

const providers: Record<ProviderName, CalendarProvider> = { google: googleCalendarProvider, microsoft: microsoftCalendarProvider };

export const calendarProvider = (name: ProviderName) => providers[name];

/** Automated tests replace a provider with a simulated one; refused in production so no real traffic can be faked. */
export function replaceCalendarProviderForTests(name: ProviderName, provider: CalendarProvider | null) {
  if (env.NODE_ENV === 'production') throw new Error('Calendar providers cannot be replaced in production.');
  providers[name] = provider || (name === 'google' ? googleCalendarProvider : microsoftCalendarProvider);
}

export * from './types.js';
