import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '../atoms/Button';

/** Page title block shared by workspace and back-office pages. */
export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
      {subtitle && <p className="text-xs text-slate-500 mt-1 max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const LoadingState: React.FC<{ label?: string }> = ({ label }) => {
  const { t } = useTranslation();
  return <p role="status" className="p-6 text-sm text-slate-500">{label || t('platformCommon.loading')}</p>;
};

export const ErrorAlert: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{message}</span>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>{t('platformCommon.retry')}</Button>}
    </div>
  );
};

export const NoticeBanner: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warning' | 'success' }> = ({ children, tone = 'info' }) => {
  const tones = { info: 'border-slate-200 bg-slate-50 text-slate-700', warning: 'border-amber-300 bg-amber-50 text-amber-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-800' };
  return <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tones[tone]}`}><Info className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div></div>;
};

/** Shown by API-only screens in VITE_DATA_MODE=mock so demo and real data are never mixed. */
export const ApiModeNotice: React.FC = () => {
  const { t } = useTranslation();
  return <NoticeBanner tone="warning">{t('platformCommon.apiModeRequired')}</NoticeBanner>;
};

export const SimplePager: React.FC<{ page: number; pages: number; onChange: (page: number) => void }> = ({ page, pages, onChange }) => {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-xs text-slate-600">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t('adminPanel.previous')}</Button>
      <span className="tabular-nums">{t('adminPanel.pageOf', { page, pages })}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>{t('adminPanel.next')}</Button>
    </div>
  );
};
