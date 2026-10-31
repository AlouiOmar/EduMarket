import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, RefreshCw, Users } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { classApi } from '../../services/platformServices';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { ClassDetail, ClassSummary } from '../../types/platform';
import type { Course } from '../../types';

const emptyForm = { name: '', level: '', academicYear: '', description: '' };
/** Classes live in the teacher and institution workspaces (and at /classes); links stay in the current one. */
const useClassesBase = () => {
  const { pathname } = useLocation();
  return pathname.startsWith('/institution') ? '/institution/classes' : pathname.startsWith('/teacher') ? '/teacher/classes' : '/classes';
};

/** Classes (groups of students) managed by a teacher or an institution. */
export const ClassesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const base = useClassesBase();
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); classApi.managed().then(setClasses).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('classesUi.title')} subtitle={t('classesUi.subtitle')} /><ApiModeNotice /></div>;

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const created = await classApi.create(form); navigate(`${base}/${created.id}`); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  const active = (classes || []).filter(item => !item.archived), archived = (classes || []).filter(item => item.archived);
  const card = (item: ClassSummary) => (
    <li key={item.id}>
      <Link to={`${base}/${item.id}`} className="block bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-indigo-300 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{item.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{[item.level, item.academicYear].filter(Boolean).join(' · ') || t('classesUi.noLevel')}</p>
          </div>
          {item.archived && <Badge size="sm" variant="default">{t('classesUi.archived')}</Badge>}
        </div>
        <p className="mt-3 text-xs text-slate-600">{t('classesUi.counts', { students: item.studentsCount, courses: item.coursesCount })}</p>
      </Link>
    </li>
  );
  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader title={t('classesUi.title')} subtitle={t('classesUi.subtitle')}
        actions={<Button variant="primary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(value => !value)}>{t('classesUi.newClass')}</Button>} />
      <NoticeBanner>{t('classesUi.howItWorks')}</NoticeBanner>
      <ErrorAlert message={error} onRetry={load} />
      {creating && (
        <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label={t('classesUi.name')} required><Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={t('classesUi.namePlaceholder')} minLength={2} maxLength={120} required /></FormField>
          <FormField label={t('classesUi.level')}><Input value={form.level} onChange={event => setForm({ ...form, level: event.target.value })} placeholder={t('classesUi.levelPlaceholder')} maxLength={80} /></FormField>
          <FormField label={t('classesUi.academicYear')}><Input value={form.academicYear} onChange={event => setForm({ ...form, academicYear: event.target.value })} placeholder="2026-2027" maxLength={20} /></FormField>
          <FormField label={t('classesUi.description')} className="sm:col-span-3"><Textarea rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={2000} /></FormField>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setCreating(false); setForm(emptyForm); }}>{t('platformCommon.cancel')}</Button>
            <Button type="submit" variant="primary" size="sm" isLoading={busy}>{t('classesUi.create')}</Button>
          </div>
        </form>
      )}
      {!classes && !error && <LoadingState />}
      {classes?.length === 0 && !creating && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('classesUi.empty')}</p>}
      {active.length > 0 && <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">{active.map(card)}</ul>}
      {archived.length > 0 && <section className="space-y-3"><h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('classesUi.archivedClasses')}</h2><ul className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-75">{archived.map(card)}</ul></section>}
    </div>
  );
};

/** One class: join code, members (with progress per course), courses opened to the class. */
export const ClassDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { classId = '' } = useParams();
  const navigate = useNavigate();
  const base = useClassesBase();
  const [group, setGroup] = useState<ClassDetail | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const apply = (detail: ClassDetail) => { setGroup(detail); setSelected(detail.courses.map(course => course.id)); };
  const load = useCallback(() => {
    setError('');
    Promise.all([classApi.detail(classId), courseService.getMyCourses()])
      .then(([detail, mine]) => { apply(detail); setCourses(mine.data.filter(course => course.status === 'published')); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [classId, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('classesUi.title')} /><ApiModeNotice /></div>;
  const back = <Link to={base} className="text-xs font-semibold text-indigo-700 hover:underline">{t('classesUi.back')}</Link>;
  if (!group) return <div className="space-y-6">{back}<ErrorAlert message={error} onRetry={load} />{!error && <LoadingState />}</div>;

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(''); }
  };
  const addStudents = (event: React.FormEvent) => {
    event.preventDefault();
    const list = emails.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
    void run('students', async () => {
      const result = await classApi.addStudents(group.id, list);
      apply(result.class); setEmails('');
      setMessage([t('classesUi.added', { count: result.added }), result.notFound.length ? t('classesUi.notFound', { emails: result.notFound.join(', ') }) : ''].filter(Boolean).join(' '));
    });
  };
  const toggleCourse = (courseId: string) => setSelected(prev => prev.includes(courseId) ? prev.filter(id => id !== courseId) : [...prev, courseId]);
  const coursesChanged = selected.length !== group.courses.length || selected.some(id => !group.courses.some(course => course.id === id));
  const copyCode = () => { void navigator.clipboard?.writeText(group.joinCode).then(() => setMessage(t('classesUi.codeCopied'))).catch(() => undefined); };

  return (
    <div className="space-y-6 max-w-6xl">
      {back}
      <PageHeader title={group.name} subtitle={[group.level, group.academicYear, group.ownerName].filter(Boolean).join(' · ')}
        actions={<div className="flex gap-2">
          <Button variant="outline" size="sm" isLoading={busy === 'archive'} onClick={() => void run('archive', async () => apply(await classApi.update(group.id, { archived: !group.archived })))}>{group.archived ? t('classesUi.restore') : t('classesUi.archive')}</Button>
          {group.studentsCount === 0 && <Button variant="ghost" size="sm" className="text-rose-600" isLoading={busy === 'delete'} onClick={() => void run('delete', async () => { await classApi.remove(group.id); navigate(base); })}>{t('classesUi.delete')}</Button>}
        </div>} />
      {group.archived && <NoticeBanner tone="warning">{t('classesUi.archivedNotice')}</NoticeBanner>}
      <ErrorAlert message={error} />
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4" aria-labelledby="join-code-title">
        <div>
          <h2 id="join-code-title" className="text-sm font-bold text-slate-900">{t('classesUi.joinCode')}</h2>
          <p className="text-xs text-slate-500">{t('classesUi.joinCodeHelp')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-base font-bold tracking-widest text-slate-900">{group.joinCode}</code>
          <Button size="sm" variant="ghost" aria-label={t('classesUi.copyCode')} onClick={copyCode}><Copy className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" aria-label={t('classesUi.newCode')} isLoading={busy === 'code'} onClick={() => void run('code', async () => { const joinCode = await classApi.newJoinCode(group.id); setGroup({ ...group, joinCode }); })}><RefreshCw className="w-4 h-4" /></Button>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={group.joinEnabled} onChange={event => void run('join', async () => apply(await classApi.update(group.id, { joinEnabled: event.target.checked })))} />
            {t('classesUi.joinEnabled')}
          </label>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 lg:col-span-1" aria-labelledby="class-courses-title">
          <h2 id="class-courses-title" className="text-sm font-bold text-slate-900">{t('classesUi.courses')}</h2>
          <p className="text-xs text-slate-500">{t('classesUi.coursesHelp')}</p>
          {courses.length === 0 && <p className="text-xs text-slate-500">{t('classesUi.noCourses')}</p>}
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {courses.map(course => (
              <li key={course.id}>
                <label className="flex items-start gap-2 text-xs text-slate-800">
                  <input type="checkbox" className="mt-0.5" checked={selected.includes(course.id)} onChange={() => toggleCourse(course.id)} />
                  <span>{course.title}{course.visibility === 'restricted' && <Badge size="sm" variant="warning" className="ms-1">{t('classesUi.restricted')}</Badge>}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="primary" disabled={!coursesChanged} isLoading={busy === 'courses'} onClick={() => void run('courses', async () => apply(await classApi.setCourses(group.id, selected)))}>{t('classesUi.saveCourses')}</Button>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 lg:col-span-2" aria-labelledby="class-students-title">
          <h2 id="class-students-title" className="text-sm font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4" />{t('classesUi.students', { count: group.students.length })}</h2>
          <form onSubmit={addStudents} className="space-y-2">
            <Textarea aria-label={t('classesUi.addByEmail')} placeholder={t('classesUi.emailsPlaceholder')} rows={2} value={emails} onChange={event => setEmails(event.target.value)} required />
            <div className="flex justify-end"><Button type="submit" size="sm" variant="outline" isLoading={busy === 'students'}>{t('classesUi.addStudents')}</Button></div>
          </form>
          {group.students.length === 0 ? <p className="text-xs text-slate-500">{t('classesUi.noStudents')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr>
                  <th className="p-2 text-start">{t('classesUi.student')}</th>
                  {group.courses.map(course => <th key={course.id} className="p-2 text-start min-w-28">{course.title}</th>)}
                  <th className="p-2" />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {group.students.map(student => (
                    <tr key={student.id}>
                      <td className="p-2"><span className="font-semibold text-slate-900 block">{student.name}</span><span className="text-slate-500">{student.email}</span></td>
                      {group.courses.map(course => { const row = student.progress.find(item => item.courseId === course.id); return <td key={course.id} className="p-2"><ProgressBar percent={row?.percent || 0} showLabel /></td>; })}
                      <td className="p-2 text-end"><Button size="sm" variant="ghost" className="text-rose-600" isLoading={busy === `remove-${student.id}`} onClick={() => void run(`remove-${student.id}`, async () => apply(await classApi.removeStudent(group.id, student.id)))}>{t('classesUi.remove')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
