import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Award, Calendar, Clock, PlayCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { courseService } from '../../services/courseService';
import { sessionService } from '../../services/sessionService';
import { enrollmentService, type CourseEnrollment } from '../../services/enrollmentService';
import { usesApi } from '../../services/apiClient';
import { Course, TutoringSession, Certificate } from '../../types';
import { StatCard } from '../../components/molecules/StatCard';
import { Button } from '../../components/atoms/Button';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { ErrorAlert } from '../../components/molecules/PageStates';
import { describeApiError } from '../../utils/apiErrors';
import { formatDate, formatPrice } from '../../utils/format';

/** Demo progress used only in mock mode, where no enrollment exists. */
const demoEnrollments = (courses: Course[]): CourseEnrollment[] => courses.slice(0, 3).map((course, index) => {
  const lessons = course.chapters.flatMap(chapter => chapter.lessons);
  const progress = [65, 30, 100][index] ?? 0;
  const completed = lessons.slice(0, Math.round(lessons.length * progress / 100)).map(lesson => lesson.id);
  return { id: `demo-${course.id}`, course, enrolledAt: '', completedLessonIds: completed, completedAt: progress === 100 ? 'demo' : null, progressPercent: progress };
});

export const StudentDashboardPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [catalog, setCatalog] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<TutoringSession[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      courseService.getCourses(),
      usesApi ? enrollmentService.getMine() : Promise.resolve(null),
      sessionService.getSessions(user?.id),
      courseService.getCertificates(user?.id),
    ]).then(([courses, mine, sessionList, certificateList]) => {
      if (!active) return;
      setCatalog(courses.data);
      setEnrollments(mine ?? demoEnrollments(courses.data));
      setSessions(sessionList.data);
      setCertificates(certificateList.data);
    }).catch(cause => { if (active) setError(describeApiError(cause)); });
    return () => { active = false; };
  }, [user?.id]);

  const today = new Date().toISOString().slice(0, 10);
  const upcomingSessions = sessions.filter(session => ['pending', 'confirmed'].includes(session.status) && session.date >= today);
  const inProgress = enrollments.filter(item => !item.completedAt);
  const completedCount = enrollments.length - inProgress.length;
  // Learning time is the duration of lessons actually completed (demo value in mock mode).
  const learningHours = usesApi
    ? Math.round(enrollments.reduce((sum, item) => sum + item.course.chapters.flatMap(chapter => chapter.lessons)
      .filter(lesson => item.completedLessonIds.includes(lesson.id)).reduce((minutes, lesson) => minutes + (lesson.durationMinutes || 0), 0), 0) / 6) / 10
    : 42;
  // API enrollments are sorted by last access: the first unfinished one is the course to resume.
  const resume = inProgress[0];
  const nextLesson = useMemo(() => resume?.course.chapters.flatMap(chapter => chapter.lessons).find(lesson => !resume.completedLessonIds.includes(lesson.id)), [resume]);
  const enrolledIds = new Set(enrollments.map(item => item.course.id));
  const recommendations = catalog.filter(course => !enrolledIds.has(course.id)).slice(0, 2);

  return (
    <div className="space-y-8">
      <ErrorAlert message={error} />
      <div className="bg-gradient-to-r from-indigo-900 to-indigo-950 rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <span className="text-xs uppercase tracking-wider text-indigo-300 font-bold block mb-1">{t('studentUi.space')}</span>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{t('studentUi.welcome', { name: user?.name || '' })}</h1>
          <p className="text-xs sm:text-sm text-indigo-200 mt-2 max-w-xl leading-relaxed">
            {t('studentUi.summary', { sessions: upcomingSessions.length, courses: inProgress.length })}
          </p>
        </div>
        {resume && (
          <Link to={`/learning/${resume.course.id}`}>
            <Button variant="primary" size="md" className="bg-white text-indigo-900 hover:bg-indigo-50 border-none shrink-0" leftIcon={<PlayCircle className="w-4 h-4 text-indigo-600" />}>
              {t('studentUi.resumeCourse')}
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('studentUi.enrolledCourses')} value={enrollments.length} icon={<BookOpen className="w-5 h-5" />} hint={t('studentUi.enrolledHint', { inProgress: inProgress.length, completed: completedCount })} />
        <StatCard label={t('studentUi.learningHours')} value={t('studentUi.hours', { hours: learningHours })} icon={<Clock className="w-5 h-5" />} hint={t('studentUi.learningHoursHint')} />
        <StatCard label={t('studentUi.certificates')} value={certificates.length} icon={<Award className="w-5 h-5" />} hint={t('studentUi.certificatesHint')} />
        <StatCard label={t('studentUi.mentoring')} value={upcomingSessions.length} icon={<Calendar className="w-5 h-5" />} hint={t('studentUi.mentoringHint', { count: upcomingSessions.filter(session => session.status === 'confirmed').length })} />
      </div>

      {resume ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">{t('studentUi.resumeTitle')}</h2>
            {nextLesson && <span className="text-xs font-semibold text-indigo-600">{t('studentUi.nextLesson')}</span>}
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {resume.course.coverImage && <img src={resume.course.coverImage} alt={resume.course.title} referrerPolicy="no-referrer" className="w-full sm:w-48 aspect-video rounded-lg object-cover" />}
            <div className="flex-1 space-y-2 w-full">
              <h3 className="text-base font-bold text-slate-900">{resume.course.title}</h3>
              {nextLesson && <p className="text-xs text-slate-500">{nextLesson.title}</p>}
              <div className="w-full max-w-md"><ProgressBar percent={resume.progressPercent} showLabel /></div>
            </div>
            <Link to={`/learning/${resume.course.id}`} className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="md" className="w-full">{t('studentUi.continue')}</Button>
            </Link>
          </div>
        </div>
      ) : enrollments.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-sm text-slate-600">{t('studentUi.noEnrollment')}</p>
          <Link to="/courses"><Button variant="primary" size="sm">{t('studentUi.browseCatalog')}</Button></Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">{t('studentUi.upcomingSessions')}</h3>
            <Link to="/student/sessions" className="text-xs text-indigo-600 font-semibold hover:underline">{t('studentUi.manageSessions')}</Link>
          </div>
          <div className="space-y-3">
            {upcomingSessions.length === 0 && <p className="p-4 bg-white border border-slate-200 rounded-xl text-xs text-slate-500">{t('studentUi.noUpcomingSessions')}</p>}
            {upcomingSessions.map(session => (
              <div key={session.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-indigo-600 block mb-1">
                    {t('studentUi.sessionWhen', { mode: session.type === 'online' ? t('teacherUi.jitsiMode') : t('teacherUi.inPerson'), date: formatDate(session.date, i18n.language), time: session.startTime })}
                  </span>
                  <h4 className="text-xs font-bold text-slate-800">{session.subject}</h4>
                  <span className="text-xs text-slate-500">{t('studentUi.with', { name: session.teacherName })}</span>
                </div>
                <Link to="/student/sessions"><Button variant="outline" size="sm">{t('studentUi.details')}</Button></Link>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">{t('studentUi.recommendations')}</h3>
            <Link to="/courses" className="text-xs text-indigo-600 font-semibold hover:underline">{t('studentUi.browseCatalog')}</Link>
          </div>
          <div className="space-y-3">
            {recommendations.map(course => (
              <div key={course.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between gap-4">
                <div className="truncate">
                  <span className="text-[11px] text-slate-400 font-medium">{course.category}</span>
                  <h4 className="text-xs font-bold text-slate-800 truncate">{course.title}</h4>
                  <span className="text-xs text-indigo-600 font-semibold">{course.isFree ? t('chromeUi.free') : formatPrice(course.price, 'eur', i18n.language)}</span>
                </div>
                <Link to={`/courses/${course.id}`} className="shrink-0"><Button variant="outline" size="sm">{t('studentUi.discover')}</Button></Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
