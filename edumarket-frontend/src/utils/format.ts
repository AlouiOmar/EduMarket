/** Locale-aware formatting for amounts (integer minor units from the API) and dates. */
const locales: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-TN' };
const localeOf = (language: string) => locales[language.slice(0, 2)] || 'fr-FR';

export function formatMoney(minorUnits: number, currency: string, language: string) {
  return new Intl.NumberFormat(localeOf(language), { style: 'currency', currency: currency.toUpperCase() }).format(minorUnits / 100);
}

/** Catalogue prices are stored as major units (e.g. 49.9 EUR). */
export function formatPrice(amount: number, currency: string, language: string) {
  return formatMoney(Math.round(amount * 100), currency, language);
}

export function formatDate(value: string | Date | null | undefined, language: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'medium' }).format(new Date(value));
}

/** `timeZone`: display in a given IANA zone (e.g. the course zone) instead of the browser's. */
export function formatDateTime(value: string | Date | null | undefined, language: string, timeZone?: string) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
}
