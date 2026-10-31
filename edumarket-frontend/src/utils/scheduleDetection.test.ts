import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestSchedule } from './scheduleDetection';

// Reference: Wednesday 28 October 2026, 09:00 in Tunis (UTC+1, no DST).
const reference = new Date('2026-10-28T08:00:00Z');
const tunis = { reference, now: reference, timeZone: 'Africa/Tunis' };
const detect = (text: string, context = tunis) => suggestSchedule(text, context);

test('« On se voit demain à 14h. » → tomorrow 14:00, no invented end time', () => {
  const result = detect('On se voit demain à 14h.')!;
  assert.equal(result.language, 'fr');
  assert.equal(result.date, '2026-10-29'); assert.equal(result.startTime, '14:00');
  assert.equal(result.start.toISOString(), '2026-10-29T13:00:00.000Z');
  assert.equal(result.endTime, null); assert.equal(result.endSource, null); assert.equal(result.end, null);
  assert.equal(result.confidence, 'high'); assert.equal(result.ambiguous, false);
});

test('« jeudi prochain de 10h à 11h30 » → explicit range, exact date flagged for confirmation', () => {
  const result = detect('Je suis disponible jeudi prochain de 10h à 11h30.')!;
  assert.equal(result.date, '2026-10-29');
  assert.equal(result.startTime, '10:00'); assert.equal(result.endTime, '11:30'); assert.equal(result.endSource, 'explicit');
  assert.equal(result.durationMinutes, 90);
  assert.equal(result.ambiguous, true); assert.deepEqual(result.ambiguity, ['next_weekday']);
});

test('explicit date with an hour: « Réunion le 5 novembre à 15:00. »', () => {
  const result = detect('Réunion le 5 novembre à 15:00.')!;
  assert.equal(result.date, '2026-11-05'); assert.equal(result.startTime, '15:00'); assert.equal(result.kind, 'meeting'); assert.equal(result.confidence, 'high');
});

test('English relative date: « Can we meet next Monday at 2 PM? »', () => {
  const result = detect('Can we meet next Monday at 2 PM?')!;
  assert.equal(result.language, 'en');
  assert.equal(result.date, '2026-11-02'); assert.equal(result.startTime, '14:00');
  assert.equal(result.ambiguous, true);
});

test('English: tomorrow at 3pm, bare « at 3 » read as afternoon but flagged', () => {
  assert.equal(detect('Can we talk tomorrow at 3pm?')!.startTime, '15:00');
  const bare = detect('Can we meet tomorrow at 3?')!;
  assert.equal(bare.startTime, '15:00'); assert.ok(bare.ambiguity.includes('bare_hour')); assert.equal(bare.confidence, 'medium');
});

test('Arabic relative date: « نلتقي غداً على الساعة 14:00. »', () => {
  const result = detect('نلتقي غداً على الساعة 14:00.')!;
  assert.equal(result.language, 'ar');
  assert.equal(result.date, '2026-10-29'); assert.equal(result.startTime, '14:00');
});

test('Arabic weekday with a range and Arabic-Indic digits', () => {
  const result = detect('هل يمكن أن نلتقي يوم الخميس القادم من الساعة ١٠ إلى ١١؟')!;
  assert.equal(result.date, '2026-10-29'); assert.equal(result.startTime, '10:00'); assert.equal(result.endTime, '11:00');
});

test('Tunisian usage: « نتقابلو غدوة على 10 الصباح »', () => {
  const result = detect('نتقابلو غدوة على 10 الصباح')!;
  assert.equal(result.date, '2026-10-29'); assert.equal(result.startTime, '10:00');
});

test('the full example: meeting tomorrow between 14h and 15h about the project', () => {
  const result = detect('On peut faire une réunion demain entre 14h et 15h pour avancer sur le projet ?')!;
  assert.equal(result.startTime, '14:00'); assert.equal(result.endTime, '15:00'); assert.equal(result.kind, 'meeting');
  assert.equal(result.topic, 'avancer sur le projet ?'.replace(' ?', ''));
});

test('a time without a meeting proposal does not trigger', () => {
  assert.equal(detect('Je termine à 14h.'), null);
  assert.equal(detect('Il est actuellement 10h.'), null);
  assert.equal(detect("It's 10 am here."), null);
  assert.equal(detect('I finish at 2pm today.'), null);
  assert.equal(detect('Le devoir est à rendre demain à 23h59.'), null);
  assert.equal(detect("Tu peux m'envoyer le fichier demain à 10h ?"), null);
  assert.equal(detect("J'ai cours demain à 10h."), null);
  assert.equal(detect('Can you send me the file tomorrow at 10am?'), null);
});

test('explicitly refused availability does not trigger', () => {
  assert.equal(detect('Je ne suis pas disponible demain.'), null);
  assert.equal(detect('Je ne suis pas disponible demain à 14h.'), null);
  assert.equal(detect("Sorry, I'm not available tomorrow at 3pm."), null);
  assert.equal(detect('آسف، لست متاحاً غداً على الساعة 10'), null);
});

test('refusal then counter-proposal: only the proposal is kept', () => {
  const result = detect('Je ne suis pas disponible demain, mais jeudi à 10h ça marche')!;
  assert.equal(result.date, '2026-10-29'); assert.equal(result.startTime, '10:00');
});

test('past dates are never suggested', () => {
  assert.equal(detect('Nous avions rendez-vous hier à 15h.'), null);
  assert.equal(detect('Réunion le 20 octobre à 15h'), null);
  // Written yesterday, "tomorrow at 8h" is already over now.
  assert.equal(detect('On se voit demain à 8h ?', { ...tunis, reference: new Date('2026-10-27T08:00:00Z') }), null);
});

test('relative dates resolve from the message time, not from now', () => {
  const result = detect('On se voit demain à 16h ?', { ...tunis, reference: new Date('2026-10-27T08:00:00Z') })!;
  assert.equal(result.date, '2026-10-28');
});

test('ambiguous numeric dates: dd/mm in French, mm/dd flagged in English', () => {
  assert.equal(detect('Réunion le 05/11 à 10h')!.date, '2026-11-05');
  const english = detect('Can we meet on 11/05 at 10am?')!;
  assert.equal(english.date, '2026-11-05'); assert.ok(english.ambiguity.includes('numeric_date'));
});

test('dans deux heures / in 30 minutes / بعد ساعتين', () => {
  assert.equal(detect('On peut s’appeler dans deux heures ?')!.startTime, '11:00');
  assert.equal(detect('Can we have a call in 30 minutes?')!.startTime, '09:30');
  assert.equal(detect('ممكن نتكلم بعد ساعتين؟')!.startTime, '11:00');
});

test('an explicit duration gives the end, marked as such', () => {
  const result = detect('On fait un appel demain à 9h pendant 1h30 ?')!;
  assert.equal(result.startTime, '09:00'); assert.equal(result.endTime, '10:30'); assert.equal(result.endSource, 'duration'); assert.equal(result.kind, 'call');
});

test('several proposals in one message: the first is suggested and the others counted', () => {
  const result = detect('On se voit demain à 14h ? Sinon jeudi à 10h ?')!;
  assert.equal(result.startTime, '14:00'); assert.equal(result.otherCount, 1);
});

test('messages without a date or time, or with only a date, give nothing', () => {
  assert.equal(detect('Merci pour le cours !'), null);
  assert.equal(detect('Je suis dispo demain'), null);
  assert.equal(detect('Le chapitre 3 contient 14 exercices.'), null);
  assert.equal(detect('Version 2.5 du projet'), null);
});

test('same weekday as today: still ahead today, otherwise next week; flagged', () => {
  const later = detect('On se voit mercredi à 15h ?')!;
  assert.equal(later.date, '2026-10-28'); assert.ok(later.ambiguity.includes('same_weekday'));
  assert.equal(detect('On se voit mercredi à 8h ?')!.date, '2026-11-04');
});

test('DST: the end of summer time in Paris is applied to the resolved instant', () => {
  const result = detect('On se voit demain à 10h ?', { reference: new Date('2026-10-24T08:00:00Z'), now: new Date('2026-10-24T08:00:00Z'), timeZone: 'Europe/Paris' })!;
  assert.equal(result.date, '2026-10-25');
  assert.equal(result.start.toISOString(), '2026-10-25T09:00:00.000Z');
});

test('nothing is created by detection: the result is plain data', () => {
  const result = detect('On se voit demain à 14h.')!;
  assert.deepEqual(Object.keys(result).sort(), ['ambiguity', 'ambiguous', 'confidence', 'date', 'durationMinutes', 'end', 'endSource', 'endTime', 'kind', 'language', 'matchedText', 'otherCount', 'start', 'startTime', 'timeZone', 'topic']);
});
