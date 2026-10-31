import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import enGbLocale from '@fullcalendar/core/locales/en-gb';
import arTnLocale from '@fullcalendar/core/locales/ar-tn';
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Lock, MapPin, RefreshCw, Settings2, Video } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { ApiModeNotice, ErrorAlert, NoticeBanner } from '../../components/molecules/PageStates';
import { EventDialog, formatRange, type EventDraft } from '../../components/calendar/EventDialog';
import { ConnectedCalendars } from '../../components/calendar/ConnectedCalendars';
import { DEFAULT_COLORS, TUTORING_KEYS, calendarSources, colorFor, textOn, visualState } from '../../components/calendar/calendarColors';
import { useAuth } from '../../contexts/AuthContext';
import { calendarService, type CalendarConnection, type CalendarPreferences, type Conflict, type FeedItem, type ProvidersStatus } from '../../services/calendarService';
import { downloadApiFile, usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatMoney } from '../../utils/format';
import { browserTimeZone } from '../../utils/timeZone';

type View = 'month' | 'week' | 'day' | 'agenda';
const FC_VIEWS: Record<Exclude<View, 'agenda'>, string> = { month: 'dayGridMonth', week: 'timeGridWeek', day: 'timeGridDay' };
const AGENDA_TYPES = ['all', 'session', 'event', 'external', 'exam', 'course'] as const;
// Stable references: FullCalendar re-initialises (and fires datesSet again) when these arrays change identity.
const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];
const LOCALES = [frLocale, enGbLocale, arTnLocale];
const sourceKey = (item: FeedItem) => item.kind === 'session' && item.status === 'pending' ? 'pending' : item.calendarKey;
/** `?date=` from another page: an ISO instant, or a local day (YYYY-MM-DD). */
const linkedDate = (value: string | null) => {
  if (!value) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Personal calendar (month / week / day / agenda) of learners, teachers, institutions and admins. */
export const CalendarPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const calendarRef = useRef<FullCalendar>(null);
  const [preferences, setPreferences] = useState<CalendarPreferences | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [providers, setProviders] = useState<ProvidersStatus | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('week');
  const [focusDate, setFocusDate] = useState(() => linkedDate(searchParams.get('date')) || new Date());
  // Item to bring into view once loaded (`?event=` from the Tutoring page); cleared after it was shown.
  const [linkedEvent, setLinkedEvent] = useState(() => searchParams.get('event'));
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null);
  const [dialog, setDialog] = useState<{ draft?: EventDraft; item?: FeedItem } | null>(null);
  const [panel, setPanel] = useState<'calendars' | 'settings' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string[]>([]);
  const [pendingMove, setPendingMove] = useState<{ info: EventDropArg | EventResizeDoneArg; conflicts: Conflict[]; participants?: string[] } | null>(null);
  const [agendaDays, setAgendaDays] = useState(30);
  const [agendaType, setAgendaType] = useState<typeof AGENDA_TYPES[number]>('all');
  const lastRange = useRef('');
  const rtl = i18n.dir() === 'rtl';
  const localZone = browserTimeZone();
  const defaultZone = preferences?.timeZone || localZone;
  const defaultDuration = preferences?.defaultDurationMinutes || 60;

  // OAuth return: the provider redirected back here with a verified outcome.
  const oauthNotice = searchParams.get('calendar');
  useEffect(() => {
    if (oauthNotice === 'error') setError(t(`apiErrors.${searchParams.get('code') || 'CALENDAR_PROVIDER_ERROR'}`, { defaultValue: t('apiErrors.CALENDAR_PROVIDER_ERROR') }));
    if (oauthNotice === 'connected') { setPanel('settings'); setStatus(t('calendarUi.connectedNotice', { provider: t(`calendarUi.providers.${searchParams.get('provider') || 'google'}`) })); }
    if (oauthNotice) setSearchParams({}, { replace: true });
  }, []);

  useEffect(() => {
    if (!usesApi) return;
    Promise.all([calendarService.preferences(), calendarService.connections(), calendarService.providers()])
      // A linked item opens in the week (or day) around it, whatever view was remembered.
      .then(([prefs, list, configured]) => { setPreferences(prefs); setConnections(list); setProviders(configured); setView(linkedEvent && prefs.defaultView === 'month' ? 'week' : prefs.defaultView); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);

  // Stale connections are refreshed in the background when the calendar opens (not instantaneous: see the status line).
  useEffect(() => {
    for (const connection of connections) {
      const stale = !connection.lastSyncAt || Date.now() - new Date(connection.lastSyncAt).getTime() > 10 * 60_000;
      if (stale && connection.status !== 'expired' && connection.status !== 'syncing') calendarService.syncConnection(connection.id).then(updated => { setConnections(previous => previous.map(entry => entry.id === updated.id ? updated : entry)); void reload(); }).catch(() => undefined);
    }
  }, [connections.length]);

  const load = useCallback(async (from: Date, to: Date, force = false) => {
    const key = `${from.toISOString()}|${to.toISOString()}`;
    if (!force && key === lastRange.current) return;
    lastRange.current = key;
    setLoading(true);
    try { setItems(await calendarService.feed(from, to)); setError(''); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setLoading(false); }
  }, [t]);
  const reload = useCallback(async () => { if (range) await load(range.from, range.to, true); }, [range, load]);

  // Coming back to the tab (e.g. after answering a request on the Tutoring page) shows the current statuses.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [reload]);

  // Linked item: highlighted, scrolled to and opened once the period around it is loaded.
  useEffect(() => {
    if (!linkedEvent || loading || !range) return;
    const target = items.find(item => item.id === linkedEvent);
    setLinkedEvent(null);
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('event'); next.delete('date'); return next; }, { replace: true });
    if (!target) { setError(t('calendarUi.linkedNotFound')); return; }
    setHighlighted(target.id);
    if (hidden.has(sourceKey(target))) setStatus(t('calendarUi.linkedHidden'));
    const start = new Date(target.start);
    window.setTimeout(() => calendarRef.current?.getApi().scrollToTime({ hours: Math.max(0, start.getHours() - 1) }), 0);
    setDialog({ item: target });
  }, [items, loading, range, linkedEvent]);

  // Agenda range follows the focus date and the chosen period.
  useEffect(() => {
    if (view !== 'agenda') return;
    const from = new Date(focusDate); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + agendaDays * 86_400_000);
    setRange({ from, to });
    setTitle(`${new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(from)} – ${new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(to.getTime() - 1))}`);
    void load(from, to);
  }, [view, focusDate, agendaDays, load, i18n.language]);

  const savePreferences = (patch: Partial<CalendarPreferences>) => {
    setPreferences(previous => previous ? { ...previous, ...patch } : previous);
    calendarService.savePreferences(patch).catch(cause => setError(apiErrorMessage(t, cause)));
  };

  const hidden = useMemo(() => new Set(preferences?.hidden || []), [preferences?.hidden]);
  // The linked item stays visible even if its calendar is hidden, so the link never lands on nothing.
  const visible = useMemo(() => items.filter(item => item.id === highlighted || !hidden.has(sourceKey(item))), [items, hidden, highlighted]);
  const sources = calendarSources(connections, key => t(`calendarUi.sources.${key}`), role === 'teacher');
  const tutoringKeys = sources.filter(source => TUTORING_KEYS.includes(source.key)).map(source => source.key);
  const tutoringHidden = tutoringKeys.every(key => hidden.has(key));
  const displayTitle = (item: FeedItem) => item.kind === 'session' && !item.subject ? t(item.status === 'available' ? 'calendarUi.openSlotTitle' : 'calendarUi.defaultSessionSubject') : item.title;

  const events = useMemo(() => visible.map(item => {
    const color = colorFor(sourceKey(item), preferences);
    return {
      id: item.id, title: displayTitle(item), start: item.start, end: item.end, allDay: item.allDay,
      backgroundColor: color, borderColor: color, textColor: textOn(color),
      startEditable: item.permissions.move, durationEditable: item.permissions.resize,
      classNames: [`em-state-${visualState(item)}`, ...(saving.includes(item.id) ? ['em-saving'] : []), ...(item.id === highlighted ? ['em-highlight'] : [])],
      extendedProps: { item },
    };
  }), [visible, preferences, saving, highlighted, t]);

  if (!usesApi) return <div className="max-w-4xl mx-auto space-y-6"><h1 className="text-xl font-bold text-slate-900">{t('calendarUi.title')}</h1><ApiModeNotice /></div>;

  const api = () => calendarRef.current?.getApi();
  const changeView = (next: View) => {
    setView(next);
    savePreferences({ defaultView: next });
    // The current period and date are kept across views.
    if (next !== 'agenda') window.setTimeout(() => api()?.changeView(FC_VIEWS[next], focusDate), 0);
  };
  const navigate = (direction: 'prev' | 'next' | 'today') => {
    if (view === 'agenda') {
      setFocusDate(direction === 'today' ? new Date() : new Date(focusDate.getTime() + (direction === 'next' ? agendaDays : -agendaDays) * 86_400_000));
      return;
    }
    const calendar = api();
    if (!calendar) return;
    if (direction === 'today') calendar.today(); else calendar[direction]();
    setFocusDate(calendar.getDate());
  };

  const openCreate = (start: Date, end: Date | null, allDay = false) => setDialog({ draft: { start, end, allDay, timeZone: defaultZone } });
  const createFromToolbar = () => {
    const start = new Date(focusDate); const now = new Date();
    start.setHours(start.toDateString() === now.toDateString() ? now.getHours() + 1 : 9, 0, 0, 0);
    openCreate(start, null);
  };
  const onSelect = (info: DateSelectArg) => {
    api()?.unselect();
    if (info.view.type === 'dayGridMonth') {
      // Month view: one day → a timed event at 09:00 (quick creation); several days → an all-day event.
      const days = Math.round((info.end.getTime() - info.start.getTime()) / 86_400_000);
      if (days <= 1) { const start = new Date(info.start); start.setHours(9, 0, 0, 0); openCreate(start, null); }
      else openCreate(info.start, new Date(info.end.getTime() - 60_000), true);
      return;
    }
    openCreate(info.start, info.end, info.allDay);
  };
  const onDatesSet = (info: DatesSetArg) => {
    setTitle(previous => previous === info.view.title ? previous : info.view.title);
    setRange(previous => previous && previous.from.getTime() === info.start.getTime() && previous.to.getTime() === info.end.getTime() ? previous : { from: info.start, to: info.end });
    void load(info.start, info.end);
  };
  const onEventClick = (info: EventClickArg) => { info.jsEvent.preventDefault(); setDialog({ item: info.event.extendedProps.item as FeedItem }); };

  const onMove = (info: EventDropArg | EventResizeDoneArg) => {
    const item = info.event.extendedProps.item as FeedItem;
    // A tutoring session with a student (their pending proposal): the teacher confirms first, the student is notified.
    if (item.kind === 'session' && item.participants.length > 0) { setPendingMove({ info, conflicts: [], participants: item.participants.map(person => person.name) }); return; }
    void persistMove(info);
  };
  const persistMove = async (info: EventDropArg | EventResizeDoneArg, allowOverlap = false) => {
    const item = info.event.extendedProps.item as FeedItem;
    const start = info.event.start!, end = info.event.end || new Date(start.getTime() + (new Date(item.end).getTime() - new Date(item.start).getTime()));
    setSaving(previous => [...previous, item.id]); setStatus(t('calendarUi.saving')); setError('');
    try {
      if (item.kind === 'session') await calendarService.moveSession(item.sourceId, { startAt: start.toISOString(), endAt: end.toISOString(), ...(item.timeZone ? { timeZone: item.timeZone } : {}) });
      else await calendarService.updateEvent(item.sourceId, { start: start.toISOString(), end: end.toISOString(), timeZone: item.timeZone || defaultZone, expectedRevision: item.revision || 0, allowOverlap });
      setStatus(t('calendarUi.moved', { range: formatRange(start, end, i18n.language) }));
      await reload();
    } catch (cause) {
      const details = (cause as { code?: string; details?: { conflicts?: Conflict[] } });
      if (details.code === 'EVENT_CONFLICT' && details.details?.conflicts && !allowOverlap) { setPendingMove({ info, conflicts: details.details.conflicts }); return; }
      info.revert();
      setStatus(''); setError(apiErrorMessage(t, cause) + (item.kind === 'session' && details.code === 'SESSION_NOT_MOVABLE' && role === 'teacher' ? ` ${t('calendarUi.useTutoringPage')}` : ''));
    } finally { setSaving(previous => previous.filter(id => id !== item.id)); }
  };

  const renderEvent = (arg: EventContentArg) => {
    const item = arg.event.extendedProps.item as FeedItem | undefined;
    // Selection / drag mirrors carry no EduMarket item: default rendering.
    if (!item) return true;
    const state = visualState(item);
    const provider = item.kind === 'external' ? item.source : item.sync?.provider;
    return (
      <div className="flex min-w-0 items-start gap-1 overflow-hidden px-0.5 leading-tight">
        <div className="min-w-0">
          {arg.timeText && <span className="me-1 font-semibold tabular-nums">{arg.timeText}</span>}
          {state !== 'normal' && <span className="me-1 rounded bg-black/20 px-1 text-[10px] font-bold uppercase">{t(`calendarUi.stateLabels.${state}`)}</span>}
          <span className="font-medium">{arg.event.title}</span>
          {item.kind === 'session' && item.isOwner && item.status === 'available' && <span className="ms-1 opacity-90">· {item.price ? formatMoney(Math.round(item.price * 100), 'eur', i18n.language) : t('calendarUi.free')}</span>}
          <span className="sr-only"> — {t(`calendarUi.kinds.${item.kind}`)}{provider ? ` (${t(`calendarUi.providers.${provider}`)})` : ''}</span>
        </div>
        <span className="ms-auto flex shrink-0 items-center gap-0.5" aria-hidden>
          {item.mode === 'online' && <Video className="h-3 w-3" />}
          {item.mode === 'in_person' && <MapPin className="h-3 w-3" />}
          {item.kind === 'external' && !item.permissions.edit && <Lock className="h-3 w-3" />}
          {item.sync && ['error', 'conflict'].includes(item.sync.state) && <AlertTriangle className="h-3 w-3" />}
          {item.sync?.state === 'pending' && <RefreshCw className="h-3 w-3" />}
        </span>
      </div>
    );
  };

  const agendaItems = visible.filter(item => agendaType === 'all' || item.kind === agendaType);
  const agendaGroups = agendaItems.reduce<Record<string, FeedItem[]>>((groups, item) => {
    const key = new Date(item.start).toDateString();
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
  const durationLabel = (item: FeedItem) => {
    const minutes = Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000);
    return minutes >= 1440 ? t('calendarUi.durationDays', { count: Math.round(minutes / 1440) }) : minutes >= 60 ? t('calendarUi.durationHours', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') }) : t('calendarUi.durationMinutes', { count: minutes });
  };
  const sourceLabel = (item: FeedItem) => sources.find(source => source.key === sourceKey(item))?.label || t(`calendarUi.sources.${sourceKey(item)}`, { defaultValue: item.calendarKey });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{t('calendarUi.title')}</h1>
        <p className="text-xs text-slate-500">{t('calendarUi.subtitle')}</p>
      </header>

      <div role="toolbar" aria-label={t('calendarUi.toolbar')} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xs">
        <Button size="sm" variant="outline" onClick={() => navigate('today')}>{t('calendarUi.today')}</Button>
        <div className="flex items-center">
          <button type="button" className="rounded-lg p-2 text-slate-700 hover:bg-slate-100" aria-label={t('calendarUi.previous')} onClick={() => navigate('prev')}>{rtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
          <button type="button" className="rounded-lg p-2 text-slate-700 hover:bg-slate-100" aria-label={t('calendarUi.next')} onClick={() => navigate('next')}>{rtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        </div>
        <h2 aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 sm:text-base">{title}</h2>
        <div role="group" aria-label={t('calendarUi.viewSelector')} className="flex overflow-hidden rounded-lg border border-slate-200">
          {(['month', 'week', 'day', 'agenda'] as const).map(choice => (
            <button key={choice} type="button" aria-pressed={view === choice} onClick={() => changeView(choice)} className={`px-3 py-1.5 text-xs font-medium ${view === choice ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{t(`calendarUi.views.${choice}`)}</button>
          ))}
        </div>
        <Button size="sm" leftIcon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={createFromToolbar}>{role === 'teacher' ? t('calendarUi.createSession') : t('calendarUi.createEvent')}</Button>
        <Button size="sm" variant="outline" aria-expanded={panel === 'calendars'} aria-controls="calendar-side-panel" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPanel(panel === 'calendars' ? null : 'calendars')}>{t('calendarUi.calendars')}</Button>
        <Button size="sm" variant="outline" aria-expanded={panel === 'settings'} aria-controls="calendar-side-panel" leftIcon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>{t('calendarUi.sync')}</Button>
        <Button size="sm" variant="ghost" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => void downloadApiFile('/calendar/events.ics', 'edumarket.ics').catch(cause => setError(apiErrorMessage(t, cause)))}>{t('calendarUi.exportIcs')}</Button>
      </div>

      {defaultZone !== localZone && <NoticeBanner tone="info">{t('calendarUi.zoneNotice', { preferred: defaultZone, device: localZone })}</NoticeBanner>}
      <p role="status" aria-live="polite" className={status ? 'rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800' : 'sr-only'}>{status}</p>
      <ErrorAlert message={error} onRetry={error ? () => void reload() : undefined} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <section aria-label={t('calendarUi.grid')} aria-busy={loading} className="em-calendar min-w-0 rounded-xl border border-slate-200 bg-white p-2 shadow-xs">
          {view !== 'agenda' ? (
            <FullCalendar
              ref={calendarRef}
              plugins={PLUGINS}
              initialView={FC_VIEWS[view]}
              initialDate={focusDate}
              headerToolbar={false}
              locales={LOCALES}
              locale={{ fr: 'fr', en: 'en-gb', ar: 'ar-tn' }[i18n.language.slice(0, 2)] || 'fr'}
              direction={rtl ? 'rtl' : 'ltr'}
              firstDay={1}
              height="auto"
              scrollTime="08:00:00"
              nowIndicator
              selectable
              selectMirror
              eventInteractive
              dayMaxEvents={3}
              events={events}
              datesSet={onDatesSet}
              select={onSelect}
              eventClick={onEventClick}
              eventDrop={onMove}
              eventResize={onMove}
              eventContent={renderEvent}
              navLinks
              navLinkDayClick={date => { setFocusDate(date); changeView('day'); }}
            />
          ) : (
            <div className="space-y-3 p-2">
              <div className="flex flex-wrap gap-3 text-xs">
                <label className="flex items-center gap-2 font-semibold text-slate-700">{t('calendarUi.period')}
                  <select className="rounded-lg border border-slate-300 px-2 py-1" value={agendaDays} onChange={event => setAgendaDays(Number(event.target.value))}>
                    {[7, 30, 90].map(days => <option key={days} value={days}>{t('calendarUi.nextDays', { count: days })}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 font-semibold text-slate-700">{t('calendarUi.typeFilter')}
                  <select className="rounded-lg border border-slate-300 px-2 py-1" value={agendaType} onChange={event => setAgendaType(event.target.value as typeof agendaType)}>
                    {AGENDA_TYPES.map(type => <option key={type} value={type}>{t(`calendarUi.agendaTypes.${type}`)}</option>)}
                  </select>
                </label>
              </div>
              {loading && <p role="status" className="text-xs text-slate-500">{t('calendarUi.loading')}</p>}
              {!loading && agendaItems.length === 0 && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">{t('calendarUi.emptyAgenda')}</p>}
              {Object.entries(agendaGroups).map(([day, entries]) => (
                <section key={day} aria-label={new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full' }).format(new Date(entries[0].start))}>
                  <h3 className="border-b border-slate-200 pb-1 text-xs font-bold uppercase text-slate-600">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full' }).format(new Date(entries[0].start))}</h3>
                  <ul className="divide-y divide-slate-100">
                    {entries.map(item => {
                      const color = colorFor(sourceKey(item), preferences), state = visualState(item);
                      return (
                        <li key={item.id}>
                          <button type="button" onClick={() => setDialog({ item })} className={`flex w-full flex-col gap-1 py-2 text-start hover:bg-slate-50 sm:flex-row sm:items-start sm:gap-3 ${item.id === highlighted ? 'em-highlight' : ''}`}>
                            <span className="w-32 shrink-0 text-xs font-semibold tabular-nums text-slate-700">{item.allDay ? t('calendarUi.allDay') : formatRange(item.start, item.end, i18n.language).split(', ').pop()}<span className="block font-normal text-slate-500">{durationLabel(item)}</span></span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-sm font-semibold text-slate-900 ${state === 'cancelled' ? 'line-through' : ''}`}>{displayTitle(item)}</span>
                              <span className="block text-xs text-slate-600">
                                {t(`calendarUi.kinds.${item.kind}`)} · {t(`calendarUi.statuses.${item.status}`, { defaultValue: item.status })}
                                {item.kind === 'session' && item.paymentStatus === 'awaiting_payment' && ` · ${t('calendarUi.payment.awaiting_payment')}`}
                                {item.kind === 'session' && item.isOwner && item.status === 'available' && ` · ${item.price ? formatMoney(Math.round(item.price * 100), 'eur', i18n.language) : t('calendarUi.free')}`}
                                {(item.counterpart || item.participants.length > 0) && ` · ${item.counterpart || item.participants.map(person => person.name).join(', ')}`}
                                {item.location && ` · ${item.location}`}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600"><span aria-hidden className="h-3 w-3 rounded-full" style={{ background: color }} />{sourceLabel(item)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>

        <aside id="calendar-side-panel" aria-label={t('calendarUi.sidePanel')} className={`${panel ? 'block' : 'hidden lg:block'} space-y-4`}>
          {panel !== 'settings' && (
            <section aria-labelledby="calendar-list-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <h2 id="calendar-list-title" className="text-sm font-bold text-slate-900">{t('calendarUi.legend')}</h2>
              {role === 'teacher' && (
                <button type="button" aria-pressed={!tutoringHidden} onClick={() => savePreferences({ hidden: tutoringHidden ? [...hidden].filter(key => !tutoringKeys.includes(key)) : [...new Set([...hidden, ...tutoringKeys])] })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                  {t('calendarUi.tutoringFilter')}
                  <span className="font-normal text-slate-600">{tutoringHidden ? t('calendarUi.hiddenLabel') : t('calendarUi.shownLabel')}</span>
                </button>
              )}
              <ul className="space-y-1.5">
                {sources.map(source => {
                  const isHidden = hidden.has(source.key);
                  const color = colorFor(source.key, preferences);
                  return (
                    <li key={source.key} className="flex items-center gap-2 text-xs">
                      <input type="color" value={color} aria-label={t('calendarUi.colorOf', { name: source.label })} onChange={event => savePreferences({ colors: { ...(preferences?.colors || {}), [source.key]: event.target.value } })} className="h-6 w-6 cursor-pointer rounded border border-slate-300 p-0" />
                      <span className={`min-w-0 flex-1 truncate ${isHidden ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{source.label}{source.provider && <span className="text-slate-500"> · {t(`calendarUi.providers.${source.provider}`)}</span>}</span>
                      <button type="button" aria-pressed={!isHidden} aria-label={t(isHidden ? 'calendarUi.showCalendar' : 'calendarUi.hideCalendar', { name: source.label })} onClick={() => savePreferences({ hidden: isHidden ? [...hidden].filter(key => key !== source.key) : [...hidden, source.key] })} className="rounded p-1 text-slate-600 hover:bg-slate-100">
                        {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="pt-1 text-[11px] text-slate-500">{t('calendarUi.legendStates')}</p>
              {Object.keys(preferences?.colors || {}).length > 0 && <button type="button" className="text-xs text-indigo-700 underline" onClick={() => savePreferences({ colors: {} })}>{t('calendarUi.resetColors', { defaults: Object.keys(DEFAULT_COLORS).length })}</button>}
            </section>
          )}
          {panel === 'settings' && <ConnectedCalendars providers={providers} connections={connections} onChanged={list => { setConnections(list); void reload(); }} />}
        </aside>
      </div>

      {dialog && (
        <EventDialog
          role={role || 'student'} draft={dialog.draft} item={dialog.item} connections={connections} defaultDurationMinutes={defaultDuration}
          onClose={() => { setDialog(null); setHighlighted(null); }}
          onSaved={message => { setDialog(null); setStatus(message); void reload(); }}
        />
      )}
      <ConfirmationDialog
        isOpen={!!pendingMove}
        description={pendingMove?.participants ? t('calendarUi.moveWithParticipants', { names: pendingMove.participants.join(', ') }) : pendingMove ? pendingMove.conflicts.map(conflict => conflict.mine ? `${conflict.title || t('calendarUi.untitled')} (${formatRange(conflict.start, conflict.end, i18n.language)})` : t('calendarUi.someoneBusy')).join(' · ') + ` — ${t('calendarUi.moveAnyway')}` : ''}
        title={pendingMove?.participants ? t('calendarUi.moveSessionTitle') : t('calendarUi.overlapTitle')}
        confirmLabel={t('calendarUi.moveConfirm')}
        onConfirm={() => { const move = pendingMove!; setPendingMove(null); void persistMove(move.info, true); }}
        onCancel={() => { pendingMove?.info.revert(); setPendingMove(null); setStatus(''); }}
      />
    </div>
  );
};
