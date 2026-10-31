import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, RefreshCw, Video } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { Textarea } from '../atoms/Textarea';
import { FormField } from '../molecules/FormField';
import { ConfirmationDialog } from '../molecules/ConfirmationDialog';
import { LmsDialog } from '../organisms/LmsShared';
import { calendarService, type CalendarConnection, type Conflict, type EventPayload, type FeedItem, type Invitee } from '../../services/calendarService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatMoney } from '../../utils/format';
import { COMMON_TIME_ZONES, browserTimeZone, fromWallInput, toWallInput } from '../../utils/timeZone';

/** `slot`: a teacher's tutoring slot published for booking (the tutoring model, not a calendar event). */
export type EventKind = 'slot' | 'session' | 'appointment' | 'meeting' | 'personal' | 'other';

/** Values a new event starts from: a selected slot, a month day, or a chat suggestion (never saved without the user). */
export interface EventDraft {
  start: Date; end: Date | null; allDay?: boolean; timeZone: string;
  title?: string; description?: string; kind?: EventKind; mode?: 'online' | 'in_person' | 'none';
  /** Proposed people: shown, never added until the user adds them. */
  suggestedParticipants?: Invitee[];
  sourceMessageId?: string | null;
  notices?: string[];
  /** Student side: slots of this teacher are listed for a session request. */
  teacherId?: string;
}

interface Props {
  role: string;
  draft?: EventDraft;
  item?: FeedItem;
  connections: CalendarConnection[];
  defaultDurationMinutes: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const REMINDER_CHOICES = [10, 30, 60, 1440];

export function formatRange(start: string | Date, end: string | Date | null, language: string, timeZone?: string) {
  const locale = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-TN' }[language.slice(0, 2)] || 'fr-FR';
  const zone = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...zone }).format(new Date(start));
  const time = (value: string | Date) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...zone }).format(new Date(value));
  return end ? `${day}, ${time(start)} – ${time(end)}` : `${day}, ${time(start)}`;
}

const kindOf = (item?: FeedItem): EventKind => !item ? 'personal' : item.kind === 'session' ? 'session' : (['appointment', 'meeting', 'personal', 'other'].includes(item.type) ? item.type as EventKind : 'other');

export const EventDialog: React.FC<Props> = ({ role, draft, item, connections, defaultDurationMinutes, onClose, onSaved }) => {
  const { t, i18n } = useTranslation();
  const editing = !!item && item.permissions.edit;
  const readOnly = !!item && !item.permissions.edit;
  const initialZone = item?.timeZone || draft?.timeZone || browserTimeZone();
  const initialStart = item ? new Date(item.start) : draft!.start;
  const initialEnd = item ? new Date(item.end) : draft?.end || new Date(initialStart.getTime() + defaultDurationMinutes * 60_000);

  const [kind, setKind] = useState<EventKind>(item ? kindOf(item) : draft?.kind || 'personal');
  const [sessionMode, setSessionMode] = useState<'slot' | 'proposal'>(draft?.suggestedParticipants?.some(person => person.role === 'student') ? 'proposal' : 'slot');
  const [title, setTitle] = useState(item?.kind === 'session' ? item.subject ?? item.title : item?.title || draft?.title || '');
  const [description, setDescription] = useState(item?.description || draft?.description || '');
  const [timeZone, setTimeZone] = useState(initialZone);
  const [startInput, setStartInput] = useState(toWallInput(initialStart, initialZone));
  const [endInput, setEndInput] = useState(toWallInput(initialEnd, initialZone));
  const [allDay, setAllDay] = useState(item?.allDay || draft?.allDay || false);
  const [mode, setMode] = useState<'online' | 'in_person' | 'none'>(item?.mode || draft?.mode || 'none');
  const [location, setLocation] = useState(item?.location || '');
  const [meetingUrl, setMeetingUrl] = useState(item?.meetingUrl || '');
  const [participantIds, setParticipantIds] = useState<string[]>(item?.participants.map(participant => participant.id) || []);
  const [courseId, setCourseId] = useState<string>(item?.courseId || '');
  const [reminders, setReminders] = useState<number[]>(item?.reminderMinutes || []);
  const [destination, setDestination] = useState(item?.sync ? `${item.sync.provider}|${item.sync.calendarId}` : 'edumarket');
  const [teamsMeeting, setTeamsMeeting] = useState(false);
  const [sendExternalInvites, setSendExternalInvites] = useState(false);
  const [price, setPrice] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [slots, setSlots] = useState<Record<string, any>[] | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isTeacher = role === 'teacher', isStudent = role === 'student';
  const isSession = kind === 'session' || kind === 'slot';
  // A new tutoring slot: from the "Tutoring slot" type, or the slot mode of a session (both create the same record).
  const slotMode = isTeacher && !item && (kind === 'slot' || (kind === 'session' && sessionMode === 'slot'));
  const sessionTitle = (entry: FeedItem) => entry.kind === 'session' && !entry.subject ? t(entry.status === 'available' ? 'calendarUi.openSlotTitle' : 'calendarUi.defaultSessionSubject') : entry.title;
  const sessionItem = item?.kind === 'session';
  const writableTargets = useMemo(() => connections.filter(connection => connection.access === 'write' && connection.status !== 'expired' && connection.syncMode !== 'read_only')
    .flatMap(connection => connection.calendars.filter(calendar => calendar.canEdit).map(calendar => ({ key: `${connection.provider}|${calendar.id}`, provider: connection.provider, calendar }))), [connections]);
  const target = writableTargets.find(entry => entry.key === destination);
  const teamsAvailable = target?.provider === 'microsoft' && target.calendar.teamsAvailable;

  useEffect(() => {
    if (readOnly) return;
    calendarService.invitees().then(setInvitees).catch(() => setInvitees([]));
    calendarService.contexts().then(setCourses).catch(() => setCourses([]));
  }, [readOnly]);

  // Overlaps are checked while the user edits, so they can fix the time before saving.
  useEffect(() => {
    if (readOnly || (isSession && isStudent)) return;
    const start = fromWallInput(startInput, timeZone), end = fromWallInput(endInput, timeZone);
    if (!start || !end || end <= start) { setConflicts([]); return; }
    const handle = window.setTimeout(() => {
      calendarService.conflicts({ start: startInput, end: endInput, timeZone, participantIds: isSession ? (studentId ? [studentId] : []) : participantIds, excludeEventId: item && item.kind !== 'session' ? item.sourceId : undefined, excludeSessionId: sessionItem ? item!.sourceId : undefined })
        .then(list => { setConflicts(list); setOverlapConfirmed(false); }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [startInput, endInput, timeZone, participantIds, studentId, isSession, readOnly]);

  // Student session request: open slots around the chosen day, from their teacher when known.
  useEffect(() => {
    if (!(isSession && isStudent) || readOnly) return;
    const start = fromWallInput(startInput, timeZone);
    if (!start) return;
    const from = new Date(Math.max(Date.now(), start.getTime() - 12 * 3600_000)), to = new Date(start.getTime() + 36 * 3600_000);
    setSlots(null);
    calendarService.availability(from, to, draft?.teacherId).then(setSlots).catch(() => setSlots([]));
  }, [isSession, isStudent, startInput, timeZone, readOnly]);

  const conflictText = (conflict: Conflict) => conflict.mine
    ? t('calendarUi.conflictMine', { title: conflict.title || t('calendarUi.untitled'), range: formatRange(conflict.start, conflict.end, i18n.language) })
    : t('calendarUi.conflictOther', { name: invitees.find(person => person.id === conflict.userId)?.name || t('calendarUi.participant') });

  const failure = (cause: unknown) => {
    const details = (cause as { details?: { conflicts?: Conflict[] } }).details;
    if (details?.conflicts?.length) { setConflicts(details.conflicts); setOverlapConfirmed(false); }
    setError(apiErrorMessage(t, cause));
  };

  const buildPayload = (notify: boolean): EventPayload => {
    const [provider, calendarId = ''] = destination.split('|');
    return {
      title: title.trim(), description, type: (isSession ? 'meeting' : kind) as EventPayload['type'], start: allDay ? `${startInput.slice(0, 10)}T00:00` : startInput,
      end: allDay ? `${endInput.slice(0, 10)}T23:59` : endInput, timeZone, allDay, mode, location: mode === 'in_person' ? location : '', meetingUrl: mode === 'online' ? meetingUrl.trim() : '',
      participantIds, courseId: courseId || null, reminderMinutes: reminders, destination: { provider: provider as EventPayload['destination']['provider'], calendarId },
      teamsMeeting: teamsAvailable ? teamsMeeting : false, sendExternalInvites: provider !== 'edumarket' && sendExternalInvites, notifyParticipants: notify, allowOverlap: overlapConfirmed, sourceMessageId: draft?.sourceMessageId || null,
    };
  };

  const syncOutcome = (saved: Record<string, any>) => {
    if (!saved?.external) return t('calendarUi.saved');
    if (saved.external.state === 'synced') {
      if (saved.external.teamsMeeting && !saved.teamsJoinUrl) return t('calendarUi.savedTeamsMissing');
      return saved.teamsJoinUrl ? t('calendarUi.savedWithTeams') : t('calendarUi.savedSynced', { provider: t(`calendarUi.providers.${saved.external.provider}`) });
    }
    return t('calendarUi.savedNotSynced', { provider: t(`calendarUi.providers.${saved.external.provider}`), reason: t(`calendarUi.syncErrors.${saved.external.error || 'PROVIDER_ERROR'}`, { defaultValue: saved.external.error }) });
  };

  const save = async (notify = false) => {
    setError('');
    if (!title.trim() && !(isSession && isStudent) && !slotMode) { setError(t('calendarUi.titleRequired')); return; }
    const start = fromWallInput(startInput, timeZone), end = fromWallInput(endInput, timeZone);
    if (!allDay && (!start || !end || end <= start)) { setError(t('calendarUi.invalidRange')); return; }
    if (conflicts.length && !overlapConfirmed && !slotMode) { setError(t('calendarUi.confirmOverlapFirst')); return; }
    setBusy(true);
    try {
      if (sessionItem) {
        await calendarService.moveSession(item!.sourceId, { startAt: startInput, endAt: endInput, timeZone });
        onSaved(t('calendarUi.sessionMoved'));
      } else if (slotMode) {
        await calendarService.createSlot({ startAt: startInput, endAt: endInput, timeZone, type: mode === 'in_person' ? 'in_person' : 'online', price, venue: mode === 'in_person' ? location : undefined, subject: title.trim() || undefined, notes: description.trim() || undefined });
        onSaved(t('calendarUi.slotCreated'));
      } else if (isSession && isTeacher) {
        if (!studentId) { setError(t('calendarUi.studentRequired')); setBusy(false); return; }
        await calendarService.proposeSession({ studentId, startAt: startInput, endAt: endInput, timeZone, type: mode === 'in_person' ? 'in_person' : 'online', venue: mode === 'in_person' ? location : undefined, subject: title.trim(), notes: description || undefined, allowOverlap: overlapConfirmed });
        onSaved(t('calendarUi.proposalSent'));
      } else if (editing) {
        const saved = await calendarService.updateEvent(item!.sourceId, { ...buildPayload(notify), destination: undefined, sourceMessageId: undefined, ...(item!.kind === 'external' ? { participantIds: undefined, teamsMeeting: undefined } : {}), expectedRevision: item!.revision || 0 });
        onSaved(syncOutcome(saved));
      } else {
        const saved = await calendarService.createEvent(buildPayload(notify));
        onSaved(syncOutcome(saved));
      }
    } catch (cause) { failure(cause); }
    finally { setBusy(false); }
  };

  const bookSlot = async (slotId: string) => {
    setBusy(true); setError('');
    try { await calendarService.book(slotId, title.trim() || t('calendarUi.defaultSessionSubject'), description || undefined); onSaved(t('calendarUi.requestSent')); }
    catch (cause) { failure(cause); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError('');
    try {
      if (item!.kind === 'session') {
        if (item!.status === 'available') await calendarService.deleteSlot(item!.sourceId);
        else await calendarService.answerSession(item!.sourceId, 'cancelled');
      } else await calendarService.deleteEvent(item!.sourceId);
      onSaved(t('calendarUi.deleted'));
    } catch (cause) { setConfirmDelete(false); failure(cause); }
    finally { setBusy(false); }
  };

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('');
    try { await action(); onSaved(message); } catch (cause) { failure(cause); } finally { setBusy(false); }
  };

  const zoneChoices = [...new Set([timeZone, browserTimeZone(), ...COMMON_TIME_ZONES])];
  const localZone = browserTimeZone();
  const sessionCancellable = sessionItem && ['pending', 'confirmed'].includes(item!.status) && new Date(item!.start).getTime() > Date.now() && !(item!.status === 'pending' && item!.permissions.respond);
  const dialogTitle = readOnly ? sessionTitle(item!) : editing ? t('calendarUi.editTitle') : t('calendarUi.createTitle');

  // The teacher handles requests, payments and the meeting room on the Tutoring page; this only leads there.
  const manageLink = isTeacher && item?.kind === 'session' && item.isOwner ? (
    <Link to={`/teacher/tutoring?session=${encodeURIComponent(item.sourceId)}`} className="inline-flex items-center rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
      {item.status === 'pending' && item.proposedBy !== 'teacher' ? t('calendarUi.manageRequests') : t('calendarUi.openInTutoring')}
    </Link>
  ) : null;

  // ---------------------------------------------------------------------------------------------- read-only details
  if (readOnly && item) {
    const mine = item.kind === 'session' ? null : item.myStatus;
    return (
      <LmsDialog title={dialogTitle} onClose={onClose} wide>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-semibold text-slate-600">{t('calendarUi.when')}</dt>
          <dd>{formatRange(item.start, item.end, i18n.language)}{item.timeZone && item.timeZone !== localZone && <span className="block text-xs text-slate-500">{t('calendarUi.inZone', { range: formatRange(item.start, item.end, i18n.language, item.timeZone), zone: item.timeZone })}</span>}</dd>
          <dt className="font-semibold text-slate-600">{t('calendarUi.typeLabel')}</dt><dd>{t(`calendarUi.kinds.${item.kind}`)} · {t(`calendarUi.statuses.${item.status}`, { defaultValue: item.status })}</dd>
          {item.counterpart && <><dt className="font-semibold text-slate-600">{t('calendarUi.with')}</dt><dd>{item.counterpart}</dd></>}
          {item.kind === 'session' && <><dt className="font-semibold text-slate-600">{t('calendarUi.price')}</dt><dd>{item.price ? formatMoney(Math.round(item.price * 100), 'eur', i18n.language) : t('calendarUi.free')}{item.paymentStatus && item.paymentStatus !== 'not_required' && ` · ${t(`calendarUi.payment.${item.paymentStatus}`, { defaultValue: item.paymentStatus })}`}</dd></>}
          {item.participants.length > 0 && <><dt className="font-semibold text-slate-600">{t('calendarUi.participants')}</dt><dd><ul>{item.participants.map(person => <li key={person.id}>{person.name} — {t(`calendarUi.answer.${person.status}`, { defaultValue: person.status })}</li>)}</ul></dd></>}
          {item.location && <><dt className="font-semibold text-slate-600">{t('calendarUi.location')}</dt><dd>{item.location}</dd></>}
          {item.meetingUrl?.startsWith('https://') && <><dt className="font-semibold text-slate-600">{t('calendarUi.meetingLink')}</dt><dd><a className="inline-flex items-center gap-1 text-indigo-700 underline" href={item.meetingUrl} target="_blank" rel="noopener noreferrer">{t('calendarUi.join')} <ExternalLink className="h-3 w-3" aria-hidden /></a></dd></>}
          {item.teamsJoinUrl?.startsWith('https://') && <><dt className="font-semibold text-slate-600">Microsoft Teams</dt><dd><a className="inline-flex items-center gap-1 text-indigo-700 underline" href={item.teamsJoinUrl} target="_blank" rel="noopener noreferrer"><Video className="h-3.5 w-3.5" aria-hidden /> {t('calendarUi.joinTeams')}</a></dd></>}
          {item.kind === 'external' && <><dt className="font-semibold text-slate-600">{t('calendarUi.source')}</dt><dd>{t('calendarUi.externalReadOnly', { provider: t(`calendarUi.providers.${item.source}`) })}</dd></>}
          {item.description && <><dt className="font-semibold text-slate-600">{t('calendarUi.description')}</dt><dd className="whitespace-pre-wrap">{item.description}</dd></>}
        </dl>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {item.kind === 'session' && item.permissions.respond && <>
            <Button variant="outline" size="sm" isLoading={busy} onClick={() => void act(() => calendarService.answerSession(item.sourceId, 'rejected'), t('calendarUi.declined'))}>{t('calendarUi.decline')}</Button>
            <Button size="sm" isLoading={busy} onClick={() => void act(() => calendarService.answerSession(item.sourceId, 'confirmed'), t('calendarUi.accepted'))}>{t('calendarUi.accept')}</Button>
          </>}
          {item.kind === 'event' && item.permissions.respond && <>
            <Button variant="outline" size="sm" isLoading={busy} disabled={mine === 'declined'} onClick={() => void act(() => calendarService.respond(item.sourceId, 'declined'), t('calendarUi.declined'))}>{t('calendarUi.decline')}</Button>
            <Button size="sm" isLoading={busy} disabled={mine === 'accepted'} onClick={() => void act(() => calendarService.respond(item.sourceId, 'accepted'), t('calendarUi.accepted'))}>{t('calendarUi.accept')}</Button>
          </>}
          {manageLink}
          {item.kind === 'session' && item.status === 'confirmed' && <Link to="/sessions" className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">{t('calendarUi.reschedule')}</Link>}
          {sessionCancellable && <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>{t('calendarUi.cancelSession')}</Button>}
          <Button variant="ghost" size="sm" onClick={onClose}>{t('calendarUi.close')}</Button>
        </div>
        <ConfirmationDialog isOpen={confirmDelete} isDangerous isLoading={busy} title={t('calendarUi.cancelSessionTitle')} description={t('calendarUi.cancelSessionText')} confirmLabel={t('calendarUi.cancelSession')} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />
      </LmsDialog>
    );
  }

  // --------------------------------------------------------------------------------------------------- form
  const kindChoices: EventKind[] = item ? [kind] : [...(isTeacher ? ['slot' as const] : []), ...(isTeacher || isStudent ? ['session' as const] : []), 'appointment', 'meeting', 'personal', 'other'];
  const studentChoices = invitees.filter(person => person.role === 'student');
  const suggestions = (draft?.suggestedParticipants || []).filter(person => !participantIds.includes(person.id));
  const external = destination !== 'edumarket';

  return (
    <LmsDialog title={dialogTitle} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(false); }}>
        {draft?.notices?.map(notice => <p key={notice} className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{notice}</p>)}
        {item?.sync?.state === 'conflict' && (
          <div role="group" aria-label={t('calendarUi.conflictTitle')} className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p>{t('calendarUi.syncConflict', { provider: t(`calendarUi.providers.${item.sync.provider}`) })}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" isLoading={busy} onClick={() => void act(() => calendarService.resolveConflict(item.sourceId, 'local'), t('calendarUi.conflictResolved'))}>{t('calendarUi.keepLocal')}</Button>
              <Button size="sm" variant="outline" isLoading={busy} onClick={() => void act(() => calendarService.resolveConflict(item.sourceId, 'remote'), t('calendarUi.conflictResolved'))}>{t('calendarUi.keepRemote', { provider: t(`calendarUi.providers.${item.sync.provider}`) })}</Button>
            </div>
          </div>
        )}
        {item?.sync?.state === 'error' && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
            {t('calendarUi.syncFailed', { provider: t(`calendarUi.providers.${item.sync.provider}`), reason: t(`calendarUi.syncErrors.${item.sync.error || 'PROVIDER_ERROR'}`, { defaultValue: item.sync.error }) })}
            <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-3 w-3" />} isLoading={busy} onClick={() => void act(() => calendarService.retrySync(item.sourceId), t('calendarUi.retried'))}>{t('calendarUi.retry')}</Button>
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('calendarUi.type')}>
            <select className={fieldClass} value={kind} disabled={!!item} onChange={event => setKind(event.target.value as EventKind)}>
              {kindChoices.map(choice => <option key={choice} value={choice}>{t(`calendarUi.types.${choice}`)}</option>)}
            </select>
          </FormField>
          {kind === 'session' && isTeacher && !item && (
            <FormField label={t('calendarUi.sessionMode')}>
              <select className={fieldClass} value={sessionMode} onChange={event => setSessionMode(event.target.value as 'slot' | 'proposal')}>
                <option value="slot">{t('calendarUi.sessionModes.slot')}</option>
                <option value="proposal">{t('calendarUi.sessionModes.proposal')}</option>
              </select>
            </FormField>
          )}
        </div>

        {sessionItem && <p className="text-xs text-slate-600">{t('calendarUi.sessionMoveHint', { title: sessionTitle(item!) })}</p>}
        {slotMode && (
          <>
            <p className="rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900">{t('calendarUi.slotHint')}</p>
            <FormField label={t('calendarUi.slotSubject')} hint={t('calendarUi.slotSubjectHint')}>
              <Input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} />
            </FormField>
            <FormField label={t('calendarUi.description')}><Textarea rows={2} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></FormField>
          </>
        )}
        {!(isSession && isStudent) && !slotMode && !sessionItem && (
          <FormField label={isSession ? t('calendarUi.subject') : t('calendarUi.eventTitle')} required>
            <Input value={title} maxLength={isSession ? 160 : 200} onChange={event => setTitle(event.target.value)} />
          </FormField>
        )}
        {isSession && isStudent && !item && (
          <FormField label={t('calendarUi.subject')} hint={t('calendarUi.studentSessionHint')}>
            <Input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} />
          </FormField>
        )}

        {!(isSession && isStudent && !item) && (
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-slate-700">{t('calendarUi.when')}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label={t('calendarUi.start')}><input className={fieldClass} type="datetime-local" required value={startInput} onChange={event => {
                // Moving the start keeps the duration, like most calendars.
                const previousStart = fromWallInput(startInput, timeZone), previousEnd = fromWallInput(endInput, timeZone), nextStart = fromWallInput(event.target.value, timeZone);
                setStartInput(event.target.value);
                if (previousStart && previousEnd && nextStart) setEndInput(toWallInput(new Date(nextStart.getTime() + (previousEnd.getTime() - previousStart.getTime())), timeZone));
              }} /></FormField>
              <FormField label={t('calendarUi.end')}><input className={fieldClass} type="datetime-local" required value={endInput} onChange={event => setEndInput(event.target.value)} /></FormField>
              <FormField label={t('calendarUi.timeZone')} hint={timeZone !== localZone ? t('calendarUi.zoneDiffers', { zone: localZone }) : undefined}>
                <select className={fieldClass} value={timeZone} onChange={event => setTimeZone(event.target.value)}>{zoneChoices.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select>
              </FormField>
            </div>
            {!isSession && <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} /> {t('calendarUi.allDay')}</label>}
          </fieldset>
        )}

        {isSession && isStudent && !item && (
          <section aria-label={t('calendarUi.openSlots')} className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">{t('calendarUi.openSlots')}</h3>
            {!slots && <p role="status" className="text-xs text-slate-500">{t('calendarUi.loading')}</p>}
            {slots?.length === 0 && <p className="text-xs text-slate-500">{t('calendarUi.noSlots')}</p>}
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {slots?.map(slot => (
                <li key={slot._id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                  <span>{formatRange(slot.startAt, slot.endAt, i18n.language)} · {slot.teacherId?.name} · {slot.type === 'online' ? t('calendarUi.modes.online') : t('calendarUi.modes.in_person')} · {slot.price > 0 ? formatMoney(Math.round(slot.price * 100), 'eur', i18n.language) : t('calendarUi.free')}</span>
                  {slot.price > 0 ? <Link to="/sessions" className="text-indigo-700 underline">{t('calendarUi.paidSlot')}</Link> : <Button size="sm" isLoading={busy} onClick={() => void bookSlot(slot._id)}>{t('calendarUi.requestSlot')}</Button>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {kind === 'session' && isTeacher && sessionMode === 'proposal' && !item && !studentId && draft?.suggestedParticipants?.filter(person => person.role === 'student').map(person => (
          <div key={person.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900">
            <span>{t('calendarUi.suggestedParticipants')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setStudentId(person.id)}>{t('calendarUi.choosePerson', { name: person.name })}</Button>
          </div>
        ))}
        {kind === 'session' && isTeacher && sessionMode === 'proposal' && !item && (
          <FormField label={t('calendarUi.student')} required hint={t('calendarUi.proposalHint')}>
            <select className={fieldClass} value={studentId} onChange={event => setStudentId(event.target.value)}>
              <option value="">{t('calendarUi.chooseStudent')}</option>
              {studentChoices.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </FormField>
        )}
        {slotMode && (
          <FormField label={t('calendarUi.price')} hint={t('calendarUi.priceHint')}><Input type="number" min={0} max={100000} step="0.5" value={price} onChange={event => setPrice(Math.max(0, Number(event.target.value) || 0))} /></FormField>
        )}

        {!(isSession && isStudent && !item) && !sessionItem && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('calendarUi.mode')}>
              <select className={fieldClass} value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
                {(isSession ? ['online', 'in_person'] : ['none', 'online', 'in_person']).map(choice => <option key={choice} value={choice}>{t(`calendarUi.modes.${choice}`)}</option>)}
              </select>
            </FormField>
            {mode === 'in_person' && <FormField label={t('calendarUi.location')}><Input value={location} maxLength={isSession ? 200 : 300} onChange={event => setLocation(event.target.value)} /></FormField>}
            {mode === 'online' && !isSession && <FormField label={t('calendarUi.meetingLink')} hint={t('calendarUi.meetingLinkHint')}><Input type="url" inputMode="url" placeholder="https://" value={meetingUrl} maxLength={1000} onChange={event => setMeetingUrl(event.target.value)} /></FormField>}
            {mode === 'online' && isSession && <p className="text-xs text-slate-500 sm:col-span-1">{t('calendarUi.jitsiHint')}</p>}
          </div>
        )}

        {!isSession && (
          <>
            <FormField label={t('calendarUi.description')}><Textarea rows={3} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></FormField>
            {item?.kind !== 'external' && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-slate-700">{t('calendarUi.participants')}</legend>
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900">
                    <span>{t('calendarUi.suggestedParticipants')}</span>
                    {suggestions.map(person => <Button key={person.id} type="button" size="sm" variant="outline" onClick={() => setParticipantIds(previous => [...previous, person.id])}>{t('calendarUi.addPerson', { name: person.name })}</Button>)}
                  </div>
                )}
                <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {invitees.length === 0 && <p className="text-xs text-slate-500">{t('calendarUi.noInvitees')}</p>}
                  {invitees.map(person => (
                    <label key={person.id} className="flex items-center gap-2 py-0.5 text-xs text-slate-800">
                      <input type="checkbox" checked={participantIds.includes(person.id)} onChange={event => setParticipantIds(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id))} />
                      {person.name} <span className="text-slate-500">({t(`calendarUi.roles.${person.role}`, { defaultValue: person.role })})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {item?.kind !== 'external' && (
                <FormField label={t('calendarUi.course')}>
                  <select className={fieldClass} value={courseId} onChange={event => setCourseId(event.target.value)}>
                    <option value="">{t('calendarUi.noCourse')}</option>
                    {courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
                  </select>
                </FormField>
              )}
              <fieldset>
                <legend className="mb-1 text-xs font-semibold text-slate-700">{t('calendarUi.reminders')}</legend>
                <div className="flex flex-wrap gap-3">
                  {REMINDER_CHOICES.map(minutes => (
                    <label key={minutes} className="flex items-center gap-1 text-xs text-slate-800">
                      <input type="checkbox" checked={reminders.includes(minutes)} disabled={!reminders.includes(minutes) && reminders.length >= 3} onChange={event => setReminders(previous => event.target.checked ? [...previous, minutes] : previous.filter(value => value !== minutes))} />
                      {t(`calendarUi.reminderChoices.${minutes}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {!item && (
              <FormField label={t('calendarUi.destination')} hint={external ? t('calendarUi.destinationHint') : undefined}>
                <select className={fieldClass} value={destination} onChange={event => { setDestination(event.target.value); setTeamsMeeting(false); }}>
                  <option value="edumarket">{t('calendarUi.edumarketCalendar')}</option>
                  {writableTargets.map(entry => <option key={entry.key} value={entry.key}>{t(`calendarUi.providers.${entry.provider}`)} — {entry.calendar.name}</option>)}
                </select>
              </FormField>
            )}
            {!item && target?.provider === 'microsoft' && mode === 'online' && (
              teamsAvailable
                ? <label className="flex items-center gap-2 text-xs text-slate-800"><input type="checkbox" checked={teamsMeeting} onChange={event => setTeamsMeeting(event.target.checked)} /> {t('calendarUi.createTeams')}</label>
                : <p className="text-xs text-slate-500">{t('calendarUi.teamsUnavailable')}</p>
            )}
            {external && participantIds.length > 0 && (
              <label className="flex items-start gap-2 text-xs text-slate-800"><input type="checkbox" className="mt-0.5" checked={sendExternalInvites} onChange={event => setSendExternalInvites(event.target.checked)} /> {t('calendarUi.sendProviderInvites', { provider: t(`calendarUi.providers.${target?.provider || 'google'}`) })}</label>
            )}
          </>
        )}

        {conflicts.length > 0 && (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">{t('calendarUi.overlapTitle')}</p>
            <ul className="list-disc ps-5">{conflicts.slice(0, 5).map((conflict, index) => <li key={index}>{conflictText(conflict)}</li>)}</ul>
            {!slotMode && <label className="flex items-center gap-2"><input type="checkbox" checked={overlapConfirmed} onChange={event => setOverlapConfirmed(event.target.checked)} /> {t('calendarUi.overlapConfirm')}</label>}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">{item && item.permissions.delete && <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>{t('calendarUi.delete')}</Button>}{manageLink}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('calendarUi.cancel')}</Button>
            {!(isSession && isStudent && !item) && <Button type="submit" size="sm" isLoading={busy}>{kind === 'session' && isTeacher && sessionMode === 'proposal' && !item ? t('calendarUi.sendProposal') : slotMode ? t('calendarUi.publishSlot') : t('calendarUi.save')}</Button>}
            {!isSession && participantIds.length > 0 && item?.kind !== 'external' && <Button type="button" variant="secondary" size="sm" isLoading={busy} onClick={() => void save(true)}>{t('calendarUi.saveAndInvite')}</Button>}
          </div>
        </div>
      </form>
      <ConfirmationDialog isOpen={confirmDelete} isDangerous isLoading={busy} title={t('calendarUi.deleteTitle')} description={item?.sync ? t('calendarUi.deleteSyncedText', { provider: t(`calendarUi.providers.${item?.sync?.provider || 'google'}`) }) : t('calendarUi.deleteText')} confirmLabel={t('calendarUi.delete')} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />
    </LmsDialog>
  );
};
