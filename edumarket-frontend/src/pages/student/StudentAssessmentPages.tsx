import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Loader2, Send } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { StudentCourseFrame, formatScore } from '../../components/organisms/LmsShared';
import { RichTextView } from '../../components/organisms/LessonBlocksView';
import { apiAssetUrl } from '../../services/apiClient';
import { assessmentApi, type AttemptAnswer, type CourseForm, type StudentAssignment, type StudentAttempt, type StudentTest } from '../../services/assessmentService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { RubricTable } from '../teacher/assessments/RubricsPanel';

/** Tests of the course: availability, attempts left, resume of an attempt in progress. */
export const StudentTestsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tests, setTests] = useState<StudentTest[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { assessmentApi.studentTests(id).then(setTests).catch(cause => setError(apiErrorMessage(t, cause))); }, [id, t]);
  const start = async (test: StudentTest) => {
    setError('');
    try { const attempt = await assessmentApi.startAttempt(id, test.id); navigate(`/student/courses/${id}/tests/attempts/${attempt.id}`); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <StudentCourseFrame courseId={id} title={t('studentAssessmentUi.testsTitle')}>
      <ErrorAlert message={error} />
      {!tests ? (!error && <LoadingState />) : (
        <ul className="space-y-3">
          {tests.map(test => {
            const left = test.maxAttempts - test.attemptsUsed;
            return (
              <li key={test.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{test.title}</h2>
                    <p className="text-xs text-slate-600">
                      {test.timeLimitMinutes ? t('studentAssessmentUi.timeLimit', { minutes: test.timeLimitMinutes }) : t('studentAssessmentUi.noTimeLimit')}
                      {' · '}{t('studentAssessmentUi.attemptsLeft', { count: Math.max(0, left) })}
                      {test.availableUntil ? ` · ${t('studentAssessmentUi.closesOn', { date: formatDateTime(test.availableUntil, i18n.language) })}` : ''}
                    </p>
                    {test.publishedGrade && <p className="text-xs font-semibold text-emerald-700">{t('studentAssessmentUi.publishedGrade', { score: formatScore(test.publishedGrade.score, i18n.language) })}</p>}
                  </div>
                  {test.inProgress
                    ? <Button size="sm" onClick={() => navigate(`/student/courses/${id}/tests/attempts/${test.inProgress}`)}>{t('studentAssessmentUi.resume')}</Button>
                    : test.open && left > 0 ? <Button size="sm" onClick={() => void start(test)}>{t('studentAssessmentUi.start')}</Button>
                    : <Badge size="sm">{test.open ? t('studentAssessmentUi.noAttemptsLeft') : t('studentAssessmentUi.notOpen')}</Badge>}
                </div>
                {test.instructions && <RichTextView html={test.instructions} className="mt-2 text-xs" />}
                {test.attempts.filter(attempt => attempt.status !== 'in_progress').length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {test.attempts.filter(attempt => attempt.status !== 'in_progress').map(attempt => (
                      <li key={attempt.id}><Link className="text-indigo-700 underline" to={`/student/courses/${id}/tests/attempts/${attempt.id}`}>{t('studentAssessmentUi.attemptLink', { number: attempt.number })}</Link></li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {!tests.length && <li className="text-sm text-slate-500">{t('studentAssessmentUi.noTests')}</li>}
        </ul>
      )}
    </StudentCourseFrame>
  );
};

const remaining = (deadline: string | null, now: number) => deadline ? Math.max(0, new Date(deadline).getTime() - now) : null;
const clock = (ms: number) => { const total = Math.ceil(ms / 1000); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

/**
 * Taking a test: answers are autosaved (debounced) on the server, so a reload or another device resumes the attempt with the
 * same questions and deadline. When time is up the attempt is submitted with the saved answers.
 */
export const StudentAttemptPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '', attemptId = '' } = useParams<{ id: string; attemptId: string }>();
  const [attempt, setAttempt] = useState<StudentAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, AttemptAnswer>>({});
  const [save, setSave] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const announced = useRef<number>(-1);
  const [announcement, setAnnouncement] = useState('');

  const adopt = (data: StudentAttempt) => { setAttempt(data); setAnswers(Object.fromEntries(data.answers.map(answer => [answer.questionId, answer]))); };
  useEffect(() => { assessmentApi.attempt(id, attemptId).then(adopt).catch(cause => setError(apiErrorMessage(t, cause))); }, [id, attemptId, t]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);

  const flush = useCallback(async () => {
    setSave('saving');
    try { await assessmentApi.saveAnswers(id, attemptId, Object.values(answersRef.current)); setSave('saved'); }
    catch (cause) {
      setSave('error');
      if ((cause as { code?: string }).code === 'ATTEMPT_CLOSED') adopt(await assessmentApi.attempt(id, attemptId));
      else setError(apiErrorMessage(t, cause));
    }
  }, [id, attemptId, t]);
  const answer = (questionId: string, changes: Partial<AttemptAnswer>) => {
    setAnswers(current => ({ ...current, [questionId]: { ...(current[questionId] ?? { questionId, optionIds: [], text: '' }), ...changes } }));
    setSave('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1000);
  };
  const submit = async () => {
    window.clearTimeout(timer.current);
    setConfirm(false); setError('');
    try { if (save !== 'saved') await assessmentApi.saveAnswers(id, attemptId, Object.values(answersRef.current)); adopt(await assessmentApi.submitAttempt(id, attemptId)); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };

  const left = attempt?.status === 'in_progress' ? remaining(attempt.deadlineAt, now) : null;
  // Time is up: the server submits with the saved answers; reload the attempt to show its result.
  useEffect(() => { if (left === 0 && attempt?.status === 'in_progress') { const handle = window.setTimeout(() => void submit(), 500); return () => window.clearTimeout(handle); } }, [left === 0]);
  // Screen-reader announcements at 10, 5 and 1 minute(s) left (not every second).
  useEffect(() => {
    if (left === null) return;
    const minutes = Math.ceil(left / 60_000);
    if ([10, 5, 1].includes(minutes) && announced.current !== minutes) { announced.current = minutes; setAnnouncement(t('studentAssessmentUi.minutesLeft', { count: minutes })); }
  }, [left, t]);

  if (error && !attempt) return <div className="max-w-3xl mx-auto"><ErrorAlert message={error} /></div>;
  if (!attempt) return <LoadingState />;
  const closed = attempt.status !== 'in_progress';
  const answeredCount = attempt.questions.filter(question => { const value = answers[question.questionId]; return value && (value.optionIds.length || value.text.trim()); }).length;

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-16">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div>
          <Link to={`/student/courses/${id}/tests`} className="text-xs text-indigo-700 underline">{t('studentAssessmentUi.backToTests')}</Link>
          <h1 className="text-base font-bold text-slate-900">{t('studentAssessmentUi.attemptTitle', { number: attempt.number })}</h1>
        </div>
        {!closed && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {left !== null && <span className={`inline-flex items-center gap-1 font-mono text-sm ${left < 60_000 ? 'text-rose-700' : 'text-slate-800'}`} aria-label={t('studentAssessmentUi.timeLeftLabel', { time: clock(left) })}><Clock className="w-4 h-4" aria-hidden />{clock(left)}</span>}
            <span role="status" className="inline-flex items-center gap-1 text-slate-600">{save === 'saving' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />{t('studentAssessmentUi.saving')}</> : save === 'saved' ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden />{t('studentAssessmentUi.saved')}</> : save === 'error' ? <span className="text-rose-700">{t('studentAssessmentUi.saveFailed')}</span> : t('studentAssessmentUi.unsaved')}</span>
            <Button size="sm" leftIcon={<Send className="w-3.5 h-3.5" />} onClick={() => setConfirm(true)}>{t('studentAssessmentUi.submit')}</Button>
          </div>
        )}
      </div>
      <ErrorAlert message={error} />
      {closed && (
        <NoticeBanner tone={attempt.gradePublished ? 'success' : 'info'}>
          {attempt.autoSubmitted ? `${t('studentAssessmentUi.autoSubmitted')} ` : ''}
          {attempt.gradePublished ? t('studentAssessmentUi.score', { score: formatScore(attempt.score, i18n.language), max: attempt.maxScore }) : attempt.status === 'needs_grading' ? t('studentAssessmentUi.awaitingGrading') : t('studentAssessmentUi.awaitingPublication')}
        </NoticeBanner>
      )}
      <ol className="space-y-4">
        {attempt.questions.map((question, index) => {
          const value = answers[question.questionId] || { questionId: question.questionId, optionIds: [], text: '' };
          const name = `q-${question.questionId}`;
          const feedback = attempt.feedback?.find(entry => entry.questionId === question.questionId);
          return (
            <li key={question.questionId}>
              <fieldset className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" disabled={closed}>
                <legend className="sr-only">{t('studentAssessmentUi.questionLegend', { index: index + 1, count: attempt.questions.length })}</legend>
                <p className="text-xs text-slate-500" aria-hidden>{t('studentAssessmentUi.questionLegend', { index: index + 1, count: attempt.questions.length })} · {t('assessmentUi.pointsCount', { count: question.points })}</p>
                <RichTextView html={question.prompt} />
                {(question.type === 'single' || question.type === 'multiple') && question.options.map(option => (
                  <label key={option.id} className={`flex items-start gap-2 rounded px-2 py-1 text-sm ${question.correct?.includes(option.id) ? 'bg-emerald-50' : ''}`}>
                    <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={name} className="mt-1" checked={value.optionIds.includes(option.id)}
                      onChange={event => answer(question.questionId, { optionIds: question.type === 'single' ? [option.id] : event.target.checked ? [...value.optionIds, option.id] : value.optionIds.filter(id => id !== option.id) })} />
                    <span>{option.text}{question.correct?.includes(option.id) ? ` (${t('studentAssessmentUi.correct')})` : ''}</span>
                  </label>
                ))}
                {question.type === 'true_false' && (['true', 'false'] as const).map(option => (
                  <label key={option} className="flex items-center gap-2 text-sm"><input type="radio" name={name} checked={value.optionIds[0] === option} onChange={() => answer(question.questionId, { optionIds: [option] })} />{t(`assessmentUi.${option}`)}</label>
                ))}
                {question.type === 'short' && <FormField label={t('studentAssessmentUi.yourAnswer')}><Input value={value.text} maxLength={500} onChange={event => answer(question.questionId, { text: event.target.value })} /></FormField>}
                {question.type === 'essay' && <FormField label={t('studentAssessmentUi.yourAnswer')}><Textarea rows={6} maxLength={20000} value={value.text} onChange={event => answer(question.questionId, { text: event.target.value })} /></FormField>}
                {question.explanation && <RichTextView html={question.explanation} className="rounded bg-slate-50 p-2 text-xs" />}
                {feedback && <p className="text-xs text-slate-700"><strong>{formatScore(feedback.score, i18n.language)} / {question.points}</strong>{feedback.feedback ? ` · ${feedback.feedback}` : ''}</p>}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <ConfirmationDialog isOpen={confirm} title={t('studentAssessmentUi.confirmTitle')} description={t('studentAssessmentUi.confirmDescription', { answered: answeredCount, count: attempt.questions.length })}
        confirmLabel={t('studentAssessmentUi.submit')} onCancel={() => setConfirm(false)} onConfirm={() => void submit()} />
    </div>
  );
};

/** Assignments of the course: instructions, attachments, visible rubric, submission (text, links, files), attempts and late window. */
export const StudentCourseAssignmentsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [assignments, setAssignments] = useState<StudentAssignment[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => assessmentApi.studentAssignments().then(list => setAssignments(list.filter(row => row.courseId === id))).catch(cause => setError(apiErrorMessage(t, cause))), [id, t]);
  useEffect(() => { void load(); }, [load]);
  return (
    <StudentCourseFrame courseId={id} title={t('studentAssessmentUi.assignmentsTitle')}>
      <ErrorAlert message={error} />
      {!assignments ? (!error && <LoadingState />) : (
        <ul className="space-y-3">
          {assignments.map(assignment => <li key={assignment.id}><AssignmentCard assignment={assignment} onSubmitted={load} /></li>)}
          {!assignments.length && <li className="text-sm text-slate-500">{t('studentAssessmentUi.noAssignments')}</li>}
        </ul>
      )}
    </StudentCourseFrame>
  );

  function AssignmentCard({ assignment, onSubmitted }: { assignment: StudentAssignment; onSubmitted: () => void }) {
    const [text, setText] = useState('');
    const [links, setLinks] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [cardError, setCardError] = useState('');
    const submission = assignment.submission;
    const canSubmit = ['open', 'late_open'].includes(assignment.status) || (submission && (assignment.maxAttempts === 0 ? submission.status !== 'graded' : submission.attemptCount < assignment.maxAttempts));
    const send = async () => {
      setBusy(true); setCardError('');
      try { await assessmentApi.submitAssignment(assignment.id, { answerText: text, links: links.split('\n').map(link => link.trim()).filter(Boolean), files }); setText(''); setLinks(''); setFiles([]); onSubmitted(); }
      catch (cause) { setCardError(apiErrorMessage(t, cause)); } finally { setBusy(false); }
    };
    return (
      <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`assignment-${assignment.id}`}>
        <div>
          <h2 id={`assignment-${assignment.id}`} className="text-sm font-semibold text-slate-900">{assignment.title}</h2>
          <p className="text-xs text-slate-600">{t('assessmentUi.dueSummary', { date: formatDateTime(assignment.dueAt, i18n.language), points: assignment.points })}
            {assignment.lateUntil ? ` · ${t('assessmentUi.lateSummary', { date: formatDateTime(assignment.lateUntil, i18n.language), penalty: assignment.latePenaltyPercent })}` : ''}</p>
          {assignment.status === 'late_open' && <p className="text-xs font-semibold text-amber-800">{t('studentAssessmentUi.lateWindow')}</p>}
        </div>
        <p className="whitespace-pre-line text-sm text-slate-700">{assignment.instructions}</p>
        {assignment.attachments.length > 0 && <ul className="text-xs">{assignment.attachments.map(file => <li key={file.assetId}><a className="text-indigo-700 underline" href={apiAssetUrl(file.url)}>{file.name}</a></li>)}</ul>}
        {assignment.rubric && <details className="text-xs"><summary className="cursor-pointer font-semibold">{t('studentAssessmentUi.rubric')}</summary><div className="mt-2"><RubricTable rubric={{ ...assignment.rubric, id: '', visibleToStudents: true, maxPoints: 0 }} /></div></details>}
        {submission && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold">{t('studentAssessmentUi.submittedOn', { date: formatDateTime(submission.submittedAt, i18n.language) })}{submission.late ? ` · ${t('assessmentUi.late')}` : ''}{submission.attemptCount > 1 ? ` · ${t('assessmentUi.attemptNumber', { number: submission.attemptCount })}` : ''}</p>
            {submission.score !== undefined ? <p className="mt-1 text-sm font-semibold text-emerald-700">{formatScore(submission.score, i18n.language)} / {assignment.points}</p> : <p className="mt-1">{t('studentAssessmentUi.awaitingPublication')}</p>}
            {submission.feedback && <p className="mt-1 whitespace-pre-line">{submission.feedback}</p>}
          </div>
        )}
        {canSubmit && (
          <div className="space-y-2">
            <FormField label={t('studentAssessmentUi.answerText')}><Textarea rows={4} maxLength={12000} value={text} onChange={event => setText(event.target.value)} /></FormField>
            {assignment.allowLinks && <FormField label={t('studentAssessmentUi.links')} hint={t('studentAssessmentUi.linksHint')}><Textarea rows={2} value={links} onChange={event => setLinks(event.target.value)} /></FormField>}
            <FormField label={t('studentAssessmentUi.files')} hint={t('studentAssessmentUi.filesHint')}><input type="file" multiple accept=".pdf,.zip,.docx" className="text-xs" onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></FormField>
            <ErrorAlert message={cardError} />
            <div className="flex justify-end"><Button size="sm" isLoading={busy} disabled={!text.trim() && !links.trim() && !files.length} onClick={() => void send()}>{submission ? t('studentAssessmentUi.resubmit') : t('studentAssessmentUi.submitWork')}</Button></div>
          </div>
        )}
      </article>
    );
  }
};

/** Course forms: answer once; anonymous forms tell the student that their identity is not stored. */
export const StudentFormsPage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [forms, setForms] = useState<CourseForm[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => assessmentApi.studentForms(id).then(setForms).catch(cause => setError(apiErrorMessage(t, cause))), [id, t]);
  useEffect(() => { void load(); }, [load]);
  return (
    <StudentCourseFrame courseId={id} title={t('studentAssessmentUi.formsTitle')}>
      <ErrorAlert message={error} />
      {!forms ? (!error && <LoadingState />) : (
        <ul className="space-y-3">
          {forms.map(form => <li key={form.id}><FormCard form={form} onDone={load} /></li>)}
          {!forms.length && <li className="text-sm text-slate-500">{t('studentAssessmentUi.noForms')}</li>}
        </ul>
      )}
    </StudentCourseFrame>
  );

  function FormCard({ form, onDone }: { form: CourseForm; onDone: () => void }) {
    const [values, setValues] = useState<Record<string, string[]>>({});
    const [cardError, setCardError] = useState('');
    const send = async () => {
      setCardError('');
      try { await assessmentApi.answerForm(id, form.id, Object.entries(values).map(([questionId, list]) => ({ questionId, values: list }))); onDone(); }
      catch (cause) { setCardError(apiErrorMessage(t, cause)); }
    };
    return (
      <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`form-${form.id}`}>
        <h2 id={`form-${form.id}`} className="text-sm font-semibold text-slate-900">{form.title}</h2>
        {form.description && <p className="text-xs text-slate-600">{form.description}</p>}
        <p className="text-xs text-slate-600">{form.anonymous ? t('studentAssessmentUi.anonymousNotice') : t('studentAssessmentUi.namedNotice')}</p>
        {form.answered ? <NoticeBanner tone="success">{t('studentAssessmentUi.formAnswered')}</NoticeBanner> : !form.open ? <p className="text-xs text-slate-500">{t('studentAssessmentUi.notOpen')}</p> : (
          <>
            {form.questions.map(question => (
              <fieldset key={question.id} className="space-y-1">
                <legend className="text-sm font-medium text-slate-800">{question.prompt}{question.required ? ' *' : ''}</legend>
                {question.type === 'text' && <Textarea rows={2} aria-label={question.prompt} value={values[question.id]?.[0] || ''} onChange={event => setValues({ ...values, [question.id]: [event.target.value] })} />}
                {question.type === 'scale' && <div className="flex gap-3">{['1', '2', '3', '4', '5'].map(option => <label key={option} className="flex items-center gap-1 text-sm"><input type="radio" name={`${form.id}-${question.id}`} checked={values[question.id]?.[0] === option} onChange={() => setValues({ ...values, [question.id]: [option] })} />{option}</label>)}</div>}
                {(question.type === 'single' || question.type === 'multiple') && question.options.map(option => (
                  <label key={option} className="flex items-center gap-2 text-sm"><input type={question.type === 'single' ? 'radio' : 'checkbox'} name={`${form.id}-${question.id}`} checked={values[question.id]?.includes(option) || false}
                    onChange={event => setValues({ ...values, [question.id]: question.type === 'single' ? [option] : event.target.checked ? [...(values[question.id] || []), option] : (values[question.id] || []).filter(value => value !== option) })} />{option}</label>
                ))}
              </fieldset>
            ))}
            <ErrorAlert message={cardError} />
            <div className="flex justify-end"><Button size="sm" onClick={() => void send()}>{t('studentAssessmentUi.sendForm')}</Button></div>
          </>
        )}
      </article>
    );
  }
};
