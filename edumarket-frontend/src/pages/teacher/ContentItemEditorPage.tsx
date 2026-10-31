import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarClock, CheckCircle2, Eye, History, Loader2, Pencil, RefreshCw, RotateCcw, Save, Send, Undo2 } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState } from '../../components/molecules/PageStates';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { LessonBlockEditor, blockIssues } from '../../components/organisms/LessonBlockEditor';
import { LessonBlocksView } from '../../components/organisms/LessonBlocksView';
import { QuizEditor, lessonIssues } from '../../components/organisms/LessonEditor';
import { courseContentApi, errorCode } from '../../services/courseContentService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { fromLocalInput, locateItem, toLocalInput, workingCopy } from '../../utils/outline';
import type { ContentVersionEntry, ContentVisibility, CourseChapter, CourseLesson, CourseQuiz, LessonBlock, PublicationStatus } from '../../types';

type Draft = { title: string; description: string; durationMinutes: number; url: string; blocks: LessonBlock[]; quiz?: CourseQuiz };
type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'invalid';
const AUTOSAVE_DELAY = 1500;

const draftOf = (item: CourseLesson): Draft => ({
  title: item.title, description: item.description || '', durationMinutes: item.durationMinutes || 0, url: item.url || '',
  blocks: item.blocks?.length ? item.blocks : item.textContent ? [{ id: `blk_legacy_${item.id}`, type: 'text', html: item.textContent.split(/\n\s*\n/).map(paragraph => `<p>${paragraph.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))}</p>`).join('') }] : [],
  quiz: item.quiz,
});

/**
 * Editor of one content item. Content is autosaved (debounced) with optimistic locking on the item revision: an edit made
 * elsewhere meanwhile is never overwritten silently (ITEM_CONFLICT → reload). Visibility and dates are applied immediately.
 */
export const ContentItemEditorPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '', itemId = '' } = useParams<{ id: string; itemId: string }>();
  const [chapter, setChapter] = useState<CourseChapter | null>(null);
  const [item, setItem] = useState<CourseLesson | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [preview, setPreview] = useState(false);
  const [publication, setPublication] = useState({ visibility: 'hidden' as ContentVisibility, from: '', until: '' });
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  // Read at save time: a save started while another one is running must use the newest draft and revision.
  const draftRef = useRef<Draft | null>(null);
  const revisionRef = useRef(0);
  draftRef.current = draft;

  const load = useCallback(() => {
    setLoadError('');
    courseContentApi.outline(id).then(({ course, outline }) => {
      const found = locateItem(outline.chapters, itemId);
      if (!found) { setLoadError(t('apiErrors.ITEM_NOT_FOUND', { defaultValue: t('apiErrors.GENERIC') })); return; }
      const zone = course.settings?.timezone || null;
      setTimeZone(zone);
      // Published items are edited through their draft: the editor always shows the working copy.
      setChapter(found.chapter); setItem(found.item); setDraft(draftOf(workingCopy(found.item))); revisionRef.current = found.item.revision || 0;
      setPublication({ visibility: found.item.visibility === 'hidden' ? 'hidden' : 'visible', from: toLocalInput(found.item.availableFrom, zone), until: toLocalInput(found.item.availableUntil, zone) });
      setState('saved'); setSaveError('');
    }).catch(cause => setLoadError(apiErrorMessage(t, cause)));
  }, [id, itemId, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  const issues = draft ? [...blockIssues(draft.blocks), ...(draft.title.trim() ? [] : ['lessonEditor.issueTitle']), ...(item?.type === 'link' && !/^https?:\/\//i.test(draft.url) ? ['courseContentUi.issueUrl'] : []),
    ...(draft.quiz ? lessonIssues({ ...(item as CourseLesson), title: draft.title || 'x', quiz: draft.quiz }) : [])] : [];

  const save = useCallback(async (current: Draft, expectedRevision: number) => {
    if (saving.current) return;
    saving.current = true; setState('saving'); setSaveError('');
    try {
      const result = await courseContentApi.updateItem(id, itemId, {
        expectedRevision, title: current.title.trim(), description: current.description, durationMinutes: current.durationMinutes,
        blocks: current.blocks, quiz: current.quiz ?? null, ...(item?.type === 'link' ? { url: current.url.trim() } : {}),
      });
      revisionRef.current = result.item.revision || expectedRevision + 1;
      setItem(result.item);
      // Keep what the author typed meanwhile; only adopt server-resolved asset info for unchanged blocks.
      setDraft(latest => latest === current ? { ...current, blocks: workingCopy(result.item).blocks || current.blocks } : latest);
      setSavedAt(new Date());
      setState(latestState => latestState === 'saving' ? 'saved' : latestState);
    } catch (cause) {
      const code = errorCode(cause);
      setState(code === 'ITEM_CONFLICT' ? 'conflict' : 'error');
      setSaveError(code === 'ITEM_CONFLICT' ? t('courseContentUi.itemConflict') : apiErrorMessage(t, cause));
    } finally { saving.current = false; }
  }, [id, itemId, item?.type, t]);

  const update = (changes: Partial<Draft>) => {
    setDraft(current => current ? { ...current, ...changes } : current);
    setState(current => current === 'conflict' ? current : 'dirty');
  };

  // Debounced autosave of valid drafts.
  useEffect(() => {
    if (!draft || state !== 'dirty') return;
    window.clearTimeout(timer.current);
    if (issues.length) { setState('invalid'); return; }
    const flush = () => {
      if (saving.current) { timer.current = window.setTimeout(flush, 400); return; }
      if (draftRef.current) void save(draftRef.current, revisionRef.current);
    };
    timer.current = window.setTimeout(flush, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer.current);
  }, [draft, state]);
  useEffect(() => { if (state === 'invalid' && !issues.length) setState('dirty'); }, [issues.length, state]);

  const unsaved = state === 'dirty' || state === 'invalid' || state === 'error' || state === 'saving';
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && currentLocation.pathname !== nextLocation.pathname);

  const applyPublication = async () => {
    setPublishing(true); setPublishMessage(''); setSaveError('');
    try {
      const result = await courseContentApi.updateItem(id, itemId, { visibility: publication.visibility, availableFrom: fromLocalInput(publication.from, timeZone), availableUntil: fromLocalInput(publication.until, timeZone) });
      setItem(result.item);
      setPublishMessage(t('courseContentUi.publicationSaved'));
    } catch (cause) { setSaveError(apiErrorMessage(t, cause)); }
    finally { setPublishing(false); }
  };

  if (!usesApi) return <div className="max-w-5xl mx-auto"><ApiModeNotice /></div>;
  if (loadError) return <div className="max-w-5xl mx-auto"><ErrorAlert message={loadError} onRetry={load} /></div>;
  if (!draft || !item || !chapter) return <LoadingState />;

  const invalidWindow = !!publication.from && !!publication.until && new Date(publication.from) >= new Date(publication.until);
  const status = {
    saved: <><CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden />{savedAt ? t('courseContentUi.savedAt', { time: formatDateTime(savedAt.toISOString(), i18n.language) }) : t('courseContentUi.upToDate')}</>,
    dirty: <>{t('courseContentUi.unsaved')}</>,
    saving: <><Loader2 className="w-4 h-4 animate-spin" aria-hidden />{t('courseContentUi.saving')}</>,
    error: <span className="text-rose-700">{t('courseContentUi.saveFailed')}</span>,
    conflict: <span className="text-rose-700">{t('courseContentUi.conflictShort')}</span>,
    invalid: <span className="text-amber-700">{t('courseContentUi.notSavedInvalid')}</span>,
  }[state];

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to={`/teacher/courses/${id}/content`} className="mt-1 text-slate-500 hover:text-slate-800" aria-label={t('courseContentUi.backToOutline')}><ArrowLeft className="w-5 h-5 rtl-flip" /></Link>
          <div>
            <p className="text-xs text-slate-500">{chapter.title}</p>
            <h1 className="text-xl font-bold text-slate-900">{draft.title || t('lessonEditor.untitled')}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-slate-600">{status}</span>
          <Button size="sm" variant="outline" aria-pressed={preview} leftIcon={preview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} onClick={() => setPreview(value => !value)}>{preview ? t('courseContentUi.editMode') : t('courseContentUi.preview')}</Button>
          <Button size="sm" leftIcon={<Save className="w-3.5 h-3.5" />} disabled={state === 'saving' || state === 'conflict' || issues.length > 0 || state === 'saved'} onClick={() => { window.clearTimeout(timer.current); void save(draft, revisionRef.current); }}>{t('courseContentUi.saveNow')}</Button>
        </div>
      </div>

      {saveError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span>{saveError}</span>
          {state === 'conflict' ? <Button size="sm" variant="outline" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>{t('courseContentUi.reloadLatest')}</Button>
            : state === 'error' ? <Button size="sm" variant="outline" onClick={() => void save(draft, revisionRef.current)}>{t('platformCommon.retry')}</Button> : null}
        </div>
      )}
      {issues.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">{t('courseContentUi.fixBeforeSave')}</p>
          <ul className="list-disc ps-5">{[...new Set(issues)].map(issue => <li key={issue}>{t(issue)}</li>)}</ul>
        </div>
      )}

      {preview ? (
        <article className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-label={t('courseContentUi.preview')}>
          {item.publicationStatus === 'pending_changes' && <p className="text-xs font-medium text-amber-800">{t('publicationUi.draftPreviewNotice')}</p>}
          <h2 className="text-lg font-bold text-slate-900">{draft.title}</h2>
          {draft.description && <p className="text-sm text-slate-600">{draft.description}</p>}
          {item.type === 'link' && <a href={draft.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-700 underline">{draft.url}</a>}
          <LessonBlocksView blocks={draft.blocks} />
          {draft.quiz && !draft.blocks.some(block => block.type === 'quiz') && <LessonBlocksView blocks={[{ id: 'quiz-preview', type: 'quiz' }]} />}
        </article>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-labelledby="item-details">
            <h2 id="item-details" className="text-sm font-bold text-slate-900">{t('courseContentUi.details')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <FormField label={t('courseContentUi.title')} required className="sm:col-span-3"><Input value={draft.title} maxLength={240} required onChange={event => update({ title: event.target.value })} /></FormField>
              <FormField label={t('lessonEditor.duration')}><Input type="number" min={0} max={10000} value={draft.durationMinutes} onChange={event => update({ durationMinutes: Math.max(0, Number(event.target.value) || 0) })} /></FormField>
            </div>
            {item.type === 'link' && <FormField label={t('courseContentUi.linkUrl')} required hint={t('courseContentUi.linkHint')}><Input type="url" value={draft.url} maxLength={2000} onChange={event => update({ url: event.target.value })} /></FormField>}
            <FormField label={t('courseContentUi.description')} hint={t('courseContentUi.descriptionHint')}><Textarea rows={2} maxLength={4000} value={draft.description} onChange={event => update({ description: event.target.value })} /></FormField>
          </section>

          <section className="space-y-3" aria-labelledby="item-blocks">
            <h2 id="item-blocks" className="text-sm font-bold text-slate-900">{t('courseContentUi.blocks')}</h2>
            <LessonBlockEditor blocks={draft.blocks} onChange={blocks => update({ blocks })} upload={(kind, file) => courseContentApi.uploadMedia(id, kind, file)} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 text-xs" aria-label={t('lessonEditor.quizToggle')}>
            <QuizEditor quiz={draft.quiz} defaultTitle={draft.title} onChange={quiz => update({ quiz })} />
          </section>
        </>
      )}

      <PublicationPanel courseId={id} item={item} timeZone={timeZone} canPublish={state === 'saved' && issues.length === 0} revision={() => revisionRef.current}
        onItem={next => { setItem(next); revisionRef.current = next.revision || 0; }}
        onRestored={next => { setItem(next); revisionRef.current = next.revision || 0; setDraft(draftOf(workingCopy(next))); setState('saved'); }} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-labelledby="item-publication">
        <h2 id="item-publication" className="text-sm font-bold text-slate-900">{t('lmsSettings.visibilityAndDates')}</h2>
        {chapter.visibility === 'hidden' && <p className="text-xs text-amber-800">{t('courseContentUi.parentHidden', { title: chapter.title })}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label={t('courseContentUi.visibility')}>
            <Select value={publication.visibility} onChange={event => setPublication(value => ({ ...value, visibility: event.target.value as ContentVisibility }))}
              options={[{ value: 'hidden', label: t('courseContentUi.hidden') }, { value: 'visible', label: t('courseContentUi.visible') }]} />
          </FormField>
          <FormField label={t('courseContentUi.availableFrom')}><Input type="datetime-local" value={publication.from} onChange={event => setPublication(value => ({ ...value, from: event.target.value }))} /></FormField>
          <FormField label={t('courseContentUi.availableUntil')} error={invalidWindow ? t('courseContentUi.invalidWindow') : undefined}><Input type="datetime-local" value={publication.until} onChange={event => setPublication(value => ({ ...value, until: event.target.value }))} /></FormField>
        </div>
        <div className="flex items-center justify-end gap-3">
          {publishMessage && <span role="status" className="text-xs text-emerald-700">{publishMessage}</span>}
          <Button size="sm" variant="outline" isLoading={publishing} disabled={invalidWindow} onClick={() => void applyPublication()}>{t('courseContentUi.applyPublication')}</Button>
        </div>
      </section>

      <ConfirmationDialog isOpen={blocker.state === 'blocked'} title={t('courseContentUi.leaveTitle')} description={t('courseContentUi.leaveDescription')}
        confirmLabel={t('courseContentUi.leaveConfirm')} isDangerous onCancel={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} />
    </div>
  );
};

const STATUS_VARIANT: Record<PublicationStatus, 'default' | 'warning' | 'success' | 'purple'> = { draft: 'default', pending_changes: 'warning', published: 'success', scheduled: 'purple' };

/**
 * Publication of the working copy: students keep the published version until the author publishes (now or at a planned time,
 * read in the course time zone). Pending changes can be discarded; every publication is archived and can be restored into the draft.
 */
const PublicationPanel: React.FC<{
  courseId: string; item: CourseLesson; timeZone: string | null; canPublish: boolean; revision: () => number;
  onItem: (item: CourseLesson) => void; onRestored: (item: CourseLesson) => void;
}> = ({ courseId, item, timeZone, canPublish, revision, onItem, onRestored }) => {
  const { t, i18n } = useTranslation();
  const [publishAt, setPublishAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [versions, setVersions] = useState<ContentVersionEntry[] | null>(null);
  const status = item.publicationStatus || 'draft';
  const pending = status === 'draft' || status === 'pending_changes' || (status === 'scheduled' && !!item.scheduledPublishAt);
  const zoneLabel = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const act = async (operation: () => Promise<{ item?: CourseLesson }>, success: string, restored = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await operation();
      if (result.item) (restored ? onRestored : onItem)(result.item);
      setMessage(success);
      if (versions) setVersions(await courseContentApi.versions(courseId, item.id));
    } catch (cause) {
      setError(errorCode(cause) === 'ITEM_CONFLICT' ? t('courseContentUi.itemConflict') : apiErrorMessage(t, cause));
    } finally { setBusy(false); }
  };
  const reloadAfter = async (promise: Promise<unknown>) => {
    await promise;
    return { item: locateItem((await courseContentApi.outline(courseId)).outline.chapters, item.id)?.item };
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-labelledby="item-publish">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="item-publish" className="text-sm font-bold text-slate-900">{t('courseContentUi.publication')}</h2>
        <Badge size="sm" variant={STATUS_VARIANT[status]}>{t(`publicationUi.status.${status}`)}</Badge>
      </div>
      <p className="text-xs text-slate-600">
        {status === 'pending_changes' ? t('publicationUi.pendingHelp') : status === 'draft' ? t('publicationUi.draftHelp') : t('publicationUi.publishedHelp')}
        {item.publishedVersion ? ` ${t('publicationUi.versionInfo', { version: item.publishedVersion, date: item.publishedAt ? formatDateTime(item.publishedAt, i18n.language) : '—' })}` : ''}
      </p>
      {item.scheduledPublishAt && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-purple-800">
          <CalendarClock className="w-4 h-4" aria-hidden />{t('publicationUi.scheduledAt', { date: formatDateTime(item.scheduledPublishAt, i18n.language, zoneLabel), zone: zoneLabel })}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => reloadAfter(courseContentApi.cancelSchedule(courseId, item.id, revision())), t('publicationUi.scheduleCancelled'))}>{t('publicationUi.cancelSchedule')}</Button>
        </p>
      )}
      {!canPublish && pending && <p className="text-xs text-amber-800">{t('publicationUi.saveFirst')}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Button size="sm" leftIcon={<Send className="w-3.5 h-3.5" />} disabled={busy || !canPublish || !pending} isLoading={busy}
          onClick={() => void act(() => courseContentApi.publishItem(courseId, item.id, { expectedRevision: revision() }), t('publicationUi.published'))}>
          {status === 'pending_changes' ? t('publicationUi.publishChanges') : t('publicationUi.publishNow')}
        </Button>
        <FormField label={t('publicationUi.publishAt', { zone: zoneLabel })} className="min-w-[14rem]">
          <Input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} />
        </FormField>
        <Button size="sm" variant="outline" leftIcon={<CalendarClock className="w-3.5 h-3.5" />} disabled={busy || !canPublish || !pending || !publishAt}
          onClick={() => void act(() => courseContentApi.publishItem(courseId, item.id, { expectedRevision: revision(), publishAt: fromLocalInput(publishAt, timeZone) }), t('publicationUi.scheduled'))}>
          {t('publicationUi.schedule')}
        </Button>
        {item.draft ? (
          <Button size="sm" variant="ghost" leftIcon={<Undo2 className="w-3.5 h-3.5" />} disabled={busy} onClick={() => setConfirmDiscard(true)}>{t('publicationUi.discard')}</Button>
        ) : null}
      </div>
      {message && <p role="status" className="text-xs text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

      <details className="rounded-lg border border-slate-200 p-3" onToggle={event => { if ((event.target as HTMLDetailsElement).open && !versions) courseContentApi.versions(courseId, item.id).then(setVersions).catch(cause => setError(apiErrorMessage(t, cause))); }}>
        <summary className="cursor-pointer text-xs font-semibold text-slate-700"><History className="w-3.5 h-3.5 inline me-1" aria-hidden />{t('publicationUi.history')}</summary>
        {!versions ? <p className="mt-2 text-xs text-slate-500">{t('publicationUi.loading')}</p> : versions.length === 0 ? <p className="mt-2 text-xs text-slate-500">{t('publicationUi.noHistory')}</p> : (
          <ol className="mt-2 space-y-1.5" aria-label={t('publicationUi.history')}>
            {versions.map(version => (
              <li key={version.version} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span><strong>{t('publicationUi.versionLabel', { version: version.version })}</strong> · {version.title} · {formatDateTime(version.publishedAt, i18n.language)}{version.publishedBy ? ` · ${version.publishedBy}` : ''} · {t(`publicationUi.origin.${version.origin}`)}</span>
                <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="w-3.5 h-3.5" />} disabled={busy} aria-label={t('publicationUi.restoreLabel', { version: version.version })}
                  onClick={() => void act(() => courseContentApi.restoreVersion(courseId, item.id, version.version, revision()), t('publicationUi.restored', { version: version.version }), true)}>{t('publicationUi.restore')}</Button>
              </li>
            ))}
          </ol>
        )}
      </details>

      <ConfirmationDialog isOpen={confirmDiscard} title={t('publicationUi.discardTitle')} description={t('publicationUi.discardDescription')} confirmLabel={t('publicationUi.discard')} isDangerous
        onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); void act(() => courseContentApi.discardDraft(courseId, item.id, revision()), t('publicationUi.discarded'), true); }} />
    </section>
  );
};
