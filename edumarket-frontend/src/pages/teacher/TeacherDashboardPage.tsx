import React, { useEffect, useState } from 'react';
import { describeApiError } from '../../utils/apiErrors';
import { formatMoney, formatPrice } from '../../utils/format';
import { paymentApi } from '../../services/platformServices';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  BookOpen, 
  DollarSign, 
  Users, 
  Star, 
  Plus, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight,
  TrendingUp,
  FileCheck,
  Edit,
  Trash2
} from 'lucide-react';
import { mockCourses, mockTutoringSessions, mockTransactions } from '../../mocks/mockData';
import { StatCard } from '../../components/molecules/StatCard';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { DataTable } from '../../components/organisms/DataTable';
import { institutionService, type InstitutionInvite, type MyAffiliation } from '../../services/institutionService';
import { usesApi } from '../../services/apiClient';
import { courseService } from '../../services/courseService';
import { sessionService } from '../../services/sessionService';
import type { Course, TutoringSession } from '../../types';

export const TeacherAffiliationsPage: React.FC = () => {
  const { t } = useTranslation();
  const [invitations, setInvitations] = useState<InstitutionInvite[]>([]);
  const [affiliation, setAffiliation] = useState<MyAffiliation | null>(null);
  const [error, setError] = useState('');
  const refresh = () => Promise.all([institutionService.myInvitations(), institutionService.myAffiliation()]).then(([items, current]) => { setInvitations(items); setAffiliation(current); });
  useEffect(() => { if (usesApi) refresh().catch(cause => setError(describeApiError(cause))); }, []);
  const leave = async () => {
    try { await institutionService.leaveAffiliation(); await refresh(); setError(''); }
    catch (cause) { setError(describeApiError(cause)); }
  };
  const respond = async (id: string, decision: 'accepted' | 'rejected') => {
    try { await institutionService.respond(id, decision); await refresh(); setError(''); }
    catch (cause) { setError(describeApiError(cause)); }
  };
  return <section className="max-w-3xl space-y-6"><div><h1 className="text-xl font-bold text-slate-900">{t('affiliation.invitationsTitle')}</h1><p className="mt-1 text-sm text-slate-500">{t('affiliation.invitationsSubtitle')}</p></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {affiliation && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900"><h2 className="font-semibold">{t('membersUi.currentAffiliation', { name: affiliation.institution.name })}</h2><p className="mt-1 text-xs">{t('membersUi.roleInfo', { role: t(`membersUi.roles.${affiliation.internalRole}`) })} · {t('affiliation.shareInfo', { percent: affiliation.revenueSharePercent })}</p><p className="mt-1 text-xs text-indigo-700">{t(`membersUi.roleRights.${affiliation.internalRole}`)}</p></div>}
    {invitations.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">{t('teacherDashUi.noInvitations')}</p>}
    {invitations.map(invite => <article key={invite.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5"><div><h2 className="font-semibold text-slate-900">{invite.institution?.name || 'Institution'}</h2><p className="text-xs text-slate-500">{invite.institution?.email} · {new Date(invite.createdAt).toLocaleDateString()} · {t('affiliation.shareInfo', { percent: invite.revenueSharePercent || 0 })}</p></div>{invite.status === 'pending' ? <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => respond(invite.id, 'accepted')}>{t('affiliation.accept')}</Button><Button size="sm" variant="outline" onClick={() => respond(invite.id, 'rejected')}>{t('affiliation.decline')}</Button></div> : <div className="flex items-center gap-2"><Badge size="sm" variant={invite.status === 'accepted' ? 'success' : 'default'}>{t(`affiliation.statuses.${invite.status}`)}</Badge>{invite.status === 'accepted' && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => void leave()}>{t('affiliation.leave')}</Button>}</div>}</article>)}
    {!usesApi && <p className="text-xs text-slate-500">{t('teacherDashUi.apiRequired')}</p>}
  </section>;
};

export const TeacherDashboardPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [earned, setEarned] = useState<number | null>(null);
  useEffect(() => { if (usesApi) paymentApi.earnings().then(result => setEarned(result.balance.earned)).catch(() => setEarned(null)); }, []);
  const [courses, setCourses] = useState<Course[]>(usesApi ? [] : mockCourses);
  const [sessions, setSessions] = useState<TutoringSession[]>(usesApi ? [] : mockTutoringSessions);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    Promise.all([courseService.getMyCourses(), sessionService.getSessions()])
      .then(([courseResult, sessionResult]) => {
        if (!active) return;
        setCourses(courseResult.data);
        setSessions(sessionResult.data.filter(session => session.status !== 'available'));
      })
      .catch(() => { if (active) setError(t('teacherDashUi.loadError')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const studentCount = courses.reduce((total, course) => total + course.studentsCount, 0);
  const totalReviews = courses.reduce((total, course) => total + course.ratingCount, 0);
  const averageRating = totalReviews
    ? (courses.reduce((total, course) => total + course.rating * course.ratingCount, 0) / totalReviews).toFixed(1)
    : '—';
  const updateSession = async (id: string, status: 'confirmed' | 'rejected') => {
    try {
      const result = await sessionService.updateSessionStatus(id, status);
      setSessions(current => current.map(session => session.id === id ? result.data : session));
      setError('');
    } catch (cause) { setError(usesApi ? describeApiError(cause) : t('teacherDashUi.sessionError')); }
  };

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacher.dashboardTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('teacherDashUi.subtitle')}</p>
        </div>
        <Link to="/teacher/courses/create">
          <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
            {t('teacher.createCourse')}
          </Button>
        </Link>
      </div>

      {loading && <p role="status" className="text-sm text-slate-500">{t('teacherDashUi.loading')}</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('teacher.totalRevenue')}
          value={usesApi ? (earned === null ? '—' : formatMoney(earned, 'eur', i18n.language)) : '4 850 €'}
          icon={<DollarSign className="w-5 h-5" />}
          {...(!usesApi ? { trend: 'up' as const, change: t('teacherDashUi.demoTrend') } : {})}
          hint={usesApi ? t('teacherDashUi.netEarnings') : undefined}
        />
        <StatCard
          label={t('teacher.activeStudents')}
          value={studentCount.toLocaleString()}
          icon={<Users className="w-5 h-5" />}
          hint={t('teacherDashUi.acrossCourses')}
        />
        <StatCard
          label={t('teacher.totalCourses')}
          value={courses.filter(course => course.status === 'published').length}
          icon={<BookOpen className="w-5 h-5" />}
          hint={t('teacherDashUi.publishedActive')}
        />
        <StatCard
          label={t('teacher.averageRating')}
          value={totalReviews ? `${averageRating} / 5` : '—'}
          icon={<Star className="w-5 h-5" />}
          hint={totalReviews ? t('teacherDashUi.basedOn', { count: totalReviews }) : undefined}
        />
      </div>

      {/* Courses summary table */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{t('teacherDashUi.activeCourses', { count: courses.length })}</h2>
          <Link to="/teacher/courses" className="text-xs font-semibold text-indigo-600 hover:underline">
            {t('teacherDashUi.courseManager')}
          </Link>
        </div>

        <div className="divide-y divide-slate-100">
          {!loading && courses.length === 0 && <p className="py-4 text-sm text-slate-500">{t('teacherDashUi.noCourses')}</p>}
          {courses.map(course => (
            <div key={course.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img
                  src={course.coverImage || undefined}
                  alt={course.title}
                  referrerPolicy="no-referrer"
                  className="w-16 h-10 object-cover rounded-lg"
                />
                <div>
                  <h3 className="text-xs font-bold text-slate-800 line-clamp-1">{course.title}</h3>
                  <span className="text-[11px] text-slate-400">{t('teacherDashUi.courseLine', { count: course.studentsCount, price: formatPrice(course.price, 'eur', i18n.language) })}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={course.status === 'published' || !usesApi ? 'success' : 'warning'} size="sm">{usesApi ? t(`courseStatus.${course.status}`, { defaultValue: course.status }) : t('teacherUi.published')}</Badge>
                <Link to={`/teacher/courses/${course.id}/edit`}>
                  <Button variant="outline" size="sm" leftIcon={<Edit className="w-3.5 h-3.5" />}>
                    {t('teacherDashUi.edit')}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tutoring Requests */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{t('teacherDashUi.mentoringRequests')}</h2>
          <Link to="/teacher/tutoring" className="text-xs font-semibold text-indigo-600 hover:underline">
            {t('teacherDashUi.manageAvailability')}
          </Link>
        </div>

        <div className="space-y-3">
          {!loading && sessions.length === 0 && <p className="text-sm text-slate-500">{t('teacherDashUi.noRequests')}</p>}
          {sessions.map(s => (
            <div key={s.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
              <div>
                <span className="font-bold text-slate-900 block">{s.studentName} — {s.subject}</span>
                <span className="text-slate-500">{t('teacherDashUi.sessionLine', { date: s.date, time: s.startTime, mode: s.type === 'online' ? t('teacherUi.jitsiMode') : t('teacherUi.inPerson') })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={s.status === 'confirmed' ? 'success' : 'warning'} size="sm">
                  {s.status === 'confirmed' ? t('teacherUi.confirmed') : t('teacherDashUi.pending')}
                </Badge>
                {s.status === 'pending' && (
                <Button variant="primary" size="sm" onClick={usesApi ? () => updateSession(s.id, 'confirmed') : undefined}>
                    {t('teacherUi.accept')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
