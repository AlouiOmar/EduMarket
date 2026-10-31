import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/atoms/Badge';
import { Button } from '../../../components/atoms/Button';
import { Input } from '../../../components/atoms/Input';
import { Select } from '../../../components/atoms/Select';
import { Textarea } from '../../../components/atoms/Textarea';
import { FormField } from '../../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../../components/molecules/PageStates';
import { LmsDialog, formatScore } from '../../../components/organisms/LmsShared';
import { RichTextView } from '../../../components/organisms/LessonBlocksView';
import { assessmentApi, type Bank, type Question, type Section, type TeacherAttempt, type TestDefinition, type TestInput } from '../../../services/assessmentService';
import { apiErrorMessage } from '../../../utils/apiErrors';
import { formatDateTime } from '../../../utils/format';
import { fromLocalInput, toLocalInput } from '../../../utils/outline';

const emptyTest = (): TestInput => ({ title: '', instructions: '', availableFrom: null, availableUntil: null, timeLimitMinutes: 0, maxAttempts: 1, shuffleQuestions: true, shuffleOptions: true, sections: [], gradePolicy: 'best', showCorrectAnswers: false });

/** Tests: fixed and random sections drawn from banks, timing, attempts, shuffling; publication and manual grading of essays. */
export const TestsPanel: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t, i18n } = useTranslation();
  const [tests, setTests] = useState<TestDefinition[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ id?: string; input: TestInput } | null>(null);
  const [grading, setGrading] = useState<TestDefinition | null>(null);
  const load = useCallback(() => assessmentApi.tests(courseId).then(setTests).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (test: TestDefinition, status: 'published' | 'closed' | 'draft') => {
    setError(''); setMessage('');
    try { await assessmentApi.setTestStatus(courseId, test.id, status); setMessage(t(`assessmentUi.testStatusChanged.${status}`, { title: test.title })); void load(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const remove = async (test: TestDefinition) => { setError(''); try { await assessmentApi.deleteTest(courseId, test.id); void load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };

  if (!tests) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end"><Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing({ input: emptyTest() })}>{t('assessmentUi.createTest')}</Button></div>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      <ul className="space-y-2">
        {tests.map(test => (
          <li key={test.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{test.title} <Badge size="sm" variant={test.status === 'published' ? 'success' : test.status === 'closed' ? 'warning' : 'default'}>{t(`assessmentUi.testStatus.${test.status}`)}</Badge></h3>
                <p className="mt-1 text-xs text-slate-600">
                  {t('assessmentUi.testSummary', { sections: test.sections.length, attempts: test.maxAttempts, minutes: test.timeLimitMinutes || '∞' })}
                  {test.availableUntil ? ` · ${t('assessmentUi.closesOn', { date: formatDateTime(test.availableUntil, i18n.language) })}` : ''}
                </p>
                <p className="text-xs text-slate-500">{t('assessmentUi.attemptStats', { attempts: test.attempts || 0, toGrade: test.toGrade || 0 })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" leftIcon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { const { id, status: _status, attempts: _attempts, toGrade: _toGrade, ...input } = test; setEditing({ id, input }); }}>{t('lmsCommon.edit')}</Button>
                {test.status !== 'published' && <Button size="sm" leftIcon={<Send className="w-3.5 h-3.5" />} onClick={() => void setStatus(test, 'published')}>{t('assessmentUi.publishTest')}</Button>}
                {test.status === 'published' && <Button size="sm" variant="outline" onClick={() => void setStatus(test, 'closed')}>{t('assessmentUi.closeTest')}</Button>}
                <Button size="sm" variant="outline" leftIcon={<ClipboardCheck className="w-3.5 h-3.5" />} onClick={() => setGrading(test)}>{t('assessmentUi.gradeAttempts')}</Button>
                {!test.attempts && <Button size="sm" variant="ghost" aria-label={t('assessmentUi.deleteTest', { title: test.title })} onClick={() => void remove(test)}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </div>
            </div>
          </li>
        ))}
        {!tests.length && <li className="text-sm text-slate-500">{t('assessmentUi.noTests')}</li>}
      </ul>
      {editing && <TestDialog courseId={courseId} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {grading && <AttemptsDialog courseId={courseId} test={grading} onClose={() => { setGrading(null); void load(); }} />}
    </div>
  );
};

const TestDialog: React.FC<{ courseId: string; editing: { id?: string; input: TestInput }; onClose: () => void; onSaved: () => void }> = ({ courseId, editing, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState<TestInput>(editing.input);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankQuestions, setBankQuestions] = useState<Record<string, Question[]>>({});
  const [error, setError] = useState('');
  useEffect(() => { assessmentApi.banks(courseId).then(setBanks).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  // Random sections added while banks were still loading get the first bank once the list arrives.
  useEffect(() => {
    if (banks[0]) setInput(current => ({ ...current, sections: current.sections.map(section => section.kind === 'random' && !section.bankId ? { ...section, bankId: banks[0].id } : section) }));
  }, [banks]);
  const questionsOf = (bankId: string) => {
    if (!bankId || bankQuestions[bankId]) return;
    assessmentApi.questions(courseId, bankId).then(list => setBankQuestions(current => ({ ...current, [bankId]: list }))).catch(cause => setError(apiErrorMessage(t, cause)));
  };
  const updateSection = (index: number, section: Section) => setInput(current => ({ ...current, sections: current.sections.map((candidate, position) => position === index ? section : candidate) }));
  const save = async () => {
    setError('');
    try {
      // Questions are locked once attempted: unchanged sections are not sent, so settings stay editable.
      const { sections, ...settings } = input;
      if (editing.id) await assessmentApi.updateTest(courseId, editing.id, JSON.stringify(sections) === JSON.stringify(editing.input.sections) ? settings : input);
      else await assessmentApi.createTest(courseId, input);
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={editing.id ? t('assessmentUi.editTest') : t('assessmentUi.createTest')} onClose={onClose} wide>
      <FormField label={t('assessmentUi.testTitle')} required><Input value={input.title} maxLength={200} onChange={event => setInput({ ...input, title: event.target.value })} /></FormField>
      <FormField label={t('assessmentUi.instructions')}><Textarea rows={3} value={input.instructions} onChange={event => setInput({ ...input, instructions: event.target.value })} /></FormField>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FormField label={t('assessmentUi.opensAt')}><Input type="datetime-local" value={toLocalInput(input.availableFrom)} onChange={event => setInput({ ...input, availableFrom: fromLocalInput(event.target.value) })} /></FormField>
        <FormField label={t('assessmentUi.closesAt')}><Input type="datetime-local" value={toLocalInput(input.availableUntil)} onChange={event => setInput({ ...input, availableUntil: fromLocalInput(event.target.value) })} /></FormField>
        <FormField label={t('assessmentUi.timeLimit')} hint={t('assessmentUi.timeLimitHint')}><Input type="number" min={0} max={600} value={input.timeLimitMinutes} onChange={event => setInput({ ...input, timeLimitMinutes: Math.max(0, Number(event.target.value) || 0) })} /></FormField>
        <FormField label={t('assessmentUi.maxAttempts')}><Input type="number" min={1} max={20} value={input.maxAttempts} onChange={event => setInput({ ...input, maxAttempts: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })} /></FormField>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={input.shuffleQuestions} onChange={event => setInput({ ...input, shuffleQuestions: event.target.checked })} />{t('assessmentUi.shuffleQuestions')}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={input.shuffleOptions} onChange={event => setInput({ ...input, shuffleOptions: event.target.checked })} />{t('assessmentUi.shuffleOptions')}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={input.showCorrectAnswers} onChange={event => setInput({ ...input, showCorrectAnswers: event.target.checked })} />{t('assessmentUi.showCorrectAnswers')}</label>
        <label className="flex items-center gap-2">{t('assessmentUi.gradePolicy')}<Select value={input.gradePolicy} onChange={event => setInput({ ...input, gradePolicy: event.target.value as 'best' | 'last' })} options={[{ value: 'best', label: t('assessmentUi.policy.best') }, { value: 'last', label: t('assessmentUi.policy.last') }]} /></label>
      </div>
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">{t('assessmentUi.sections')}</legend>
        {input.sections.map((section, index) => (
          <div key={index} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>{t('assessmentUi.sectionLabel', { index: index + 1 })} · {t(`assessmentUi.sectionKinds.${section.kind}`)}</span>
              <Button size="sm" variant="ghost" aria-label={t('assessmentUi.removeSection', { index: index + 1 })} onClick={() => setInput({ ...input, sections: input.sections.filter((_, position) => position !== index) })}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            {section.kind === 'random' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <FormField label={t('assessmentUi.bank')}><Select value={section.bankId} onChange={event => updateSection(index, { ...section, bankId: event.target.value })} options={[{ value: '', label: '—' }, ...banks.map(bank => ({ value: bank.id, label: `${bank.title} (${bank.questionCount})` }))]} /></FormField>
                <FormField label={t('assessmentUi.drawCount')}><Input type="number" min={1} max={200} value={section.count} onChange={event => updateSection(index, { ...section, count: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
                <FormField label={t('assessmentUi.chapter')}><Input value={section.chapter || ''} onChange={event => updateSection(index, { ...section, chapter: event.target.value })} /></FormField>
                <FormField label={t('assessmentUi.difficultyLabel')}><Select value={section.difficulty || ''} onChange={event => updateSection(index, { ...section, difficulty: event.target.value as '' })} options={[{ value: '', label: t('assessmentUi.anyDifficulty') }, ...(['easy', 'medium', 'hard'] as const).map(value => ({ value, label: t(`assessmentUi.difficulty.${value}`) }))]} /></FormField>
              </div>
            ) : (
              <FixedSectionEditor banks={banks} questions={bankQuestions} onBank={questionsOf} section={section} onChange={next => updateSection(index, next)} />
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!banks.length} onClick={() => setInput({ ...input, sections: [...input.sections, { kind: 'random', bankId: banks[0]?.id || '', count: 5, chapter: '', difficulty: '' }] })}>{t('assessmentUi.addRandomSection')}</Button>
          <Button size="sm" variant="outline" onClick={() => setInput({ ...input, sections: [...input.sections, { kind: 'fixed', questionIds: [] }] })}>{t('assessmentUi.addFixedSection')}</Button>
        </div>
      </fieldset>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button>
        <Button size="sm" disabled={!input.title.trim() || input.sections.some(section => section.kind === 'random' ? !section.bankId : !section.questionIds.length)} onClick={() => void save()}>{t('lmsCommon.save')}</Button>
      </div>
    </LmsDialog>
  );
};

const FixedSectionEditor: React.FC<{ banks: Bank[]; questions: Record<string, Question[]>; onBank: (bankId: string) => void; section: Extract<Section, { kind: 'fixed' }>; onChange: (section: Section) => void }> = ({ banks, questions, onBank, section, onChange }) => {
  const { t } = useTranslation();
  const [bankId, setBankId] = useState(banks[0]?.id || '');
  useEffect(() => { if (bankId) onBank(bankId); }, [bankId]);
  useEffect(() => { if (!bankId && banks[0]) setBankId(banks[0].id); }, [banks]);
  const list = questions[bankId] || [];
  return (
    <div className="space-y-2">
      <FormField label={t('assessmentUi.bank')}><Select value={bankId} onChange={event => setBankId(event.target.value)} options={banks.map(bank => ({ value: bank.id, label: bank.title }))} /></FormField>
      <p className="text-xs text-slate-600">{t('assessmentUi.selectedCount', { count: section.questionIds.length })}</p>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {list.map(question => (
          <li key={question.id}>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={section.questionIds.includes(question.id)} onChange={event => onChange({ ...section, questionIds: event.target.checked ? [...section.questionIds, question.id] : section.questionIds.filter(id => id !== question.id) })} />
              <span>{question.prompt.replace(/<[^>]*>/g, ' ').trim().slice(0, 140)} <span className="text-slate-500">({t(`assessmentUi.types.${question.type}`)}, {t('assessmentUi.pointsCount', { count: question.points })})</span></span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Attempts of a test; essays are graded here (automatic scores are computed from the answer key). */
const AttemptsDialog: React.FC<{ courseId: string; test: TestDefinition; onClose: () => void }> = ({ courseId, test, onClose }) => {
  const { t, i18n } = useTranslation();
  const [attempts, setAttempts] = useState<TeacherAttempt[] | null>(null);
  const [scores, setScores] = useState<Record<string, { score: string; feedback: string }>>({});
  const [error, setError] = useState('');
  const load = useCallback(() => assessmentApi.attempts(courseId, test.id).then(setAttempts).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, test.id, t]);
  useEffect(() => { void load(); }, [load]);
  const grade = async (attempt: TeacherAttempt) => {
    setError('');
    const payload = attempt.questions.filter(question => question.type === 'essay').map(question => {
      const value = scores[`${attempt.id}:${question.questionId}`] ?? { score: String(attempt.manual.find(entry => entry.questionId === question.questionId)?.score ?? ''), feedback: attempt.manual.find(entry => entry.questionId === question.questionId)?.feedback ?? '' };
      return { questionId: question.questionId, score: Number(value.score.replace(',', '.')), feedback: value.feedback };
    }).filter(entry => Number.isFinite(entry.score));
    if (!payload.length) return;
    try { await assessmentApi.gradeAttempt(courseId, attempt.id, payload); void load(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('assessmentUi.attemptsOf', { title: test.title })} onClose={onClose} wide>
      <p className="text-xs text-slate-600">{t('assessmentUi.gradingHint')}</p>
      <ErrorAlert message={error} />
      {!attempts ? <LoadingState /> : attempts.length === 0 ? <p className="text-sm text-slate-500">{t('assessmentUi.noAttempts')}</p> : (
        <ul className="space-y-3">
          {attempts.map(attempt => (
            <li key={attempt.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">{attempt.studentName} · {t('assessmentUi.attemptNumber', { number: attempt.number })} · <span className="font-normal">{t(`assessmentUi.attemptStatus.${attempt.status}`)}</span></p>
              <p className="text-xs text-slate-500">{attempt.submittedAt ? formatDateTime(attempt.submittedAt, i18n.language) : '—'}{attempt.autoSubmitted ? ` · ${t('assessmentUi.autoSubmitted')}` : ''} · {formatScore(attempt.score, i18n.language)} / {attempt.maxScore}</p>
              {attempt.questions.filter(question => question.type === 'essay').map(question => {
                const key = `${attempt.id}:${question.questionId}`;
                const existing = attempt.manual.find(entry => entry.questionId === question.questionId);
                const value = scores[key] ?? { score: existing ? String(existing.score) : '', feedback: existing?.feedback || '' };
                return (
                  <div key={question.questionId} className="mt-2 space-y-2 rounded bg-slate-50 p-2">
                    <RichTextView html={question.prompt} className="text-xs" />
                    <p className="whitespace-pre-line rounded border border-slate-200 bg-white p-2 text-xs text-slate-800">{attempt.answers.find(answer => answer.questionId === question.questionId)?.text || t('assessmentUi.noAnswer')}</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <FormField label={t('assessmentUi.essayScore', { max: question.points })} className="w-32"><Input inputMode="decimal" value={value.score} onChange={event => setScores({ ...scores, [key]: { ...value, score: event.target.value } })} /></FormField>
                      <FormField label={t('gradebookUi.feedback')} className="flex-1"><Input value={value.feedback} onChange={event => setScores({ ...scores, [key]: { ...value, feedback: event.target.value } })} /></FormField>
                    </div>
                  </div>
                );
              })}
              {attempt.questions.some(question => question.type === 'essay') && attempt.status !== 'in_progress' && (
                <div className="mt-2 flex justify-end"><Button size="sm" onClick={() => void grade(attempt)}>{t('assessmentUi.saveGrades')}</Button></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </LmsDialog>
  );
};
