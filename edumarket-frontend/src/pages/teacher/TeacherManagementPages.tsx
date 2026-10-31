import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  Edit, 
  Trash2, 
  DollarSign, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  ExternalLink,
  ShieldCheck,
  Video,
  LayoutList,
} from 'lucide-react';
import { mockCourses, mockTransactions } from '../../mocks/mockData';
import { sessionService } from '../../services/sessionService';
import { usesApi } from '../../services/apiClient';
import { SellerRevenuePage } from '../shared/SellerRevenuePage';
import { courseWorkflowApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatPrice } from '../../utils/format';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';
import { ApiTeacherAssignmentsPage } from './ApiTeacherAssignmentsPage';
import { Course } from '../../types';
import { courseService } from '../../services/courseService';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { StatCard } from '../../components/molecules/StatCard';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';

export const TeacherCoursesListPage: React.FC = () => {
  const { role, user } = useAuth();
  const [courses, setCourses] = useState<Course[]>(usesApi ? [] : mockCourses);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState(false);
  const { t, i18n } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const [submittingId, setSubmittingId] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const submitForReview = async (courseId: string) => {
    setSubmittingId(courseId); setWorkflowMessage(null);
    try {
      await courseWorkflowApi.submitForReview(courseId);
      setCourses(prev => prev.map(course => course.id === courseId ? { ...course, status: 'pending_review' } : course));
      setWorkflowMessage({ tone: 'success', text: t('courseStatus.submitted') });
    } catch (cause) { setWorkflowMessage({ tone: 'error', text: apiErrorMessage(t, cause) }); }
    finally { setSubmittingId(''); }
  };

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    courseService.getMyCourses().then(result => {
      if (active) setCourses(result.data);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherUi.coursesTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('teacherUi.coursesSubtitle')}</p>
        </div>
        {(!usesApi || role === 'admin' || (role === 'teacher' && user?.verified)) && <Link to="/teacher/courses/create">
          <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
            {t('teacherUi.createCourse')}
          </Button>
        </Link>}
      </div>

      {workflowMessage && <p role={workflowMessage.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${workflowMessage.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{workflowMessage.text}</p>}
      {loading && <p className="p-6 text-sm text-slate-500" role="status">{t('teacherUi.loadingCourses')}</p>}
      {error && <p className="p-6 text-sm text-rose-700" role="alert">{t('teacherUi.loadCoursesError')}</p>}
      {!loading && !error && courses.length === 0 && <p className="p-6 text-sm text-slate-500">{t('teacherUi.noCourses')}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs divide-y divide-slate-100">
        {courses.map(course => (
          <div key={course.id} className="p-4 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src={course.coverImage || undefined}
                alt={course.title}
                referrerPolicy="no-referrer"
                className="w-20 h-14 object-cover rounded-lg shrink-0"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">{course.title}</h3>
                  <Badge variant={course.status === 'published' ? 'success' : course.status === 'suspended' || course.status === 'rejected' ? 'danger' : 'warning'} size="sm">{usesApi ? t(`courseStatus.${course.status}`, { defaultValue: course.status }) : t('teacherUi.published')}</Badge>
                </div>
                <span className="text-xs text-slate-500 block mt-1">
                  {t('teacherUi.courseMeta', { category: categoryLabel(course.category), count: course.studentsCount, price: formatPrice(course.price, 'eur', i18n.language) })}
                </span>
                {usesApi && course.review?.note && (course.status === 'rejected' || course.status === 'suspended') && (
                  <span className="text-xs text-rose-700 block mt-1">{t('courseStatus.moderationNote', { note: course.review.note })}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(course.status === 'published' || !usesApi) && <Link to={`/courses/${course.id}`}>
                <Button variant="outline" size="sm">
                  {t('teacherUi.viewLive')}
                </Button>
              </Link>}
              {usesApi && role !== 'admin' && (course.status === 'draft' || course.status === 'rejected') && (
                <Button variant="success" size="sm" isLoading={submittingId === course.id} onClick={() => void submitForReview(course.id)}>
                  {t('courseStatus.submitForReview')}
                </Button>
              )}
              {usesApi && (
                <Link to={`/teacher/courses/${course.id}/content`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
                  <LayoutList className="w-3.5 h-3.5" aria-hidden />{t('courseContentUi.pageTitle')}
                </Link>
              )}
              <Link to={`/teacher/courses/${course.id}/edit`}>
                <Button variant="primary" size="sm" leftIcon={<Edit className="w-3.5 h-3.5" />}>
                  {t('teacherUi.edit')}
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TeacherTutoringPage: React.FC = () => {
  const [sessions, setSessions] = useState<import('../../types').TutoringSession[]>([]);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [price, setPrice] = useState('45');
  const [type, setType] = useState<'online' | 'in_person'>('online');
  const [venue, setVenue] = useState('');
  const [subject, setSubject] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?session=` from the calendar ("Manage requests"): that row is scrolled to, focused and highlighted.
  const [linked, setLinked] = useState(() => searchParams.get('session'));
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadSessions = React.useCallback(() => sessionService.getSessions().then(result => { setSessions(result.data); setLoaded(true); }).catch(() => setNotice(t('teacherUi.sessionsLoadError'))), [t]);
  React.useEffect(() => { void loadSessions(); }, []);
  // Back from the calendar tab: statuses changed there (or by a payment) are shown without a manual refresh.
  React.useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadSessions(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [loadSessions]);
  React.useEffect(() => {
    if (!linked || !loaded) return;
    setLinked(null);
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('session'); return next; }, { replace: true });
    const row = document.getElementById(`tutoring-${linked}`);
    if (!row) { setNotice(t('calendarUi.tutoring.linkedNotFound')); return; }
    setHighlighted(linked);
    row.scrollIntoView({ block: 'center' });
    row.focus();
  }, [linked, loaded]);

  const when = (s: import('../../types').TutoringSession) => {
    if (!s.startAt) return { date: s.date, time: s.startTime };
    const start = new Date(s.startAt);
    return { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(start), time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(start) };
  };

  const handleStatus = async (id: string, status: 'confirmed' | 'rejected') => {
    try { const result = await sessionService.updateSessionStatus(id, status); setSessions(prev => prev.map(session => session.id === id ? result.data : session)); }
    catch (cause) { setNotice(usesApi ? apiErrorMessage(t, cause) : t('teacherUi.statusUpdateError')); }
  };

  const handleAvailability = async (event: React.FormEvent) => {
    event.preventDefault(); setNotice('');
    // One request at a time: a double click never publishes the slot twice (the API also refuses a second slot at that time).
    if (publishing) return;
    setPublishing(true);
    try {
      await sessionService.createAvailability({ startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), type, price: Number(price), venue: type === 'in_person' ? venue : undefined, subject: subject.trim() || undefined });
      setNotice(t('teacherUi.slotPublished')); setStartAt(''); setEndAt(''); setSubject('');
      const result = await sessionService.getSessions(); setSessions(result.data);
    } catch (cause) { setNotice(usesApi ? apiErrorMessage(t, cause) : t('teacherUi.slotError')); }
    finally { setPublishing(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherUi.tutoringTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('teacherUi.tutoringSubtitle')}</p>
        </div>
        {usesApi && <Link to="/calendar" className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Calendar className="h-3.5 w-3.5" aria-hidden />{t('calendarUi.tutoring.openCalendar')}</Link>}
      </div>

      <form onSubmit={handleAvailability} className="bg-white border border-slate-200 rounded-xl p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <label className="text-xs text-slate-600 sm:col-span-2 lg:col-span-5">{t('calendarUi.slotSubject')}<input value={subject} maxLength={160} onChange={event => setSubject(event.target.value)} placeholder={t('calendarUi.slotSubjectHint')} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
        <label className="text-xs text-slate-600">{t('teacherUi.start')}<input required type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
        <label className="text-xs text-slate-600">{t('teacherUi.end')}<input required type="datetime-local" value={endAt} onChange={event => setEndAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
        <label className="text-xs text-slate-600">{t('teacherUi.format')}<select value={type} onChange={event => setType(event.target.value as 'online' | 'in_person')} className="mt-1 w-full rounded-lg border border-slate-300 p-2"><option value="online">{t('teacherUi.online')}</option><option value="in_person">{t('teacherUi.inPerson')}</option></select></label>
        <label className="text-xs text-slate-600">{t('teacherUi.price')}<input required type="number" min="0" max="100000" value={price} onChange={event => setPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
        {type === 'in_person' && <label className="text-xs text-slate-600">{t('teacherUi.venue')}<input required value={venue} onChange={event => setVenue(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>}
        <Button type="submit" variant="primary" size="sm" isLoading={publishing}>{t('teacherUi.publishSlot')}</Button>
      </form>
      {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
        {loaded && sessions.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{t('calendarUi.tutoring.empty')}</p>}
        {sessions.map(s => (
          <div key={s.id} id={`tutoring-${s.id}`} tabIndex={-1} aria-current={highlighted === s.id ? 'true' : undefined} className={`p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 focus:outline-none ${highlighted === s.id ? 'em-highlight bg-amber-50' : ''}`}>
            <div>
              <span className="text-xs font-bold text-indigo-600 uppercase block mb-1">
                {t('teacherUi.sessionWhen', { ...when(s), minutes: s.durationMinutes, mode: s.type === 'online' ? t('teacherUi.jitsiMode') : t('teacherUi.onSite') })}
              </span>
              <h3 className="text-sm font-bold text-slate-900">{s.subject || (s.status === 'available' ? t('calendarUi.openSlotTitle') : t('calendarUi.defaultSessionSubject'))}</h3>
              <span className="text-xs text-slate-500">{s.studentName ? t('teacherUi.learner', { name: s.studentName, price: formatPrice(s.price, 'eur', i18n.language) }) : t('calendarUi.tutoring.openSlotPrice', { price: s.price ? formatPrice(s.price, 'eur', i18n.language) : t('calendarUi.free') })}</span>
              {s.paymentStatus && s.paymentStatus !== 'not_required' && <span className="ms-2 text-xs font-medium text-amber-800">· {t(`calendarUi.payment.${s.paymentStatus}`)}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {usesApi && s.startAt && (
                <Link to={`/calendar?date=${encodeURIComponent(s.startAt)}&event=${encodeURIComponent(`session-${s.id}`)}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline" aria-label={t('calendarUi.tutoring.seeInCalendarOf', { date: when(s).date, time: when(s).time })}>
                  <Calendar className="h-3.5 w-3.5" aria-hidden />{t('calendarUi.tutoring.seeInCalendar')}
                </Link>
              )}
              {s.type === 'online' && s.jitsiRoomId && (usesApi ? s.meetingUrl : true) && s.status === 'confirmed' && (
                <Link to={`/sessions/room/${s.jitsiRoomId}`}>
                  <Button variant="primary" size="sm" leftIcon={<Video className="w-4 h-4" />}>
                    {t('teacherUi.openRoom')}
                  </Button>
                </Link>
              )}
              {s.status === 'pending' ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleStatus(s.id, 'rejected')}>
                    {t('teacherUi.reject')}
                  </Button>
                  <Button variant="primary" size="sm" disabled={s.paymentStatus === 'awaiting_payment'} title={s.paymentStatus === 'awaiting_payment' ? t('apiErrors.SESSION_PAYMENT_PENDING') : undefined} onClick={() => handleStatus(s.id, 'confirmed')}>
                    {t('teacherUi.accept')}
                  </Button>
                </div>
              ) : (
                <Badge variant={s.status === 'confirmed' ? 'success' : 'default'} size="sm">
                  {s.status === 'confirmed' ? t('teacherUi.confirmed') : t(`teacherUi.statuses.${s.status}`, { defaultValue: s.status })}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TeacherRevenuePage: React.FC = () => {
  const { t } = useTranslation();
  const transactions = mockTransactions;
  const [payoutRequested, setPayoutRequested] = useState(false);

  if (usesApi) return <SellerRevenuePage />;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherUi.revenueTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('teacherUi.revenueSubtitle')}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setPayoutRequested(true)}>
          {t('teacherUi.requestDemoPayout')}
        </Button>
      </div>

      {payoutRequested && (
        <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{t('teacherUi.demoPayoutDone')}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('teacherUi.availableBalance')} value="4 850 €" hint={t('teacherUi.readyForTransfer')} />
        <StatCard label={t('teacherUi.teacherShare')} value="80 %" hint={t('teacherUi.perSale')} />
        <StatCard label={t('teacherUi.platformCommission')} value="20 %" hint={t('teacherUi.hostingIncluded')} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900">{t('teacherUi.recentSales')}</h2>
        <div className="divide-y divide-slate-100 text-xs">
          {transactions.map(tx => (
            <div key={tx.id} className="py-3 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block">{tx.itemName}</span>
                <span className="text-slate-400">{t('teacherUi.buyer', { date: tx.date, name: tx.userName })}</span>
              </div>
              <div className="text-end">
                <span className="font-bold text-emerald-600 block tabular-nums">+{tx.sellerCommission} €</span>
                <span className="text-[10px] text-slate-400">{t('teacherUi.total', { amount: tx.amount })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MockTeacherAssignmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const [graded, setGraded] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherUi.gradingTitle')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('teacherUi.gradingSubtitle')}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <span className="text-xs text-indigo-600 font-semibold">Architectures Modernes React 19</span>
            <h3 className="text-base font-bold text-slate-900">{t('teacherUi.demoAssignment')}</h3>
            <span className="text-xs text-slate-500">{t('teacherUi.demoSubmission')}</span>
          </div>
          <Badge variant="warning" size="sm">{t('teacherUi.toGrade')}</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('teacherUi.grade')} required>
            <Input type="number" defaultValue={92} required />
          </FormField>
          <FormField label={t('teacherUi.feedback')}>
            <Textarea defaultValue="Excellente structure des atomes et molécules. Pensez à isoler la logique du store dans un hook dédié." rows={3} />
          </FormField>
        </div>

        <Button variant="primary" size="sm" onClick={() => setGraded(true)}>
          {t('teacherUi.sendGrade')}
        </Button>

        {graded && (
          <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('teacherUi.gradeSaved')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const TeacherAssignmentsPage: React.FC = () => usesApi ? <ApiTeacherAssignmentsPage /> : <MockTeacherAssignmentsPage />;
