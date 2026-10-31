import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../../utils/apiErrors';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { PageHeader } from '../../components/molecules/PageStates';
import { institutionService, type InstitutionApplication } from '../../services/institutionService';

export const InstitutionApplicationsPage: React.FC = () => {
  const { t } = useTranslation();
  const [applications, setApplications] = useState<InstitutionApplication[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const refresh = async () => setApplications(await institutionService.adminApplications());
  useEffect(() => { refresh().catch(cause => setError(describeApiError(cause))); }, []);
  const review = async (application: InstitutionApplication, status: 'approved' | 'rejected') => {
    setBusyId(application.id); setError('');
    try { await institutionService.reviewApplication(application.id, status, notes[application.id] || ''); await refresh(); }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setBusyId(''); }
  };
  return (
    <section className="space-y-6">
      <PageHeader title={t('institutionApplyUi.adminTitle')} subtitle={t('institutionApplyUi.adminSubtitle')} />
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {applications.map(application => (
        <article key={application.id} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{application.name}</h2>
              <p className="text-xs text-slate-500">{typeof application.ownerId === 'string' ? application.ownerId : `${application.ownerId.name} · ${application.ownerId.email}`}</p>
            </div>
            <Badge size="sm" variant={application.status === 'approved' ? 'success' : application.status === 'pending' ? 'warning' : 'danger'}>{t(`common.${application.status}`)}</Badge>
          </div>
          <p className="text-sm text-slate-700">{application.description}</p>
          <p className="text-xs text-slate-500">{application.city}, {application.country} · {application.website || t('institutionApplyUi.noWebsite')} · {application.contactEmail}</p>
          {application.status === 'pending' && (
            <>
              <Textarea aria-label={t('institutionApplyUi.reviewNote')} placeholder={t('institutionApplyUi.reviewNote')} maxLength={1000} rows={2} value={notes[application.id] || ''} onChange={e => setNotes(current => ({ ...current, [application.id]: e.target.value }))} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" isLoading={busyId === application.id} onClick={() => review(application, 'approved')}>{t('adminPanel.approve')}</Button>
                <Button size="sm" variant="outline" disabled={busyId === application.id} onClick={() => review(application, 'rejected')}>{t('adminPanel.reject')}</Button>
              </div>
            </>
          )}
          {application.status === 'rejected' && application.reviewNote && <p className="text-sm text-rose-700">{t('courseStatus.moderationNote', { note: application.reviewNote })}</p>}
        </article>
      ))}
      {applications.length === 0 && !error && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">{t('institutionApplyUi.noApplications')}</p>}
    </section>
  );
};
