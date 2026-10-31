import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  PlayCircle, 
  FileText, 
  HelpCircle, 
  CheckCircle2, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw,
  Sparkles, Link2, Lock } from 'lucide-react';
import { apiAssetUrl } from '../../services/apiClient';
import { CourseChapter, CourseLesson, CourseQuiz } from '../../types';
import { QuizGradeResult } from '../../services/enrollmentService';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';

export const CourseCurriculum: React.FC<{
  chapters: CourseChapter[];
  activeLessonId?: string;
  onSelectLesson: (lesson: CourseLesson) => void;
}> = ({ chapters, activeLessonId, onSelectLesson }) => {
  const { t } = useTranslation();
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({
    [chapters[0]?.id || '']: true,
  });

  const toggleChapter = (id: string) => {
    setOpenChapters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getLessonIcon = (type: CourseLesson['type']) => {
    switch (type) {
      case 'video':
        return <PlayCircle className="w-4 h-4 text-indigo-400 shrink-0" />;
      case 'text':
        return <FileText className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'interactive':
        return <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'link':
        return <Link2 className="w-4 h-4 text-sky-400 shrink-0" />;
    }
  };

  return (
    <div className="space-y-2">
      {chapters.map((chapter) => {
        const isOpen = openChapters[chapter.id];
        return (
          <div key={chapter.id} className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/60">
            <button
              onClick={() => toggleChapter(chapter.id)}
              aria-expanded={!!isOpen}
              className="w-full px-4 py-3 flex items-center justify-between text-start text-xs font-semibold text-slate-300 hover:bg-slate-800/60 transition-colors"
            >
              <span className="truncate pe-2">{chapter.title}</span>
              <div className="flex items-center gap-2 shrink-0 text-slate-400">
                <span className="text-[11px] tabular-nums">{chapter.lessons.length} leçons</span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {isOpen && (
              <div className="divide-y divide-slate-800/80 bg-slate-950/40">
                {chapter.lessons.map((lesson) => {
                  const isActive = lesson.id === activeLessonId;
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => onSelectLesson(lesson)}
                      disabled={lesson.locked}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full px-4 py-3 flex items-center justify-between text-start text-xs transition-colors ${
                        isActive
                          ? 'bg-indigo-950/80 text-white font-bold border-s-2 border-indigo-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate pe-2">
                        {lesson.locked ? (
                          <Lock className="w-4 h-4 text-slate-400 shrink-0" aria-label={t('blockUi.lockedLesson')} />
                        ) : lesson.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          getLessonIcon(lesson.type)
                        )}
                        <span className="truncate">{lesson.title}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {lesson.durationMinutes} min
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const VideoPlayerContainer: React.FC<{
  videoUrl?: string;
  title: string;
  onEnded?: () => void;
}> = ({ videoUrl, title, onEnded }) => {
  const { t } = useTranslation();
  return (
    <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black shadow-lg border border-slate-800">
      {videoUrl ? (
        <video
          src={apiAssetUrl(videoUrl)}
          crossOrigin="use-credentials"
          controls
          className="w-full h-full object-contain"
          onEnded={onEnded}
          poster="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&auto=format&fit=crop&q=80"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center">
          <PlayCircle className="w-12 h-12 mb-2 text-slate-600" />
          <p className="text-sm">{t('chromeUi.videoUnavailable')}</p>
        </div>
      )}
    </div>
  );
};

export const QuizPlayer: React.FC<{
  quiz: CourseQuiz;
  onComplete: (scorePercentage: number) => void;
  onSubmit?: (answers: Array<{ questionId: string; selectedOptionIndex: number }>) => Promise<QuizGradeResult>;
}> = ({ quiz, onComplete, onSubmit }) => {
  const { t } = useTranslation();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [serverGrade, setServerGrade] = useState<QuizGradeResult | null>(null);

  const currentQ = quiz.questions[currentIdx];

  const handleSelectOption = (optionIndex: number) => {
    if (submitted) return;
    setSelectedAnswers(prev => ({ ...prev, [currentIdx]: optionIndex }));
  };

  const calculateScore = () => {
    let correctCount = 0;
    quiz.questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctOptionIndex) {
        correctCount++;
      }
    });
    return Math.round((correctCount / quiz.questions.length) * 100);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmissionError('');
    try {
      if (onSubmit) {
        const answers = Object.entries(selectedAnswers).map(([index, selectedOptionIndex]) => ({
          questionId: quiz.questions[Number(index)].id, selectedOptionIndex,
        }));
        const grade = await onSubmit(answers);
        setServerGrade(grade);
        onComplete(grade.score);
      } else onComplete(calculateScore());
      setSubmitted(true);
    } catch {
      setSubmissionError(t('learning.quizSubmitFailed'));
    } finally { setSubmitting(false); }
  };

  const handleRestart = () => {
    setSelectedAnswers({});
    setCurrentIdx(0);
    setSubmitted(false);
    setServerGrade(null);
    setSubmissionError('');
  };

  const scorePercentage = serverGrade?.score ?? calculateScore();
  const isPassed = serverGrade?.passed ?? scorePercentage >= quiz.passPercentage;

  if (submitted) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 text-center text-white">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${
          isPassed ? 'bg-emerald-950 text-emerald-400 border border-emerald-500' : 'bg-rose-950 text-rose-400 border border-rose-500'
        }`}>
          {isPassed ? <Sparkles className="w-7 h-7" /> : <RotateCcw className="w-7 h-7" />}
        </div>

        <h3 className="text-lg font-bold mb-2">
          {isPassed ? t('learning.quizPassed') : t('learning.quizFailed')}
        </h3>

        <div className="text-3xl font-extrabold my-4 tabular-nums">
          {scorePercentage}%
        </div>

        <p className="text-xs text-slate-400 mb-6">
          Seuil de réussite exigé : {quiz.passPercentage}%
        </p>

        {/* Answer Breakdown with Explanations */}
        <div className="space-y-4 text-start mb-6 max-h-72 overflow-y-auto pe-2">
          {quiz.questions.map((q, idx) => {
            const result = serverGrade?.results.find(answer => answer.questionId === q.id);
            const correctOptionIndex = result?.correctOptionIndex ?? q.correctOptionIndex;
            const isCorrect = selectedAnswers[idx] === correctOptionIndex;
            return (
              <div key={q.id} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <div className="font-semibold text-slate-200 mb-1.5">
                  {idx + 1}. {q.question}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={isCorrect ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {isCorrect ? t('chromeUi.correctAnswer') : t('chromeUi.wrongAnswer')}
                  </span>
                  <span className="text-slate-400">
                    {t('chromeUi.yourChoice', { choice: q.options[selectedAnswers[idx]] || t('chromeUi.notAnswered') })}
                  </span>
                </div>
                <p className="text-slate-400 italic text-[11px] border-t border-slate-800/80 pt-1 mt-1">
                  💡 {result?.explanation ?? q.explanation}
                </p>
              </div>
            );
          })}
        </div>

        <Button variant="outline" size="sm" onClick={handleRestart} leftIcon={<RotateCcw className="w-4 h-4" />}>
          {t('learning.retryQuiz')}
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-white">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
        <div>
          <span className="text-xs text-indigo-400 font-semibold">{quiz.title}</span>
          <h3 className="text-sm font-bold text-slate-200 mt-0.5">
            Question {currentIdx + 1} sur {quiz.questions.length}
          </h3>
        </div>
        <Badge variant="purple" size="sm">
          {quiz.durationMinutes} min
        </Badge>
      </div>

      <div className="mb-6">
        <p className="text-sm font-semibold text-slate-100 mb-4 leading-relaxed">
          {currentQ.question}
        </p>

        <div className="space-y-2.5">
          {currentQ.options.map((option, optIdx) => {
            const isSelected = selectedAnswers[currentIdx] === optIdx;
            return (
              <button
                key={optIdx}
                onClick={() => handleSelectOption(optIdx)}
                className={`w-full p-3.5 rounded-lg border text-start text-xs font-medium transition-colors flex items-center justify-between ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-950/60 text-white'
                    : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <span>{option}</span>
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  isSelected ? 'border-indigo-400 bg-indigo-600' : 'border-slate-700'
                }`}>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <Button
          variant="outline"
          size="sm"
          disabled={currentIdx === 0}
          onClick={() => setCurrentIdx(prev => prev - 1)}
        >
          {t('common.previous')}
        </Button>

        {currentIdx < quiz.questions.length - 1 ? (
          <Button
            variant="primary"
            size="sm"
            disabled={selectedAnswers[currentIdx] === undefined}
            onClick={() => setCurrentIdx(prev => prev + 1)}
          >
            {t('common.next')}
          </Button>
        ) : (
          <Button
            variant="success"
            size="sm"
            disabled={selectedAnswers[currentIdx] === undefined || submitting}
            onClick={handleSubmit}
          >
            {submitting ? t('common.loading') : t('learning.submitQuiz')}
          </Button>
        )}
      </div>
      {submissionError && <p role="alert" className="mt-3 text-xs text-rose-300">{submissionError}</p>}
    </div>
  );
};
