import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/atoms/Button';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { EmptyState } from '../../components/molecules/EmptyState';
import { ErrorAlert, LoadingState } from '../../components/molecules/PageStates';
import { usesApi } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { learningPathApi, paymentApi } from '../../services/platformServices';
import { describeApiError } from '../../utils/apiErrors';
import { formatPrice } from '../../utils/format';
import type { LearningPathSummary } from '../../types/platform';

export const ForTeachersPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [coursePrice, setCoursePrice] = useState(69);
  const [studentsCount, setStudentsCount] = useState(150);
  // The simulator uses the live platform commission in API mode (demo: 20 %).
  const [commissionRate, setCommissionRate] = useState(20);
  useEffect(() => { if (usesApi) paymentApi.config().then(config => setCommissionRate(config.commissionRate)).catch(() => undefined); }, []);
  const teacherShare = 100 - commissionRate;
  const estimatedRevenue = Math.round(coursePrice * studentsCount * teacherShare / 100);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{t('marketingUi.teachersKicker')}</span>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">{t('marketingUi.teachersTitle')}</h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{t('marketingUi.teachersText', { share: teacherShare })}</p>
          <Link to={isAuthenticated || !usesApi ? '/teacher/application' : '/auth/register/teacher'}><Button variant="primary" size="lg">{t('marketingUi.becomeTeacher')}</Button></Link>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-lg space-y-6">
          <h2 className="text-base font-bold text-slate-900">{t('marketingUi.simulator')}</h2>
          <div className="space-y-4">
            <label className="block">
              <span className="flex justify-between text-xs text-slate-600 mb-1"><span>{t('marketingUi.coursePrice')}</span><strong className="text-slate-900 tabular-nums">{formatPrice(coursePrice, 'eur', i18n.language)}</strong></span>
              <input type="range" min={10} max={250} value={coursePrice} onChange={(e) => setCoursePrice(Number(e.target.value))} className="w-full accent-indigo-600" />
            </label>
            <label className="block">
              <span className="flex justify-between text-xs text-slate-600 mb-1"><span>{t('marketingUi.students')}</span><strong className="text-slate-900 tabular-nums">{studentsCount}</strong></span>
              <input type="range" min={10} max={1000} step={10} value={studentsCount} onChange={(e) => setStudentsCount(Number(e.target.value))} className="w-full accent-indigo-600" />
            </label>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">{t('marketingUi.estimatedRevenue', { share: teacherShare })}</span>
            <span className="text-2xl font-extrabold text-indigo-600 tabular-nums">{formatPrice(estimatedRevenue, 'eur', i18n.language)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ForInstitutionsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{t('marketingUi.institutionsKicker')}</span>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">{t('marketingUi.institutionsTitle')}</h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{t('marketingUi.institutionsText')}</p>
        <div className="pt-2"><Link to="/auth/institution-request"><Button variant="primary" size="lg">{t('marketingUi.institutionsCta')}</Button></Link></div>
      </div>
    </div>
  );
};

const demoPaths = (t: (key: string) => string): LearningPathSummary[] => [1, 2, 3].map(index => ({
  id: `demo-${index}`, slug: `demo-${index}`, coursesCount: [5, 4, 4][index - 1], durationMinutes: [180, 120, 140][index - 1] * 60,
  title: { fr: t(`marketingUi.demoPaths.p${index}Title`), en: t(`marketingUi.demoPaths.p${index}Title`), ar: t(`marketingUi.demoPaths.p${index}Title`) },
  description: { fr: t(`marketingUi.demoPaths.p${index}Text`), en: t(`marketingUi.demoPaths.p${index}Text`), ar: t(`marketingUi.demoPaths.p${index}Text`) },
  skills: [['React 19', 'Node.js', 'Docker', 'PostgreSQL'], ['LLMs', 'Prompt Engineering', 'RAG', 'Python'], ['SIEM', 'Threat Hunting', 'OWASP', 'Forensics']][index - 1],
}));

/** Admin-curated paths in API mode, with the signed-in learner's progress; demo paths in mock mode. */
export const LearningPathsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.language.slice(0, 2) as 'fr' | 'en' | 'ar';
  const [paths, setPaths] = useState<LearningPathSummary[] | null>(usesApi ? null : demoPaths(t));
  const [error, setError] = useState('');
  useEffect(() => { if (usesApi) learningPathApi.list().then(setPaths).catch(cause => setError(describeApiError(cause))); }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{t('marketingUi.pathsTitle')}</h1>
        <p className="text-sm text-slate-600 mt-1">{t('marketingUi.pathsSubtitle')}</p>
      </div>
      <ErrorAlert message={error} />
      {!paths && !error && <LoadingState />}
      {paths?.length === 0 && <EmptyState title={t('marketingUi.noPaths')} description={t('marketingUi.pathsSubtitle')} />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {paths?.map(path => (
          <div key={path.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
            <div className="space-y-3">
              <span className="text-xs font-semibold text-indigo-600">{t('marketingUi.pathMeta', { courses: path.coursesCount, hours: Math.round(path.durationMinutes / 6) / 10 })}</span>
              <h2 className="text-lg font-bold text-slate-900">{path.title[language] || path.title.fr}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{path.description[language] || path.description.fr}</p>
              {path.skills.length > 0 && (
                <div className="pt-2">
                  <span className="text-xs font-semibold text-slate-700 block mb-2">{t('marketingUi.skills')}</span>
                  <div className="flex flex-wrap gap-1.5">{path.skills.map(skill => <span key={skill} className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-medium text-slate-700">{skill}</span>)}</div>
                </div>
              )}
              {path.progress && path.coursesCount > 0 && (
                <div className="pt-2 space-y-1">
                  <span className="text-[11px] text-slate-500">{t('marketingUi.pathProgress', { completed: path.progress.completed, total: path.coursesCount })}</span>
                  <ProgressBar percent={path.progress.completed / path.coursesCount * 100} />
                </div>
              )}
            </div>
            <div className="pt-6 border-t border-slate-100 mt-6 space-y-2">
              {path.courses?.map(course => <Link key={course.id} to={`/courses/${course.id}`} className="block text-xs text-indigo-700 hover:underline">{course.title}</Link>)}
              <Link to={usesApi && path.courseIds?.length ? `/courses/${path.courseIds[0]}` : '/courses'}>
                <Button variant="outline" size="sm" className="w-full">{t('marketingUi.explorePath')}</Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
