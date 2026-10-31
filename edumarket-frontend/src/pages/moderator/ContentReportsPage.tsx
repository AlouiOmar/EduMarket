import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import { reportApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import type { ContentReport } from '../../types/platform';

type StatusFilter = ContentReport['status'] | 'all';
const reportStatuses: StatusFilter[] = ['open', 'escalated', 'actioned', 'dismissed', 'all'];

/** Generic content reports (courses, reviews, private messages, profiles). Moderators escalate account cases to admins. */
export const ContentReportsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { role } = useAuth();
  const [status, setStatus] = useState<StatusFilter>(role === 'admin' ? 'escalated' : 'open');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [reports, setReports] = useState<ContentReport[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    reportApi.queue({ status, page }).then(result => { setReports(result.data); setPages(result.pagination.pages || 1); }).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [status, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6 max-w-4xl mx-auto"><PageHeader title={t('reports.queueTitle')} subtitle={t('reports.queueSubtitle')} /><ApiModeNotice /></div>;

  const decide = async (report: ContentReport, decision: 'actioned' | 'dismissed') => {
    setBusyId(report.id); setError('');
    try { await reportApi.decide(report.id, decision, notes[report.id] || ''); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };
  const actionLabel = (report: ContentReport) => report.targetType === 'user' && role === 'admin' ? t('reports.actions.userAdmin') : t(`reports.actions.${report.targetType}`);
  const canDecide = (report: ContentReport) => report.status === 'open' || (report.status === 'escalated' && role === 'admin');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title={t('reports.queueTitle')} subtitle={t('reports.queueSubtitle')} actions={
        <Select aria-label={t('adminPanel.filterStatus')} value={status} onChange={event => { setStatus(event.target.value as StatusFilter); setPage(1); }}
          options={reportStatuses.map(value => ({ value, label: value === 'all' ? t('adminPanel.all') : t(`reports.statuses.${value}`) }))} />
      } />
      <ErrorAlert message={error} onRetry={reports ? undefined : load} />
      {!reports && !error && <LoadingState />}
      {reports?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('reports.empty')}</p>}
      {reports?.map(report => (
        <article key={report.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning" size="sm">{t(`reports.targetTypes.${report.targetType}`)}</Badge>
            <Badge variant="danger" size="sm">{t(`reports.reasons.${report.reason}`)}</Badge>
            <Badge variant={canDecide(report) ? 'info' : 'default'} size="sm">{t(`reports.statuses.${report.status}`)}</Badge>
            <span className="text-slate-400">{formatDateTime(report.createdAt, i18n.language)}</span>
          </div>
          {report.snapshot.title && <h3 className="text-sm font-bold text-slate-900">{report.snapshot.title}</h3>}
          {report.snapshot.excerpt && <blockquote className="border-s-2 border-slate-200 ps-3 text-slate-700 whitespace-pre-line">{report.snapshot.excerpt}</blockquote>}
          <p className="text-slate-500">
            {report.snapshot.ownerName ? `${t('reports.owner', { name: report.snapshot.ownerName })} · ` : ''}
            {report.reporter ? t('reports.reportedBy', { name: report.reporter.name }) : ''}
          </p>
          {report.details && <p className="text-rose-700">{report.details}</p>}
          {report.decisionNote && <p className="text-slate-600">{t('courseStatus.moderationNote', { note: report.decisionNote })}</p>}
          {report.targetType === 'course' && <Link to={`/courses/${report.targetId}`} className="text-indigo-700 underline underline-offset-2">{t('moderation.preview')}</Link>}
          {canDecide(report) && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input aria-label={t('moderation.notePlaceholder')} placeholder={t('moderation.notePlaceholder')} value={notes[report.id] || ''} onChange={event => setNotes(prev => ({ ...prev, [report.id]: event.target.value }))} />
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" disabled={busyId === report.id} onClick={() => void decide(report, 'dismissed')}>{t('reports.dismiss')}</Button>
                <Button variant="danger" size="sm" isLoading={busyId === report.id} onClick={() => void decide(report, 'actioned')}>{actionLabel(report)}</Button>
              </div>
            </div>
          )}
        </article>
      ))}
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};
