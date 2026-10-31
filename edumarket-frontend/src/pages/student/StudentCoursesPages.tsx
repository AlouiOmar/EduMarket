import React, { useEffect, useState } from 'react';
import { Badge } from '../../components/atoms/Badge';
import { formatDate } from '../../utils/format';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, CheckCircle, Heart, Clock, PlayCircle } from 'lucide-react';
import { mockCourses } from '../../mocks/mockData';
import { CourseCard } from '../../components/organisms/CourseCard';
import { Button } from '../../components/atoms/Button';
import { enrollmentService, CourseEnrollment } from '../../services/enrollmentService';
import { usesApi } from '../../services/apiClient';
import { EmptyState } from '../../components/molecules/EmptyState';
import { favoriteService } from '../../services/favoriteService';
import { Course } from '../../types';

export const StudentCoursesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'all' | 'in_progress' | 'completed' | 'favorites'>('all');
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [favorites, setFavorites] = useState<Course[]>([]);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    Promise.all([enrollmentService.getMine(), favoriteService.list()]).then(([items, favoriteItems]) => { if (active) { setEnrollments(items); setFavorites(favoriteItems); } })
      .catch(() => { if (active) setError(t('auth.apiUnavailable')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const allCourses = usesApi ? enrollments.map(item => item.course) : mockCourses;
  const inProgressCourses = usesApi ? enrollments.filter(item => !item.completedAt).map(item => item.course) : [mockCourses[0]];
  const completedCourses = usesApi ? enrollments.filter(item => !!item.completedAt).map(item => item.course) : [mockCourses[1]];
  const favoriteCourses = usesApi ? favorites : [mockCourses[0], mockCourses[2]];
  let displayCourses: typeof mockCourses = allCourses;
  if (tab === 'in_progress') displayCourses = inProgressCourses;
  else if (tab === 'completed') displayCourses = completedCourses;
  else if (tab === 'favorites') displayCourses = favoriteCourses;
  // Subscription access ends with the period; the badge tells learners when (or that) it lapsed.
  const accessLabel = (courseId: string) => {
    const enrollment = enrollments.find(item => item.course.id === courseId);
    if (enrollment?.accessType !== 'subscription' || !enrollment.accessExpiresAt) return null;
    const expired = new Date(enrollment.accessExpiresAt).getTime() <= Date.now();
    return <Badge variant={expired ? 'danger' : 'info'} size="sm">{expired ? t('subscriptionUi.accessExpired') : t('subscriptionUi.accessExpires', { date: formatDate(enrollment.accessExpiresAt, i18n.language) })}</Badge>;
  };
  const progressFor = (courseId: string) => usesApi ? enrollments.find(item => item.course.id === courseId)?.progressPercent || 0 : courseId === 'course_react_node' ? 65 : 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('studentUi.myCoursesTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('studentUi.myCoursesSubtitle')}</p>
        </div>
        <Link to="/courses">
          <Button variant="outline" size="sm">
            {t('studentUi.discoverMore')}
          </Button>
        </Link>
      </div>

      {loading && <p className="text-xs text-slate-500" role="status">{t('common.loading')}</p>}
      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}

      {/* Segmented Tabs */}
      <div className="flex border-b border-slate-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setTab('all')}
          className={`pb-3 border-b-2 transition-colors ${tab === 'all' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('studentUi.tabAll', { count: allCourses.length })}
        </button>
        <button
          onClick={() => setTab('in_progress')}
          className={`pb-3 border-b-2 transition-colors ${tab === 'in_progress' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('studentUi.tabInProgress', { count: inProgressCourses.length })}
        </button>
        <button
          onClick={() => setTab('completed')}
          className={`pb-3 border-b-2 transition-colors ${tab === 'completed' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('studentUi.tabCompleted', { count: completedCourses.length })}
        </button>
        <button
          onClick={() => setTab('favorites')}
          className={`pb-3 border-b-2 transition-colors ${tab === 'favorites' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('studentUi.tabFavorites', { count: favoriteCourses.length })}
        </button>
      </div>

      {displayCourses.length ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayCourses.map(course => <div key={course.id} className="space-y-1.5">{usesApi && accessLabel(course.id)}<CourseCard course={course} progressPercent={tab === 'favorites' ? undefined : progressFor(course.id)} isFavorite={tab === 'favorites' || favorites.some(item => item.id === course.id)} onFavoriteChange={async (_courseId, favorited) => { if (usesApi) setFavorites(await favoriteService.list()); else if (!favorited) setFavorites(current => current.filter(item => item.id !== course.id)); }} /></div>)}
      </div> : <EmptyState title={t('common.emptyTitle')} description={t('common.emptyDescription')} />}
    </div>
  );
};

export const LearningHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const [apiHistory, setApiHistory] = useState<Awaited<ReturnType<typeof enrollmentService.getHistory>>>([]);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    enrollmentService.getHistory().then(items => { if (active) setApiHistory(items); })
      .catch(() => { if (active) setError(t('auth.apiUnavailable')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const demoHistory = [
    { id: 'demo-history-1', date: "Aujourd'hui à 15:40", lesson: "Mise en place de l'Atomic Design", course: 'Architectures Modernes React 19', result: '24 minutes' },
    { id: 'demo-history-2', date: 'Hier à 11:20', lesson: 'Introduction et principes SOLID en Frontend', course: 'Architectures Modernes React 19', result: '18 minutes' },
    { id: 'demo-history-3', date: '10 octobre 2026', lesson: 'Architecture Attention is All You Need', course: 'Ingénierie IA & Systèmes d’Agents', result: '45 minutes' },
  ];
  const entries = usesApi ? apiHistory.map(item => ({
    id: item.id,
    date: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)),
    lesson: item.type === 'quiz_submitted' ? `${item.lessonTitle} · ${t('learning.quizAttempt')}` : item.lessonTitle,
    course: item.courseTitle,
    result: item.type === 'quiz_submitted' ? `${item.score}%` : t('learning.lessonCompleted'),
  })) : demoHistory;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('learning.historyTitle')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('learning.historyDescription')}</p>
      </div>
      {loading && <p role="status" className="text-xs text-slate-500">{t('common.loading')}</p>}
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {entries.length > 0 ? <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
        {entries.map(item => (
          <div key={item.id} className="p-4 flex items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-[11px] text-indigo-600 font-semibold block">{item.course}</span>
              <h2 className="font-bold text-slate-800 mt-0.5">{item.lesson}</h2>
              <time className="text-slate-400 text-[11px]">{item.date}</time>
            </div>
            <span className="text-slate-500 font-medium tabular-nums">{item.result}</span>
          </div>
        ))}
      </div> : !loading && !error && <EmptyState title={t('common.emptyTitle')} description={t('common.emptyDescription')} />}
    </div>
  );
};
