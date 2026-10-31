import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Download, EyeOff, Plus, Send, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { LmsDialog, TeacherCourseFrame, formatScore } from '../../components/organisms/LmsShared';
import { gradebookApi, type GradeColumn, type GradeEntry, type Gradebook } from '../../services/gradebookService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { fromLocalInput, toLocalInput } from '../../utils/outline';

type EntryTarget = { column: GradeColumn; student: Gradebook['students'][number]; entry?: GradeEntry };

const StatusIcon: React.FC<{ entry?: GradeEntry }> = ({ entry }) => {
  const { t } = useTranslation();
  if (!entry || entry.status === 'not_graded') return null;
  if (entry.status === 'pending') return <Clock className="w-3 h-3 text-amber-600" aria-label={t('gradebookUi.status.pending')} />;
  if (entry.status === 'graded') return <EyeOff className="w-3 h-3 text-slate-500" aria-label={t('gradebookUi.status.graded')} />;
  return <CheckCircle2 className="w-3 h-3 text-emerald-600" aria-label={t('gradebookUi.status.published')} />;
};

/**
 * Course gradebook: categories with relative weights, columns (linked activities or manual), grade entry with feedback,
 * exceptions, individual or global publication, CSV/XLSX export. Students only ever see published grades.
 */
export const GradebookPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [book, setBook] = useState<Gradebook | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<EntryTarget | null>(null);
  const [columnDialog, setColumnDialog] = useState<GradeColumn | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const load = useCallback(() => { setError(''); gradebookApi.load(id).then(setBook).catch(cause => setError(apiErrorMessage(t, cause))); }, [id, t]);
  useEffect(() => { load(); }, [load]);

  const entryOf = useMemo(() => {
    const map = new Map((book?.entries || []).map(entry => [`${entry.columnId}:${entry.studentId}`, entry]));
    return (columnId: string, studentId: string) => map.get(`${columnId}:${studentId}`);
  }, [book]);
  const orderedColumns = useMemo(() => book ? book.categories.flatMap(category => book.columns.filter(column => column.categoryId === category.id)) : [], [book]);

  const publish = async (column: GradeColumn) => {
    setMessage(''); setError('');
    try {
      const result = await gradebookApi.publish(id, column.id);
      setMessage(t('gradebookUi.publishedCount', { count: result.published, column: column.title }));
      load();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const download = (format: 'csv' | 'xlsx') => gradebookApi.export(id, format, `gradebook.${format}`).catch(cause => setError(apiErrorMessage(t, cause)));

  return (
    <TeacherCourseFrame courseId={id} title={t('gradebookUi.title')} subtitle={t('gradebookUi.subtitle')} actions={<>
      <Button size="sm" variant="outline" leftIcon={<SlidersHorizontal className="w-3.5 h-3.5" />} onClick={() => setCategoriesOpen(true)} disabled={!book}>{t('gradebookUi.categories')}</Button>
      <Button size="sm" variant="outline" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setColumnDialog('new')} disabled={!book}>{t('gradebookUi.addColumn')}</Button>
      <Button size="sm" variant="outline" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={() => void download('csv')}>CSV</Button>
      <Button size="sm" variant="outline" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={() => void download('xlsx')}>XLSX</Button>
    </>}>
      <ErrorAlert message={error} onRetry={book ? undefined : load} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      {!book ? (!error && <LoadingState />) : (
        <>
          <p className="text-xs text-slate-600">{t('gradebookUi.rules')}</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <caption className="sr-only">{t('gradebookUi.caption')}</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" rowSpan={2} className="sticky start-0 z-10 bg-slate-50 px-3 py-2 text-start font-semibold text-slate-700">{t('gradebookUi.student')}</th>
                  {book.categories.map(category => {
                    const span = book.columns.filter(column => column.categoryId === category.id).length;
                    return span ? <th key={category.id} scope="colgroup" colSpan={span} className="border-s border-slate-200 px-3 py-1 text-center font-semibold text-slate-700">{category.name} · {t('gradebookUi.weightShort', { weight: category.weight })}</th> : null;
                  })}
                  <th scope="colgroup" colSpan={3} className="border-s border-slate-200 px-3 py-1 text-center font-semibold text-slate-700">{t('gradebookUi.total')}</th>
                </tr>
                <tr>
                  {orderedColumns.map(column => (
                    <th key={column.id} scope="col" className="border-s border-slate-200 px-2 py-1.5 align-top font-medium text-slate-700">
                      <div className="flex min-w-[8rem] items-start justify-between gap-1">
                        <span className="text-start">{column.title}<span className="block text-[10px] font-normal text-slate-500">/{column.maxPoints}{column.source.kind !== 'manual' ? ` · ${t(`gradebookUi.kinds.${column.source.kind}`)}` : ''}{!column.countsInFinal ? ` · ${t('gradebookUi.notCounted')}` : ''}</span></span>
                        <span className="flex shrink-0 gap-0.5">
                          <button type="button" className="rounded p-1 hover:bg-slate-200" aria-label={t('gradebookUi.publishColumn', { column: column.title })} title={t('gradebookUi.publishColumn', { column: column.title })} onClick={() => void publish(column)}><Send className="w-3 h-3" /></button>
                          <button type="button" className="rounded p-1 hover:bg-slate-200" aria-label={t('gradebookUi.columnSettings', { column: column.title })} onClick={() => setColumnDialog(column)}><Settings2 className="w-3 h-3" /></button>
                        </span>
                      </div>
                    </th>
                  ))}
                  <th scope="col" className="border-s border-slate-200 px-2 py-1.5 font-medium text-slate-700">%</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-slate-700">/20</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-slate-700">{t('gradebookUi.publishedTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {book.students.length === 0 && <tr><td colSpan={orderedColumns.length + 4} className="px-3 py-6 text-center text-slate-500">{t('gradebookUi.noStudents')}</td></tr>}
                {book.students.map(student => {
                  const totals = book.totals.find(total => total.studentId === student.id);
                  return (
                    <tr key={student.id} className="border-t border-slate-100">
                      <th scope="row" className="sticky start-0 z-10 bg-white px-3 py-1.5 text-start font-medium text-slate-800">{student.name}<span className="block text-[10px] font-normal text-slate-500">{student.email}{!student.active ? ` · ${t('gradebookUi.inactive')}` : ''}</span></th>
                      {orderedColumns.map(column => {
                        const entry = entryOf(column.id, student.id);
                        const value = entry?.excused ? t('gradebookUi.excusedShort') : formatScore(entry?.score, i18n.language);
                        return (
                          <td key={column.id} className="border-s border-slate-100 px-1 py-1 text-center">
                            <button type="button" onClick={() => setTarget({ column, student, entry })}
                              aria-label={t('gradebookUi.cellLabel', { student: student.name, column: column.title, value, status: t(`gradebookUi.status.${entry?.status || 'not_graded'}`) })}
                              className="inline-flex w-full items-center justify-center gap-1 rounded px-2 py-1 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
                              <span className={entry?.score === null || entry?.score === undefined ? 'text-slate-400' : 'text-slate-900'}>{value}</span><StatusIcon entry={entry} />
                            </button>
                          </td>
                        );
                      })}
                      <td className="border-s border-slate-100 px-2 py-1 text-center">{formatScore(totals?.working.percent, i18n.language)}</td>
                      <td className="px-2 py-1 text-center font-semibold">{formatScore(totals?.working.outOf20, i18n.language)}</td>
                      <td className="px-2 py-1 text-center text-slate-600">{formatScore(totals?.published.outOf20, i18n.language)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-wrap gap-4 text-[11px] text-slate-600" aria-label={t('gradebookUi.legend')}>
            <li className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-amber-600" aria-hidden />{t('gradebookUi.status.pending')}</li>
            <li className="inline-flex items-center gap-1"><EyeOff className="w-3 h-3 text-slate-500" aria-hidden />{t('gradebookUi.status.graded')}</li>
            <li className="inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" aria-hidden />{t('gradebookUi.status.published')}</li>
            <li>— {t('gradebookUi.noGrade')}</li>
          </ul>
        </>
      )}
      {target && book && <EntryDialog courseId={id} target={target} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); load(); }} />}
      {columnDialog && book && <ColumnDialog courseId={id} book={book} column={columnDialog === 'new' ? null : columnDialog} onClose={() => setColumnDialog(null)} onSaved={() => { setColumnDialog(null); load(); }} />}
      {categoriesOpen && book && <CategoriesDialog courseId={id} book={book} onClose={() => setCategoriesOpen(false)} onChanged={load} />}
    </TeacherCourseFrame>
  );
};

const EntryDialog: React.FC<{ courseId: string; target: EntryTarget; onClose: () => void; onSaved: () => void }> = ({ courseId, target, onClose, onSaved }) => {
  const { t, i18n } = useTranslation();
  const { column, student, entry } = target;
  const [score, setScore] = useState(entry?.score === null || entry?.score === undefined ? '' : String(entry.score));
  const [feedback, setFeedback] = useState(entry?.feedback || '');
  const [excused, setExcused] = useState(!!entry?.excused);
  const [dueAt, setDueAt] = useState(toLocalInput(entry?.exception?.dueAt));
  const [extraAttempts, setExtraAttempts] = useState(entry?.exception?.extraAttempts || 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const numeric = score.trim() === '' ? null : Number(score.replace(',', '.'));
  const invalid = numeric !== null && (!Number.isFinite(numeric) || numeric < 0 || numeric > column.maxPoints);

  const save = async (publishAfter: boolean) => {
    setBusy(true); setError('');
    try {
      await gradebookApi.saveEntry(courseId, column.id, student.id, { score: numeric, feedback, excused, exception: { dueAt: fromLocalInput(dueAt), extraAttempts }, expectedUpdatedAt: entry ? entry.updatedAt : null });
      if (publishAfter) await gradebookApi.publish(courseId, column.id, [student.id]);
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); setBusy(false); }
  };

  return (
    <LmsDialog title={t('gradebookUi.entryTitle', { student: student.name, column: column.title })} onClose={onClose}>
      {entry?.published && <p className="text-xs text-slate-600">{t('gradebookUi.publishedValue', { value: entry.published.excused ? t('gradebookUi.excusedShort') : formatScore(entry.published.score, i18n.language), date: formatDateTime(entry.published.at, i18n.language) })}</p>}
      {entry?.overridden && <p className="text-xs text-amber-800">{t('gradebookUi.overridden')}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label={t('gradebookUi.score', { max: column.maxPoints })} hint={t('gradebookUi.scoreHint')} error={invalid ? t('gradebookUi.scoreInvalid', { max: column.maxPoints }) : undefined}>
          <Input inputMode="decimal" value={score} onChange={event => setScore(event.target.value)} disabled={excused} />
        </FormField>
        <label className="flex items-center gap-2 text-xs text-slate-700 sm:pt-6"><input type="checkbox" checked={excused} onChange={event => setExcused(event.target.checked)} />{t('gradebookUi.excused')}</label>
      </div>
      <FormField label={t('gradebookUi.feedback')}><Textarea rows={3} maxLength={4000} value={feedback} onChange={event => setFeedback(event.target.value)} /></FormField>
      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">{t('gradebookUi.exception')}</legend>
        <FormField label={t('gradebookUi.extendedDueAt')}><Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></FormField>
        <FormField label={t('gradebookUi.extraAttempts')}><Input type="number" min={0} max={20} value={extraAttempts} onChange={event => setExtraAttempts(Math.max(0, Math.min(20, Number(event.target.value) || 0)))} /></FormField>
      </fieldset>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button>
        <Button size="sm" variant="outline" disabled={busy || invalid} onClick={() => void save(false)}>{t('gradebookUi.save')}</Button>
        <Button size="sm" disabled={busy || invalid || (numeric === null && !excused)} isLoading={busy} onClick={() => void save(true)}>{t('gradebookUi.saveAndPublish')}</Button>
      </div>
    </LmsDialog>
  );
};

const ColumnDialog: React.FC<{ courseId: string; book: Gradebook; column: GradeColumn | null; onClose: () => void; onSaved: () => void }> = ({ courseId, book, column, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: column?.title || '', categoryId: column?.categoryId || book.categories[0]?.id || '', maxPoints: String(column?.maxPoints ?? 20), dueAt: toLocalInput(column?.dueAt),
    countsInFinal: column?.countsInFinal ?? true, missingAsZero: column?.missingAsZero ?? false, releaseMode: column?.releaseMode || 'manual',
  });
  const [error, setError] = useState('');
  const linked = !!column && column.source.kind !== 'manual';
  const submit = async () => {
    setError('');
    const payload = { title: form.title.trim(), categoryId: form.categoryId, dueAt: fromLocalInput(form.dueAt), countsInFinal: form.countsInFinal, missingAsZero: form.missingAsZero };
    try {
      if (column) await gradebookApi.updateColumn(courseId, column.id, { ...payload, ...(linked ? {} : { maxPoints: Number(form.maxPoints) }), releaseMode: form.releaseMode as 'manual' | 'auto', ...(linked ? { title: undefined, dueAt: undefined } : {}) });
      else await gradebookApi.createColumn(courseId, { ...payload, maxPoints: Number(form.maxPoints) });
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const remove = async () => { try { await gradebookApi.deleteColumn(courseId, column!.id); onSaved(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <LmsDialog title={column ? t('gradebookUi.columnSettings', { column: column.title }) : t('gradebookUi.addColumn')} onClose={onClose}>
      {linked && <p className="text-xs text-slate-600">{t('gradebookUi.linkedHint')}</p>}
      <FormField label={t('gradebookUi.columnTitle')} required><Input value={form.title} maxLength={200} disabled={linked} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label={t('gradebookUi.category')}><Select value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })} options={book.categories.map(category => ({ value: category.id, label: category.name }))} /></FormField>
        <FormField label={t('gradebookUi.maxPoints')}><Input type="number" min={0.01} step="0.5" value={form.maxPoints} disabled={linked} onChange={event => setForm({ ...form, maxPoints: event.target.value })} /></FormField>
        <FormField label={t('gradebookUi.dueAt')}><Input type="datetime-local" value={form.dueAt} disabled={linked} onChange={event => setForm({ ...form, dueAt: event.target.value })} /></FormField>
        <FormField label={t('gradebookUi.releaseMode')}><Select value={form.releaseMode} onChange={event => setForm({ ...form, releaseMode: event.target.value as 'manual' | 'auto' })} options={[{ value: 'manual', label: t('gradebookUi.release.manual') }, { value: 'auto', label: t('gradebookUi.release.auto') }]} /></FormField>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.countsInFinal} onChange={event => setForm({ ...form, countsInFinal: event.target.checked })} />{t('gradebookUi.countsInFinal')}</label>
      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.missingAsZero} onChange={event => setForm({ ...form, missingAsZero: event.target.checked })} />{t('gradebookUi.missingAsZero')}</label>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap justify-between gap-2">
        {column && !linked ? <Button size="sm" variant="ghost" onClick={() => void remove()}>{t('gradebookUi.deleteColumn')}</Button> : <span />}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button>
          <Button size="sm" disabled={!form.title.trim() || !form.categoryId || !(Number(form.maxPoints) > 0)} onClick={() => void submit()}>{t('gradebookUi.save')}</Button>
        </div>
      </div>
    </LmsDialog>
  );
};

const CategoriesDialog: React.FC<{ courseId: string; book: Gradebook; onClose: () => void; onChanged: () => void }> = ({ courseId, book, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState(book.categories.map(category => ({ ...category, weightText: String(category.weight) })));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const total = rows.reduce((sum, row) => sum + (Number(row.weightText) || 0), 0);
  const saveRow = async (row: typeof rows[number]) => {
    setError('');
    try { await gradebookApi.updateCategory(courseId, row.id, { name: row.name.trim(), weight: Number(row.weightText) || 0 }); onChanged(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const add = async () => {
    setError('');
    try { const created = await gradebookApi.createCategory(courseId, { name: name.trim(), weight: 1 }); setRows([...rows, { ...created, weightText: '1' }]); setName(''); onChanged(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const remove = async (id: string) => {
    setError('');
    try { await gradebookApi.deleteCategory(courseId, id); setRows(rows.filter(row => row.id !== id)); onChanged(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('gradebookUi.categories')} onClose={onClose}>
      <p className="text-xs text-slate-600">{t('gradebookUi.weightsHint')}</p>
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row.id} className="flex flex-wrap items-end gap-2">
            <FormField label={t('gradebookUi.categoryName')} className="flex-1 min-w-[10rem]"><Input value={row.name} maxLength={120} onChange={event => setRows(rows.map(candidate => candidate.id === row.id ? { ...candidate, name: event.target.value } : candidate))} /></FormField>
            <FormField label={t('gradebookUi.weight')} className="w-24"><Input type="number" min={0} value={row.weightText} onChange={event => setRows(rows.map(candidate => candidate.id === row.id ? { ...candidate, weightText: event.target.value } : candidate))} /></FormField>
            <span className="pb-2 text-xs text-slate-500">{total > 0 ? `${Math.round((Number(row.weightText) || 0) / total * 1000) / 10} %` : '—'}</span>
            <Button size="sm" variant="outline" onClick={() => void saveRow(row)}>{t('gradebookUi.save')}</Button>
            <Button size="sm" variant="ghost" aria-label={t('gradebookUi.deleteCategory', { name: row.name })} onClick={() => void remove(row.id)}>✕</Button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <FormField label={t('gradebookUi.newCategory')} className="flex-1"><Input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></FormField>
        <Button size="sm" disabled={!name.trim()} onClick={() => void add()}>{t('gradebookUi.add')}</Button>
      </div>
      <ErrorAlert message={error} />
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.close')}</Button></div>
    </LmsDialog>
  );
};
