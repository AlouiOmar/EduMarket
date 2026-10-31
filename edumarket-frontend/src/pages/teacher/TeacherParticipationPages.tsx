import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { LmsDialog, TeacherCourseFrame, formatScore } from '../../components/organisms/LmsShared';
import { DiscussionThread, GroupFiles, JournalEntries } from '../../components/organisms/ParticipationViews';
import { RichTextView } from '../../components/organisms/LessonBlocksView';
import {
  participationApi, type Announcement, type AttendanceStatus, type AttendanceView, type CourseAnalytics, type Discussion, type GroupsView, type Journal, type JournalEntry, type Participant,
} from '../../services/participationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { fromLocalInput } from '../../utils/outline';

const useCourseId = () => useParams<{ id: string }>().id || '';
const useLoad = <T,>(loader: () => Promise<T>, deps: unknown[]) => {
  const { t } = useTranslation();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); loader().then(setData).catch(cause => setError(apiErrorMessage(t, cause))); }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, load, setError };
};

// --- Discussions ------------------------------------------------------------------------------------------------------------

export const DiscussionsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const { data, error, load, setError } = useLoad(() => participationApi.discussions(courseId), [courseId]);
  const groups = useLoad(() => participationApi.groups(courseId), [courseId]).data;
  const [open, setOpen] = useState<Discussion | null>(null);
  const [creating, setCreating] = useState(false);
  const [participants, setParticipants] = useState<{ discussion: Discussion; rows: Participant[] } | null>(null);
  const toggle = async (discussion: Discussion, changes: Partial<Discussion>) => { try { await participationApi.updateDiscussion(courseId, discussion.id, changes); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.discussionsTitle')} subtitle={t('participationUi.discussionsHint')} actions={<Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>{t('participationUi.createDiscussion')}</Button>}>
      <ErrorAlert message={error} />
      {open ? (
        <div className="space-y-3">
          <Button size="sm" variant="outline" onClick={() => { setOpen(null); load(); }}>{t('participationUi.backToList')}</Button>
          <DiscussionThread courseId={courseId} discussionId={open.id} manager />
        </div>
      ) : !data ? <LoadingState /> : (
        <ul className="space-y-2">
          {data.map(discussion => (
            <li key={discussion.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <button type="button" className="text-start text-sm font-semibold text-indigo-700 hover:underline" onClick={() => setOpen(discussion)}>{discussion.title}</button>
                <p className="text-xs text-slate-600">{t('participationUi.postCount', { count: discussion.posts || 0 })} · {discussion.groupId ? t('participationUi.groupDiscussion', { name: groups?.groups.find(group => group.id === discussion.groupId)?.name || '—' }) : t('participationUi.courseDiscussion')}
                  {discussion.graded ? ` · ${t('participationUi.gradedOn', { points: discussion.points })}` : ''}{discussion.dueAt ? ` · ${formatDateTime(discussion.dueAt, i18n.language)}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {discussion.pinned && <Badge size="sm" variant="purple">{t('participationUi.pinned')}</Badge>}
                <Button size="sm" variant="outline" onClick={() => void toggle(discussion, { pinned: !discussion.pinned })}>{discussion.pinned ? t('participationUi.unpin') : t('participationUi.pin')}</Button>
                <Button size="sm" variant="outline" onClick={() => void toggle(discussion, { status: discussion.status === 'open' ? 'closed' : 'open' })}>{discussion.status === 'open' ? t('participationUi.close') : t('participationUi.reopen')}</Button>
                {discussion.graded && <Button size="sm" variant="outline" leftIcon={<Users className="w-3.5 h-3.5" />} onClick={() => participationApi.participants(courseId, discussion.id).then(rows => setParticipants({ discussion, rows })).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('participationUi.participantsAndGrades')}</Button>}
              </div>
            </li>
          ))}
          {!data.length && <li className="text-sm text-slate-500">{t('participationUi.noDiscussions')}</li>}
        </ul>
      )}
      {creating && <CreateDiscussionDialog courseId={courseId} groups={groups} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {participants && <GradeParticipantsDialog title={participants.discussion.title} points={participants.discussion.points} rows={participants.rows.map(row => ({ id: row.studentId, name: row.name, detail: t('participationUi.participationDetail', { posts: row.posts, replies: row.replies }) }))}
        onGrade={(studentId, score, feedback) => participationApi.gradeDiscussion(courseId, participants.discussion.id, { studentId, score, feedback })} onClose={() => setParticipants(null)} />}
    </TeacherCourseFrame>
  );
};

const CreateDiscussionDialog: React.FC<{ courseId: string; groups: GroupsView | null; onClose: () => void; onSaved: () => void }> = ({ courseId, groups, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({ title: '', prompt: '', groupId: '', graded: false, points: 10, dueAt: '' });
  const [error, setError] = useState('');
  const save = async () => {
    try { await participationApi.createDiscussion(courseId, { title: form.title.trim(), prompt: form.prompt, groupId: form.groupId || null, graded: form.graded, points: form.points, dueAt: fromLocalInput(form.dueAt) }); onSaved(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('participationUi.createDiscussion')} onClose={onClose}>
      <FormField label={t('participationUi.discussionTitle')} required><Input value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
      <FormField label={t('participationUi.prompt')}><Textarea rows={3} value={form.prompt} onChange={event => setForm({ ...form, prompt: event.target.value })} /></FormField>
      <FormField label={t('participationUi.audience')}><Select value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })} options={[{ value: '', label: t('participationUi.wholeCourse') }, ...(groups?.groups || []).map(group => ({ value: group.id, label: group.name }))]} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-700 pt-6"><input type="checkbox" checked={form.graded} onChange={event => setForm({ ...form, graded: event.target.checked })} />{t('participationUi.graded')}</label>
        {form.graded && <FormField label={t('participationUi.points')}><Input type="number" min={1} max={1000} value={form.points} onChange={event => setForm({ ...form, points: Math.max(1, Number(event.target.value) || 1) })} /></FormField>}
      </div>
      <FormField label={t('participationUi.dueAt')}><Input type="datetime-local" value={form.dueAt} onChange={event => setForm({ ...form, dueAt: event.target.value })} /></FormField>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={!form.title.trim()} onClick={() => void save()}>{t('lmsCommon.create')}</Button></div>
    </LmsDialog>
  );
};

/** Grades a participative activity (discussion or journal) per student; the grade is sent to the gradebook unpublished. */
const GradeParticipantsDialog: React.FC<{ title: string; points: number; rows: { id: string; name: string; detail: string }[]; onGrade: (studentId: string, score: number, feedback: string) => Promise<unknown>; onClose: () => void }> = ({ title, points, rows, onGrade, onClose }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, { score: string; feedback: string; saved?: boolean }>>({});
  const [error, setError] = useState('');
  const save = async (id: string) => {
    const value = values[id];
    setError('');
    try { await onGrade(id, Number((value?.score || '').replace(',', '.')), value?.feedback || ''); setValues({ ...values, [id]: { ...value, saved: true } }); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <LmsDialog title={t('participationUi.gradeTitle', { title })} onClose={onClose} wide>
      <p className="text-xs text-slate-600">{t('participationUi.gradeHint', { points })}</p>
      <ErrorAlert message={error} />
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-2">
            <div className="min-w-[10rem] flex-1 text-xs"><p className="font-semibold text-slate-800">{row.name}</p><p className="text-slate-500">{row.detail}</p></div>
            <FormField label={t('gradebookUi.score', { max: points })} className="w-28"><Input inputMode="decimal" value={values[row.id]?.score || ''} onChange={event => setValues({ ...values, [row.id]: { ...values[row.id], score: event.target.value, feedback: values[row.id]?.feedback || '', saved: false } })} /></FormField>
            <FormField label={t('gradebookUi.feedback')} className="flex-1"><Input value={values[row.id]?.feedback || ''} onChange={event => setValues({ ...values, [row.id]: { ...values[row.id], feedback: event.target.value, score: values[row.id]?.score || '', saved: false } })} /></FormField>
            <Button size="sm" variant="outline" disabled={!values[row.id]?.score} onClick={() => void save(row.id)}>{values[row.id]?.saved ? t('participationUi.saved') : t('lmsCommon.save')}</Button>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-slate-500">{t('participationUi.noParticipants')}</li>}
      </ul>
    </LmsDialog>
  );
};

// --- Journals ---------------------------------------------------------------------------------------------------------------

export const JournalsPage: React.FC = () => {
  const { t } = useTranslation();
  const courseId = useCourseId();
  const { data, error, load, setError } = useLoad(() => participationApi.journals(courseId), [courseId]);
  const students = useLoad(() => participationApi.groups(courseId), [courseId]).data?.students || [];
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Journal | null>(null);
  const [studentId, setStudentId] = useState('');
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [grading, setGrading] = useState(false);
  const loadEntries = useCallback(() => { if (open) participationApi.entries(courseId, open.id, studentId || undefined).then(result => setEntries(result.entries)).catch(cause => setError(apiErrorMessage(t, cause))); }, [open, studentId, courseId]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  const [form, setForm] = useState({ title: '', instructions: '', graded: false, points: 10 });
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.journalsTitle')} subtitle={t('participationUi.journalsHint')} actions={<Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>{t('participationUi.createJournal')}</Button>}>
      <ErrorAlert message={error} />
      {open ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => { setOpen(null); setEntries(null); load(); }}>{t('participationUi.backToList')}</Button>
            <div className="flex items-end gap-2">
              <FormField label={t('participationUi.filterStudent')}><Select value={studentId} onChange={event => setStudentId(event.target.value)} options={[{ value: '', label: t('participationUi.allStudents') }, ...students.map(student => ({ value: student.id, label: student.name }))]} /></FormField>
              {open.graded && <Button size="sm" variant="outline" onClick={() => setGrading(true)}>{t('participationUi.gradeJournal')}</Button>}
            </div>
          </div>
          <h2 className="text-base font-semibold text-slate-900">{open.title}</h2>
          {open.instructions && <RichTextView html={open.instructions} className="text-sm" />}
          {!entries ? <LoadingState /> : <JournalEntries courseId={courseId} entries={entries} onChanged={loadEntries} canComment />}
        </div>
      ) : !data ? <LoadingState /> : (
        <ul className="space-y-2">
          {data.map(journal => (
            <li key={journal.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <button type="button" className="text-start text-sm font-semibold text-indigo-700 hover:underline" onClick={() => { setOpen(journal); setStudentId(''); }}>{journal.title}</button>
                <p className="text-xs text-slate-600">{t('participationUi.journalStats', { entries: journal.entries || 0, authors: journal.authors || 0 })}{journal.graded ? ` · ${t('participationUi.gradedOn', { points: journal.points })}` : ''}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => participationApi.updateJournal(courseId, journal.id, { status: journal.status === 'open' ? 'closed' : 'open' }).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{journal.status === 'open' ? t('participationUi.close') : t('participationUi.reopen')}</Button>
            </li>
          ))}
          {!data.length && <li className="text-sm text-slate-500">{t('participationUi.noJournals')}</li>}
        </ul>
      )}
      {creating && (
        <LmsDialog title={t('participationUi.createJournal')} onClose={() => setCreating(false)}>
          <p className="text-xs text-slate-600">{t('participationUi.journalPrivacy')}</p>
          <FormField label={t('participationUi.journalTitle')} required><Input value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
          <FormField label={t('participationUi.instructions')}><Textarea rows={3} value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} /></FormField>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.graded} onChange={event => setForm({ ...form, graded: event.target.checked })} />{t('participationUi.graded')}</label>
          {form.graded && <FormField label={t('participationUi.points')}><Input type="number" min={1} max={1000} value={form.points} onChange={event => setForm({ ...form, points: Math.max(1, Number(event.target.value) || 1) })} /></FormField>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>{t('lmsCommon.cancel')}</Button>
            <Button size="sm" disabled={!form.title.trim()} onClick={() => participationApi.createJournal(courseId, { ...form, title: form.title.trim() }).then(() => { setCreating(false); setForm({ title: '', instructions: '', graded: false, points: 10 }); load(); }).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('lmsCommon.create')}</Button>
          </div>
        </LmsDialog>
      )}
      {grading && open && <GradeParticipantsDialog title={open.title} points={open.points} rows={students.map(student => ({ id: student.id, name: student.name, detail: '' }))} onGrade={(id, score, feedback) => participationApi.gradeJournal(courseId, open.id, { studentId: id, score, feedback })} onClose={() => setGrading(false)} />}
    </TeacherCourseFrame>
  );
};

// --- Announcements ----------------------------------------------------------------------------------------------------------

export const AnnouncementsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const { data, error, load, setError } = useLoad(() => participationApi.announcements(courseId), [courseId]);
  const groups = useLoad(() => participationApi.groups(courseId), [courseId]).data;
  const [form, setForm] = useState({ title: '', body: '', groupIds: [] as string[], sendEmail: false, publishAt: '' });
  const [message, setMessage] = useState('');
  const submit = async (draft: boolean) => {
    setError(''); setMessage('');
    try {
      const result = await participationApi.createAnnouncement(courseId, { title: form.title.trim(), body: form.body, groupIds: form.groupIds, sendEmail: form.sendEmail, publishAt: fromLocalInput(form.publishAt), draft });
      setMessage(result.status === 'sent' ? t('participationUi.announcementSent', { count: result.stats?.recipients || 0 }) : result.status === 'scheduled' ? t('participationUi.announcementScheduled') : t('participationUi.announcementDraft'));
      setForm({ title: '', body: '', groupIds: [], sendEmail: false, publishAt: '' }); load();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const statusOf = (announcement: Announcement) => t(`participationUi.announcementStatus.${announcement.status}`);
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.announcementsTitle')} subtitle={t('participationUi.announcementsHint')}>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="new-announcement">
        <h2 id="new-announcement" className="text-sm font-semibold text-slate-900">{t('participationUi.newAnnouncement')}</h2>
        <FormField label={t('participationUi.announcementTitle')} required><Input value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
        <FormField label={t('participationUi.message')} required><Textarea rows={4} maxLength={20000} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} /></FormField>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label={t('participationUi.publishAt')} hint={t('participationUi.publishAtHint')}><Input type="datetime-local" value={form.publishAt} onChange={event => setForm({ ...form, publishAt: event.target.value })} /></FormField>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-semibold text-slate-700">{t('participationUi.audience')}</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-700">
              {(groups?.groups || []).map(group => (
                <label key={group.id} className="flex items-center gap-1"><input type="checkbox" checked={form.groupIds.includes(group.id)} onChange={event => setForm({ ...form, groupIds: event.target.checked ? [...form.groupIds, group.id] : form.groupIds.filter(id => id !== group.id) })} />{group.name}</label>
              ))}
              {!form.groupIds.length && <span className="text-slate-500">{t('participationUi.wholeCourse')}</span>}
            </div>
          </fieldset>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.sendEmail} onChange={event => setForm({ ...form, sendEmail: event.target.checked })} />{t('participationUi.sendEmail')}</label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!form.title.trim() || !form.body.trim()} onClick={() => void submit(true)}>{t('participationUi.saveDraft')}</Button>
          <Button size="sm" disabled={!form.title.trim() || !form.body.trim()} onClick={() => void submit(false)}>{form.publishAt ? t('participationUi.schedule') : t('participationUi.publishNow')}</Button>
        </div>
      </section>
      {!data ? <LoadingState /> : (
        <ul className="space-y-2">
          {data.map(announcement => (
            <li key={announcement.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{announcement.title} <Badge size="sm" variant={announcement.status === 'sent' ? 'success' : announcement.status === 'scheduled' ? 'purple' : 'default'}>{statusOf(announcement)}</Badge></h3>
                {announcement.status !== 'sent' && announcement.status !== 'sending' && <Button size="sm" variant="ghost" aria-label={t('participationUi.deleteAnnouncement', { title: announcement.title })} onClick={() => participationApi.deleteAnnouncement(courseId, announcement.id).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </div>
              <p className="text-xs text-slate-600">{announcement.sentAt ? t('participationUi.sentOn', { date: formatDateTime(announcement.sentAt, i18n.language) }) : announcement.publishAt ? t('participationUi.plannedOn', { date: formatDateTime(announcement.publishAt, i18n.language) }) : ''}
                {announcement.stats && announcement.status === 'sent' ? ` · ${t('participationUi.deliveryStats', announcement.stats)}` : ''}</p>
              <RichTextView html={announcement.body} className="text-sm" />
            </li>
          ))}
          {!data.length && <li className="text-sm text-slate-500">{t('participationUi.noAnnouncements')}</li>}
        </ul>
      )}
    </TeacherCourseFrame>
  );
};

// --- Attendance -------------------------------------------------------------------------------------------------------------

const STATUSES: AttendanceStatus[] = ['present', 'late', 'absent', 'excused'];
export const AttendancePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const { data, error, load, setError } = useLoad(() => participationApi.attendance(courseId), [courseId]);
  const [sessionId, setSessionId] = useState('');
  const [draft, setDraft] = useState<Record<string, { status: AttendanceStatus; note: string }>>({});
  const [form, setForm] = useState({ title: '', date: '' });
  const [message, setMessage] = useState('');
  useEffect(() => { if (data && !sessionId && data.sessions.length) setSessionId(data.sessions[data.sessions.length - 1].id); }, [data]);
  useEffect(() => {
    if (!data || !sessionId) return;
    setDraft(Object.fromEntries((data.students || []).map(student => {
      const record = data.records.find(row => row.sessionId === sessionId && row.studentId === student.id);
      return [student.id, { status: record?.status || 'present', note: record?.note || '' }];
    })));
  }, [data, sessionId]);
  const save = async () => {
    setError(''); setMessage('');
    try { await participationApi.saveRecords(courseId, sessionId, Object.entries(draft).map(([studentId, value]) => ({ studentId, ...value }))); setMessage(t('participationUi.attendanceSaved')); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const create = async () => { try { const created = await participationApi.createSession(courseId, { title: form.title.trim(), date: fromLocalInput(form.date)! }); setForm({ title: '', date: '' }); setSessionId(created.id); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  const session = data?.sessions.find(candidate => candidate.id === sessionId);
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.attendanceTitle')} subtitle={t('participationUi.attendanceHint')} actions={<>
      <Button size="sm" variant="outline" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={() => void participationApi.exportAttendance(courseId, 'csv').catch(cause => setError(apiErrorMessage(t, cause)))}>CSV</Button>
      <Button size="sm" variant="outline" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={() => void participationApi.exportAttendance(courseId, 'xlsx').catch(cause => setError(apiErrorMessage(t, cause)))}>XLSX</Button>
    </>}>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      <section className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4" aria-label={t('participationUi.newSession')}>
        <FormField label={t('participationUi.sessionTitle')}><Input value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
        <FormField label={t('participationUi.sessionDate')}><Input type="datetime-local" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></FormField>
        <Button size="sm" disabled={!form.title.trim() || !form.date} onClick={() => void create()}>{t('participationUi.addSession')}</Button>
      </section>
      {!data ? <LoadingState /> : !data.sessions.length ? <p className="text-sm text-slate-500">{t('participationUi.noSessions')}</p> : (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="attendance-roll">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <FormField label={t('participationUi.session')}><Select value={sessionId} onChange={event => setSessionId(event.target.value)} options={data.sessions.map(candidate => ({ value: candidate.id, label: `${candidate.title} · ${formatDateTime(candidate.date, i18n.language)}` }))} /></FormField>
            {session && <Button size="sm" variant="ghost" onClick={() => participationApi.deleteSession(courseId, session.id).then(() => { setSessionId(''); load(); }).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('participationUi.deleteSession')}</Button>}
          </div>
          <h2 id="attendance-roll" className="sr-only">{t('participationUi.roll')}</h2>
          <table className="min-w-full text-xs">
            <caption className="sr-only">{t('participationUi.rollCaption', { title: session?.title || '' })}</caption>
            <thead><tr className="text-slate-600"><th scope="col" className="py-1 text-start">{t('gradebookUi.student')}</th>{STATUSES.map(status => <th key={status} scope="col">{t(`participationUi.attendanceStatus.${status}`)}</th>)}<th scope="col" className="text-start">{t('participationUi.note')}</th><th scope="col" className="text-start">{t('participationUi.history')}</th></tr></thead>
            <tbody>
              {(data.students || []).map(student => (
                <tr key={student.id} className="border-t border-slate-100">
                  <th scope="row" className="py-1.5 text-start font-medium text-slate-800">{student.name}</th>
                  {STATUSES.map(status => (
                    <td key={status} className="text-center"><input type="radio" name={`attendance-${student.id}`} aria-label={t('participationUi.markStatus', { name: student.name, status: t(`participationUi.attendanceStatus.${status}`) })} checked={draft[student.id]?.status === status} onChange={() => setDraft({ ...draft, [student.id]: { ...draft[student.id], status } })} /></td>
                  ))}
                  <td><Input value={draft[student.id]?.note || ''} maxLength={300} aria-label={t('participationUi.noteFor', { name: student.name })} onChange={event => setDraft({ ...draft, [student.id]: { ...draft[student.id], note: event.target.value } })} /></td>
                  <td className="text-slate-600">{t('participationUi.attendanceStats', student.stats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end"><Button size="sm" onClick={() => void save()}>{t('participationUi.saveAttendance')}</Button></div>
        </section>
      )}
    </TeacherCourseFrame>
  );
};

// --- Groups -----------------------------------------------------------------------------------------------------------------

export const GroupsPage: React.FC = () => {
  const { t } = useTranslation();
  const courseId = useCourseId();
  const { data, error, load, setError } = useLoad(() => participationApi.groups(courseId), [courseId]);
  const [form, setForm] = useState({ name: '', mode: 'random' as 'manual' | 'random' | 'self', maxMembers: 3, groupCount: 2 });
  const [editing, setEditing] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [filesOf, setFilesOf] = useState<string | null>(null);
  const create = async () => { try { await participationApi.createGroupSet(courseId, { name: form.name.trim(), mode: form.mode, maxMembers: form.maxMembers, ...(form.mode !== 'random' ? { groupCount: form.groupCount } : {}) }); setForm({ ...form, name: '' }); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  const saveMembers = async (groupId: string) => { try { await participationApi.setMembers(courseId, groupId, selection); setEditing(null); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.groupsTitle')} subtitle={t('participationUi.groupsHint')}>
      <ErrorAlert message={error} />
      <section className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4" aria-label={t('participationUi.newGroupSet')}>
        <FormField label={t('participationUi.groupSetName')}><Input value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
        <FormField label={t('participationUi.groupMode')}><Select value={form.mode} onChange={event => setForm({ ...form, mode: event.target.value as typeof form.mode })} options={(['random', 'manual', 'self'] as const).map(mode => ({ value: mode, label: t(`participationUi.groupModes.${mode}`) }))} /></FormField>
        <FormField label={t('participationUi.maxMembers')}><Input type="number" min={1} max={200} value={form.maxMembers} onChange={event => setForm({ ...form, maxMembers: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
        {form.mode !== 'random' && <FormField label={t('participationUi.groupCount')}><Input type="number" min={1} max={100} value={form.groupCount} onChange={event => setForm({ ...form, groupCount: Math.max(1, Number(event.target.value) || 1) })} /></FormField>}
        <Button size="sm" disabled={!form.name.trim()} onClick={() => void create()}>{t('participationUi.createGroups')}</Button>
      </section>
      {!data ? <LoadingState /> : data.sets.map(set => (
        <section key={set.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`set-${set.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`set-${set.id}`} className="text-sm font-semibold text-slate-900">{set.name} <span className="font-normal text-slate-500">· {t(`participationUi.groupModes.${set.mode}`)} · {t('participationUi.maxMembersShort', { count: set.maxMembers })}</span></h2>
            {set.mode === 'self' && <Button size="sm" variant="outline" onClick={() => participationApi.updateGroupSet(courseId, set.id, { selfSignupOpen: !set.selfSignupOpen }).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{set.selfSignupOpen ? t('participationUi.closeSignup') : t('participationUi.openSignup')}</Button>}
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.groups.filter(group => group.setId === set.id).map(group => (
              <li key={group.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs">
                <p className="font-semibold text-slate-800">{group.name} <span className="font-normal text-slate-500">({group.memberCount})</span></p>
                {editing === group.id ? (
                  <div className="space-y-1">
                    {(data.students || []).map(student => (
                      <label key={student.id} className="flex items-center gap-2"><input type="checkbox" checked={selection.includes(student.id)} onChange={event => setSelection(event.target.checked ? [...selection, student.id] : selection.filter(id => id !== student.id))} />{student.name}</label>
                    ))}
                    <div className="flex gap-2"><Button size="sm" onClick={() => void saveMembers(group.id)}>{t('lmsCommon.save')}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('lmsCommon.cancel')}</Button></div>
                  </div>
                ) : (
                  <p className="text-slate-600">{group.members.map(member => member.name).join(', ') || t('participationUi.emptyGroup')}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {editing !== group.id && <Button size="sm" variant="outline" onClick={() => { setEditing(group.id); setSelection(group.members.map(member => member.id)); }}>{t('participationUi.editMembers')}</Button>}
                  <Button size="sm" variant="outline" onClick={() => setFilesOf(filesOf === group.id ? null : group.id)}>{t('participationUi.groupSpace')}</Button>
                </div>
                {filesOf === group.id && <GroupFiles courseId={courseId} groupId={group.id} manager />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data && !data.sets.length && <p className="text-sm text-slate-500">{t('participationUi.noGroups')}</p>}
    </TeacherCourseFrame>
  );
};

// --- Analytics --------------------------------------------------------------------------------------------------------------

export const CourseAnalyticsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const [filters, setFilters] = useState({ from: '', to: '', classId: '', inactiveDays: 14 });
  const [applied, setApplied] = useState(filters);
  const classes = useLoad(() => participationApi.analyticsClasses(courseId), [courseId]).data || [];
  const { data, error } = useLoad<CourseAnalytics>(() => participationApi.analytics(courseId, { from: fromLocalInput(applied.from) || undefined, to: fromLocalInput(applied.to) || undefined, classId: applied.classId || undefined, inactiveDays: applied.inactiveDays }), [courseId, applied]);
  const card = (label: string, value: string) => <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-slate-900">{value}</p></div>;
  return (
    <TeacherCourseFrame courseId={courseId} title={t('participationUi.analyticsTitle')} subtitle={t('participationUi.analyticsHint')}>
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4" onSubmit={event => { event.preventDefault(); setApplied(filters); }} aria-label={t('participationUi.filters')}>
        <FormField label={t('participationUi.from')}><Input type="datetime-local" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></FormField>
        <FormField label={t('participationUi.to')}><Input type="datetime-local" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></FormField>
        <FormField label={t('participationUi.class')}><Select value={filters.classId} onChange={event => setFilters({ ...filters, classId: event.target.value })} options={[{ value: '', label: t('participationUi.allClasses') }, ...classes.map(group => ({ value: group.id, label: group.name }))]} /></FormField>
        <FormField label={t('participationUi.inactiveDays')}><Input type="number" min={1} max={365} value={filters.inactiveDays} onChange={event => setFilters({ ...filters, inactiveDays: Math.max(1, Number(event.target.value) || 14) })} /></FormField>
        <Button size="sm" type="submit">{t('participationUi.apply')}</Button>
      </form>
      <ErrorAlert message={error} />
      {!data ? (!error && <LoadingState />) : (
        <>
          <section aria-labelledby="authoring" className="space-y-2">
            <h2 id="authoring" className="text-sm font-semibold text-slate-900">{t('participationUi.authoringProgress')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {card(t('participationUi.items'), String(data.authoring.items))}
              {card(t('participationUi.publishedItems'), `${data.authoring.published} / ${data.authoring.items}`)}
              {card(t('participationUi.neverPublished'), String(data.authoring.neverPublished))}
              {card(t('participationUi.pendingChanges'), String(data.authoring.pendingChanges))}
              {card(t('participationUi.scheduledItems'), String(data.authoring.scheduled))}
            </div>
          </section>
          <section aria-labelledby="learners" className="space-y-2">
            <h2 id="learners" className="text-sm font-semibold text-slate-900">{t('participationUi.learnerProgress')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {card(t('participationUi.students'), String(data.totals.students))}
              {card(t('participationUi.activeInPeriod'), String(data.totals.activeInPeriod))}
              {card(t('participationUi.inactive', { days: data.inactiveDays }), String(data.totals.inactive))}
              {card(t('participationUi.averageProgress'), data.totals.averageProgress === null ? '—' : `${data.totals.averageProgress} %`)}
              {card(t('participationUi.completionRate'), data.totals.completionRate === null ? '—' : `${data.totals.completionRate} %`)}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <caption className="sr-only">{t('participationUi.studentsCaption')}</caption>
                <thead className="bg-slate-50 text-slate-600"><tr>
                  <th scope="col" className="px-3 py-2 text-start">{t('gradebookUi.student')}</th><th scope="col">{t('participationUi.progress')}</th><th scope="col">{t('participationUi.lastActivity')}</th>
                  <th scope="col">{t('participationUi.activityLessons')}</th><th scope="col">{t('participationUi.activityAssessments')}</th><th scope="col">{t('participationUi.activityPosts')}</th><th scope="col">{t('participationUi.status')}</th>
                </tr></thead>
                <tbody>{data.students.map(student => (
                  <tr key={student.studentId} className="border-t border-slate-100 text-center">
                    <th scope="row" className="px-3 py-1.5 text-start font-medium text-slate-800">{student.name}</th>
                    <td>{student.progress} %</td>
                    <td>{student.lastActivityAt ? formatDateTime(student.lastActivityAt, i18n.language) : '—'}</td>
                    <td>{student.activity.lessons}</td><td>{student.activity.quizAttempts + student.activity.testAttempts + student.activity.submissions}</td><td>{student.activity.posts}</td>
                    <td>{student.inactive ? <Badge size="sm" variant="warning">{t('participationUi.inactiveBadge')}</Badge> : <Badge size="sm" variant="success">{t('participationUi.activeBadge')}</Badge>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="results" className="space-y-2">
            <h2 id="results" className="text-sm font-semibold text-slate-900">{t('participationUi.assessmentResults')}</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.assessments.map(column => (
                <li key={column.columnId} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                  <p className="font-semibold text-slate-800">{column.title}</p>
                  <p className="text-slate-600">{t('participationUi.resultLine', { average: column.averagePercent === null ? '—' : formatScore(column.averagePercent, i18n.language), graded: column.graded, pending: column.pending, published: column.published })}</p>
                  {column.averagePercent !== null && <div className="mt-1 h-2 rounded bg-slate-100" aria-hidden><div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.min(100, column.averagePercent)}%` }} /></div>}
                </li>
              ))}
              {!data.assessments.length && <li className="text-sm text-slate-500">{t('participationUi.noResults')}</li>}
            </ul>
          </section>
        </>
      )}
    </TeacherCourseFrame>
  );
};
