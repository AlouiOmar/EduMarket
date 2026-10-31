import React, { useEffect, useState } from 'react';
import { describeApiError } from '../../utils/apiErrors';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, CheckCircle2, Users, BookOpen, MapPin, Globe } from 'lucide-react';
import { mockInstitutions, mockCourses } from '../../mocks/mockData';
import { Button } from '../../components/atoms/Button';
import { Rating } from '../../components/atoms/Rating';
import { CourseCard } from '../../components/organisms/CourseCard';
import { usesApi } from '../../services/apiClient';
import { institutionService } from '../../services/institutionService';
import { Course, Institution } from '../../types';

export const InstitutionsDirectoryPage: React.FC = () => {
  const { t } = useTranslation();
  const [institutions, setInstitutions] = useState<Institution[]>(usesApi ? [] : mockInstitutions);
  const [error, setError] = useState('');
  useEffect(() => { if (usesApi) institutionService.publicDirectory().then(setInstitutions).catch(cause => setError(describeApiError(cause))); }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {t('nav.institutions')}
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {t('directoryUi.institutionsSubtitle')}
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {institutions.map((inst) => (
          <div key={inst.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col justify-between">
            <div className="h-32 bg-slate-900 relative">
              {inst.banner && <img
                src={inst.banner}
                alt={inst.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-70"
              />}
              <div className="absolute -bottom-6 start-6 w-14 h-14 rounded-xl border-2 border-white bg-white overflow-hidden shadow-md">
                {inst.logo ? <img src={inst.logo} alt={inst.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <Building2 className="m-auto mt-3 h-7 w-7 text-indigo-600" />}
              </div>
            </div>

            <div className="p-6 pt-10 space-y-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-base font-bold text-slate-900">{inst.name}</h3>
                  {inst.verified && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                </div>
                <span className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                  <MapPin className="w-3.5 h-3.5" /> {inst.city}, {inst.country}
                </span>
              </div>

              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                {inst.description}
              </p>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span className="tabular-nums font-semibold">{t('directoryUi.certifyingCourses', { count: inst.coursesCount })}</span>
                {inst.rating > 0 ? <Rating score={inst.rating} count={inst.studentsCount} size="sm" /> : <span>{t('directoryUi.learners', { count: inst.studentsCount })}</span>}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 text-end">
              <Link to={`/institutions/${inst.id}`}>
                <Button variant="outline" size="sm">
                  Voir le catalogue &rarr;
                </Button>
              </Link>
            </div>
          </div>
        ))}
        {usesApi && institutions.length === 0 && !error && <p className="col-span-full rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{t('directoryUi.noInstitutions')}</p>}
      </div>
    </div>
  );
};

export const InstitutionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [inst, setInst] = useState<Institution | null>(usesApi ? null : mockInstitutions[0]);
  const [instCourses, setInstCourses] = useState<Course[]>(usesApi ? [] : mockCourses);
  const [error, setError] = useState('');
  useEffect(() => {
    if (usesApi && id) institutionService.publicDetail(id).then(result => { setInst(result.institution); setInstCourses(result.courses); }).catch(cause => setError(describeApiError(cause)));
  }, [id]);

  if (!inst) return <div className="max-w-7xl mx-auto px-4 py-10">{error ? <p role="alert" className="text-rose-700">{error}</p> : <p className="text-slate-500">{usesApi ? t('directoryUi.loadingInstitution') : t('directoryUi.institutionNotFound')}</p>}</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="h-48 bg-slate-900 relative">
          {inst.banner && <img src={inst.banner} alt={inst.name} referrerPolicy="no-referrer" className="w-full h-full object-cover opacity-80" />}
        </div>

        <div className="p-6 sm:p-8 flex flex-col md:flex-row items-start gap-6">
          <div className="w-20 h-20 -mt-16 rounded-2xl border-4 border-white bg-white overflow-hidden shadow-lg shrink-0">
            {inst.logo ? <img src={inst.logo} alt={inst.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <Building2 className="m-auto mt-4 h-9 w-9 text-indigo-600" />}
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold text-slate-900">{inst.name}</h1>
                  {inst.verified && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
                </div>
                <span className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                  <MapPin className="w-3.5 h-3.5" /> {inst.city}, {inst.country} · {inst.website}
                </span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
              {inst.description}
            </p>

            <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-600 border-t border-slate-100">
              <span className="tabular-nums font-semibold">{inst.teachersCount} enseignants affiliés</span>
              <span className="tabular-nums font-semibold">{inst.coursesCount} cursus agréés</span>
              <span className="tabular-nums font-semibold">+{inst.studentsCount} apprenants diplômés</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          {t('directoryUi.institutionCourses')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {instCourses.map(course => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </div>
    </div>
  );
};
