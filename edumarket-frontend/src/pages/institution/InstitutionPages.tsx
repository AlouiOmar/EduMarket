import React, { useEffect, useState } from 'react';
import { describeApiError } from '../../utils/apiErrors';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Building2, 
  Users, 
  BookOpen, 
  FileCheck, 
  DollarSign, 
  Activity, 
  Plus, 
  UserPlus, 
  CheckCircle2, 
  Settings,
  Mail,
  Shield
} from 'lucide-react';
import { mockInstitutions, mockCourses, mockExams } from '../../mocks/mockData';
import { StatCard } from '../../components/molecules/StatCard';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { FormField } from '../../components/molecules/FormField';
import { examService, type ExamRegistration } from '../../services/examService';
import { Course, Exam } from '../../types';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { ApiInstitutionAnalyticsPage } from './InstitutionAnalyticsPages';
import { institutionService, type AffiliatedTeacher, type InstitutionInternalRole, type InstitutionInvite } from '../../services/institutionService';

export const InstitutionExamGradingPage: React.FC = () => {
  const { t } = useTranslation();
  const [exams, setExams] = useState<Exam[]>([]);
  const [selected, setSelected] = useState('');
  const [registrations, setRegistrations] = useState<ExamRegistration[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { examService.listManage().then(setExams).catch(e => setError(describeApiError(e))); }, []);
  useEffect(() => {
    if (!selected) { setRegistrations([]); return; }
    examService.listRegistrations(selected).then(setRegistrations).catch(e => setError(describeApiError(e)));
  }, [selected]);
  const save = async (studentId: string) => {
    const value = Number(scores[studentId]);
    if (!Number.isFinite(value) || value < 0 || value > 100) { setError(t('institutionUi.scoreRange')); return; }
    try {
      await examService.gradeRegistration(selected, studentId, value, feedback[studentId] || '');
      setRegistrations(await examService.listRegistrations(selected));
      setNotice(t('institutionUi.resultSaved')); setError('');
    } catch (e) { setError(describeApiError(e)); }
  };

  return <section className="space-y-6">
    <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('institutionUi.examResultsTitle')}</h1><p className="text-sm text-slate-500 mt-1">{t('institutionUi.examResultsSubtitle')}</p></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <label className="block max-w-xl text-sm font-semibold">{t('institutionUi.exam')}
      <select className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3" value={selected} onChange={e => { setSelected(e.target.value); setNotice(''); }}>
        <option value="">{t('institutionUi.chooseExam')}</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title} — {exam.courseTitle}</option>)}
      </select>
    </label>
    {selected && <div className="space-y-3">{registrations.length === 0 && <p className="text-sm text-slate-500">{t('institutionUi.noRegistrations')}</p>}{registrations.map(reg => <article key={reg.studentId} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold text-slate-900">{reg.studentName}</h2><p className="text-xs text-slate-500">{reg.email}</p></div>{reg.result && <p className="text-sm font-semibold">{reg.result.score}% · {reg.result.passed ? t('institutionUi.passed') : t('institutionUi.notPassed')}</p>}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[130px_1fr_auto]"><label className="text-xs font-semibold">{t('institutionUi.score')}<input type="number" min="0" max="100" value={scores[reg.studentId] ?? (reg.result ? String(reg.result.score) : '')} onChange={e => setScores(v => ({ ...v, [reg.studentId]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" /></label><label className="text-xs font-semibold">{t('institutionUi.feedback')}<textarea maxLength={2000} value={feedback[reg.studentId] ?? reg.result?.feedback ?? ''} onChange={e => setFeedback(v => ({ ...v, [reg.studentId]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" rows={2} /></label><button onClick={() => save(reg.studentId)} className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">{t('institutionUi.saveResult')}</button></div>
    </article>)}</div>}
  </section>;
};

export const InstitutionDashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const inst = mockInstitutions[0];
  const [institutionCourses, setInstitutionCourses] = useState<typeof mockCourses>([]);
  const [institutionExams, setInstitutionExams] = useState<typeof mockExams>([]);
  const [affiliationTeachers, setAffiliationTeachers] = useState<AffiliatedTeacher[]>([]);
  const [institutionName, setInstitutionName] = useState(usesApi ? '' : mockInstitutions[0].name);
  const [dashboardError, setDashboardError] = useState('');
  useEffect(() => {
    if (usesApi) {
      Promise.all([courseService.getMyCourses(), examService.listManage(), institutionService.teachers(), institutionService.application()])
        .then(([courses, exams, teachers, profile]) => {
          setInstitutionCourses(courses.data); setInstitutionExams(exams); setAffiliationTeachers(teachers);
          setInstitutionName(profile?.name || '');
        }).catch(cause => setDashboardError(describeApiError(cause) || t('institutionUi.dashboardError')));
    } else {
      setInstitutionCourses(mockCourses);
      setInstitutionExams(mockExams);
    }
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('institution.dashboardTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{usesApi ? institutionName : t('institutionUi.accreditedCampus', { name: inst.name })}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/institution/teachers">
            <Button variant="outline" size="sm" leftIcon={<UserPlus className="w-4 h-4" />}>
              {t('institutionUi.inviteTeacher')}
            </Button>
          </Link>
          <Link to="/institution/exams">
            <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
              {t('institutionUi.createExamCenter')}
            </Button>
          </Link>
        </div>
      </div>

      {dashboardError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{dashboardError}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('institution.affiliatedTeachers')}
          value={usesApi ? affiliationTeachers.length : inst.teachersCount}
          icon={<Users className="w-5 h-5" />}
          hint={t('institutionUi.teachersHint')}
        />
        <StatCard
          label={usesApi ? t('institution.enrollmentsAcrossCourses') : t('institution.enrolledStudents')}
          value={usesApi ? institutionCourses.reduce((count, course) => count + course.studentsCount, 0) : inst.studentsCount}
          icon={<Users className="w-5 h-5" />}
          hint={usesApi ? t('institution.enrollmentHint') : t('institutionUi.cohorts')}
        />
        <StatCard
          label={t('institution.institutionalCourses')}
          value={usesApi ? institutionCourses.length : inst.coursesCount}
          icon={<BookOpen className="w-5 h-5" />}
          hint={t('institutionUi.labelledPaths')}
        />
        <StatCard
          label={t('institutionUi.certificationRate')}
          value={usesApi ? '—' : '91.4 %'}
          icon={<FileCheck className="w-5 h-5" />}
          trend={usesApi ? undefined : 'up'}
          change={usesApi ? undefined : '+3.2%'}
        />
      </div>

      {/* Cohorts & Teachers quick glance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900">{t('institutionUi.recentTeachers')}</h3>
          {usesApi ? <div className="divide-y divide-slate-100 text-xs">{affiliationTeachers.map(teacher => <div key={teacher.id} className="py-2.5"><span className="font-bold text-slate-800">{teacher.name}</span><span className="block text-slate-400">{teacher.headline || teacher.email}</span></div>)}{affiliationTeachers.length === 0 && <p className="py-3 text-xs text-slate-500">{t('institutionUi.noTeachers')}</p>}</div> : <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800">Dr. Sarah Mansour</span>
                <span className="text-slate-400 block">Informatique & Architectures Logicielles</span>
              </div>
              <Badge variant="success" size="sm">{t('institutionUi.active')}</Badge>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800">Alexandre Dupont</span>
                <span className="text-slate-400 block">Cybersécurité & Audit SOC</span>
              </div>
              <Badge variant="warning" size="sm">{t('institutionUi.validationPending')}</Badge>
            </div>
          </div>}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900">{t('institutionUi.scheduledExams')}</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {institutionExams.map(ex => (
              <div key={ex.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800">{ex.title}</span>
                  <span className="text-slate-400 block">{ex.type === 'online' ? t('institutionUi.proctoredOnline') : (ex.location ? [ex.location.venue, ex.location.city].filter(Boolean).join(', ') : t('institutionUi.onSiteLab'))}</span>
                </div>
                <Badge variant={ex.type === 'online' ? 'purple' : 'default'} size="sm">
                  {ex.durationMinutes} min
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const INTERNAL_ROLES: InstitutionInternalRole[] = ['teacher', 'coordinator', 'examiner'];

/** One affiliated teacher: internal role and revenue share (future sales only), saved together. */
const InstitutionMemberRow: React.FC<{ teacher: AffiliatedTeacher; onSaved: (teacher: AffiliatedTeacher) => void; onError: (message: string) => void; onEnd: () => void }> = ({ teacher, onSaved, onError, onEnd }) => {
  const { t } = useTranslation();
  const [role, setRole] = useState<InstitutionInternalRole>(teacher.internalRole || 'teacher');
  const [share, setShare] = useState(teacher.revenueSharePercent || 0);
  const [busy, setBusy] = useState(false);
  const dirty = role !== (teacher.internalRole || 'teacher') || share !== (teacher.revenueSharePercent || 0);
  const save = async () => {
    setBusy(true); onError('');
    try { onSaved(await institutionService.updateMember(teacher.id, { internalRole: role, revenueSharePercent: share })); }
    catch (cause) { onError(describeApiError(cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="border-t border-slate-100 py-3 space-y-2">
      <div><div className="text-sm font-semibold">{teacher.name}</div><div className="text-xs text-slate-500">{teacher.email}{teacher.headline ? ` · ${teacher.headline}` : ''}</div></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600 flex flex-col gap-1">{t('membersUi.role')}
          <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs" value={role} onChange={event => setRole(event.target.value as InstitutionInternalRole)}>
            {INTERNAL_ROLES.map(value => <option key={value} value={value}>{t(`membersUi.roles.${value}`)}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600 flex flex-col gap-1">{t('affiliation.sharePercent')}
          <Input type="number" min={0} max={50} step={1} value={share} onChange={event => setShare(Math.max(0, Math.min(50, Number(event.target.value))))} className="w-24" />
        </label>
        <Button variant="outline" size="sm" disabled={!dirty} isLoading={busy} onClick={() => void save()}>{t('membersUi.save')}</Button>
        <Button variant="ghost" size="sm" className="text-rose-600" onClick={onEnd}>{t('affiliation.end')}</Button>
      </div>
    </div>
  );
};

export const InstitutionTeachersPage: React.FC = () => {
  const { t } = useTranslation();
  const [inviteEmail, setInviteEmail] = useState('');
  const [sharePercent, setSharePercent] = useState(0);
  const [invited, setInvited] = useState(false);
  const [teachers, setTeachers] = useState<AffiliatedTeacher[]>([]);
  const [invitations, setInvitations] = useState<InstitutionInvite[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!usesApi) return;
    Promise.all([institutionService.teachers(), institutionService.sentInvitations()])
      .then(([currentTeachers, currentInvites]) => { setTeachers(currentTeachers); setInvitations(currentInvites); })
      .catch(cause => setError(describeApiError(cause)));
  }, []);
  const sendInvitation = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setInvited(false);
    try {
      if (usesApi) {
        await institutionService.inviteTeacher(inviteEmail, sharePercent);
        setInvitations(await institutionService.sentInvitations());
      }
      setInvited(true); setInviteEmail('');
    } catch (cause) { setError(describeApiError(cause)); }
  };

  const endAffiliation = async (teacherId: string) => {
    setError('');
    try { await institutionService.endAffiliation(teacherId); setTeachers(prev => prev.filter(teacher => teacher.id !== teacherId)); setInvitations(await institutionService.sentInvitations()); }
    catch (cause) { setError(describeApiError(cause)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('institutionUi.teamTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('institutionUi.teamSubtitle')}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900">{t('institutionUi.inviteNew')}</h3>
        {usesApi && <p className="text-xs text-slate-500">{t('affiliation.inviteNotice')}</p>}
        <form onSubmit={sendInvitation} className="flex flex-wrap items-end gap-2 max-w-2xl">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="professeur@institution.edu"
            required
          />
          {usesApi && (
            <label className="text-xs text-slate-600 flex flex-col gap-1" title={t('affiliation.shareHint')}>
              {t('affiliation.sharePercent')}
              <Input type="number" min={0} max={50} step={1} value={sharePercent} onChange={(e) => setSharePercent(Math.max(0, Math.min(50, Number(e.target.value))))} className="w-28" />
            </label>
          )}
          <Button type="submit" variant="primary" size="md">
            {t('institutionUi.sendInvite')}
          </Button>
        </form>
        {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
        {invited && (
          <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('institutionUi.inviteSent')}</span>
          </div>
        )}
      </div>
      {usesApi && <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-900">{t('affiliation.teachersTitle', { count: teachers.length })}</h3><p className="mt-1 text-xs text-slate-500">{t('membersUi.rolesHelp')}</p>{teachers.map(teacher => <InstitutionMemberRow key={teacher.id} teacher={teacher} onSaved={updated => setTeachers(prev => prev.map(item => item.id === updated.id ? updated : item))} onError={setError} onEnd={() => void endAffiliation(teacher.id)} />)}</div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-900">{t('affiliation.historyTitle')}</h3>{invitations.map(invite => <div key={invite.id} className="flex justify-between gap-3 border-t border-slate-100 py-3 text-sm"><span>{invite.teacher?.name || invite.teacher?.email} · {t('affiliation.shareInfo', { percent: invite.revenueSharePercent || 0 })}</span><Badge variant={invite.status === 'accepted' ? 'success' : invite.status === 'pending' ? 'warning' : 'default'} size="sm">{t(`affiliation.statuses.${invite.status}`)}</Badge></div>)}</div>
      </div>}
    </div>
  );
};

export const InstitutionCoursesPage: React.FC = () => {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!usesApi) { setCourses(mockCourses); return; }
    courseService.getMyCourses().then(result => setCourses(result.data)).catch(cause => setError(describeApiError(cause)));
  }, []);
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('institutionUi.catalogTitle')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('institutionUi.catalogSubtitle')}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
        {courses.map(c => (
          <div key={c.id} className="p-4 sm:p-6 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs text-indigo-600 font-semibold">{c.category}</span>
              <h3 className="text-sm font-bold text-slate-900">{c.title}</h3>
              <span className="text-xs text-slate-500">{t('institutionUi.courseBy', { name: c.teacherName, count: c.studentsCount })}</span>
            </div>
            <Badge variant={usesApi ? (c.status === 'published' ? 'success' : 'warning') : 'success'} size="sm">{usesApi ? t(`courseStatus.${c.status}`, { defaultValue: c.status }) : t('institutionUi.accredited')}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
};

const MockInstitutionAnalyticsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('institutionUi.mockAnalyticsTitle')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('institutionUi.mockAnalyticsSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('institutionUi.attendance')} value="88.7 %" trend="up" change="+2.4%" />
        <StatCard label={t('institutionUi.averageGrade')} value="15.8 / 20" hint={t('institutionUi.cohortAverage')} />
        <StatCard label={t('institutionUi.averageDuration')} value={t('institutionUi.days')} hint={t('institutionUi.steadyPace')} />
      </div>
    </div>
  );
};

export const InstitutionAnalyticsPage: React.FC = () => usesApi ? <ApiInstitutionAnalyticsPage /> : <MockInstitutionAnalyticsPage />;
