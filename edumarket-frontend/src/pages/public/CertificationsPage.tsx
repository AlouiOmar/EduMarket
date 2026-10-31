import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, ShieldCheck, CheckCircle2, FileCheck, XCircle } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { apiRequest, usesApi } from '../../services/apiClient';
import { formatDate } from '../../utils/format';

interface VerifiedCertificate { code: string; studentName: string; courseTitle: string; instructorName: string; issueDate: string; status?: 'valid' | 'revoked'; revokedAt?: string | null }

/** Public certificate registry: API mode checks the code against issued certificates; mock mode keeps a demo result. */
export const CertificationsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [verifyCode, setVerifyCode] = React.useState(searchParams.get('code') || '');
  const [result, setResult] = React.useState<VerifiedCertificate | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = verifyCode.trim();
    if (!code) return;
    setResult(null); setNotFound(false);
    if (!usesApi) {
      setResult({ code, studentName: 'Karim Benali', courseTitle: 'Architectures Modernes React 19 & Node.js pour la Production', instructorName: 'Dr. Sarah Mansour', issueDate: '2026-02-14' });
      return;
    }
    setChecking(true);
    try { setResult((await apiRequest<{ data: VerifiedCertificate }>(`/certificates/verify/${encodeURIComponent(code)}`)).data); }
    catch { setNotFound(true); }
    finally { setChecking(false); }
  };

  React.useEffect(() => { if (searchParams.get('code')) void handleVerify(); }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-16">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
          <Award className="w-4 h-4" />
          <span>{t('certificationsUi.kicker')}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">{t('certificationsUi.title')}</h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{t('certificationsUi.text')}</p>
      </div>

      <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-slate-900 text-center">{t('certificationsUi.verifyTitle')}</h2>
        <form onSubmit={handleVerify} className="flex gap-2">
          <Input aria-label={t('certificationsUi.codeLabel')} value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder={t('certificationsUi.codePlaceholder')} maxLength={64} required />
          <Button type="submit" variant="primary" isLoading={checking}>{t('certificationsUi.verify')}</Button>
        </form>
        {result && (
          <div role="status" className={`p-4 rounded-xl border text-xs space-y-2 mt-4 ${result.status === 'revoked' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
            {result.status === 'revoked'
              ? <div className="flex items-center gap-2 font-bold text-rose-800"><XCircle className="w-4 h-4" /><span>{t('certificateStatusUi.revoked', { date: formatDate(result.revokedAt || '', i18n.language) })}</span></div>
              : <div className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 className="w-4 h-4" /><span>{t('certificationsUi.valid')}</span></div>}
            <dl className="space-y-1">
              <div><dt className="inline">{t('certificationsUi.holder')} </dt><dd className="inline font-bold">{result.studentName}</dd></div>
              <div><dt className="inline">{t('certificationsUi.course')} </dt><dd className="inline font-bold">{result.courseTitle}</dd></div>
              {result.instructorName && <div><dt className="inline">{t('certificationsUi.instructor')} </dt><dd className="inline font-bold">{result.instructorName}</dd></div>}
              <div><dt className="inline">{t('certificationsUi.issued')} </dt><dd className="inline font-bold">{formatDate(result.issueDate, i18n.language)}</dd></div>
              <div><dt className="inline">{t('certificationsUi.code')} </dt><dd className="inline font-mono">{result.code}</dd></div>
            </dl>
          </div>
        )}
        {notFound && (
          <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4" /><span>{t('certificationsUi.notFound')}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {([['continuous', Award, 'text-indigo-600'], ['online', ShieldCheck, 'text-amber-600'], ['inPerson', FileCheck, 'text-emerald-600']] as const).map(([key, Icon, color]) => (
          <div key={key} className="p-6 bg-white border border-slate-200 rounded-xl space-y-3">
            <Icon className={`w-8 h-8 ${color}`} />
            <h3 className="text-base font-bold text-slate-900">{t(`certificationsUi.${key}`)}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{t(`certificationsUi.${key}Text`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
