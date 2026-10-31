import React, { useState, useEffect } from 'react';
import { lessonQaApi, type LessonQuestionDto } from '../../services/platformServices';
import { useAuth } from '../../contexts/AuthContext';
import { describeApiError } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  PlayCircle, 
  FileText, 
  HelpCircle, 
  CheckCircle2, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  MessageSquare, 
  Send,
  Star,
  Award,
  Sparkles
} from 'lucide-react';
import { courseService } from '../../services/courseService';
import { Course, CourseLesson } from '../../types';
import { CourseLearningLayout } from '../../components/templates/SpecializedLayouts';
import { CourseCurriculum, VideoPlayerContainer, QuizPlayer } from '../../components/organisms/LearningOrganisms';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { Avatar } from '../../components/atoms/Avatar';
import { enrollmentService } from '../../services/enrollmentService';
import { LtiLaunch, ScormPlayer } from '../../components/organisms/IntegrationViews';
import { usesApi } from '../../services/apiClient';
import { LessonBlocksView } from '../../components/organisms/LessonBlocksView';

export const CourseLearningPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const [course, setCourse] = useState<Course | null>(null);
  const [currentLesson, setCurrentLesson] = useState<CourseLesson | null>(null);
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({
    les_1_1: true,
  });
  const [loading, setLoading] = useState(true);
  const [learningError, setLearningError] = useState('');
  const [progressError, setProgressError] = useState('');

  // Active tab on stage: content / qna / resources
  const [activeTab, setActiveTab] = useState<'content' | 'qna' | 'resources'>('content');

  // Q&A: persisted per lesson in API mode; mock mode keeps a local demo thread.
  const [questions, setQuestions] = useState<LessonQuestionDto[]>(usesApi ? [] : [{
    id: 'q_1', body: 'Comment gérez-vous le re-render des composants atomes dans une liste volumineuse ?', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), mine: false,
    author: { name: 'Karim Benali' },
    answers: [{ id: 'a_1', body: 'En utilisant React.memo avec une fonction d’égalité stricte ou en isolant l’état dans un hook local.', staff: true, createdAt: new Date().toISOString(), author: { name: 'Dr. Sarah Mansour' } }],
  }]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [qaError, setQaError] = useState('');
  const { user } = useAuth();
  const isStaff = user?.role === 'teacher' || user?.role === 'institution' || user?.role === 'admin';

  useEffect(() => {
    if (!usesApi || !id || !currentLesson) return;
    let active = true;
    setQaError('');
    lessonQaApi.list(id, currentLesson.id).then(list => { if (active) setQuestions(list); }).catch(cause => { if (active) { setQuestions([]); setQaError(describeApiError(cause)); } });
    return () => { active = false; };
  }, [id, currentLesson?.id]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let completedIds: string[] = [];
        if (usesApi && id) {
          const enrollment = await enrollmentService.getForCourse(id);
          if (!active) return;
          completedIds = enrollment.completedLessonIds;
          setCompletedMap(Object.fromEntries(completedIds.map(lessonId => [lessonId, true])));
        }
        const res = await courseService.getCourseById(id || 'course_react_node');
        if (!active) return;
        if (res.data) {
          setCourse(res.data);
          const openLessons = res.data.chapters.flatMap(chapter => chapter.lessons).filter(lesson => !lesson.locked);
          const firstLesson = openLessons.find(lesson => !usesApi || !completedIds.includes(lesson.id)) || openLessons[0];
          if (firstLesson) setCurrentLesson(firstLesson);
        } else setLearningError(t('learning.courseUnavailable'));
      } catch {
        if (active) setLearningError(t('learning.enrollmentRequired'));
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [id]);

  if (loading) {
    return <div className="p-12 text-center text-white">{t('common.loading')}</div>;
  }

  if (learningError || !course || !currentLesson) {
    return <div className="min-h-screen grid place-items-center bg-slate-950 text-center text-white p-8"><div><p role="alert" className="mb-4">{learningError || t('learning.courseUnavailable')}</p><Link to={id ? `/courses/${id}` : '/courses'} className="text-indigo-300 underline">{t('learning.backToCourse')}</Link></div></div>;
  }

  const courseLessons: CourseLesson[] = course.chapters.flatMap(c => c.lessons);
  // Locked items (sequential modules) are listed but cannot be opened: navigation skips them.
  const allLessons = courseLessons.filter(lesson => !lesson.locked);
  const currentIndex = allLessons.findIndex(l => l.id === currentLesson.id);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  const completedCount = Object.values(completedMap).filter(Boolean).length;
  const progressPercent = courseLessons.length ? Math.min(100, Math.round((completedCount / courseLessons.length) * 100)) : 0;

  const toggleComplete = async () => {
    if (usesApi) {
      if (completedMap[currentLesson.id]) return;
      try {
        const progress = await enrollmentService.completeLesson(course.id, currentLesson.id);
        setCompletedMap(Object.fromEntries(progress.completedLessonIds.map(lessonId => [lessonId, true])));
        setProgressError('');
        // Completing an item can unlock the next one of a sequential module.
        if (course.chapters.some(chapter => chapter.lessons.some(lesson => lesson.locked))) {
          const refreshed = await courseService.getCourseById(course.id).catch(() => null);
          if (refreshed?.data) setCourse(refreshed.data);
        }
      } catch { setProgressError(t('learning.progressSaveFailed')); }
      return;
    }
    setCompletedMap(prev => ({
      ...prev,
      [currentLesson.id]: !prev[currentLesson.id],
    }));
  };

  const handlePostQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = newQuestionText.trim();
    if (!body) return;
    setQaError('');
    try {
      const created = usesApi
        ? await lessonQaApi.ask(course.id, currentLesson.id, body)
        : { id: `q_${Date.now()}`, body, createdAt: new Date().toISOString(), mine: true, author: { name: user?.name || '' }, answers: [] };
      setQuestions(prev => [created, ...prev]);
      setNewQuestionText('');
    } catch (cause) { setQaError(describeApiError(cause)); }
  };

  const handleAnswer = async (questionId: string) => {
    const body = answerDrafts[questionId]?.trim();
    if (!body || !usesApi) return;
    try {
      const updated = await lessonQaApi.answer(course.id, currentLesson.id, questionId, body);
      setQuestions(prev => prev.map(question => question.id === questionId ? updated : question));
      setAnswerDrafts(prev => ({ ...prev, [questionId]: '' }));
    } catch (cause) { setQaError(describeApiError(cause)); }
  };

  return (
    <CourseLearningLayout
      courseTitle={course.title}
      courseId={course.id}
      progressPercent={progressPercent}
      sidebar={
        <div className="p-4 space-y-4">
          <div className="pb-2 border-b border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('learningUi.outline')}
            </h3>
          </div>
          <CourseCurriculum
            chapters={course.chapters}
            activeLessonId={currentLesson.id}
            onSelectLesson={(lesson) => {
              setCurrentLesson(lesson);
              setActiveTab('content');
            }}
          />
        </div>
      }
    >
      <div className="space-y-6">
        
        {/* Lesson Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider block">
              {t('learningUi.currentLesson')}
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
              {currentLesson.title}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant={completedMap[currentLesson.id] ? 'success' : 'outline'}
              size="sm"
              onClick={toggleComplete}
              leftIcon={<CheckCircle2 className="w-4 h-4" />}
            >
              {completedMap[currentLesson.id] ? t('learning.lessonCompleted') : t('learning.markAsCompleted')}
            </Button>
          </div>
        </div>
        {progressError && <p role="alert" className="text-xs text-rose-300">{progressError}</p>}

        {/* Tab Navigation on Stage */}
        <div className="flex border-b border-slate-800 gap-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('content')}
            className={`pb-3 border-b-2 transition-colors ${activeTab === 'content' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t('learningUi.content')}
          </button>
          <button
            onClick={() => setActiveTab('qna')}
            className={`pb-3 border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'qna' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{t('learningUi.qna', { count: questions.length })}</span>
          </button>
          {currentLesson.resources.length > 0 && (
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'resources' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('learningUi.resources', { count: currentLesson.resources.length })}</span>
            </button>
          )}
        </div>

        {/* Tab 1: Lesson Content */}
        {activeTab === 'content' && (
          <div className="space-y-6">
            {currentLesson.type === 'video' && (
              <VideoPlayerContainer
                videoUrl={currentLesson.videoUrl}
                title={currentLesson.title}
                onEnded={() => { void toggleComplete(); }}
              />
            )}

            {currentLesson.type === 'link' && currentLesson.url && (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 space-y-3">
                {currentLesson.description && <p className="text-sm text-slate-300">{currentLesson.description}</p>}
                <a href={currentLesson.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                  {t('blockUi.openLink')}<span className="sr-only"> {t('blockUi.newTab')}</span>
                </a>
                <p className="text-xs text-slate-400 break-all">{currentLesson.url}</p>
              </div>
            )}

            {currentLesson.type === 'lti' && usesApi && id && <LtiLaunch courseId={id} itemId={currentLesson.id} title={currentLesson.title} />}
            {currentLesson.type === 'scorm' && usesApi && id && (
              <ScormPlayer key={currentLesson.id} courseId={id} itemId={currentLesson.id} title={currentLesson.title}
                onProgress={() => { void enrollmentService.getForCourse(id).then(enrollment => setCompletedMap(Object.fromEntries(enrollment.completedLessonIds.map(lessonId => [lessonId, true])))).catch(() => undefined); }} />
            )}

            {currentLesson.blocks && currentLesson.blocks.length > 0 && (
              <div className="rounded-xl bg-white p-6 sm:p-8">
                <LessonBlocksView blocks={currentLesson.blocks} renderQuiz={currentLesson.quiz ? () => (
                  <QuizPlayer
                    quiz={currentLesson.quiz!}
                    onSubmit={usesApi && id ? answers => enrollmentService.submitQuiz(id, currentLesson.id, answers) : undefined}
                    onComplete={(score) => { if (score >= currentLesson.quiz!.passPercentage) setCompletedMap(prev => ({ ...prev, [currentLesson.id]: true })); }}
                  />
                ) : undefined} />
              </div>
            )}

            {!currentLesson.blocks?.length && (currentLesson.type === 'text' || currentLesson.type === 'interactive') && currentLesson.textContent && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 sm:p-8 prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed whitespace-pre-line">
                {currentLesson.textContent}
              </div>
            )}

            {currentLesson.quiz && !currentLesson.blocks?.some(block => block.type === 'quiz') && (
              <div className="pt-2">
                <QuizPlayer
                  quiz={currentLesson.quiz}
                  onSubmit={usesApi && id ? answers => enrollmentService.submitQuiz(id, currentLesson.id, answers) : undefined}
                  onComplete={(score) => {
                    if (score >= currentLesson.quiz!.passPercentage) {
                      if (usesApi) setCompletedMap(prev => ({ ...prev, [currentLesson.id]: true }));
                      else setCompletedMap(prev => ({ ...prev, [currentLesson.id]: true }));
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Q&A */}
        {activeTab === 'qna' && (
          <div className="space-y-6">
            {!isStaff && (
              <form onSubmit={handlePostQuestion} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <span className="text-xs font-semibold text-slate-200 block">{t('learning.askQuestion')}</span>
                <Textarea value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)} placeholder={t('learningUi.questionPlaceholder')} rows={2} maxLength={4000} className="bg-slate-900 border-slate-800 text-white" required />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" size="sm" leftIcon={<Send className="w-3.5 h-3.5 rtl-flip" />}>{t('learning.submitQuestion')}</Button>
                </div>
              </form>
            )}
            {qaError && <p role="alert" className="text-xs text-rose-300">{qaError}</p>}
            {questions.length === 0 && !qaError && <p className="text-xs text-slate-400">{t('learningUi.noQuestions')}</p>}

            <div className="space-y-4">
              {questions.map((q) => (
                <div key={q.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Avatar alt={q.author.name} size="xs" />
                    <span className="font-bold text-slate-200">{q.mine ? t('learningUi.you') : q.author.name}</span>
                    <span className="text-slate-400 text-[11px]">· {formatDateTime(q.createdAt, i18n.language)}</span>
                  </div>
                  <p className="text-slate-300 font-medium whitespace-pre-line">{q.body}</p>
                  {q.answers.length === 0 && <p className="ps-4 border-s-2 border-slate-700 text-slate-400 text-[11px]">{t('learningUi.awaitingAnswer')}</p>}
                  {q.answers.map(answer => (
                    <div key={answer.id} className="ps-4 border-s-2 border-indigo-500 text-slate-400 text-[11px] leading-relaxed pt-1">
                      <span className="font-semibold text-slate-200">{answer.author.name}</span>{answer.staff && <span className="ms-2 rounded bg-indigo-500/20 px-1.5 text-indigo-300">{t('learningUi.teacherBadge')}</span>}
                      <p className="whitespace-pre-line">{answer.body}</p>
                    </div>
                  ))}
                  {usesApi && (
                    <div className="flex gap-2">
                      <Textarea aria-label={t('learningUi.answerPlaceholder')} placeholder={t('learningUi.answerPlaceholder')} rows={1} maxLength={4000} value={answerDrafts[q.id] || ''} onChange={event => setAnswerDrafts(prev => ({ ...prev, [q.id]: event.target.value }))} className="bg-slate-900 border-slate-800 text-white" />
                      <Button variant="outline" size="sm" disabled={!answerDrafts[q.id]?.trim()} onClick={() => void handleAnswer(q.id)}>{t('learningUi.answer')}</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Resources */}
        {activeTab === 'resources' && (
          <div className="space-y-3">
            {currentLesson.resources.map((res) => (
              <div key={res.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-indigo-400" />
                  <div>
                    <h4 className="font-bold text-slate-200">{res.title}</h4>
                    <span className="text-slate-400 text-[11px]">{res.size || t('learningUi.pdfFile')}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void courseService.downloadResource(res).catch(cause => setProgressError(describeApiError(cause)))} leftIcon={<Download className="w-4 h-4" />}>
                  {t('common.download')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Lesson Bottom Navigation Bar */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800">
          {prevLesson ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentLesson(prevLesson);
                setActiveTab('content');
              }}
              leftIcon={<ChevronLeft className="w-4 h-4 rtl-flip" />}
            >
              {t('learningUi.previousLesson')}
            </Button>
          ) : <div />}

          {nextLesson ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setCurrentLesson(nextLesson);
                setActiveTab('content');
              }}
              rightIcon={<ChevronRight className="w-4 h-4 rtl-flip" />}
            >
              {t('learningUi.nextLesson')}
            </Button>
          ) : (
            <Link to="/student/certificates">
              <Button variant="success" size="sm" leftIcon={<Award className="w-4 h-4" />}>
                {t('learningUi.finish')}
              </Button>
            </Link>
          )}
        </div>

      </div>
    </CourseLearningLayout>
  );
};
