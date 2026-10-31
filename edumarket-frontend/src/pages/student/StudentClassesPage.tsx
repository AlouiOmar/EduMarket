import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader } from '../../components/molecules/PageStates';
import { CourseCard } from '../../components/organisms/CourseCard';
import { classApi } from '../../services/platformServices';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { StudentClass } from '../../types/platform';

/** Student's classes: join with the code given by the teacher/institution, then open the courses of each class. */
export const StudentClassesPage: React.FC = () => {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [code, setCode] = useState('');
  const [joined, setJoined] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); classApi.mine().then(setClasses).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('studentClassesUi.title')} subtitle={t('studentClassesUi.subtitle')} /><ApiModeNotice /></div>;

  const join = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setJoined('');
    try { const result = await classApi.join(code.trim()); setJoined(result.name); setCode(''); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-8">
      <PageHeader title={t('studentClassesUi.title')} subtitle={t('studentClassesUi.subtitle')} />
      <form onSubmit={join} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-wrap items-end gap-3 max-w-xl">
        <label className="flex-1 min-w-48 text-xs font-semibold text-slate-700 space-y-1">
          <span>{t('studentClassesUi.code')}</span>
          <Input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="AB12CD34" pattern="[A-Za-z0-9]{6,12}" maxLength={12} required className="font-mono tracking-widest" />
        </label>
        <Button type="submit" variant="primary" isLoading={busy}>{t('studentClassesUi.join')}</Button>
      </form>
      {joined && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{t('studentClassesUi.joined', { name: joined })}</p>}
      <ErrorAlert message={error} />
      {!classes && !error && <LoadingState />}
      {classes?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('studentClassesUi.empty')}</p>}
      {classes?.map(group => (
        <section key={group.id} className="space-y-4" aria-labelledby={`class-${group.id}`}>
          <div>
            <h2 id={`class-${group.id}`} className="text-base font-bold text-slate-900">{group.name}</h2>
            <p className="text-xs text-slate-500">{[group.level, group.academicYear, group.ownerName].filter(Boolean).join(' · ')}</p>
            {group.description && <p className="text-sm text-slate-600 mt-1">{group.description}</p>}
          </div>
          {group.courses.length === 0 ? <p className="text-xs text-slate-500">{t('studentClassesUi.noCourses')}</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {group.courses.map(course => courseService.normalizeApiCourse(course)).map(course => <CourseCard key={course.id} course={course} />)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
};
