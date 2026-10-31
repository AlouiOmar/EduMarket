import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/atoms/Button';
import { Input } from '../../../components/atoms/Input';
import { Select } from '../../../components/atoms/Select';
import { Textarea } from '../../../components/atoms/Textarea';
import { FormField } from '../../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../../components/molecules/PageStates';
import { LmsDialog } from '../../../components/organisms/LmsShared';
import { RichTextView } from '../../../components/organisms/LessonBlocksView';
import { RichTextEditor } from '../../../components/organisms/RichTextEditor';
import { apiRequest } from '../../../services/apiClient';
import { assessmentApi, type Bank, type Difficulty, type Question, type QuestionInput, type QuestionType } from '../../../services/assessmentService';
import { apiErrorMessage } from '../../../utils/apiErrors';

const TYPES: QuestionType[] = ['single', 'multiple', 'true_false', 'short', 'essay'];
const emptyQuestion = (): QuestionInput => ({ type: 'single', prompt: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct: [], caseSensitive: false, points: 1, chapter: '', difficulty: 'medium', explanation: '' });

/** Question banks ("séries"): questions by chapter and difficulty, reusable by several tests and copyable to another course. */
export const BanksPanel: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t } = useTranslation();
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newBank, setNewBank] = useState('');
  const [editing, setEditing] = useState<{ id?: string; input: QuestionInput } | null>(null);
  const [copying, setCopying] = useState(false);

  const loadBanks = useCallback(() => assessmentApi.banks(courseId).then(list => { setBanks(list); setSelected(current => current || list[0]?.id || ''); }).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void loadBanks(); }, [loadBanks]);
  const loadQuestions = useCallback(() => { if (selected) assessmentApi.questions(courseId, selected).then(setQuestions).catch(cause => setError(apiErrorMessage(t, cause))); else setQuestions([]); }, [courseId, selected, t]);
  useEffect(() => { loadQuestions(); }, [loadQuestions]);

  const createBank = async () => {
    setError('');
    try { const bank = await assessmentApi.createBank(courseId, { title: newBank.trim() }); setNewBank(''); await loadBanks(); setSelected(bank.id); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const remove = async (question: Question) => {
    setError('');
    try { await assessmentApi.deleteQuestion(courseId, question.id); loadQuestions(); void loadBanks(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };

  if (!banks) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  const bank = banks.find(candidate => candidate.id === selected);
  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
      <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-3" aria-label={t('assessmentUi.banks')}>
        <h2 className="text-sm font-semibold text-slate-900">{t('assessmentUi.banks')}</h2>
        <ul className="space-y-1">
          {banks.map(candidate => (
            <li key={candidate.id}>
              <button type="button" aria-current={candidate.id === selected ? 'true' : undefined} onClick={() => setSelected(candidate.id)}
                className={`w-full rounded px-2 py-1.5 text-start text-xs ${candidate.id === selected ? 'bg-indigo-50 font-semibold text-indigo-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                {candidate.title} <span className="text-slate-500">({candidate.questionCount})</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <FormField label={t('assessmentUi.newBank')} className="flex-1"><Input value={newBank} maxLength={200} onChange={event => setNewBank(event.target.value)} /></FormField>
          <Button size="sm" disabled={!newBank.trim()} onClick={() => void createBank()} aria-label={t('assessmentUi.createBank')}><Plus className="w-3.5 h-3.5" /></Button>
        </div>
      </aside>
      <div className="lg:col-span-3 space-y-3">
        <ErrorAlert message={error} />
        {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
        {!bank ? <p className="text-sm text-slate-500">{t('assessmentUi.noBank')}</p> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{bank.title}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" leftIcon={<Copy className="w-3.5 h-3.5" />} onClick={() => setCopying(true)}>{t('assessmentUi.copyBank')}</Button>
                <Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing({ input: emptyQuestion() })}>{t('assessmentUi.addQuestion')}</Button>
              </div>
            </div>
            <ol className="space-y-2" aria-label={t('assessmentUi.questionsOf', { bank: bank.title })}>
              {questions.map((question, index) => (
                <li key={question.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">{index + 1}. {t(`assessmentUi.types.${question.type}`)} · {t('assessmentUi.pointsCount', { count: question.points })} · {t(`assessmentUi.difficulty.${question.difficulty}`)}{question.chapter ? ` · ${question.chapter}` : ''}</p>
                      <RichTextView html={question.prompt} />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={t('assessmentUi.editQuestion', { index: index + 1 })} onClick={() => { const { id, bankId: _bankId, ...input } = question; setEditing({ id, input }); }}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label={t('assessmentUi.deleteQuestion', { index: index + 1 })} onClick={() => void remove(question)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </li>
              ))}
              {!questions.length && <li className="text-sm text-slate-500">{t('assessmentUi.noQuestions')}</li>}
            </ol>
          </>
        )}
      </div>
      {editing && bank && <QuestionDialog courseId={courseId} bankId={bank.id} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadQuestions(); void loadBanks(); }} />}
      {copying && bank && <CopyBankDialog courseId={courseId} bank={bank} onClose={() => setCopying(false)} onCopied={count => { setCopying(false); setMessage(t('assessmentUi.bankCopied', { count })); }} />}
    </div>
  );
};

const QuestionDialog: React.FC<{ courseId: string; bankId: string; editing: { id?: string; input: QuestionInput }; onClose: () => void; onSaved: () => void }> = ({ courseId, bankId, editing, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState<QuestionInput>(editing.input);
  const [accepted, setAccepted] = useState(editing.input.type === 'short' ? editing.input.correct.join('\n') : '');
  const [error, setError] = useState('');
  const choice = input.type === 'single' || input.type === 'multiple';
  const setType = (type: QuestionType) => setInput(current => ({ ...current, type, correct: type === 'true_false' ? ['true'] : [], options: type === 'single' || type === 'multiple' ? (current.options.length >= 2 ? current.options : emptyQuestion().options) : [] }));
  const toggleCorrect = (id: string, checked: boolean) => setInput(current => ({ ...current, correct: current.type === 'single' ? (checked ? [id] : []) : checked ? [...current.correct, id] : current.correct.filter(value => value !== id) }));
  const save = async () => {
    setError('');
    const payload: QuestionInput = { ...input, correct: input.type === 'short' ? accepted.split('\n').map(value => value.trim()).filter(Boolean) : input.type === 'essay' ? [] : input.correct, options: choice ? input.options.map(option => ({ ...option, text: option.text.trim() })) : [] };
    try {
      if (editing.id) await assessmentApi.updateQuestion(courseId, editing.id, payload); else await assessmentApi.createQuestion(courseId, bankId, payload);
      onSaved();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={editing.id ? t('assessmentUi.editQuestionTitle') : t('assessmentUi.addQuestion')} onClose={onClose} wide>
      {editing.id && <p className="text-xs text-slate-600">{t('assessmentUi.snapshotHint')}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <FormField label={t('assessmentUi.type')}><Select value={input.type} onChange={event => setType(event.target.value as QuestionType)} options={TYPES.map(type => ({ value: type, label: t(`assessmentUi.types.${type}`) }))} /></FormField>
        <FormField label={t('assessmentUi.points')}><Input type="number" min={0} step="0.5" value={input.points} onChange={event => setInput({ ...input, points: Math.max(0, Number(event.target.value) || 0) })} /></FormField>
        <FormField label={t('assessmentUi.chapter')}><Input value={input.chapter} maxLength={120} onChange={event => setInput({ ...input, chapter: event.target.value })} /></FormField>
        <FormField label={t('assessmentUi.difficultyLabel')}><Select value={input.difficulty} onChange={event => setInput({ ...input, difficulty: event.target.value as Difficulty })} options={(['easy', 'medium', 'hard'] as const).map(value => ({ value, label: t(`assessmentUi.difficulty.${value}`) }))} /></FormField>
      </div>
      <div><p className="mb-1 text-xs font-semibold text-slate-700">{t('assessmentUi.prompt')} *</p><RichTextEditor label={t('assessmentUi.prompt')} value={input.prompt} onChange={prompt => setInput(current => ({ ...current, prompt }))} /></div>
      {choice && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-700">{t('assessmentUi.options')}</legend>
          {input.options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <input type={input.type === 'single' ? 'radio' : 'checkbox'} name="correct" checked={input.correct.includes(option.id)} onChange={event => toggleCorrect(option.id, event.target.checked)} aria-label={t('assessmentUi.markCorrect', { index: index + 1 })} />
              <Input value={option.text} maxLength={1000} aria-label={t('assessmentUi.optionLabel', { index: index + 1 })} onChange={event => setInput({ ...input, options: input.options.map(candidate => candidate.id === option.id ? { ...candidate, text: event.target.value } : candidate) })} />
              <Button size="sm" variant="ghost" disabled={input.options.length <= 2} aria-label={t('assessmentUi.removeOption', { index: index + 1 })} onClick={() => setInput({ ...input, options: input.options.filter(candidate => candidate.id !== option.id), correct: input.correct.filter(value => value !== option.id) })}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={input.options.length >= 12} onClick={() => setInput({ ...input, options: [...input.options, { id: `o${Date.now().toString(36)}`, text: '' }] })}>{t('assessmentUi.addOption')}</Button>
        </fieldset>
      )}
      {input.type === 'true_false' && (
        <FormField label={t('assessmentUi.correctAnswer')}><Select value={input.correct[0] || 'true'} onChange={event => setInput({ ...input, correct: [event.target.value] })} options={[{ value: 'true', label: t('assessmentUi.true') }, { value: 'false', label: t('assessmentUi.false') }]} /></FormField>
      )}
      {input.type === 'short' && (
        <>
          <FormField label={t('assessmentUi.acceptedAnswers')} hint={t('assessmentUi.acceptedHint')}><Textarea rows={3} value={accepted} onChange={event => setAccepted(event.target.value)} /></FormField>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={input.caseSensitive} onChange={event => setInput({ ...input, caseSensitive: event.target.checked })} />{t('assessmentUi.caseSensitive')}</label>
        </>
      )}
      {input.type === 'essay' && <p className="text-xs text-slate-600">{t('assessmentUi.essayHint')}</p>}
      <FormField label={t('assessmentUi.explanation')}><Textarea rows={2} maxLength={4000} value={input.explanation} onChange={event => setInput({ ...input, explanation: event.target.value })} /></FormField>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button>
        <Button size="sm" disabled={!input.prompt.replace(/<[^>]*>/g, '').trim()} onClick={() => void save()}>{t('lmsCommon.save')}</Button>
      </div>
    </LmsDialog>
  );
};

const CopyBankDialog: React.FC<{ courseId: string; bank: Bank; onClose: () => void; onCopied: (count: number) => void }> = ({ courseId, bank, onClose, onCopied }) => {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<{ _id: string; title: string }[]>([]);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { apiRequest<{ data: { _id: string; title: string }[] }>('/courses/mine').then(result => setCourses(result.data.filter(course => course._id !== courseId))).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  const copy = async () => { try { onCopied((await assessmentApi.copyBank(courseId, bank.id, target)).questionCount); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <LmsDialog title={t('assessmentUi.copyBankTitle', { bank: bank.title })} onClose={onClose}>
      <p className="text-xs text-slate-600">{t('assessmentUi.copyBankHint')}</p>
      <FormField label={t('assessmentUi.targetCourse')}><Select value={target} onChange={event => setTarget(event.target.value)} options={[{ value: '', label: '—' }, ...courses.map(course => ({ value: course._id, label: course.title }))]} /></FormField>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={!target} onClick={() => void copy()}>{t('assessmentUi.copy')}</Button></div>
    </LmsDialog>
  );
};
