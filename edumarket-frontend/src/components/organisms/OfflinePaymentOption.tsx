import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banknote } from 'lucide-react';
import { Button } from '../atoms/Button';
import { offlinePaymentApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate } from '../../utils/format';
import type { OfflineMethod, Order, SubscriptionPlan } from '../../types/platform';

const METHODS: OfflineMethod[] = ['cash', 'cheque', 'bank_transfer'];

/** Confirmation shown after a request: method, deadline, platform instructions and a link to the orders. */
export const OfflineRequestConfirmation: React.FC<{ order: Order; instructions?: string }> = ({ order, instructions }) => {
  const { t, i18n } = useTranslation();
  return (
    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2">
      <p className="font-semibold">{t('offlineUi.requestCreated', { method: t(`offlineUi.methods.${order.paymentMethod || 'cash'}`) })}</p>
      <p className="text-xs">{t('offlineUi.requestHelp', { date: formatDate(order.expiresAt || '', i18n.language) })}</p>
      {instructions && <p className="text-xs whitespace-pre-line rounded-lg bg-white/70 p-2">{instructions}</p>}
      <Link to="/student/orders" className="text-xs font-semibold underline">{t('checkout.viewOrders')}</Link>
    </div>
  );
};

/**
 * "Pay by cash, cheque or bank transfer": creates a pending offline order. Access is granted when an admin records
 * the payment; the student sees the platform instructions and can follow the request in their orders.
 */
export const OfflinePaymentOption: React.FC<{ courseIds?: string[]; plan?: SubscriptionPlan; instructions?: string; disabled?: boolean; onRequested?: (order: Order, instructions: string) => void }> = ({ courseIds, plan, instructions, disabled, onRequested }) => {
  const { t } = useTranslation();
  const [method, setMethod] = useState<OfflineMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState<{ order: Order; instructions: string } | null>(null);

  const request = async () => {
    setBusy(true); setError('');
    try {
      const result = await offlinePaymentApi.request({ ...(courseIds?.length ? { courseIds } : {}), ...(plan ? { plan } : {}), method });
      setRequested(result);
      onRequested?.(result.order, result.instructions);
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };

  if (requested) return <OfflineRequestConfirmation order={requested.order} instructions={requested.instructions || instructions} />;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Banknote className="w-4 h-4 text-emerald-600" />{t('offlineUi.optionTitle')}</div>
      <p className="text-xs text-slate-500">{t('offlineUi.optionHelp')}</p>
      {instructions && <p className="text-xs whitespace-pre-line text-slate-700 rounded-lg bg-slate-50 p-2">{instructions}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t('offlineUi.method')} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" value={method} onChange={event => setMethod(event.target.value as OfflineMethod)}>
          {METHODS.map(value => <option key={value} value={value}>{t(`offlineUi.methods.${value}`)}</option>)}
        </select>
        <Button variant="outline" size="md" isLoading={busy} disabled={disabled} onClick={() => void request()}>{t('offlineUi.request')}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
};
