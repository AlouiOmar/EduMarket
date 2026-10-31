import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { TeacherVerificationRequest } from '../../types';
import { teacherVerificationService } from '../../services/teacherVerificationService';
import { usesApi } from '../../services/apiClient';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { useAuth } from '../../contexts/AuthContext';

export const TeacherVerificationPage: React.FC = () => {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [application, setApplication] = useState<TeacherVerificationRequest | null>(null);
  const [specialty, setSpecialty] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [credentialsSummary, setCredentialsSummary] = useState('');
  const [mockSubmitted, setMockSubmitted] = useState(false);
  const [loading, setLoading] = useState(usesApi);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    teacherVerificationService.getMine().then(request => {
      if (!active || !request) return;
      setApplication(request);
      setSpecialty(request.specialty);
      setRegistrationNumber(request.registrationNumber || '');
      setCredentialsSummary(request.credentialsSummary || '');
    }).catch(() => { if (active) setError(t('teacherVerification.loadError')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const status = usesApi ? application?.status || 'missing' : mockSubmitted ? 'pending' : 'missing';
  const statusText = status === 'pending' ? t('teacherVerification.pending')
    : status === 'approved' ? t('teacherVerification.approved')
      : status === 'rejected' ? t('teacherVerification.rejected') : t('teacherVerification.missing');
  const canSubmit = status === 'missing' || status === 'rejected';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!usesApi) { setMockSubmitted(true); return; }
    setSubmitting(true);
    try {
      const result = await teacherVerificationService.submit({ specialty, registrationNumber, credentialsSummary });
      setApplication(result);
      void refreshUser().catch(() => undefined);
    } catch { setError(t('teacherVerification.saveError')); }
    finally { setSubmitting(false); }
  };

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(''); setUploading(true);
    try {
      const document = await teacherVerificationService.uploadDocument(file);
      setApplication(current => current ? { ...current, documents: [...current.documents, document] } : current);
    } catch { setError(t('teacherVerification.uploadError')); }
    finally { setUploading(false); event.target.value = ''; }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherVerification.title')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('teacherVerification.description')}</p>
      </div>

      {loading && <p className="text-xs text-slate-500" role="status">{t('common.loading')}</p>}
      {error && <p className="text-xs text-rose-700" role="alert">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
        <div className={`flex items-center gap-3 p-4 rounded-xl border text-xs ${status === 'approved' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
          {status === 'approved' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <ShieldAlert className="w-5 h-5 shrink-0" />}
          <span>{statusText}</span>
        </div>

        {application?.notes && <p className="text-xs text-slate-600">{application.notes}</p>}

        {canSubmit && !loading && <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label={t('teacherVerification.specialty')} required>
            <Input value={specialty} onChange={event => setSpecialty(event.target.value)} required maxLength={160} />
          </FormField>
          <FormField label={t('teacherVerification.registrationNumber')}>
            <Input value={registrationNumber} onChange={event => setRegistrationNumber(event.target.value)} maxLength={80} />
          </FormField>
          <FormField label={t('teacherVerification.credentialsSummary')} hint="Minimum 30 characters">
            <Textarea value={credentialsSummary} onChange={event => setCredentialsSummary(event.target.value)} required minLength={30} maxLength={2000} rows={5} />
          </FormField>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('teacherVerification.submitting') : t('teacherVerification.submit')}
          </Button>
        </form>}

        {application && status !== 'approved' && <section className="space-y-3 border-t border-slate-100 pt-5">
          <div><h2 className="text-sm font-bold text-slate-900">{t('teacherVerification.documentsTitle')}</h2><p className="text-xs text-slate-500 mt-1">{t('teacherVerification.documentsHint')}</p></div>
          <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => void handleDocumentUpload(event)} disabled={uploading || application.documents.length >= 5} aria-label={t('teacherVerification.uploadDocument')} className="block w-full text-xs text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-indigo-700" />
          {uploading && <p role="status" className="text-xs text-slate-500">{t('teacherVerification.uploading')}</p>}
          <ul className="space-y-2">{application.documents.map((document, index) => <li key={`${document.url}-${index}`}><button type="button" onClick={() => void teacherVerificationService.downloadDocument(document).catch(() => setError(t('teacherVerification.downloadError')))} className="text-xs text-indigo-700 underline underline-offset-2">{document.name} · {t('teacherVerification.downloadDocument')}</button></li>)}</ul>
        </section>}

        {status === 'approved' && <Link to="/teacher/dashboard"><Button variant="primary">{t('workspace.teacher.dashboard')}</Button></Link>}
      </div>
    </div>
  );
};
