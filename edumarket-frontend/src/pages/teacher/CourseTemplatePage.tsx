import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { TeacherCourseFrame, formatScore } from '../../components/organisms/LmsShared';
import { templateApi, type ClassComparison, type CourseTemplateInfo, type DiffStatus, type TemplateDiff, type TemplateInstance } from '../../services/templateService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { fromLocalInput } from '../../utils/outline';

const ACTIONABLE: DiffStatus[] = ['template_changed', 'conflict', 'added_in_template'];
const VARIANT: Record<DiffStatus, 'default' | 'info' | 'warning' | 'danger' | 'success' | 'purple'> = {
  unchanged: 'default', template_changed: 'info', locally_modified: 'success', conflict: 'danger', added_in_template: 'purple', removed_in_template: 'warning', removed_locally: 'warning',
};

/**
 * Template and classes: a template produces independent class instances (own content, dates, students, assessments, grades,
 * groups). Instances compare themselves with their template and pull selected changes; local adaptations are protected.
 */
export const CourseTemplatePage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [info, setInfo] = useState<CourseTemplateInfo | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => templateApi.info(id).then(setInfo).catch(cause => setError(apiErrorMessage(t, cause))), [id, t]);
  useEffect(() => { void load(); }, [load]);
  return (
    <TeacherCourseFrame courseId={id} title={t('templateUi.title')} subtitle={t('templateUi.subtitle')}>
      <ErrorAlert message={error} />
      {!info ? (!error && <LoadingState />) : info.templateLink ? <InstanceSync courseId={id} /> : info.isTemplate ? <TemplateClasses courseId={id} onChanged={load} /> : (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-700">{t('templateUi.notTemplate')}</p>
          <Button size="sm" onClick={() => templateApi.setTemplate(id, true).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('templateUi.makeTemplate')}</Button>
        </section>
      )}
    </TeacherCourseFrame>
  );
};

const TemplateClasses: React.FC<{ courseId: string; onChanged: () => void }> = ({ courseId, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [instances, setInstances] = useState<TemplateInstance[] | null>(null);
  const [comparison, setComparison] = useState<ClassComparison | null>(null);
  const [form, setForm] = useState({ title: '', courseCode: '', startsAt: '', endsAt: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    templateApi.instances(courseId).then(setInstances).catch(cause => setError(apiErrorMessage(t, cause)));
    templateApi.compare(courseId).then(setComparison).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [courseId, t]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const created = await templateApi.createInstance(courseId, { title: form.title.trim(), courseCode: form.courseCode.trim() || undefined, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt) });
      setMessage(t('templateUi.instanceCreated', { title: created.title })); setForm({ title: '', courseCode: '', startsAt: '', endsAt: '' }); load();
    } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      <NoticeBanner>{t('templateUi.templateNotice')}</NoticeBanner>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="new-instance">
        <h2 id="new-instance" className="text-sm font-semibold text-slate-900">{t('templateUi.newInstance')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <FormField label={t('templateUi.instanceTitle')} required className="sm:col-span-2"><Input value={form.title} maxLength={160} placeholder={t('templateUi.instancePlaceholder')} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
          <FormField label={t('courseSettingsUi.courseCode')}><Input value={form.courseCode} maxLength={40} onChange={event => setForm({ ...form, courseCode: event.target.value })} /></FormField>
          <div />
          <FormField label={t('courseSettingsUi.startsAt')}><Input type="datetime-local" value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} /></FormField>
          <FormField label={t('courseSettingsUi.endsAt')}><Input type="datetime-local" value={form.endsAt} onChange={event => setForm({ ...form, endsAt: event.target.value })} /></FormField>
        </div>
        <p className="text-xs text-slate-600">{t('templateUi.copyRules')}</p>
        <div className="flex justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => templateApi.setTemplate(courseId, false).then(onChanged).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('templateUi.unmakeTemplate')}</Button>
          <Button size="sm" leftIcon={<Copy className="w-3.5 h-3.5" />} isLoading={busy} disabled={form.title.trim().length < 3} onClick={() => void create()}>{t('templateUi.createInstance')}</Button>
        </div>
      </section>
      <section className="space-y-2" aria-labelledby="compare-title">
        <h2 id="compare-title" className="text-sm font-semibold text-slate-900">{t('templateUi.comparison')}</h2>
        {!comparison || !instances ? <LoadingState /> : !comparison.classes.length ? <p className="text-sm text-slate-500">{t('templateUi.noInstances')}</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <caption className="sr-only">{t('templateUi.comparisonCaption')}</caption>
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th scope="col" className="px-3 py-2 text-start">{t('templateUi.class')}</th><th scope="col">{t('templateUi.status')}</th><th scope="col">{t('participationUi.students')}</th>
                <th scope="col">{t('participationUi.activeInPeriod')}</th><th scope="col">{t('participationUi.inactive', { days: comparison.inactiveDays })}</th><th scope="col">{t('participationUi.averageProgress')}</th>
                <th scope="col">{t('participationUi.completionRate')}</th><th scope="col">{t('templateUi.averageGrade')}</th><th scope="col">{t('templateUi.publishedContent')}</th>
              </tr></thead>
              <tbody>{comparison.classes.map(row => {
                const instance = instances.find(candidate => candidate.id === row.id);
                return (
                  <tr key={row.id} className="border-t border-slate-100 text-center">
                    <th scope="row" className="px-3 py-1.5 text-start font-medium"><Link className="text-indigo-700 hover:underline" to={`/teacher/courses/${row.id}/content`}>{row.title}</Link>{row.courseCode ? <span className="block font-mono text-[10px] text-slate-500">{row.courseCode}</span> : null}{row.startsAt ? <span className="block text-[10px] text-slate-500">{formatDateTime(row.startsAt, i18n.language)}</span> : null}</th>
                    <td>{instance ? <Badge size="sm" variant={instance.accessState === 'open' && instance.status === 'published' ? 'success' : 'default'}>{t(`courseContentUi.accessStates.${instance.accessState}`)}</Badge> : null}</td>
                    <td>{row.students}</td><td>{row.activeInPeriod}</td><td>{row.inactive}</td>
                    <td>{row.averageProgress === null ? '—' : `${row.averageProgress} %`}</td><td>{row.completionRate === null ? '—' : `${row.completionRate} %`}</td>
                    <td>{row.grades.average === null ? '—' : `${formatScore(row.grades.average, i18n.language)} / 20`}<span className="block text-[10px] text-slate-500">{t('templateUi.gradedStudents', { count: row.grades.gradedStudents })}</span></td>
                    <td>{row.publishedItems} / {row.items}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const InstanceSync: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t, i18n } = useTranslation();
  const [diff, setDiff] = useState<TemplateDiff | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(() => { setSelected({}); setOverwrite({}); templateApi.diff(courseId).then(setDiff).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  useEffect(() => { load(); }, [load]);
  const apply = async () => {
    if (!diff) return;
    setError(''); setMessage('');
    const items = diff.rows.filter(row => row.templateItemId && selected[row.templateItemId]).map(row => ({ templateItemId: row.templateItemId!, action: row.status === 'added_in_template' ? 'add' as const : 'update' as const, overwriteLocal: !!overwrite[row.templateItemId!] }));
    try { const result = await templateApi.sync(courseId, diff.structureVersion, items); setMessage(t('templateUi.applied', { count: result.applied.length })); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  if (!diff) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  const actionable = diff.rows.filter(row => ACTIONABLE.includes(row.status));
  const blocked = diff.rows.some(row => row.templateItemId && selected[row.templateItemId] && row.status === 'conflict' && !overwrite[row.templateItemId]);
  return (
    <div className="space-y-3">
      <NoticeBanner>{t('templateUi.instanceNotice', { template: diff.template.title, date: formatDateTime(diff.syncedAt, i18n.language) })}</NoticeBanner>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      <div className="flex justify-between gap-2">
        <Link className="text-xs text-indigo-700 underline" to={`/teacher/courses/${diff.template.id}/template`}>{t('templateUi.openTemplate')}</Link>
        <Button size="sm" variant="outline" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>{t('templateUi.refresh')}</Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label={t('templateUi.changes')}>
        {diff.rows.map(row => {
          const key = row.templateItemId || row.instanceItemId || row.title;
          const canApply = ACTIONABLE.includes(row.status) && !!row.templateItemId;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <label className={`flex items-center gap-2 ${canApply ? '' : 'opacity-70'}`}>
                {canApply && <input type="checkbox" checked={!!selected[row.templateItemId!]} onChange={event => setSelected({ ...selected, [row.templateItemId!]: event.target.checked })} aria-label={t('templateUi.selectChange', { title: row.title })} />}
                <span><span className="font-medium text-slate-800">{row.title}</span>{row.templateContainerTitle ? <span className="text-xs text-slate-500"> · {row.templateContainerTitle}</span> : null}</span>
              </label>
              <span className="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant={VARIANT[row.status]}>{t(`templateUi.statuses.${row.status}`)}</Badge>
                {row.status === 'conflict' && selected[row.templateItemId!] && (
                  <label className="flex items-center gap-1 text-xs text-rose-800"><input type="checkbox" checked={!!overwrite[row.templateItemId!]} onChange={event => setOverwrite({ ...overwrite, [row.templateItemId!]: event.target.checked })} />{t('templateUi.overwriteLocal')}</label>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-600">{t('templateUi.syncRules')}</p>
      <div className="flex justify-end"><Button size="sm" disabled={!actionable.some(row => selected[row.templateItemId!]) || blocked} onClick={() => void apply()}>{t('templateUi.applySelected')}</Button></div>
    </div>
  );
};
