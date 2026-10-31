import { addDays, isoDate, isoTime, wallTime, zonedWallTimeToUtc, type WallTime } from './timeZone';

/**
 * Local, deterministic detection of meeting proposals in chat messages (French, English, Arabic incl. Maghreb usage).
 * Nothing leaves the browser. The work is split in four steps:
 *   1. detection   — date and time expressions in each clause (`detectExpressions`);
 *   2. interpretation — is it a proposal of a future meeting? (negation, past, "it is 10 am", "I finish at 2"…);
 *   3. resolution  — relative and explicit dates resolved from the message's own timestamp in the reader's time zone;
 *   4. suggestion  — prefilled values; an end time is only given when the message states it (or states a duration).
 * Creating anything is left to the user.
 */

export type DetectedLanguage = 'fr' | 'en' | 'ar';
export type SuggestionKind = 'meeting' | 'appointment' | 'session' | 'call';

export interface ScheduleSuggestion {
  language: DetectedLanguage;
  /** Wall date/time in `timeZone`, and the matching UTC instants. */
  date: string; startTime: string; endTime: string | null; start: Date; end: Date | null;
  /** `explicit`: "de 10h à 11h30"; `duration`: "pendant 1h"; null: not stated (the user picks it, nothing is invented). */
  endSource: 'explicit' | 'duration' | null;
  durationMinutes: number | null;
  timeZone: string;
  kind: SuggestionKind;
  topic: string;
  confidence: 'high' | 'medium';
  /** The exact date must be confirmed ("vendredi prochain", 05/11 in English, bare hour, no day given…). */
  ambiguous: boolean;
  ambiguity: Array<'next_weekday' | 'numeric_date' | 'bare_hour' | 'no_date' | 'week_only' | 'same_weekday'>;
  matchedText: string;
  /** Other proposals found in the same message (shown so the user checks which one is meant). */
  otherCount: number;
}

export interface DetectionContext {
  /** When the message was sent: "demain" means the day after this. */
  reference: Date;
  /** Current time: suggestions in the past are dropped. */
  now: Date;
  timeZone: string;
}

// ------------------------------------------------------------------------------------------------------- normalisation

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** Lower case, Latin accents and Arabic diacritics/hamza seats removed, Arabic-Indic digits → ASCII, ة → ه, ى → ي. */
export function normalize(text: string) {
  return text
    .replace(ARABIC_DIGITS, digit => String((digit.charCodeAt(0) & 0xf) % 10))
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/ـ/g, '').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[’`´]/g, "'").replace(/،/g, ',')
    .toLowerCase().replace(/[ \t ]+/g, ' ');
}

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
function guessLanguage(text: string): DetectedLanguage {
  if (hasArabic(text)) return 'ar';
  const english = (text.match(/\b(the|we|you|can|meet|tomorrow|next|at|pm|am|on|let's|is|are|available|call)\b/g) || []).length;
  const french = (text.match(/\b(le|la|les|on|nous|vous|demain|prochain|a|de|est|suis|disponible|rendez|reunion|se)\b/g) || []).length;
  return english > french ? 'en' : 'fr';
}

// Arabic words often carry a one-letter prefix (و / ف / ب / ل); Latin words use ASCII word boundaries.
const AR = (pattern: string) => `(?:^|[^\\p{L}])[وفبل]?(?:${pattern})(?![\\p{L}])`;

// --------------------------------------------------------------------------------------------------------- vocabulary

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, 'demi': 0.5,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5,
};
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(dimanche|sunday)\b/, 0], [/\b(lundi|monday)\b/, 1], [/\b(mardi|tuesday|tues)\b/, 2], [/\b(mercredi|wednesday)\b/, 3],
  [/\b(jeudi|thursday|thurs)\b/, 4], [/\b(vendredi|friday)\b/, 5], [/\b(samedi|saturday)\b/, 6],
  [new RegExp(AR('(?:ال)?احد'), 'u'), 0], [new RegExp(AR('(?:ال)?اثنين'), 'u'), 1], [new RegExp(AR('(?:ال)?ثلاثاء?'), 'u'), 2], [new RegExp(AR('(?:ال)?اربعاء?'), 'u'), 3],
  [new RegExp(AR('(?:ال)?خميس'), 'u'), 4], [new RegExp(AR('(?:ال)?جمعه'), 'u'), 5], [new RegExp(AR('(?:ال)?سبت'), 'u'), 6],
];
const MONTHS: Array<[string, number]> = [
  ['janvier', 1], ['janv', 1], ['january', 1], ['jan', 1], ['fevrier', 2], ['fevr', 2], ['fev', 2], ['february', 2], ['feb', 2], ['mars', 3], ['march', 3], ['mar', 3],
  ['avril', 4], ['avr', 4], ['april', 4], ['apr', 4], ['mai', 5], ['may', 5], ['juin', 6], ['june', 6], ['jun', 6], ['juillet', 7], ['juil', 7], ['july', 7], ['jul', 7],
  ['aout', 8], ['august', 8], ['aug', 8], ['septembre', 9], ['september', 9], ['sept', 9], ['sep', 9], ['octobre', 10], ['october', 10], ['oct', 10],
  ['novembre', 11], ['november', 11], ['nov', 11], ['decembre', 12], ['december', 12], ['dec', 12],
  // Arabic: Middle-East, Maghreb (Tunisia, Algeria) and Levant names.
  ['يناير', 1], ['جانفي', 1], ['كانون الثاني', 1], ['فبراير', 2], ['فيفري', 2], ['شباط', 2], ['مارس', 3], ['اذار', 3], ['ابريل', 4], ['افريل', 4], ['نيسان', 4],
  ['مايو', 5], ['ماي', 5], ['ايار', 5], ['يونيو', 6], ['جوان', 6], ['حزيران', 6], ['يوليو', 7], ['جويليه', 7], ['تموز', 7], ['اغسطس', 8], ['اوت', 8], ['اب', 8],
  ['سبتمبر', 9], ['ايلول', 9], ['اكتوبر', 10], ['تشرين الاول', 10], ['نوفمبر', 11], ['تشرين الثاني', 11], ['ديسمبر', 12], ['كانون الاول', 12],
];
const MONTH_PATTERN = MONTHS.map(([name]) => name).sort((left, right) => right.length - left.length).join('|');

const PROPOSAL_CUES = [
  // French
  /\bon se (voit|retrouve|capte|parle|fait)\b/, /\bse (voir|rencontrer|retrouver|parler)\b/, /\b(rendez-vous|rendez vous|rdv|reunion|meeting|seance|entretien|visio|appel|faire un point)\b/, /\b(un|une|le|du|de) cours (ensemble|particulier|de soutien)\b/,
  /\b(disponible|dispo|libre)\b/, /\b(on peut|on pourrait|pouvons-nous|pouvons nous|peux-tu|pouvez-vous|pourriez|pourrais|serais-tu|seriez-vous)\b/,
  /\bca (te|vous) (va|irait|convient|dit)\b/, /\bca (marche|me va|me convient)\b/, /\b(je propose|propose|planifier|programmer|fixer)\b/, /\bok pour\b/,
  // English
  /\b(meet|meeting|call|catch up|appointment|session|sync up|tutoring)\b/, /\b(available|free)\b/, /\b(can we|could we|shall we|should we|let's|lets|how about|what about)\b/,
  /\bworks? for (me|you)\b/, /\bschedule\b/, /\bsee you\b/,
  // Arabic (normalised)
  new RegExp(AR('نلتقي|نتقابل|نتقابلو|نتقابلوا|نلتقو|نلتقوا|نتلاقي|نتلاقاو|موعد|اجتماع|لقاء|حصه|درس|مكالمه|نتكلم|نتحدث|متاح|متاحه|فاضي|نتفق'), 'u'),
];
const NEGATION = [
  /\b(pas|plus) (disponible|dispo|libre)\b/, /\bindisponible\b/, /\bne (suis|serai|peux|pourrai|pourrais)\b/, /\b(impossible|empeche|annule|annuler)\b/, /\bje peux pas\b/,
  /\b(not available|unavailable|can't|cannot|can not|won't|not free|busy|not possible|cancel)\b/,
  new RegExp(AR('غير متاح|غير متاحه|لست متاح|مش متاح|موش متاح|مانيش|ما نجمش|لا استطيع|لا يمكنني|لا اقدر|مشغول|مشغوله|الغاء|نلغي'), 'u'),
];
/** Statements that contain a time without proposing anything. */
const STATEMENTS = [
  /\b(je|j'ai|on) (termine|finis|fini|finirai|sors|pars)\b/, /\bil est (actuellement |deja |maintenant )?\d/, /\bil etait\b/, /\b(termine|finit|commence) a \d/,
  /\b(i|we) (finish|finished|end|ended|leave|left)\b/, /\bit'?s (now |already )?\d/, /\bit is (now |already )?\d/, /\b(ends|finishes|closes) at\b/,
  new RegExp(AR('الساعه الان|الان الساعه|انهي|نكمل|نخرج|يخلص|نوفي'), 'u'),
];
const PAST = [/\b(hier|avant-hier|dernier|derniere|avions|avait|etait)\b/, /\b(yesterday|last|ago|had|was)\b/, new RegExp(AR('امس|البارحه|الماضي|الماضيه|كان|كانت'), 'u')];
const CONTRAST = /\s*(?:\b(?:mais|cependant|par contre|but|however|though)\b|(?:^|\s)(?:لكن|ولكن|بس|اما)(?=\s))\s*/u;

// ----------------------------------------------------------------------------------------------------------- 1. detection

interface TimeExpression { start: number; end: number | null; ambiguousHour: boolean; text: string }
interface DateExpression { kind: 'relative_day' | 'weekday' | 'explicit' | 'week' | 'in_minutes'; days?: number; weekday?: number; next?: boolean; month?: number; day?: number; year?: number; numeric?: boolean; minutes?: number; text: string }
interface ClauseExpressions { time: TimeExpression | null; date: DateExpression | null; duration: number | null }

const minutesOf = (hour: number, minute = 0) => hour * 60 + minute;
const validClock = (hour: number, minute: number) => hour >= 0 && hour <= 24 && minute >= 0 && minute < 60;

function meridiem(hour: number, marker: string | undefined) {
  if (!marker) return hour;
  if (/^(pm|p\.m\.|de l'apres-midi|du soir|apres-midi|soir|مساء|مساءا|ليلا|عشيه|عصرا|ظهرا|العشيه|بالليل)$/.test(marker)) return hour < 12 ? hour + 12 : hour;
  if (/^(am|a\.m\.|du matin|matin|صباحا|الصباح|صباح)$/.test(marker)) return hour === 12 ? 0 : hour;
  return hour;
}
const MERIDIEM = "(am|pm|a\\.m\\.|p\\.m\\.|du matin|de l'apres-midi|du soir|مساء|مساءا|ليلا|عشيه|عصرا|ظهرا|صباحا|الصباح|بالليل)";
// "14h", "14h30", "14 h 30", "14:00", "2pm", "2:30 pm", "الساعه 14", "الساعه 2 مساء"
const CLOCK = `(\\d{1,2})(?:\\s*(?:h|heures?|:|\\.)\\s*(\\d{2})?|\\s*(?=${MERIDIEM}))?\\s*${MERIDIEM}?(?![\\d/])`;
const TIME_PREFIX = "(?:a|vers|for|at|around|by|على الساعه|علي الساعه|في الساعه|الساعه|على|علي|مع)";

function parseClock(hourText: string, minuteText: string | undefined, marker: string | undefined, hadUnit: boolean) {
  let hour = Number(hourText), minute = Number(minuteText || 0);
  if (!validClock(hour, minute)) return null;
  hour = meridiem(hour, marker);
  if (hour === 24) hour = 0;
  // "at 2" with neither h/:/pm nor 24-hour form: the half of the day is a guess.
  const ambiguousHour = !marker && !hadUnit && hour >= 1 && hour <= 11;
  // Meetings at 1–7 o'clock are far more often in the afternoon; the guess is flagged for confirmation.
  if (ambiguousHour && hour <= 7) hour += 12;
  return { minutes: minutesOf(hour, minute), ambiguousHour };
}

function detectTime(clause: string): TimeExpression | null {
  // Ranges first: "de 10h à 11h30", "entre 14h et 15h", "10h-11h", "from 10 to 11:30 am", "من 10 الى 11:30", "بين 2 و 3 مساء".
  const range = new RegExp(`(?:\\b(?:de|from|between|entre)\\s+|(?:^|\\s)(?:من|بين)\\s+(?:الساعه\\s+)?)?(\\d{1,2})(?:\\s*(?:h|heures?|:|\\.)\\s*(\\d{2})?)?\\s*${MERIDIEM}?\\s*(?:-|–|a|à|to|until|till|and|et|الي|حتي|و|ل)\\s*(?:الساعه\\s+)?(\\d{1,2})(?:\\s*(?:h|heures?|:|\\.)\\s*(\\d{2})?)?\\s*${MERIDIEM}?`, 'u');
  const rangeMatch = range.exec(clause);
  if (rangeMatch && (/[h:.]|heure/.test(rangeMatch[0]) || rangeMatch[3] || rangeMatch[6] || /\b(de|from|between|entre)\b|من|بين/u.test(rangeMatch[0]))) {
    const startMarker = rangeMatch[3] || rangeMatch[6];
    const startUnit = /\d\s*(h|heure|:|\.)/.test(rangeMatch[0].split(/-|–|\sa\s|\sà\s|\sto\s|\suntil\s|\still\s|\sand\s|\set\s|الي|حتي|\sو\s/u)[0]);
    const first = parseClock(rangeMatch[1], rangeMatch[2], startMarker, startUnit);
    const second = parseClock(rangeMatch[4], rangeMatch[5], rangeMatch[6] || startMarker, startUnit);
    const plausible = first && second && (/[h:.]|heure/.test(rangeMatch[0]) || startMarker || /\b(de|from|between|entre)\b|من|بين/u.test(rangeMatch[0]));
    if (first && second && plausible) {
      let end = second.minutes;
      if (end <= first.minutes && end + 12 * 60 > first.minutes && !rangeMatch[6]) end += 12 * 60; // "1-3" read as 13-15 when 1 pm start is implied
      if (end > first.minutes && end - first.minutes <= 12 * 60) return { start: first.minutes, end, ambiguousHour: first.ambiguousHour && second.ambiguousHour, text: rangeMatch[0].trim() };
    }
  }
  if (/\b(midi|noon)\b|(?:^|\s)(?:الظهر|منتصف النهار)(?=\s|$)/u.test(clause)) return { start: 12 * 60, end: null, ambiguousHour: false, text: 'midi' };
  if (/\b(minuit|midnight)\b/.test(clause)) return { start: 0, end: null, ambiguousHour: false, text: 'minuit' };
  const single = new RegExp(`(?:${TIME_PREFIX}\\s+)?${CLOCK}`, 'gu');
  for (const match of clause.matchAll(single)) {
    const text = match[0];
    const unit = /\d\s*(h|heure|:|\.)/.test(text);
    const prefixed = new RegExp(`^${TIME_PREFIX}\\s`, 'u').test(text);
    // A bare number is a time only with a clock unit, an am/pm marker, or "at/à/الساعه" before it.
    if (!unit && !match[3] && !prefixed) continue;
    // "5 novembre", "5/11", "2 heures de cours" (duration) are not times.
    const after = clause.slice((match.index || 0) + text.length);
    if (!unit && !match[3] && new RegExp(`^\\s*(?:${MONTH_PATTERN}|/|\\d)`, 'u').test(after)) continue;
    if (/^\s*\d+\s*(heures?|h)\s*(de|d')/.test(text + after.slice(0, 4)) && /\b(pendant|during|for|لمده)\s*$/.test(clause.slice(0, match.index))) continue;
    const parsed = parseClock(match[1], match[2], match[3], unit);
    if (parsed) return { start: parsed.minutes, end: null, ambiguousHour: parsed.ambiguousHour, text: text.trim() };
  }
  return null;
}

function numberValue(token: string) {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

function detectDuration(clause: string) {
  const latin = /\b(?:pendant|durant|for|during)\s+(?:(\d+|une?|deux|trois|an|a|one|two|three)\s*(?:h|heures?|hours?|hrs?)(?:\s*(?:et\s+)?(\d{1,2}|demie?|half))?|(\d{1,3})\s*(?:min|minutes?|mn))\b/.exec(clause);
  if (latin) {
    if (latin[3]) return Number(latin[3]);
    const hours = numberValue(latin[1]) || 0;
    const extra = latin[2] ? (/^(demie?|half)$/.test(latin[2]) ? 30 : Number(latin[2])) : 0;
    return hours * 60 + extra;
  }
  const hourAndHalf = /\b(\d)h(30)\b(?=\s*(de|d')\s)/.exec(clause);
  if (hourAndHalf) return Number(hourAndHalf[1]) * 60 + 30;
  const arabic = new RegExp(`(?:لمده|مده|طوال)\\s*(ساعتين|ساعه ونصف|ساعه|(\\d+)\\s*(?:ساعات|ساعه|دقيقه|دقائق))`, 'u').exec(clause);
  if (arabic) {
    if (arabic[1] === 'ساعتين') return 120;
    if (arabic[1] === 'ساعه ونصف') return 90;
    if (arabic[1] === 'ساعه') return 60;
    return /دقيق/.test(arabic[1]) ? Number(arabic[2]) : Number(arabic[2]) * 60;
  }
  return null;
}

function detectDate(clause: string, language: DetectedLanguage): DateExpression | null {
  // "dans deux heures", "in 30 minutes", "بعد ساعتين" — must not catch "بعد غد".
  const inLatin = /\b(?:dans|in)\s+(\d+|une?|deux|trois|quatre|an|a|one|two|three|four|half an?)\s*(heures?|h|hours?|minutes?|min|mn)\b/.exec(clause);
  if (inLatin) {
    const amount = /^half/.test(inLatin[1]) ? 0.5 : numberValue(inLatin[1]) || 0;
    return { kind: 'in_minutes', minutes: /^h|^hour|^heure/.test(inLatin[2]) ? amount * 60 : amount, text: inLatin[0] };
  }
  const inArabic = new RegExp(`(?:^|\\s)بعد\\s+(ساعتين|ساعه|نصف ساعه|(\\d+)\\s*(?:ساعات|ساعه|دقيقه|دقائق))`, 'u').exec(clause);
  if (inArabic) {
    const value = inArabic[1] === 'ساعتين' ? 120 : inArabic[1] === 'ساعه' ? 60 : inArabic[1] === 'نصف ساعه' ? 30 : /دقيق/.test(inArabic[1]) ? Number(inArabic[2]) : Number(inArabic[2]) * 60;
    return { kind: 'in_minutes', minutes: value, text: inArabic[0].trim() };
  }
  const relative = (latin: RegExp, arabic: string) => latin.exec(clause)?.[0] || new RegExp(AR(arabic), 'u').exec(clause)?.[0]?.trim();
  let word: string | undefined;
  if ((word = relative(/\bapres[- ]demain\b|\bday after tomorrow\b/, 'بعد غد|بعد الغد|بعد بكره|بعد غدوه'))) return { kind: 'relative_day', days: 2, text: word };
  if ((word = relative(/\bdemain\b|\btomorrow\b/, 'غدا|غدوه|بكره|غد'))) return { kind: 'relative_day', days: 1, text: word };
  if ((word = /\bavant[- ]hier\b/.exec(clause)?.[0])) return { kind: 'relative_day', days: -2, text: word };
  if ((word = relative(/\bhier\b|\byesterday\b/, 'امس|البارحه'))) return { kind: 'relative_day', days: -1, text: word };
  if ((word = relative(/\b(aujourd'hui|aujourdhui|ce soir|ce matin|cet apres-midi|today|tonight|this (morning|afternoon|evening))\b/, 'اليوم|الليله|هالعشيه|العشيه'))) return { kind: 'relative_day', days: 0, text: word };

  // Explicit dates: 2026-11-05, 05/11(/2026), "5 novembre (2026)", "November 5(th)", "5 نوفمبر".
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(clause);
  if (iso) return { kind: 'explicit', year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]), text: iso[0] };
  const numeric = /(?:^|[^\d:])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d:])/.exec(clause);
  if (numeric && !/\d[.:]\d{2}\s*(h|pm|am)/.test(numeric[0])) {
    const first = Number(numeric[1]), second = Number(numeric[2]);
    // dd/mm in French and Arabic; mm/dd in English, flagged as numeric (ambiguous) when both readings are possible.
    const [day, month] = language === 'en' && first <= 12 ? [second, first] : [first, second];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { kind: 'explicit', day, month, year: numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : undefined, numeric: first <= 12 && second <= 12, text: numeric[0].trim() };
  }
  const dayMonth = new RegExp(`(?:^|[^\\p{L}\\d])(\\d{1,2})(?:er|st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_PATTERN})\\.?(?![\\p{L}])(?:\\s+(20\\d{2}))?`, 'u').exec(clause);
  const monthDay = new RegExp(`(?:^|[^\\p{L}])(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:hH])(?:,?\\s+(20\\d{2}))?`, 'u').exec(clause);
  const monthNumber = (name: string) => MONTHS.find(([month]) => month === name)?.[1];
  if (dayMonth) return { kind: 'explicit', day: Number(dayMonth[1]), month: monthNumber(dayMonth[2]), year: dayMonth[3] ? Number(dayMonth[3]) : undefined, text: dayMonth[0].trim() };
  if (monthDay) return { kind: 'explicit', day: Number(monthDay[2]), month: monthNumber(monthDay[1]), year: monthDay[3] ? Number(monthDay[3]) : undefined, text: monthDay[0].trim() };

  const nextWeek = /\b(la )?semaine prochaine\b|\bnext week\b/.test(clause) || new RegExp(AR('الاسبوع القادم|الاسبوع المقبل|الاسبوع الجاي|الجمعه الجايه'), 'u').test(clause);
  for (const [pattern, weekday] of WEEKDAYS) {
    const match = pattern.exec(clause);
    if (!match) continue;
    const following = clause.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 30);
    const preceding = clause.slice(Math.max(0, (match.index || 0) - 12), match.index);
    const next = nextWeek || /^\s*(prochain|prochaine|qui vient)\b/.test(following) || /\bnext\s*$/.test(preceding) || new RegExp(`^\\s*(القادم|المقبل|الجاي|الجايه|القادمه)`, 'u').test(following);
    return { kind: 'weekday', weekday, next, text: match[0].trim() };
  }
  if (nextWeek) return { kind: 'week', text: 'semaine prochaine' };
  return null;
}

function detectExpressions(clause: string, language: DetectedLanguage): ClauseExpressions {
  return { time: detectTime(clause), date: detectDate(clause, language), duration: detectDuration(clause) };
}

// ------------------------------------------------------------------------------------------------------ 3. resolution

interface Resolved { date: { year: number; month: number; day: number }; minutes: number; ambiguity: ScheduleSuggestion['ambiguity'] }

function resolve(found: ClauseExpressions, context: DetectionContext): Resolved | null {
  const today: WallTime = wallTime(context.reference, context.timeZone);
  const ambiguity: ScheduleSuggestion['ambiguity'] = [];
  const date = found.date;
  if (date?.kind === 'in_minutes') {
    // Rounded to the next 5 minutes from the message time.
    const start = new Date(Math.ceil((context.reference.getTime() + (date.minutes || 0) * 60_000) / 300_000) * 300_000);
    const wall = wallTime(start, context.timeZone);
    return { date: wall, minutes: wall.hour * 60 + wall.minute, ambiguity };
  }
  if (!found.time) return null;
  if (found.time.ambiguousHour) ambiguity.push('bare_hour');
  let day: { year: number; month: number; day: number };
  if (!date) {
    day = today;
    ambiguity.push('no_date');
  } else if (date.kind === 'relative_day') {
    day = addDays(today, date.days || 0);
  } else if (date.kind === 'weekday') {
    let delta = ((date.weekday! - today.weekday) + 7) % 7;
    if (delta === 0) {
      // "jeudi" said on a Thursday: today if the time is still ahead, else next week; both are shown.
      const stillAhead = found.time.start > today.hour * 60 + today.minute;
      delta = date.next || !stillAhead ? 7 : 0;
      ambiguity.push('same_weekday');
    } else if (date.next) {
      // "vendredi prochain": the coming Friday; some readers mean the one after → confirm the exact date.
      ambiguity.push('next_weekday');
    }
    day = addDays(today, delta);
  } else if (date.kind === 'week') {
    // "la semaine prochaine à 14h": Monday of next week, day to confirm.
    day = addDays(today, ((1 - today.weekday + 7) % 7) || 7);
    ambiguity.push('week_only');
  } else {
    if (!date.month || !date.day) return null;
    let year = date.year || today.year;
    const candidate = Date.UTC(year, date.month - 1, date.day), todayValue = Date.UTC(today.year, today.month - 1, today.day);
    // No year: a date more than two months in the past means next year ("le 5 janvier" written in October).
    if (!date.year && candidate < todayValue - 60 * 86_400_000) year += 1;
    const check = new Date(Date.UTC(year, date.month - 1, date.day));
    if (check.getUTCMonth() !== date.month - 1) return null;
    day = { year, month: date.month, day: date.day };
    if (date.numeric) ambiguity.push('numeric_date');
  }
  return { date: day, minutes: found.time.start, ambiguity };
}

// ------------------------------------------------------------------------------------------------- 2. interpretation

const isNegated = (clause: string) => NEGATION.some(pattern => pattern.test(clause));
const isStatement = (clause: string) => STATEMENTS.some(pattern => pattern.test(clause));
const isPastWording = (clause: string) => PAST.some(pattern => pattern.test(clause));
const hasCue = (text: string) => PROPOSAL_CUES.some(pattern => pattern.test(text));

function suggestionKind(text: string): SuggestionKind {
  if (/\b(cours|seance|session|lesson|tutoring)\b/.test(text) || new RegExp(AR('حصه|درس'), 'u').test(text)) return 'session';
  if (/\b(appel|call|visio|phone|telephone)\b/.test(text) || new RegExp(AR('مكالمه|نتكلم|نتحدث'), 'u').test(text)) return 'call';
  if (/\b(rendez-vous|rendez vous|rdv|appointment)\b/.test(text) || new RegExp(AR('موعد'), 'u').test(text)) return 'appointment';
  return 'meeting';
}

function topicOf(original: string) {
  const match = /(?:\bpour\b|\bsur\b|\bconcernant\b|\babout\b|\bregarding\b|\bto discuss\b|\bon\b(?= the\b)|(?:^|\s)(?:لمناقشه|لمناقشة|حول|بخصوص|عن)(?=\s))\s+([^.!?؟\n,]{3,80})/iu.exec(original);
  return match ? match[1].trim().replace(/\s+/g, ' ').slice(0, 80) : '';
}

// --------------------------------------------------------------------------------------------------- 4. suggestion

/** Splits on sentence ends and on contrast words ("pas dispo demain, mais jeudi à 10h ça marche"), keeping question marks. */
function clauses(normalized: string) {
  const sentences = normalized.split(/(?<=[.!?؟\n;])\s*/u).filter(Boolean);
  return sentences.flatMap(sentence => sentence.split(CONTRAST)).map(part => part.trim()).filter(Boolean);
}

export function suggestSchedule(text: string, context: DetectionContext): ScheduleSuggestion | null {
  if (!text || text.length > 2000) return null;
  const normalized = normalize(text);
  const language = guessLanguage(normalized);
  const parts = clauses(normalized);
  const messageHasCue = parts.some(part => hasCue(part) && !isNegated(part));
  const candidates: ScheduleSuggestion[] = [];
  const allFound = parts.map(part => detectExpressions(part, language));
  const onlyDate = allFound.filter(found => found.date).length === 1 ? allFound.find(found => found.date)!.date : null;

  parts.forEach((part, index) => {
    const found = allFound[index];
    if (!found.time && found.date?.kind !== 'in_minutes') return;
    if (isNegated(part) || isStatement(part)) return;
    // "Jeudi ? Je suis dispo de 10h à 11h30": a date stated in another clause of the same message applies.
    if (!found.date && onlyDate) found.date = onlyDate;
    if (!hasCue(part) && !messageHasCue) return;
    if (found.date && found.date.kind === 'relative_day' && (found.date.days || 0) < 0) return;
    if (isPastWording(part) && !found.date) return;
    const resolved = resolve(found, context);
    if (!resolved) return;
    const start = zonedWallTimeToUtc(resolved.date.year, resolved.date.month, resolved.date.day, Math.floor(resolved.minutes / 60), resolved.minutes % 60, context.timeZone);
    // Only future meetings are suggested; a past date is never turned into a new event.
    if (start.getTime() <= context.now.getTime()) return;
    if (isPastWording(part) && found.date?.kind !== 'weekday') return;
    const explicitEnd = found.time?.end ?? null;
    const durationMinutes = explicitEnd !== null ? explicitEnd - resolved.minutes : found.duration;
    const end = durationMinutes ? new Date(start.getTime() + durationMinutes * 60_000) : null;
    const endWall = end ? wallTime(end, context.timeZone) : null;
    const ambiguity = resolved.ambiguity;
    candidates.push({
      language, date: isoDate(resolved.date), startTime: isoTime(resolved.minutes), endTime: endWall ? isoTime(endWall.hour * 60 + endWall.minute) : null, start, end,
      endSource: explicitEnd !== null ? 'explicit' : found.duration ? 'duration' : null, durationMinutes: durationMinutes || null, timeZone: context.timeZone,
      kind: suggestionKind(normalized), topic: topicOf(text), confidence: found.date && !ambiguity.includes('no_date') && !ambiguity.includes('week_only') && !ambiguity.includes('bare_hour') ? 'high' : 'medium',
      ambiguous: ambiguity.length > 0, ambiguity, matchedText: [found.date?.text, found.time?.text].filter(Boolean).join(' '), otherCount: 0,
    });
  });
  if (!candidates.length) return null;
  return { ...candidates[0], otherCount: candidates.length - 1 };
}
