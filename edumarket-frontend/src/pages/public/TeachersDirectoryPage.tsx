import React, { useEffect, useState } from 'react';
import { ReportButton } from '../../components/organisms/ReportButton';
import { paymentApi } from '../../services/platformServices';
import { describeApiError } from '../../utils/apiErrors';
import { formatDate } from '../../utils/format';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { mockUsers, mockCourses } from '../../mocks/mockData';
import { Avatar } from '../../components/atoms/Avatar';
import { Rating } from '../../components/atoms/Rating';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { CourseCard } from '../../components/organisms/CourseCard';
import { SessionBookingForm } from '../../components/organisms/SessionOrganisms';
import { sessionService } from '../../services/sessionService';
import { PublicTeacher, publicTeacherService } from '../../services/publicTeacherService';
import { Course } from '../../types';
import { usesApi } from '../../services/apiClient';
import { EmptyState } from '../../components/molecules/EmptyState';

const demoTeachers: PublicTeacher[] = [mockUsers.teacher, mockUsers.unverified_teacher].map((teacher, index) => ({
  id: teacher.id, name: teacher.name, headline: teacher.headline || '', bio: teacher.bio || '',
  joinedDate: teacher.joinedDate, avatar: teacher.avatar || '', rating: index ? 4.7 : 4.9,
  ratingCount: index ? 56 : 128, coursesCount: index ? 2 : 8, studentsCount: index ? 340 : 1280,
  website: teacher.website,
}));

export const TeachersDirectoryPage: React.FC = () => {
  const { t } = useTranslation();
  const [teachers, setTeachers] = useState<PublicTeacher[]>(usesApi ? [] : demoTeachers);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(teachers.length);
  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    setLoading(true); setError('');
    publicTeacherService.list(search, page).then(result => { if (active) { setTeachers(result.items); setTotal(result.total); } })
      .catch(() => { if (active) setError(t('auth.apiUnavailable')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t, search, page]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{t('nav.teachers')}</h1>
        <p className="text-sm text-slate-600 mt-1">{t('directoryUi.teachersSubtitle')}</p>
      </div>
      <form className="flex max-w-xl gap-2" onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
        <Input value={searchInput} onChange={event => setSearchInput(event.target.value)} aria-label={t('common.search')} placeholder={t('common.search')} />
        <Button type="submit" variant="primary" size="sm">{t('common.search')}</Button>
      </form>
      {loading && <p role="status" className="text-sm text-slate-500">{t('common.loading')}</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {teachers.length ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teachers.map(teacher => <article key={teacher.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start gap-4 mb-4">
              <Avatar src={teacher.avatar} alt={teacher.name} size="lg" />
              <div><h2 className="text-base font-bold text-slate-900">{teacher.name}</h2><span className="text-xs text-indigo-600 font-medium block">{teacher.headline}</span>
                <div className="mt-1"><Rating score={teacher.rating} count={teacher.ratingCount} size="sm" /></div>
              </div>
            </div>
            <p className="text-xs text-slate-600 line-clamp-3 mb-4 leading-relaxed">{teacher.bio}</p>
          </div>
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-700">{t('directoryUi.coursesCount', { count: teacher.coursesCount })}</span>
            <Link to={`/teachers/${teacher.id}`}><Button variant="outline" size="sm">{t('directoryUi.viewProfile')}</Button></Link>
          </div>
        </article>)}
      </div> : !loading && !error && <EmptyState title={t('common.emptyTitle')} description={t('common.emptyDescription')} />}
      {usesApi && total > 20 && <div className="flex items-center justify-center gap-4 text-sm">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>{t('common.previous')}</Button>
        <span className="text-slate-500">{t('common.pagination.page')} {page} {t('common.pagination.of')} {Math.ceil(total / 20)}</span>
        <Button type="button" variant="outline" size="sm" disabled={page >= Math.ceil(total / 20) || loading} onClick={() => setPage(value => value + 1)}>{t('common.next')}</Button>
      </div>}
    </div>
  );
};

export const TeacherDetailPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const [teacher, setTeacher] = useState<PublicTeacher | null>(usesApi ? null : demoTeachers[0]);
  const [teacherCourses, setTeacherCourses] = useState<Course[]>(usesApi ? [] : mockCourses.filter(course => course.teacherId === mockUsers.teacher.id));
  const [loading, setLoading] = useState(usesApi);
  const [loadError, setLoadError] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    setLoading(true); setLoadError(false);
    publicTeacherService.get(id).then(profile => {
      if (active) { setTeacher(profile); setTeacherCourses(profile.courses || []); }
    }).catch(() => { if (active) { setTeacher(null); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const handleBook = async (data: { slotId: string; subject: string; notes?: string }) => {
    try { await sessionService.bookSession(data); setBookingSuccess(true); setBookingError(''); setShowBooking(false); }
    catch (error) {
      if (usesApi && (error as { code?: string }).code === 'PAYMENT_REQUIRED') {
        // Paid slots go through the provider checkout before the teacher can confirm.
        try { window.location.assign((await paymentApi.checkoutSession(data.slotId, { subject: data.subject, notes: data.notes })).checkoutUrl); }
        catch (checkoutError) { setBookingError(describeApiError(checkoutError)); }
        return;
      }
      setBookingError((error as { status?: number }).status === 401 ? t('directoryUi.loginToBook') : usesApi ? describeApiError(error) : t('directoryUi.bookingFailed'));
    }
  };

  if (loading) return <div className="mx-auto max-w-7xl p-12 text-center text-slate-500">{t('common.loading')}</div>;
  if (!teacher) return <div className="mx-auto max-w-7xl p-12 text-center"><EmptyState title={loadError ? t('common.error') : t('common.emptyTitle')} description={loadError ? t('auth.apiUnavailable') : t('common.emptyDescription')} /><Link className="mt-4 inline-block text-indigo-600" to="/teachers">{t('common.back')}</Link></div>;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row items-start gap-8">
        <Avatar src={teacher.avatar} alt={teacher.name} size="xl" />
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h1 className="text-2xl font-extrabold text-slate-900">{teacher.name}</h1><span className="text-sm text-indigo-600 font-medium">{teacher.headline}</span>{usesApi && <div className="mt-1"><ReportButton targetType="user" targetId={teacher.id} /></div>}</div>
            <Button variant="primary" size="md" onClick={() => setShowBooking(true)}>{t('directoryUi.bookTutoring')}</Button>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">{teacher.bio}</p>
          <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-500">
            <Rating score={teacher.rating} count={teacher.ratingCount} size="sm" />
            <span>{t('directoryUi.memberSince', { date: teacher.joinedDate ? formatDate(teacher.joinedDate, i18n.language) : '—' })}</span>
            {teacher.website && <a href={teacher.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-600 hover:underline"><Globe className="w-3.5 h-3.5" /> {t('directoryUi.website')}</a>}
          </div>
        </div>
      </div>
      {bookingSuccess && <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">{t('directoryUi.bookingSent')}</div>}
      {bookingError && <p role="alert" className="text-sm text-rose-600">{bookingError}</p>}
      {showBooking && <div className="max-w-2xl mx-auto"><SessionBookingForm teacherId={usesApi ? teacher.id : undefined} onBook={handleBook} onCancel={() => setShowBooking(false)} /></div>}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">{t('directoryUi.teacherCourses', { count: teacherCourses.length })}</h2>
        {teacherCourses.length ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{teacherCourses.map(course => <CourseCard key={course.id} course={course} />)}</div> : <EmptyState title={t('common.emptyTitle')} description={t('common.emptyDescription')} />}
      </div>
    </div>
  );
};
