import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, X } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Select } from '../atoms/Select';
import { Textarea } from '../atoms/Textarea';
import { FormField } from '../molecules/FormField';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import { reportApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { ReportReason, ReportTarget } from '../../types/platform';

const reasons: ReportReason[] = ['inappropriate', 'harassment', 'spam', 'copyright', 'misinformation', 'other'];

/** Report entry point shared by course pages, reviews, messages and profiles. Hidden for visitors and in mock mode. */
export const ReportButton: React.FC<{ targetType: ReportTarget; targetId: string; compact?: boolean; className?: string }> = ({ targetType, targetId, compact = false, className = '' }) => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('inappropriate');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!usesApi || !isAuthenticated) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSending(true); setMessage(null);
    try { await reportApi.create({ targetType, targetId, reason, details: details.trim() || undefined }); setMessage({ tone: 'success', text: t('reports.sent') }); setDetails(''); }
    catch (cause) { setMessage({ tone: 'error', text: apiErrorMessage(t, cause) }); }
    finally { setSending(false); }
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setMessage(null); }} className={`inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 transition-colors ${className}`} aria-label={t('reports.title')}>
        <Flag className="w-3.5 h-3.5" />{!compact && <span>{t('reports.report')}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label={t('reports.title')}>
          <form onSubmit={submit} className="relative w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 space-y-4">
            <button type="button" onClick={() => setOpen(false)} aria-label={t('platformCommon.close')} className="absolute top-4 end-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            <h2 className="text-base font-bold text-slate-900">{t('reports.title')}</h2>
            <FormField label={t('reports.reason')} required>
              <Select value={reason} onChange={event => setReason(event.target.value as ReportReason)} options={reasons.map(value => ({ value, label: t(`reports.reasons.${value}`) }))} />
            </FormField>
            <FormField label={t('reports.details')}><Textarea value={details} onChange={event => setDetails(event.target.value)} rows={3} maxLength={1000} /></FormField>
            {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{message.text}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('platformCommon.close')}</Button>
              <Button type="submit" variant="danger" size="sm" isLoading={sending} disabled={message?.tone === 'success'}>{t('reports.submit')}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
