import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, Package, Plug, Upload } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { LmsDialog, TeacherCourseFrame } from '../../components/organisms/LmsShared';
import { formatBytes } from '../../components/organisms/LessonBlocksView';
import { integrationApi, type AiActivity, type AiConversationRow, type AiMessage, type AiStatus, type ScormPackageRow } from '../../services/integrationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

/**
 * Course integrations: AI conversation activities (server-side provider), SCORM packages (isolated player), LTI 1.3 tools
 * (registered by an administrator, placed as outline items). Each section states plainly when the server is not configured.
 */
export const IntegrationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  return (
    <TeacherCourseFrame courseId={id} title={t('integrationUi.title')} subtitle={t('integrationUi.subtitle')}>
      <AiSection courseId={id} />
      <ScormSection courseId={id} />
      <LtiSection />
    </TeacherCourseFrame>
  );
};

const NotConfigured: React.FC<{ what: 'ai' | 'scorm' | 'lti' }> = ({ what }) => {
  const { t } = useTranslation();
  return <NoticeBanner tone="warning">{t(`integrationUi.notConfigured.${what}`)}</NoticeBanner>;
};

const AiSection: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<{ status: AiStatus; activities: AiActivity[] } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<AiActivity | null>(null);
  const [rows, setRows] = useState<AiConversationRow[] | null>(null);
  const [transcript, setTranscript] = useState<{ row: AiConversationRow; messages: AiMessage[] } | null>(null);
  const [grade, setGrade] = useState({ score: '', feedback: '' });
  const [form, setForm] = useState({ title: '', instructions: '', systemPrompt: '', maxTurns: 15, retentionDays: 180, graded: false, points: 10 });
  const load = useCallback(() => integrationApi.aiActivities(courseId).then(setData).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  const act = async (operation: () => Promise<unknown>) => { setError(''); try { await operation(); await load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  const openConversations = (activity: AiActivity) => { setOpen(activity); setRows(null); integrationApi.aiConversations(courseId, activity.id).then(setRows).catch(cause => setError(apiErrorMessage(t, cause))); };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="ai-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Bot className="w-4 h-4" aria-hidden />{t('integrationUi.aiTitle')}</h2>
        {data && <Badge size="sm" variant={data.status.configured ? 'success' : 'warning'}>{data.status.configured ? t('integrationUi.configuredWith', { provider: data.status.provider, model: data.status.model }) : t('integrationUi.notOperational')}</Badge>}
      </div>
      <ErrorAlert message={error} />
      {data && !data.status.configured && <NotConfigured what="ai" />}
      {!data ? <LoadingState /> : (
        <>
          <ul className="space-y-2">
            {data.activities.map(activity => (
              <li key={activity.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs">
                <div><p className="text-sm font-semibold text-slate-800">{activity.title} <Badge size="sm">{t(`integrationUi.aiStatus.${activity.status}`)}</Badge></p>
                  <p className="text-slate-600">{t('integrationUi.aiSummary', { turns: activity.maxTurns, days: activity.retentionDays, conversations: activity.conversations || 0 })}</p></div>
                <div className="flex flex-wrap gap-1">
                  {activity.status !== 'published' && <Button size="sm" disabled={!data.status.configured} onClick={() => void act(() => integrationApi.updateAiActivity(courseId, activity.id, { status: 'published' }))}>{t('integrationUi.publish')}</Button>}
                  {activity.status === 'published' && <Button size="sm" variant="outline" onClick={() => void act(() => integrationApi.updateAiActivity(courseId, activity.id, { status: 'closed' }))}>{t('integrationUi.close')}</Button>}
                  <Button size="sm" variant="outline" onClick={() => openConversations(activity)}>{t('integrationUi.conversations')}</Button>
                </div>
              </li>
            ))}
            {!data.activities.length && <li className="text-sm text-slate-500">{t('integrationUi.noAiActivities')}</li>}
          </ul>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>{t('integrationUi.createAiActivity')}</Button>
        </>
      )}
      {creating && (
        <LmsDialog title={t('integrationUi.createAiActivity')} onClose={() => setCreating(false)} wide>
          <FormField label={t('integrationUi.aiActivityTitle')} required><Input value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} /></FormField>
          <FormField label={t('integrationUi.studentInstructions')} hint={t('integrationUi.studentInstructionsHint')}><Textarea rows={2} maxLength={4000} value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} /></FormField>
          <FormField label={t('integrationUi.systemPrompt')} hint={t('integrationUi.systemPromptHint')} required><Textarea rows={5} maxLength={8000} value={form.systemPrompt} onChange={event => setForm({ ...form, systemPrompt: event.target.value })} /></FormField>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FormField label={t('integrationUi.maxTurns')}><Input type="number" min={1} max={100} value={form.maxTurns} onChange={event => setForm({ ...form, maxTurns: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
            <FormField label={t('integrationUi.retentionDays')}><Input type="number" min={1} max={730} value={form.retentionDays} onChange={event => setForm({ ...form, retentionDays: Math.max(1, Number(event.target.value) || 1) })} /></FormField>
            <label className="flex items-center gap-2 pt-6 text-xs text-slate-700"><input type="checkbox" checked={form.graded} onChange={event => setForm({ ...form, graded: event.target.checked })} />{t('participationUi.graded')}</label>
            {form.graded && <FormField label={t('participationUi.points')}><Input type="number" min={1} max={1000} value={form.points} onChange={event => setForm({ ...form, points: Math.max(1, Number(event.target.value) || 1) })} /></FormField>}
          </div>
          <p className="text-xs text-slate-600">{t('integrationUi.privacyPolicy', { days: form.retentionDays })}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>{t('lmsCommon.cancel')}</Button>
            <Button size="sm" disabled={!form.title.trim() || form.systemPrompt.trim().length < 10} onClick={() => void act(async () => { await integrationApi.createAiActivity(courseId, form); setCreating(false); })}>{t('lmsCommon.create')}</Button>
          </div>
        </LmsDialog>
      )}
      {open && (
        <LmsDialog title={t('integrationUi.conversationsOf', { title: open.title })} onClose={() => { setOpen(null); setTranscript(null); }} wide>
          {!rows ? <LoadingState /> : transcript ? (
            <div className="space-y-3">
              <Button size="sm" variant="outline" onClick={() => setTranscript(null)}>{t('participationUi.backToList')}</Button>
              <p className="text-xs text-slate-600">{t('integrationUi.transcriptOf', { name: transcript.row.studentName, date: formatDateTime(transcript.row.deleteAfter, i18n.language) })}</p>
              <ol className="space-y-2" aria-label={t('integrationUi.transcript')}>
                {transcript.messages.map((message, index) => (
                  <li key={index} className={`rounded-lg p-2 text-sm ${message.role === 'user' ? 'bg-indigo-50' : 'bg-slate-50'}`}><span className="block text-[10px] font-semibold uppercase text-slate-500">{t(`integrationUi.roles.${message.role}`)} · {formatDateTime(message.at, i18n.language)}</span><span className="whitespace-pre-line">{message.content}</span></li>
                ))}
              </ol>
              {open.graded && (
                <div className="flex flex-wrap items-end gap-2">
                  <FormField label={t('gradebookUi.score', { max: open.points })} className="w-28"><Input inputMode="decimal" value={grade.score} onChange={event => setGrade({ ...grade, score: event.target.value })} /></FormField>
                  <FormField label={t('gradebookUi.feedback')} className="flex-1"><Input value={grade.feedback} onChange={event => setGrade({ ...grade, feedback: event.target.value })} /></FormField>
                  <Button size="sm" disabled={!grade.score} onClick={() => void act(() => integrationApi.gradeAi(courseId, open.id, { studentId: transcript.row.studentId, score: Number(grade.score.replace(',', '.')), feedback: grade.feedback }))}>{t('assessmentUi.saveGrade')}</Button>
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map(row => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                  <span>{row.studentName} · {t('integrationUi.turnsCount', { count: row.turns })} · {t(`integrationUi.conversationStatus.${row.status}`)}</span>
                  <Button size="sm" variant="outline" onClick={() => integrationApi.aiTranscript(courseId, row.id).then(result => { setGrade({ score: '', feedback: '' }); setTranscript({ row, messages: result.messages }); }).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('integrationUi.readTranscript')}</Button>
                </li>
              ))}
              {!rows.length && <li className="py-2 text-slate-500">{t('integrationUi.noConversations')}</li>}
            </ul>
          )}
        </LmsDialog>
      )}
    </section>
  );
};

const ScormSection: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<{ configured: boolean; packages: ScormPackageRow[] } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => integrationApi.scormPackages(courseId).then(setData).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  const upload = async (file: File) => {
    setBusy(true); setError(''); setMessage('');
    try { const created = await integrationApi.uploadScorm(courseId, file); setMessage(t('integrationUi.scormImported', { title: created.title })); await load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="scorm-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="scorm-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Package className="w-4 h-4" aria-hidden />{t('integrationUi.scormTitle')}</h2>
        {data && <Badge size="sm" variant={data.configured ? 'success' : 'warning'}>{data.configured ? t('integrationUi.scormOperational') : t('integrationUi.notOperational')}</Badge>}
      </div>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      {data && !data.configured && <NotConfigured what="scorm" />}
      {!data ? <LoadingState /> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
          {data.packages.map(row => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-semibold text-slate-800">{row.title}</span> · SCORM {row.version} · {t('integrationUi.fileCount', { count: row.fileCount })} · {formatBytes(row.totalSize)} · {formatDateTime(row.createdAt, i18n.language)}</span>
              <Button size="sm" variant="ghost" onClick={() => integrationApi.deleteScorm(courseId, row.id).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('lmsCommon.delete')}</Button>
            </li>
          ))}
          {!data.packages.length && <li className="px-3 py-2 text-slate-500">{t('integrationUi.noPackages')}</li>}
        </ul>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
        <Upload className="w-3.5 h-3.5" aria-hidden />{busy ? t('participationUi.uploading') : t('integrationUi.importScorm')}
        <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      </label>
      <p className="text-[11px] text-slate-500">{t('integrationUi.scormRules')}</p>
    </section>
  );
};

const LtiSection: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<{ configured: boolean; tools: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { integrationApi.availableTools().then(setData).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="lti-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lti-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Plug className="w-4 h-4" aria-hidden />{t('integrationUi.ltiTitle')}</h2>
        {data && <Badge size="sm" variant={data.configured ? 'success' : 'warning'}>{data.configured ? t('integrationUi.ltiOperational') : t('integrationUi.notOperational')}</Badge>}
      </div>
      <ErrorAlert message={error} />
      {data && !data.configured && <NotConfigured what="lti" />}
      <p className="text-xs text-slate-600">{t('integrationUi.ltiHowTo')}</p>
      {data && <ul className="flex flex-wrap gap-2 text-xs">{data.tools.map(tool => <li key={tool.id}><Badge size="sm" variant="info">{tool.name}</Badge></li>)}{!data.tools.length && <li className="text-slate-500">{t('integrationUi.noTools')}</li>}</ul>}
    </section>
  );
};
