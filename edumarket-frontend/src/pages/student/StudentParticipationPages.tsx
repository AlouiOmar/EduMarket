import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { StudentCourseFrame } from '../../components/organisms/LmsShared';
import { DiscussionThread, GroupFiles, JournalEntries } from '../../components/organisms/ParticipationViews';
import { RichTextView } from '../../components/organisms/LessonBlocksView';
import { useAuth } from '../../contexts/AuthContext';
import { participationApi, type Announcement, type AttendanceView, type Discussion, type GroupsView, type Journal, type JournalEntry } from '../../services/participationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

const useCourseId = () => useParams<{ id: string }>().id || '';

export const StudentDiscussionsPage: React.FC = () => {
  const { t } = useTranslation();
  const courseId = useCourseId();
  const { user } = useAuth();
  const [discussions, setDiscussions] = useState<Discussion[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => participationApi.discussions(courseId).then(setDiscussions).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  return (
    <StudentCourseFrame courseId={courseId} title={t('participationUi.discussionsTitle')}>
      <ErrorAlert message={error} />
      {open ? (
        <div className="space-y-3">
          <Button size="sm" variant="outline" onClick={() => { setOpen(null); void load(); }}>{t('participationUi.backToList')}</Button>
          <DiscussionThread courseId={courseId} discussionId={open} manager={false} currentUserId={user?.id} />
        </div>
      ) : !discussions ? (!error && <LoadingState />) : (
        <ul className="space-y-2">
          {discussions.map(discussion => (
            <li key={discussion.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <button type="button" className="text-start text-sm font-semibold text-indigo-700 hover:underline" onClick={() => setOpen(discussion.id)}>{discussion.title}</button>
              <p className="text-xs text-slate-600">{t('participationUi.postCount', { count: discussion.posts || 0 })}{discussion.groupId ? ` · ${t('participationUi.myGroupOnly')}` : ''}{discussion.status === 'closed' ? ` · ${t('participationUi.closed')}` : ''}{discussion.graded ? ` · ${t('participationUi.gradedOn', { points: discussion.points })}` : ''}</p>
            </li>
          ))}
          {!discussions.length && <li className="text-sm text-slate-500">{t('participationUi.noDiscussions')}</li>}
        </ul>
      )}
    </StudentCourseFrame>
  );
};

/** Private journal: the student writes entries; only they and the course teachers can read them. */
export const StudentJournalPage: React.FC = () => {
  const { t } = useTranslation();
  const courseId = useCourseId();
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { participationApi.journals(courseId).then(list => { setJournals(list); setSelected(current => current || list[0]?.id || ''); }).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  const loadEntries = useCallback(() => { if (selected) participationApi.entries(courseId, selected).then(result => setEntries(result.entries)).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, selected, t]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  const journal = journals?.find(candidate => candidate.id === selected);
  const write = async () => { setError(''); try { await participationApi.createEntry(courseId, selected, body); setBody(''); loadEntries(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <StudentCourseFrame courseId={courseId} title={t('participationUi.myJournal')} subtitle={t('participationUi.journalPrivacyStudent')}>
      <ErrorAlert message={error} />
      {!journals ? (!error && <LoadingState />) : !journals.length ? <p className="text-sm text-slate-500">{t('participationUi.noJournals')}</p> : (
        <>
          <div role="group" aria-label={t('participationUi.journalsTitle')} className="flex flex-wrap gap-2">
            {journals.map(candidate => <Button key={candidate.id} size="sm" variant={candidate.id === selected ? 'primary' : 'outline'} aria-pressed={candidate.id === selected} onClick={() => setSelected(candidate.id)}>{candidate.title}</Button>)}
          </div>
          {journal?.instructions && <RichTextView html={journal.instructions} className="text-sm" />}
          {journal?.status === 'open' ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <FormField label={t('participationUi.newEntry')}><Textarea rows={4} maxLength={20000} value={body} onChange={event => setBody(event.target.value)} /></FormField>
              <div className="flex justify-end"><Button size="sm" disabled={!body.trim()} onClick={() => void write()}>{t('participationUi.addEntry')}</Button></div>
            </div>
          ) : <NoticeBanner>{t('participationUi.journalClosed')}</NoticeBanner>}
          {!entries ? <LoadingState /> : <JournalEntries courseId={courseId} entries={entries} onChanged={loadEntries} canComment />}
        </>
      )}
    </StudentCourseFrame>
  );
};

export const StudentAnnouncementsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { participationApi.announcements(courseId).then(setAnnouncements).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  return (
    <StudentCourseFrame courseId={courseId} title={t('participationUi.announcementsTitle')}>
      <ErrorAlert message={error} />
      {!announcements ? (!error && <LoadingState />) : (
        <ul className="space-y-3">
          {announcements.map(announcement => (
            <li key={announcement.id}>
              <article className="space-y-1 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`announcement-${announcement.id}`}>
                <h2 id={`announcement-${announcement.id}`} className="text-sm font-semibold text-slate-900">{announcement.title}</h2>
                <p className="text-xs text-slate-500">{announcement.sentAt ? formatDateTime(announcement.sentAt, i18n.language) : ''}</p>
                <RichTextView html={announcement.body} className="text-sm" />
              </article>
            </li>
          ))}
          {!announcements.length && <li className="text-sm text-slate-500">{t('participationUi.noAnnouncements')}</li>}
        </ul>
      )}
    </StudentCourseFrame>
  );
};

export const StudentGroupsPage: React.FC = () => {
  const { t } = useTranslation();
  const courseId = useCourseId();
  const { user } = useAuth();
  const [view, setView] = useState<GroupsView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => participationApi.groups(courseId).then(setView).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  const act = async (operation: () => Promise<unknown>) => { setError(''); try { await operation(); await load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <StudentCourseFrame courseId={courseId} title={t('participationUi.myGroups')}>
      <ErrorAlert message={error} />
      {!view ? (!error && <LoadingState />) : (
        <>
          {view.groups.filter(group => group.mine).map(group => (
            <section key={group.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`group-${group.id}`}>
              <h2 id={`group-${group.id}`} className="text-sm font-semibold text-slate-900">{group.name} <span className="font-normal text-slate-500">· {view.sets.find(set => set.id === group.setId)?.name}</span></h2>
              <p className="text-xs text-slate-600">{t('participationUi.members')} : {group.members.map(member => member.name).join(', ')}</p>
              {view.sets.find(set => set.id === group.setId)?.mode === 'self' && view.sets.find(set => set.id === group.setId)?.selfSignupOpen && <Button size="sm" variant="ghost" onClick={() => void act(() => participationApi.leaveGroup(courseId, group.id))}>{t('participationUi.leave')}</Button>}
              <h3 className="text-xs font-semibold text-slate-800">{t('participationUi.sharedFiles')}</h3>
              <GroupFiles courseId={courseId} groupId={group.id} manager={false} currentUserId={user?.id} />
            </section>
          ))}
          {view.sets.filter(set => set.mode === 'self' && set.selfSignupOpen && !view.groups.some(group => group.setId === set.id && group.mine)).map(set => (
            <section key={set.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`signup-${set.id}`}>
              <h2 id={`signup-${set.id}`} className="text-sm font-semibold text-slate-900">{t('participationUi.chooseGroup', { name: set.name })}</h2>
              <ul className="flex flex-wrap gap-2">
                {view.groups.filter(group => group.setId === set.id).map(group => (
                  <li key={group.id}><Button size="sm" variant="outline" disabled={group.memberCount >= set.maxMembers} onClick={() => void act(() => participationApi.joinGroup(courseId, group.id))}>
                    {t('participationUi.joinGroup', { name: group.name, count: group.memberCount, max: set.maxMembers })}</Button></li>
                ))}
              </ul>
            </section>
          ))}
          {!view.groups.some(group => group.mine) && !view.sets.some(set => set.mode === 'self' && set.selfSignupOpen) && <p className="text-sm text-slate-500">{t('participationUi.noMyGroups')}</p>}
        </>
      )}
    </StudentCourseFrame>
  );
};

export const StudentAttendancePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const courseId = useCourseId();
  const [view, setView] = useState<AttendanceView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { participationApi.attendance(courseId).then(setView).catch(cause => setError(apiErrorMessage(t, cause))); }, [courseId, t]);
  return (
    <StudentCourseFrame courseId={courseId} title={t('participationUi.myAttendance')}>
      <ErrorAlert message={error} />
      {!view ? (!error && <LoadingState />) : (
        <>
          {view.stats && <p className="text-sm text-slate-700">{t('participationUi.attendanceStats', view.stats)}</p>}
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {view.sessions.map(session => {
              const record = view.records.find(row => row.sessionId === session.id);
              return (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>{session.title} · <span className="text-slate-500">{formatDateTime(session.date, i18n.language)}</span></span>
                  {record ? <Badge size="sm" variant={record.status === 'present' ? 'success' : record.status === 'absent' ? 'danger' : 'warning'}>{t(`participationUi.attendanceStatus.${record.status}`)}</Badge> : <span className="text-xs text-slate-500">—</span>}
                </li>
              );
            })}
            {!view.sessions.length && <li className="px-4 py-2 text-slate-500">{t('participationUi.noSessions')}</li>}
          </ul>
        </>
      )}
    </StudentCourseFrame>
  );
};
