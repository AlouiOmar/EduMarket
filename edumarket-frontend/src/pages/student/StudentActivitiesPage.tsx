import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, Send } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { StudentCourseFrame } from '../../components/organisms/LmsShared';
import { integrationApi, type AiStatus, type StudentAiActivity } from '../../services/integrationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

/** AI conversation activities: data notice to accept first, then a limited conversation the teacher can read and grade. */
export const StudentActivitiesPage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [data, setData] = useState<{ status: AiStatus; activities: StudentAiActivity[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => integrationApi.studentAiActivities(id).then(setData).catch(cause => setError(apiErrorMessage(t, cause))), [id, t]);
  useEffect(() => { void load(); }, [load]);
  return (
    <StudentCourseFrame courseId={id} title={t('integrationUi.activitiesTitle')}>
      <ErrorAlert message={error} />
      {!data ? (!error && <LoadingState />) : (
        <>
          {!data.status.configured && <NoticeBanner tone="warning">{t('integrationUi.aiUnavailableStudent')}</NoticeBanner>}
          <ul className="space-y-3">{data.activities.map(activity => <li key={activity.id}><AiConversationCard courseId={id} activity={activity} onChanged={load} /></li>)}</ul>
          {!data.activities.length && <p className="text-sm text-slate-500">{t('integrationUi.noStudentActivities')}</p>}
        </>
      )}
    </StudentCourseFrame>
  );
};

const AiConversationCard: React.FC<{ courseId: string; activity: StudentAiActivity; onChanged: () => void }> = ({ courseId, activity, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [conversation, setConversation] = useState(activity.conversation);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turns = conversation?.messages.filter(entry => entry.role === 'user').length || 0;
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(false); } };
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`ai-${activity.id}`}>
      <h2 id={`ai-${activity.id}`} className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Bot className="w-4 h-4" aria-hidden />{activity.title}</h2>
      {activity.instructions && <p className="whitespace-pre-line text-sm text-slate-700">{activity.instructions}</p>}
      <ErrorAlert message={error} />
      {!conversation ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">{t('integrationUi.dataNoticeTitle')}</p>
          <p>{t('integrationUi.dataNotice', { days: activity.dataNotice.retentionDays, provider: activity.dataNotice.provider })}</p>
          <Button size="sm" disabled={!activity.open || busy} onClick={() => void act(async () => { setConversation((await integrationApi.consent(courseId, activity.id)).conversation); })}>{t('integrationUi.acceptAndStart')}</Button>
        </div>
      ) : (
        <>
          <ol className="space-y-2" aria-label={t('integrationUi.transcript')} aria-live="polite">
            {conversation.messages.map((entry, index) => (
              <li key={index} className={`rounded-lg p-2 text-sm ${entry.role === 'user' ? 'ms-8 bg-indigo-50' : 'me-8 bg-slate-50'}`}>
                <span className="block text-[10px] font-semibold uppercase text-slate-500">{t(`integrationUi.roles.${entry.role}`)} · {formatDateTime(entry.at, i18n.language)}</span>
                <span className="whitespace-pre-line">{entry.content}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">{t('integrationUi.turnsLeft', { count: Math.max(0, activity.maxTurns - turns) })} · {t('integrationUi.deletedOn', { date: formatDateTime(conversation.deleteAfter, i18n.language) })}</p>
          {conversation.status === 'active' && activity.open ? (
            <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (message.trim()) void act(async () => { const result = await integrationApi.sendMessage(courseId, activity.id, message.trim()); setConversation(result.conversation); setMessage(''); }); }}>
              <FormField label={t('integrationUi.yourMessage')}><Textarea rows={2} maxLength={2000} value={message} disabled={busy || turns >= activity.maxTurns} onChange={event => setMessage(event.target.value)} /></FormField>
              <div className="flex justify-between gap-2">
                <Button size="sm" type="button" variant="outline" disabled={busy || !turns} onClick={() => void act(async () => { setConversation(await integrationApi.submitConversation(courseId, activity.id)); onChanged(); })}>{t('integrationUi.submitConversation')}</Button>
                <Button size="sm" type="submit" leftIcon={<Send className="w-3.5 h-3.5" />} isLoading={busy} disabled={!message.trim() || turns >= activity.maxTurns}>{t('integrationUi.send')}</Button>
              </div>
            </form>
          ) : <NoticeBanner>{conversation.status === 'submitted' ? t('integrationUi.conversationSubmitted') : t('studentAssessmentUi.notOpen')}</NoticeBanner>}
        </>
      )}
    </article>
  );
};
