import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Award, GraduationCap, Users } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { StatCard } from '../../components/molecules/StatCard';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader } from '../../components/molecules/PageStates';
import { analyticsApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate } from '../../utils/format';
import type { InstitutionAnalytics } from '../../types/platform';

/** Loads cohort analytics for the signed-in institution (own courses and verified affiliated teachers' courses). */
function useInstitutionAnalytics(source: 'institution' | 'teacher' = 'institution') {
  const { t } = useTranslation();
  const [data, setData] = useState<InstitutionAnalytics | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); analyticsApi[source]().then(setData).catch(cause => setError(apiErrorMessage(t, cause))); }, [t, source]);
  useEffect(load, [load]);
  return { data, error, load };
}

const percent = (value: number | null, fallback: string) => value === null ? fallback : `${value} %`;

export const ApiInstitutionAnalyticsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, load } = useInstitutionAnalytics();
  const na = t('institutionAnalytics.notAvailable');
  return (
    <div className="space-y-6">
      <PageHeader title={t('institutionAnalytics.title')} subtitle={t('institutionAnalytics.subtitle')} />
      <ErrorAlert message={error} onRetry={load} />
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t('institutionAnalytics.uniqueStudents')} value={data.totals.uniqueStudents} icon={<Users className="w-5 h-5" />} hint={`${t('institutionAnalytics.enrollments')} : ${data.totals.enrollments}`} />
            <StatCard label={t('institutionAnalytics.completionRate')} value={percent(data.totals.completionRate, na)} icon={<GraduationCap className="w-5 h-5" />} />
            <StatCard label={t('institutionAnalytics.averageProgress')} value={percent(data.totals.averageProgress, na)} icon={<Activity className="w-5 h-5" />} />
            <StatCard label={t('institutionAnalytics.examAverage')} value={data.totals.examAverageScore === null ? na : `${data.totals.examAverageScore} %`} icon={<Award className="w-5 h-5" />} hint={`${t('institutionAnalytics.examPassRate')} : ${percent(data.totals.examPassRate, na)}`} />
          </div>
          <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
            <h2 className="text-base font-bold text-slate-900 p-5 pb-3">{t('institutionAnalytics.perCourse')}</h2>
            {data.courses.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">{t('institutionAnalytics.empty')}</p> : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="p-3 text-start">{t('institutionAnalytics.course')}</th><th className="p-3 text-start">{t('institutionAnalytics.teacher')}</th>
                  <th className="p-3 text-end">{t('institutionAnalytics.enrollments')}</th><th className="p-3 text-end">{t('institutionAnalytics.completions')}</th>
                  <th className="p-3 text-start min-w-32">{t('institutionAnalytics.averageProgress')}</th><th className="p-3 text-end">{t('institutionAnalytics.quizPassRate')}</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.courses.map(course => (
                    <tr key={course.courseId}>
                      <td className="p-3 font-semibold text-slate-900">{course.title} <Badge variant={course.status === 'published' ? 'success' : 'default'} size="sm">{t(`courseStatus.${course.status}`)}</Badge></td>
                      <td className="p-3 text-slate-600">{course.teacherName}</td>
                      <td className="p-3 text-end tabular-nums">{course.enrollments}</td>
                      <td className="p-3 text-end tabular-nums">{course.completions}</td>
                      <td className="p-3"><ProgressBar percent={course.averageProgress} showLabel /></td>
                      <td className="p-3 text-end tabular-nums">{percent(course.quizPassRate, na)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
};

/** Mock mode keeps the historical route behaviour through `fallback`; API mode lists real enrollments. */
export const InstitutionStudentsPage: React.FC<{ fallback?: React.ReactNode }> = ({ fallback }) => usesApi ? <InstitutionStudentsList /> : <>{fallback}</>;

/** Teacher view of the same report: learners of own, co-owned and coordinated courses. */
export const TeacherStudentsPage: React.FC = () => {
  const { t } = useTranslation();
  return usesApi ? <InstitutionStudentsList source="teacher" /> : <div className="space-y-6"><PageHeader title={t('teacherTeamUi.studentsTitle')} subtitle={t('teacherTeamUi.studentsSubtitle')} /><ApiModeNotice /></div>;
};

const InstitutionStudentsList: React.FC<{ source?: 'institution' | 'teacher' }> = ({ source = 'institution' }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [search, setSearch] = useState('');
  const { data, error, load } = useInstitutionAnalytics(source);
  const query = search.trim().toLowerCase();
  const students = (data?.students || []).filter(row => !query || row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query) || row.courseTitle.toLowerCase().includes(query));
  return (
    <div className="space-y-6">
      <PageHeader title={t(source === 'teacher' ? 'teacherTeamUi.studentsTitle' : 'institutionAnalytics.studentsTitle')} subtitle={t(source === 'teacher' ? 'teacherTeamUi.studentsSubtitle' : 'institutionAnalytics.studentsSubtitle')} />
      <Input aria-label={t('platformCommon.search')} placeholder={t('platformCommon.search')} value={search} onChange={event => setSearch(event.target.value)} />
      <ErrorAlert message={error} onRetry={load} />
      {!data && !error && <LoadingState />}
      {data && students.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('institutionAnalytics.empty')}</p>}
      {students.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="p-3 text-start">{t('institutionAnalytics.student')}</th><th className="p-3 text-start">{t('institutionAnalytics.course')}</th>
              <th className="p-3 text-start min-w-32">{t('institutionAnalytics.progress')}</th><th className="p-3 text-start">{t('institutionAnalytics.enrolledOn')}</th><th className="p-3 text-start">{t('common.status')}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {students.map(row => (
                <tr key={`${row.studentId}-${row.courseId}`}>
                  <td className="p-3"><span className="font-semibold text-slate-900 block">{row.name}</span><span className="text-slate-500">{row.email}</span></td>
                  <td className="p-3 text-slate-700">{row.courseTitle}</td>
                  <td className="p-3"><ProgressBar percent={row.progress} showLabel /></td>
                  <td className="p-3 text-slate-500 whitespace-nowrap">{formatDate(row.enrolledAt, language)}</td>
                  <td className="p-3"><Badge variant={row.completedAt ? 'success' : 'info'} size="sm">{row.completedAt ? t('institutionAnalytics.completed') : t('institutionAnalytics.inProgress')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
