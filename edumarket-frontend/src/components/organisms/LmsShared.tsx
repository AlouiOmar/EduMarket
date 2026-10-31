import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiRequest, usesApi } from '../../services/apiClient';
import { ApiModeNotice } from '../molecules/PageStates';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

/** Modal dialog: focus moves inside on open and returns to the opener on close; Escape closes. */
export const LmsDialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`lms-dialog-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), [href], [tabindex]:not([tabindex="-1"])');
    (first || ref.current)?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl`}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" data-close onClick={onClose} aria-label={t('lmsCommon.close')} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

const tabClass = ({ isActive }: { isActive: boolean }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

/** Teacher course workspace sections (each is its own route; the content outline stays the default). */
export const TEACHER_COURSE_SECTIONS = ['content', 'gradebook', 'assessments', 'discussions', 'journals', 'announcements', 'attendance', 'groups', 'analytics', 'template', 'files', 'integrations'] as const;
export type TeacherCourseSection = typeof TEACHER_COURSE_SECTIONS[number];

export const CourseWorkspaceNav: React.FC<{ courseId: string; base?: string }> = ({ courseId, base = '/teacher' }) => {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('lmsCommon.courseSections')} className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1 px-1 pb-1">
        {TEACHER_COURSE_SECTIONS.map(section => (
          <li key={section}><NavLink end={section === 'content'} to={`${base}/courses/${courseId}/${section}`} className={tabClass}>{t(`lmsCommon.sections.${section}`)}</NavLink></li>
        ))}
      </ul>
    </nav>
  );
};

export const STUDENT_COURSE_SECTIONS = ['grades', 'tests', 'assignments', 'discussions', 'journal', 'announcements', 'groups', 'attendance', 'forms', 'activities'] as const;

export const StudentCourseNav: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('lmsCommon.courseSections')} className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1 px-1 pb-1">
        <li><NavLink to={`/learning/${courseId}`} className={tabClass}>{t('lmsCommon.studentSections.learn')}</NavLink></li>
        {STUDENT_COURSE_SECTIONS.map(section => (
          <li key={section}><NavLink to={`/student/courses/${courseId}/${section}`} className={tabClass}>{t(`lmsCommon.studentSections.${section}`)}</NavLink></li>
        ))}
      </ul>
    </nav>
  );
};

/** Grade cell text: "—" for no grade (never 0), "EXC" for excused, otherwise the number in the locale. */
export const formatScore = (value: number | null | undefined, language: string, digits = 2) =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** Header of a teacher course section: course title, section title and the workspace tabs. API mode only. */
export const TeacherCourseFrame: React.FC<{ courseId: string; title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ courseId, title, subtitle, actions, children }) => {
  const { t } = useTranslation();
  const [courseTitle, setCourseTitle] = useState('');
  useEffect(() => {
    if (!usesApi) return;
    apiRequest<{ data: { title: string } }>(`/courses/mine/${encodeURIComponent(courseId)}`).then(result => setCourseTitle(result.data.title)).catch(() => setCourseTitle(''));
  }, [courseId]);
  if (!usesApi) return <div className="max-w-5xl mx-auto"><ApiModeNotice /></div>;
  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-12">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to="/teacher/courses" className="mt-1 text-slate-500 hover:text-slate-800" aria-label={t('lmsCommon.backToCourses')}><ArrowLeft className="w-5 h-5 rtl-flip" /></Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{courseTitle || ' '}</p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 max-w-3xl text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <CourseWorkspaceNav courseId={courseId} />
      {children}
    </div>
  );
};

/** Header of a student course section. */
export const StudentCourseFrame: React.FC<{ courseId: string; title: string; subtitle?: string; children: React.ReactNode }> = ({ courseId, title, subtitle, children }) => {
  const { t } = useTranslation();
  const [courseTitle, setCourseTitle] = useState('');
  useEffect(() => {
    if (!usesApi) return;
    apiRequest<{ data: { title: string } }>(`/courses/${encodeURIComponent(courseId)}`).then(result => setCourseTitle(result.data.title)).catch(() => setCourseTitle(''));
  }, [courseId]);
  if (!usesApi) return <div className="max-w-5xl mx-auto"><ApiModeNotice /></div>;
  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
      <div className="flex items-start gap-3">
        <Link to="/student/courses" className="mt-1 text-slate-500 hover:text-slate-800" aria-label={t('lmsCommon.backToCourses')}><ArrowLeft className="w-5 h-5 rtl-flip" /></Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{courseTitle || ' '}</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <StudentCourseNav courseId={courseId} />
      {children}
    </div>
  );
};
