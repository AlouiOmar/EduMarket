import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, FileText, HelpCircle, Plus, Trash2, Video } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { Select } from '../atoms/Select';
import { Textarea } from '../atoms/Textarea';
import { Switch } from '../atoms/Switch';
import { FormField } from '../molecules/FormField';
import type { CourseLesson, CourseQuiz, CourseQuizQuestion } from '../../types';

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const blankQuestion = (): CourseQuizQuestion => ({ id: newId('q'), question: '', options: ['', ''], correctOptionIndex: 0, explanation: '' });

/**
 * Authoring form for one lesson: metadata, text content and an optional server-graded quiz.
 * Answer keys stay in the course document; the API strips them from learner DTOs.
 */
export const LessonEditor: React.FC<{
  lesson: CourseLesson;
  onChange: (lesson: CourseLesson) => void;
  onDelete: () => void;
  children?: React.ReactNode;
}> = ({ lesson, onChange, onDelete, children }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const update = (changes: Partial<CourseLesson>) => onChange({ ...lesson, ...changes });

  return (
    <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(value => !value)} className="flex items-center gap-2 truncate text-start" aria-expanded={open}>
          {lesson.type === 'video' ? <Video className="w-4 h-4 text-indigo-600 shrink-0" /> : <FileText className="w-4 h-4 text-emerald-600 shrink-0" />}
          <span className="font-semibold text-slate-800 truncate">{lesson.title || t('lessonEditor.untitled')}</span>
          {lesson.quiz && <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-label={t('lessonEditor.hasQuiz')} />}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-slate-400 tabular-nums">{t('lessonEditor.minutes', { count: lesson.durationMinutes })}</span>
          <button type="button" onClick={onDelete} aria-label={t('lessonEditor.deleteLesson')} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {children}
      {open && (
        <div className="space-y-3 pt-3 border-t border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label={t('lessonEditor.title')} required className="sm:col-span-2"><Input value={lesson.title} maxLength={240} onChange={event => update({ title: event.target.value })} /></FormField>
            <FormField label={t('lessonEditor.duration')}><Input type="number" min={0} max={10000} value={lesson.durationMinutes} onChange={event => update({ durationMinutes: Math.max(0, Number(event.target.value) || 0) })} /></FormField>
          </div>
          <FormField label={t('lessonEditor.type')}>
            <Select value={lesson.type} onChange={event => update({ type: event.target.value as CourseLesson['type'] })}
              options={(['video', 'text', 'interactive'] as const).map(value => ({ value, label: t(`lessonEditor.types.${value}`) }))} />
          </FormField>
          {lesson.type !== 'video' && (
            <FormField label={t('lessonEditor.textContent')}><Textarea rows={6} maxLength={20000} value={lesson.textContent || ''} onChange={event => update({ textContent: event.target.value })} /></FormField>
          )}
          <QuizEditor quiz={lesson.quiz} defaultTitle={lesson.title} onChange={quiz => update({ quiz })} />
        </div>
      )}
    </div>
  );
};

/** Optional server-graded quiz of an item; answer keys never reach learners (stripped by the API). */
export const QuizEditor: React.FC<{ quiz?: CourseQuiz; defaultTitle: string; onChange: (quiz: CourseQuiz | undefined) => void }> = ({ quiz, defaultTitle, onChange }) => {
  const { t } = useTranslation();
  const updateQuiz = (changes: Partial<CourseQuiz>) => quiz && onChange({ ...quiz, ...changes });
  const updateQuestion = (questionId: string, changes: Partial<CourseQuizQuestion>) =>
    quiz && updateQuiz({ questions: quiz.questions.map(question => question.id === questionId ? { ...question, ...changes } : question) });
  const toggleQuiz = (enabled: boolean) => onChange(enabled ? { id: newId('quiz'), title: defaultTitle, durationMinutes: 10, passPercentage: 80, questions: [blankQuestion()] } : undefined);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 font-semibold text-slate-800">
        <span>{t('lessonEditor.quizToggle')}</span>
        <Switch checked={!!quiz} onChange={toggleQuiz} ariaLabel={t('lessonEditor.quizToggle')} />
      </div>
      {quiz && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-white p-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label={t('lessonEditor.quizTitle')}><Input value={quiz.title} maxLength={240} onChange={event => updateQuiz({ title: event.target.value })} /></FormField>
            <FormField label={t('lessonEditor.passPercentage')}><Input type="number" min={0} max={100} value={quiz.passPercentage} onChange={event => updateQuiz({ passPercentage: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /></FormField>
            <FormField label={t('lessonEditor.quizDuration')}><Input type="number" min={1} max={600} value={quiz.durationMinutes} onChange={event => updateQuiz({ durationMinutes: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
          </div>
          {quiz.questions.map((question, questionIndex) => (
            <fieldset key={question.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 font-semibold text-slate-700">{t('lessonEditor.questionNumber', { number: questionIndex + 1 })}</legend>
              <Textarea rows={2} maxLength={2000} placeholder={t('lessonEditor.questionPlaceholder')} value={question.question} onChange={event => updateQuestion(question.id, { question: event.target.value })} />
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${question.id}`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(question.id, { correctOptionIndex: optionIndex })} aria-label={t('lessonEditor.markCorrect', { number: optionIndex + 1 })} />
                  <Input value={option} maxLength={500} placeholder={t('lessonEditor.optionPlaceholder', { number: optionIndex + 1 })}
                    onChange={event => updateQuestion(question.id, { options: question.options.map((value, index) => index === optionIndex ? event.target.value : value) })} />
                  {question.options.length > 2 && (
                    <button type="button" aria-label={t('lessonEditor.removeOption')} className="p-1 text-slate-400 hover:text-rose-600"
                      onClick={() => updateQuestion(question.id, {
                        options: question.options.filter((_, index) => index !== optionIndex),
                        correctOptionIndex: (question.correctOptionIndex ?? 0) === optionIndex ? 0 : (question.correctOptionIndex ?? 0) > optionIndex ? (question.correctOptionIndex ?? 0) - 1 : question.correctOptionIndex,
                      })}><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
              <Input value={question.explanation || ''} maxLength={2000} placeholder={t('lessonEditor.explanationPlaceholder')} onChange={event => updateQuestion(question.id, { explanation: event.target.value })} />
              <div className="flex flex-wrap justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={question.options.length >= 10} leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => updateQuestion(question.id, { options: [...question.options, ''] })}>{t('lessonEditor.addOption')}</Button>
                {quiz.questions.length > 1 && <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => updateQuiz({ questions: quiz.questions.filter(item => item.id !== question.id) })}>{t('lessonEditor.removeQuestion')}</Button>}
              </div>
            </fieldset>
          ))}
          <Button type="button" variant="outline" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => updateQuiz({ questions: [...quiz.questions, blankQuestion()] })}>{t('lessonEditor.addQuestion')}</Button>
        </div>
      )}
    </div>
  );
};

/** Client-side checks mirroring the API schema so authors get immediate feedback before saving. */
export function lessonIssues(lesson: CourseLesson): string[] {
  const issues: string[] = [];
  if (!lesson.title.trim()) issues.push('lessonEditor.issueTitle');
  if (lesson.quiz) {
    if (!lesson.quiz.questions.length) issues.push('lessonEditor.issueQuestions');
    for (const question of lesson.quiz.questions) {
      if (!question.question.trim() || question.options.some(option => !option.trim())) { issues.push('lessonEditor.issueIncompleteQuestion'); break; }
    }
  }
  return issues;
}
