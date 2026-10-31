import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Plus, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/atoms/Badge';
import { Button } from '../../../components/atoms/Button';
import { Input } from '../../../components/atoms/Input';
import { Select } from '../../../components/atoms/Select';
import { Textarea } from '../../../components/atoms/Textarea';
import { FormField } from '../../../components/molecules/FormField';
import { ErrorAlert, LoadingState } from '../../../components/molecules/PageStates';
import { LmsDialog } from '../../../components/organisms/LmsShared';
import { assessmentApi, type CourseForm, type FormQuestion, type FormResults } from '../../../services/assessmentService';
import { apiErrorMessage } from '../../../utils/apiErrors';
import { formatDateTime } from '../../../utils/format';

const uid = () => `q${Math.random().toString(36).slice(2, 8)}`;

/** Forms and surveys: configurable questions, optional anonymity, availability; never graded (no gradebook column). */
export const FormsPanel: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t } = useTranslation();
  const [forms, setForms] = useState<CourseForm[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<FormResults | null>(null);
  const load = useCallback(() => assessmentApi.forms(courseId).then(setForms).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  const setStatus = async (form: CourseForm, status: CourseForm['status']) => { setError(''); try { await assessmentApi.updateForm(courseId, form.id, { status }); void load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  const showResults = async (form: CourseForm) => { setError(''); try { setResults(await assessmentApi.formResults(courseId, form.id)); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  if (!forms) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end"><Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>{t('assessmentUi.createForm')}</Button></div>
      <ErrorAlert message={error} />
      <ul className="space-y-2">
        {forms.map(form => (
          <li key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{form.title} <Badge size="sm" variant={form.status === 'published' ? 'success' : 'default'}>{t(`assessmentUi.testStatus.${form.status}`)}</Badge>{form.anonymous && <Badge size="sm" variant="info">{t('assessmentUi.anonymous')}</Badge>}</h3>
              <p className="text-xs text-slate-600">{t('assessmentUi.formSummary', { questions: form.questions.length, responses: form.responses || 0 })}</p>
            </div>
            <div className="flex gap-2">
              {form.status !== 'published' && <Button size="sm" onClick={() => void setStatus(form, 'published')}>{t('assessmentUi.publishForm')}</Button>}
              {form.status === 'published' && <Button size="sm" variant="outline" onClick={() => void setStatus(form, 'closed')}>{t('assessmentUi.closeForm')}</Button>}
              <Button size="sm" variant="outline" leftIcon={<BarChart3 className="w-3.5 h-3.5" />} onClick={() => void showResults(form)}>{t('assessmentUi.results')}</Button>
            </div>
          </li>
        ))}
        {!forms.length && <li className="text-sm text-slate-500">{t('assessmentUi.noForms')}</li>}
      </ul>
      {creating && <FormDialog courseId={courseId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
      {results && <ResultsDialog results={results} onClose={() => setResults(null)} />}
    </div>
  );
};

const FormDialog: React.FC<{ courseId: string; onClose: () => void; onSaved: () => void }> = ({ courseId, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [questions, setQuestions] = useState<FormQuestion[]>([{ id: uid(), type: 'scale', prompt: '', options: [], required: true }]);
  const [error, setError] = useState('');
  const update = (id: string, changes: Partial<FormQuestion>) => setQuestions(current => current.map(question => question.id === id ? { ...question, ...changes } : question));
  const save = async () => {
    setError('');
    try { await assessmentApi.createForm(courseId, { title: title.trim(), description, anonymous, questions: questions.map(question => ({ ...question, options: question.options.map(option => option.trim()).filter(Boolean) })) }); onSaved(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('assessmentUi.createForm')} onClose={onClose} wide>
      <FormField label={t('assessmentUi.formTitle')} required><Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></FormField>
      <FormField label={t('courseContentUi.description')}><Textarea rows={2} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></FormField>
      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} />{t('assessmentUi.anonymousHint')}</label>
      {questions.map((question, index) => (
        <fieldset key={question.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">{t('assessmentUi.questionLabel', { index: index + 1 })}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <FormField label={t('assessmentUi.type')}><Select value={question.type} onChange={event => update(question.id, { type: event.target.value as FormQuestion['type'] })} options={(['scale', 'single', 'multiple', 'text'] as const).map(type => ({ value: type, label: t(`assessmentUi.formTypes.${type}`) }))} /></FormField>
            <FormField label={t('assessmentUi.prompt')} className="sm:col-span-3"><Input value={question.prompt} maxLength={2000} onChange={event => update(question.id, { prompt: event.target.value })} /></FormField>
          </div>
          {['single', 'multiple'].includes(question.type) && <FormField label={t('assessmentUi.formOptions')} hint={t('assessmentUi.oneOptionPerLine')}><Textarea rows={3} value={question.options.join('\n')} onChange={event => update(question.id, { options: event.target.value.split('\n') })} /></FormField>}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={question.required} onChange={event => update(question.id, { required: event.target.checked })} />{t('assessmentUi.required')}</label>
            <Button size="sm" variant="ghost" disabled={questions.length <= 1} aria-label={t('assessmentUi.removeQuestion', { index: index + 1 })} onClick={() => setQuestions(questions.filter(candidate => candidate.id !== question.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        </fieldset>
      ))}
      <Button size="sm" variant="outline" onClick={() => setQuestions([...questions, { id: uid(), type: 'text', prompt: '', options: [], required: false }])}>{t('assessmentUi.addQuestion')}</Button>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={!title.trim() || questions.some(question => !question.prompt.trim())} onClick={() => void save()}>{t('lmsCommon.save')}</Button></div>
    </LmsDialog>
  );
};

const ResultsDialog: React.FC<{ results: FormResults; onClose: () => void }> = ({ results, onClose }) => {
  const { t, i18n } = useTranslation();
  return (
    <LmsDialog title={t('assessmentUi.resultsOf', { title: results.form.title })} onClose={onClose} wide>
      <p className="text-xs text-slate-600">{t('assessmentUi.responsesCount', { count: results.total })}{results.form.anonymous ? ` · ${t('assessmentUi.anonymousResults')}` : ''}</p>
      {results.form.questions.map(question => {
        const tally = results.tallies.find(row => row.questionId === question.id)?.counts;
        return (
          <section key={question.id} className="space-y-1 rounded-lg border border-slate-200 p-3" aria-label={question.prompt}>
            <h3 className="text-xs font-semibold text-slate-900">{question.prompt}</h3>
            {tally ? (
              <ul className="space-y-1 text-xs">{Object.entries(tally).map(([option, count]) => (
                <li key={option} className="flex items-center gap-2"><span className="w-28 truncate">{option}</span><span className="h-2 rounded bg-indigo-500" style={{ width: `${results.total ? count / results.total * 100 : 0}%`, minWidth: count ? '4px' : 0 }} aria-hidden /><span>{count}</span></li>
              ))}</ul>
            ) : (
              <ul className="list-disc ps-5 text-xs text-slate-700">{results.responses.map(response => response.answers.find(answer => answer.questionId === question.id)?.values[0]).filter(Boolean).map((value, index) => <li key={index}>{value}</li>)}</ul>
            )}
          </section>
        );
      })}
      {!results.form.anonymous && (
        <details className="text-xs"><summary className="cursor-pointer font-semibold">{t('assessmentUi.respondents')}</summary><ul className="mt-1">{results.responses.map(response => <li key={response.id}>{response.respondent} · {formatDateTime(response.submittedAt, i18n.language)}</li>)}</ul></details>
      )}
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.close')}</Button></div>
    </LmsDialog>
  );
};
