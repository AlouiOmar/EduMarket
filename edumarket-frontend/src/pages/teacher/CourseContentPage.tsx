import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Archive, CopyPlus, Download, Eye, FileUp, Lock, Pencil, Settings } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Select } from '../../components/atoms/Select';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { CourseOutlineEditor } from '../../components/organisms/CourseOutlineEditor';
import { LessonBlocksView } from '../../components/organisms/LessonBlocksView';
import { courseContentApi, type CopyReport, type CopySource, type Outline } from '../../services/courseContentService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { Course, CourseLesson } from '../../types';
import { CourseWorkspaceNav } from '../../components/organisms/LmsShared';

const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="content-dialog-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
      <h2 id="content-dialog-title" className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  </div>
);

const ReportView: React.FC<{ report: CopyReport }> = ({ report }) => {
  const { t } = useTranslation();
  return (
    <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
      <p className="font-semibold">{t('courseContentUi.copyDone', { containers: report.copiedContainers, items: report.copiedItems, files: report.copiedAssets })}</p>
      {report.skipped.length > 0 && (
        <details open className="text-amber-900">
          <summary className="cursor-pointer font-semibold">{t('courseContentUi.copySkipped', { count: report.skipped.length })}</summary>
          <ul className="mt-1 list-disc ps-5">{report.skipped.map((entry, index) => <li key={`${entry.id}-${index}`}>{entry.title || entry.id || '—'} · {t(`courseContentUi.skipReasons.${entry.reason}`, { defaultValue: entry.reason })}</li>)}</ul>
        </details>
      )}
    </div>
  );
};

/** "Copier le contenu": whole course or selected modules/items of another course the teacher manages. Copies arrive hidden. */
const CopyContentDialog: React.FC<{ courseId: string; outline: Outline; onDone: (outline: Outline) => void; onClose: () => void }> = ({ courseId, outline, onDone, onClose }) => {
  const { t } = useTranslation();
  const [sources, setSources] = useState<CopySource[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<CopyReport | null>(null);
  useEffect(() => { courseContentApi.copySources(courseId).then(setSources).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId]);
  const source = sources?.find(candidate => candidate.id === sourceId);
  const toggle = (id: string) => setSelection(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const submit = async () => {
    if (!source) return;
    setBusy(true); setError(''); setReport(null);
    try {
      const containerIds = source.chapters.filter(chapter => selection.has(chapter.id)).map(chapter => chapter.id);
      const itemIds = source.chapters.flatMap(chapter => chapter.lessons).filter(lesson => selection.has(lesson.id)).map(lesson => lesson.id);
      const result = await courseContentApi.importContent(courseId, { expectedVersion: outline.structureVersion, sourceCourseId: source.id, containerIds, itemIds, ...(target ? { targetContainerId: target } : {}) });
      setReport(result.report);
      onDone({ structureVersion: result.structureVersion, chapters: result.chapters });
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={t('courseContentUi.copyContent')} onClose={onClose}>
      <p className="text-xs text-slate-500">{t('courseContentUi.copyHint')}</p>
      {!sources && !error && <LoadingState />}
      {sources && sources.length === 0 && <p className="text-sm text-slate-500">{t('courseContentUi.noSources')}</p>}
      {sources && sources.length > 0 && (
        <FormField label={t('courseContentUi.sourceCourse')}>
          <Select value={sourceId} onChange={event => { setSourceId(event.target.value); setSelection(new Set()); setReport(null); }}
            options={[{ value: '', label: '—' }, ...sources.map(candidate => ({ value: candidate.id, label: candidate.courseCode ? `${candidate.title} (${candidate.courseCode})` : candidate.title }))]} />
        </FormField>
      )}
      {source && (
        <fieldset className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 p-3 text-xs">
          <legend className="px-1 font-semibold text-slate-700">{t('courseContentUi.copySelection')}</legend>
          <p className="mb-2 text-slate-500">{t('courseContentUi.copyWholeHint')}</p>
          <ul className="space-y-1">
            {source.chapters.map(chapter => (
              <li key={chapter.id}>
                <label className="flex items-center gap-2 font-semibold text-slate-800"><input type="checkbox" checked={selection.has(chapter.id)} onChange={() => toggle(chapter.id)} />{chapter.title}</label>
                <ul className="ms-6 mt-1 space-y-0.5">
                  {chapter.lessons.map(lesson => (
                    <li key={lesson.id}><label className="flex items-center gap-2 text-slate-700"><input type="checkbox" disabled={selection.has(chapter.id)} checked={selection.has(chapter.id) || selection.has(lesson.id)} onChange={() => toggle(lesson.id)} />{lesson.title}</label></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {source && source.chapters.some(chapter => chapter.lessons.some(lesson => selection.has(lesson.id) && !selection.has(chapter.id))) && (
        <FormField label={t('courseContentUi.copyTarget')}>
          <Select value={target} onChange={event => setTarget(event.target.value)} options={[{ value: '', label: t('courseContentUi.copyNewFolder') }, ...outline.chapters.map(chapter => ({ value: chapter.id, label: chapter.title }))]} />
        </FormField>
      )}
      <ErrorAlert message={error} />
      {busy && <p role="status" className="text-xs text-slate-600">{t('courseContentUi.copyInProgress')}</p>}
      {report && <ReportView report={report} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>{report ? t('platformCommon.close') : t('platformCommon.cancel')}</Button>
        {!report && <Button size="sm" isLoading={busy} disabled={!source} onClick={() => void submit()}>{selection.size ? t('courseContentUi.copySelected', { count: selection.size }) : t('courseContentUi.copyAll')}</Button>}
      </div>
    </Dialog>
  );
};

/** Read-only student view of the course as served by the API (`/student-preview`). */
const StudentPreview: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t } = useTranslation();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<CourseLesson | null>(null);
  // Published version (what students see now) or draft version (what they will see once pending drafts are published).
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    setCourse(null);
    courseContentApi.studentPreview(courseId, draft).then(data => { setCourse(data); setCurrent(data.chapters.flatMap(chapter => chapter.lessons).find(lesson => !lesson.locked) || null); }).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [courseId, draft]);
  if (error) return <ErrorAlert message={error} />;
  if (!course) return <LoadingState />;
  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('publicationUi.previewVersion')} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([false, true] as const).map(value => (
          <button key={String(value)} type="button" aria-pressed={draft === value} onClick={() => setDraft(value)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${draft === value ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{t(value ? 'publicationUi.previewDraft' : 'publicationUi.previewPublished')}</button>
        ))}
      </div>
      <NoticeBanner tone="info">{t(draft ? 'publicationUi.previewDraftNotice' : 'courseContentUi.previewNotice')}</NoticeBanner>
      {course.accessState === 'private' && <NoticeBanner tone="warning">{t('courseContentUi.previewPrivate')}</NoticeBanner>}
      {course.chapters.length === 0 && course.accessState !== 'private' && <p className="text-sm text-slate-500">{t('courseContentUi.previewEmpty')}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <nav aria-label={t('courseContentUi.previewOutline')} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          {course.chapters.map(chapter => (
            <div key={chapter.id}>
              <h3 className="text-xs font-bold text-slate-900">{chapter.title}</h3>
              <ul className="mt-1 space-y-0.5">
                {chapter.lessons.map(lesson => (
                  <li key={lesson.id}>
                    <button type="button" disabled={lesson.locked} aria-current={current?.id === lesson.id ? 'page' : undefined} onClick={() => setCurrent(lesson)}
                      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-xs ${current?.id === lesson.id ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50'} disabled:text-slate-400`}>
                      {lesson.locked && <Lock className="w-3 h-3" aria-label={t('courseContentUi.locked')} />}{lesson.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <article className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5" aria-live="polite">
          {current ? (
            <>
              <h2 className="mb-4 text-lg font-bold text-slate-900">{current.title}</h2>
              {current.type === 'link' && current.url && <a href={current.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-700 underline">{current.url}</a>}
              {current.blocks?.length ? <LessonBlocksView blocks={current.blocks} /> : current.textContent ? <p className="whitespace-pre-line text-sm text-slate-700">{current.textContent}</p> : null}
            </>
          ) : <p className="text-sm text-slate-500">{t('courseContentUi.previewSelect')}</p>}
        </article>
      </div>
    </div>
  );
};

export const CourseContentPage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [dialog, setDialog] = useState<'copy' | 'archive' | 'duplicate' | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [includeStudentData, setIncludeStudentData] = useState(false);
  const [packageReport, setPackageReport] = useState<CopyReport | null>(null);

  const load = useCallback(() => {
    setError('');
    courseContentApi.outline(id).then(result => { setCourse(result.course); setOutline(result.outline); }).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [id, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="max-w-5xl mx-auto"><ApiModeNotice /></div>;
  if (error && !outline) return <div className="max-w-5xl mx-auto"><ErrorAlert message={error} onRetry={load} /></div>;
  if (!course || !outline) return <LoadingState />;

  const fileBase = (course.courseCode || course.title).normalize('NFKD').replace(/[^\w-]+/g, '-').slice(0, 60) || 'course';
  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setActionError('');
    try { await action(); } catch (cause) { setActionError(apiErrorMessage(t, cause)); } finally { setBusy(''); }
  };
  const accessVariant = course.accessState === 'private' ? 'warning' : course.accessState === 'completed' ? 'default' : 'success';

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link to="/teacher/courses" className="mt-1 text-slate-500 hover:text-slate-800" aria-label={t('courseEditorUi.back')}><ArrowLeft className="w-5 h-5 rtl-flip" /></Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{t('courseContentUi.pageTitle')}</p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{course.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {course.courseCode && <span className="font-mono">{course.courseCode}</span>}
              <Badge size="sm" variant={accessVariant}>{t(`courseContentUi.accessStates.${course.accessState || 'open'}`)}</Badge>
              <Badge size="sm" variant={course.status === 'published' ? 'success' : 'default'}>{t(`courseContentUi.statuses.${course.status}`, { defaultValue: course.status })}</Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('courseContentUi.viewMode')} className="inline-flex rounded-lg border border-slate-300 p-0.5">
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}><Pencil className="w-3.5 h-3.5" aria-hidden />{t('courseContentUi.editMode')}</button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}><Eye className="w-3.5 h-3.5" aria-hidden />{t('courseContentUi.studentPreview')}</button>
          </div>
          <Button size="sm" variant="outline" leftIcon={<Settings className="w-3.5 h-3.5" />} onClick={() => navigate(`/teacher/courses/${id}/edit`)}>{t('courseContentUi.courseSettings')}</Button>
        </div>
      </div>

      <CourseWorkspaceNav courseId={id} />

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label={t('courseContentUi.courseActions')}>
        <Button size="sm" variant="outline" leftIcon={<CopyPlus className="w-3.5 h-3.5" />} onClick={() => setDialog('copy')}>{t('courseContentUi.copyContent')}</Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
          <FileUp className="w-3.5 h-3.5" aria-hidden />{busy === 'package' ? t('courseContentUi.importing') : t('courseContentUi.importPackage')}
          <input type="file" accept="application/json,.json" className="sr-only" disabled={!!busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            void act('package', async () => {
              const result = await courseContentApi.importPackage(id, outline.structureVersion, JSON.parse(await file.text()));
              setOutline({ structureVersion: result.structureVersion, chapters: result.chapters }); setPackageReport(result.report);
            });
          }} />
        </label>
        <Button size="sm" variant="outline" isLoading={busy === 'export'} leftIcon={<Download className="w-3.5 h-3.5" />} onClick={() => void act('export', () => courseContentApi.exportCourse(id, `${fileBase}-export.json`))}>{t('courseContentUi.export')}</Button>
        <Button size="sm" variant="outline" leftIcon={<Archive className="w-3.5 h-3.5" />} onClick={() => setDialog('archive')}>{t('courseContentUi.archive')}</Button>
        <Button size="sm" variant="outline" leftIcon={<CopyPlus className="w-3.5 h-3.5" />} onClick={() => setDialog('duplicate')}>{t('courseContentUi.duplicateCourse')}</Button>
      </div>
      <ErrorAlert message={actionError} />
      {packageReport && <ReportView report={packageReport} />}

      {mode === 'edit'
        ? <CourseOutlineEditor courseId={id} outline={outline} onOutline={setOutline} onReload={load} />
        : <StudentPreview key={outline.structureVersion} courseId={id} />}

      {dialog === 'copy' && <CopyContentDialog courseId={id} outline={outline} onDone={setOutline} onClose={() => setDialog(null)} />}
      {dialog === 'archive' && (
        <Dialog title={t('courseContentUi.archive')} onClose={() => setDialog(null)}>
          <p className="text-xs text-slate-600">{t('courseContentUi.archiveHint')}</p>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={includeStudentData} onChange={event => setIncludeStudentData(event.target.checked)} />
            <span><span className="font-semibold block">{t('courseContentUi.includeStudentData')}</span>{t('courseContentUi.includeStudentDataHint')}</span>
          </label>
          <ErrorAlert message={actionError} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>{t('platformCommon.cancel')}</Button>
            <Button size="sm" isLoading={busy === 'archive'} onClick={() => void act('archive', async () => { await courseContentApi.archiveCourse(id, `${fileBase}-archive.json`, includeStudentData); setDialog(null); })}>{t('courseContentUi.downloadArchive')}</Button>
          </div>
        </Dialog>
      )}
      {dialog === 'duplicate' && (
        <Dialog title={t('courseContentUi.duplicateCourse')} onClose={() => setDialog(null)}>
          <p className="text-xs text-slate-600">{t('courseContentUi.duplicateCourseHint')}</p>
          <ErrorAlert message={actionError} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>{t('platformCommon.cancel')}</Button>
            <Button size="sm" isLoading={busy === 'duplicate'} onClick={() => void act('duplicate', async () => { const copy = await courseContentApi.copyCourse(id); setDialog(null); navigate(`/teacher/courses/${copy.id}/content`); })}>{t('courseContentUi.duplicateConfirm')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
};
