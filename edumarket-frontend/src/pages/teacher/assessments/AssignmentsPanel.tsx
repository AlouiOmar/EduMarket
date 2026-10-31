import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Plus, Settings2 } from 'lucide-react';
import { Badge } from '../../../components/atoms/Badge';
import { Button } from '../../../components/atoms/Button';
import { Input } from '../../../components/atoms/Input';
import { Select } from '../../../components/atoms/Select';
import { Textarea } from '../../../components/atoms/Textarea';
import { FormField } from '../../../components/molecules/FormField';
import { ErrorAlert, LoadingState } from '../../../components/molecules/PageStates';
import { LmsDialog, formatScore } from '../../../components/organisms/LmsShared';
import { apiAssetUrl } from '../../../services/apiClient';
import { assessmentApi, type CourseAssignment, type Rubric } from '../../../services/assessmentService';
import { apiErrorMessage } from '../../../utils/apiErrors';
import { formatDateTime } from '../../../utils/format';
import { fromLocalInput, toLocalInput } from '../../../utils/outline';
import { RubricTable } from './RubricsPanel';

type Settings = { title: string; instructions: string; dueAt: string; points: number; lateUntil: string; latePenaltyPercent: number; maxAttempts: number; rubricId: string; allowLinks: boolean };

/** Course assignments: late policy, attempts, rubric; submissions graded with a score or with the rubric. */
export const AssignmentsPanel: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t, i18n } = useTranslation();
  const [assignments, setAssignments] = useState<CourseAssignment[] | null>(null);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<{ id?: string; values: Settings } | null>(null);
  const [grading, setGrading] = useState<{ assignment: CourseAssignment; submission: CourseAssignment['submissions'][number] } | null>(null);
  const load = useCallback(() => {
    assessmentApi.courseAssignments(courseId).then(setAssignments).catch(cause => setError(apiErrorMessage(t, cause)));
    assessmentApi.rubrics(courseId).then(setRubrics).catch(() => setRubrics([]));
  }, [courseId, t]);
  useEffect(() => { load(); }, [load]);

  const open = (assignment?: CourseAssignment) => setSettings({ id: assignment?.id, values: {
    title: assignment?.title || '', instructions: assignment?.instructions || '', dueAt: toLocalInput(assignment?.dueAt || new Date(Date.now() + 7 * 86_400_000).toISOString()), points: assignment?.points ?? 20,
    lateUntil: toLocalInput(assignment?.lateUntil), latePenaltyPercent: assignment?.latePenaltyPercent ?? 0, maxAttempts: assignment?.maxAttempts ?? 1, rubricId: assignment?.rubricId || '', allowLinks: assignment?.allowLinks ?? true,
  } });

  if (!assignments) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end"><Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => open()}>{t('assessmentUi.createAssignment')}</Button></div>
      <ErrorAlert message={error} />
      {assignments.map(assignment => (
        <section key={assignment.id} aria-label={assignment.title} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{assignment.title} <Badge size="sm" variant={assignment.status === 'published' ? 'success' : 'default'}>{t(`assessmentUi.assignmentStatus.${assignment.status}`, { defaultValue: assignment.status })}</Badge></h3>
              <p className="text-xs text-slate-600">{t('assessmentUi.dueSummary', { date: formatDateTime(assignment.dueAt, i18n.language), points: assignment.points })}
                {assignment.lateUntil ? ` · ${t('assessmentUi.lateSummary', { date: formatDateTime(assignment.lateUntil, i18n.language), penalty: assignment.latePenaltyPercent })}` : ''}
                {` · ${assignment.maxAttempts ? t('assessmentUi.attemptsCount', { count: assignment.maxAttempts }) : t('assessmentUi.legacyAttempts')}`}</p>
            </div>
            <Button size="sm" variant="outline" leftIcon={<Settings2 className="w-3.5 h-3.5" />} onClick={() => open(assignment)}>{t('assessmentUi.settings')}</Button>
          </div>
          <table className="min-w-full text-xs">
            <caption className="sr-only">{t('assessmentUi.submissionsOf', { title: assignment.title })}</caption>
            <thead><tr className="text-start text-slate-600"><th scope="col" className="py-1 text-start">{t('gradebookUi.student')}</th><th scope="col" className="text-start">{t('assessmentUi.submittedAt')}</th><th scope="col" className="text-start">{t('assessmentUi.grade')}</th><th scope="col"><span className="sr-only">{t('assessmentUi.actions')}</span></th></tr></thead>
            <tbody>
              {assignment.submissions.map(submission => (
                <tr key={submission.id} className="border-t border-slate-100">
                  <th scope="row" className="py-1.5 text-start font-medium text-slate-800">{submission.studentName}</th>
                  <td>{formatDateTime(submission.submittedAt, i18n.language)}{submission.late ? <Badge size="sm" variant="warning">{t('assessmentUi.late')}</Badge> : null}{submission.attemptCount > 1 ? ` · ${t('assessmentUi.attemptNumber', { number: submission.attemptCount })}` : ''}</td>
                  <td>{submission.status === 'graded' ? `${formatScore(submission.score, i18n.language)} / ${assignment.points}` : t('gradebookUi.status.pending')}</td>
                  <td className="text-end">{submission.status === 'submitted' && <Button size="sm" variant="outline" leftIcon={<ClipboardCheck className="w-3.5 h-3.5" />} onClick={() => setGrading({ assignment, submission })}>{t('assessmentUi.grade')}</Button>}</td>
                </tr>
              ))}
              {!assignment.submissions.length && <tr><td colSpan={4} className="py-2 text-slate-500">{t('assessmentUi.noSubmissions')}</td></tr>}
            </tbody>
          </table>
        </section>
      ))}
      {!assignments.length && <p className="text-sm text-slate-500">{t('assessmentUi.noAssignments')}</p>}
      {settings && <AssignmentDialog courseId={courseId} rubrics={rubrics} settings={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); load(); }} />}
      {grading && <GradeDialog grading={grading} rubric={rubrics.find(rubric => rubric.id === grading.assignment.rubricId) || null} onClose={() => setGrading(null)} onSaved={() => { setGrading(null); load(); }} />}
    </div>
  );
};

const AssignmentDialog: React.FC<{ courseId: string; rubrics: Rubric[]; settings: { id?: string; values: Settings }; onClose: () => void; onSaved: () => void }> = ({ courseId, rubrics, settings, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState(settings.values);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    const payload = { title: values.title.trim(), instructions: values.instructions.trim(), dueAt: fromLocalInput(values.dueAt)!, points: values.points, lateUntil: fromLocalInput(values.lateUntil), latePenaltyPercent: values.latePenaltyPercent, maxAttempts: values.maxAttempts, rubricId: values.rubricId || null, allowLinks: values.allowLinks };
    try {
      if (settings.id) await assessmentApi.updateAssignment(settings.id, payload); else await assessmentApi.createAssignment({ ...payload, courseId, status: 'published' });
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={settings.id ? t('assessmentUi.assignmentSettings') : t('assessmentUi.createAssignment')} onClose={onClose} wide>
      <FormField label={t('assessmentUi.assignmentTitle')} required><Input value={values.title} maxLength={180} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
      <FormField label={t('assessmentUi.instructions')} required><Textarea rows={4} maxLength={12000} value={values.instructions} onChange={event => setValues({ ...values, instructions: event.target.value })} /></FormField>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <FormField label={t('assessmentUi.dueAt')}><Input type="datetime-local" value={values.dueAt} onChange={event => setValues({ ...values, dueAt: event.target.value })} /></FormField>
        <FormField label={t('assessmentUi.points')}><Input type="number" min={1} max={1000} value={values.points} onChange={event => setValues({ ...values, points: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
        <FormField label={t('assessmentUi.maxAttempts')} hint={t('assessmentUi.maxAttemptsHint')}><Input type="number" min={0} max={20} value={values.maxAttempts} onChange={event => setValues({ ...values, maxAttempts: Math.max(0, Number(event.target.value) || 0) })} /></FormField>
        <FormField label={t('assessmentUi.lateUntil')} hint={t('assessmentUi.lateUntilHint')}><Input type="datetime-local" value={values.lateUntil} onChange={event => setValues({ ...values, lateUntil: event.target.value })} /></FormField>
        <FormField label={t('assessmentUi.latePenalty')}><Input type="number" min={0} max={100} value={values.latePenaltyPercent} onChange={event => setValues({ ...values, latePenaltyPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /></FormField>
        <FormField label={t('assessmentUi.rubric')}><Select value={values.rubricId} onChange={event => setValues({ ...values, rubricId: event.target.value })} options={[{ value: '', label: t('assessmentUi.noRubric') }, ...rubrics.map(rubric => ({ value: rubric.id, label: rubric.title }))]} /></FormField>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={values.allowLinks} onChange={event => setValues({ ...values, allowLinks: event.target.checked })} />{t('assessmentUi.allowLinks')}</label>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={values.title.trim().length < 3 || values.instructions.trim().length < 5 || !values.dueAt} onClick={() => void save()}>{t('lmsCommon.save')}</Button></div>
    </LmsDialog>
  );
};

const GradeDialog: React.FC<{ grading: { assignment: CourseAssignment; submission: CourseAssignment['submissions'][number] }; rubric: Rubric | null; onClose: () => void; onSaved: () => void }> = ({ grading, rubric, onClose, onSaved }) => {
  const { t, i18n } = useTranslation();
  const { assignment, submission } = grading;
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const useRubric = !!rubric;
  const complete = useRubric ? rubric!.criteria.every(criterion => ratings[criterion.id]) : score.trim() !== '';
  const save = async () => {
    setError('');
    try {
      await assessmentApi.gradeSubmission(assignment.id, submission.id, useRubric ? { rubricRatings: Object.entries(ratings).map(([criterionId, levelId]) => ({ criterionId, levelId })), feedback } : { score: Number(score.replace(',', '.')), feedback });
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('assessmentUi.gradeTitle', { student: submission.studentName, title: assignment.title })} onClose={onClose} wide>
      {submission.late && <p className="text-xs text-amber-800">{t('assessmentUi.latePenaltyNotice', { penalty: assignment.latePenaltyPercent })}</p>}
      {submission.answerText && <p className="whitespace-pre-line rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">{submission.answerText}</p>}
      {submission.links.length > 0 && <ul className="text-xs">{submission.links.map(link => <li key={link}><a className="text-indigo-700 underline" href={link} target="_blank" rel="noopener noreferrer nofollow">{link}</a></li>)}</ul>}
      {submission.files.length > 0 && <ul className="text-xs">{submission.files.map(file => <li key={file.url}><a className="text-indigo-700 underline" href={apiAssetUrl(file.url)} target="_blank" rel="noopener noreferrer">{file.name}</a></li>)}</ul>}
      {submission.history.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">{t('assessmentUi.previousAttempts', { count: submission.history.length })}</summary><ul className="mt-1 space-y-1">{submission.history.map((entry, index) => <li key={index}>{formatDateTime(entry.submittedAt, i18n.language)} · {entry.score ?? '—'} · {entry.answerText?.slice(0, 120)}</li>)}</ul></details>}
      {useRubric ? <RubricTable rubric={rubric!} selected={ratings} onSelect={(criterionId, levelId) => setRatings({ ...ratings, [criterionId]: levelId })} />
        : <FormField label={t('gradebookUi.score', { max: assignment.points })}><Input inputMode="decimal" value={score} onChange={event => setScore(event.target.value)} /></FormField>}
      <FormField label={t('gradebookUi.feedback')}><Textarea rows={3} maxLength={4000} value={feedback} onChange={event => setFeedback(event.target.value)} /></FormField>
      <p className="text-xs text-slate-600">{t('assessmentUi.gradeUnpublished')}</p>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={!complete} onClick={() => void save()}>{t('assessmentUi.saveGrade')}</Button></div>
    </LmsDialog>
  );
};
