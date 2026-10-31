import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Percent, RotateCcw, Wallet } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { StatCard } from '../../components/molecules/StatCard';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { OrdersHistoryPage, orderStatusVariant } from '../student/OrdersPages';
import { adminPaymentApi, offlinePaymentApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime, formatMoney } from '../../utils/format';
import type { Order, Payout, PaymentSummary } from '../../types/platform';

/** Admin-only financial operations; they call the payments business service, never the database directly. */
export const AdminTransactionsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [status, setStatus] = useState('paid');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [refunding, setRefunding] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    Promise.all([adminPaymentApi.summary(), adminPaymentApi.orders({ status, page })])
      .then(([totals, result]) => { setSummary(totals); setOrders(result.data); setPages(result.pagination.pages || 1); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [status, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <OrdersHistoryPage />;
  const money = (amount: number, currency = summary?.currency || 'eur') => formatMoney(amount, currency, i18n.language);

  const refund = async () => {
    if (!refunding) return;
    setBusy(true); setError('');
    try { await adminPaymentApi.refund(refunding.id, refunding.reason); setRefunding(null); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('adminPanel.transactionsTitle')} subtitle={t('adminPanel.transactionsSubtitle')} />
      {summary && !summary.provider && <NoticeBanner tone="warning">{t('checkout.providerDisabled')}</NoticeBanner>}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('adminPanel.grossRevenue')} value={money(summary.grossRevenue)} hint={t('adminPanel.paidOrders', { count: summary.paidOrders })} icon={<DollarSign className="w-5 h-5" />} />
          <StatCard label={t('revenue.platformFees')} value={money(summary.platformFees)} icon={<Percent className="w-5 h-5" />} />
          <StatCard label={t('revenue.refunded')} value={money(summary.refundedAmount)} hint={`${summary.refundedOrders}`} icon={<RotateCcw className="w-5 h-5" />} />
          <StatCard label={t('adminPanel.payoutsTitle')} value={money(summary.pendingPayouts)} hint={`${summary.pendingPayoutCount}`} icon={<Wallet className="w-5 h-5" />} />
        </div>
      )}
      <div className="flex justify-end">
        <Select aria-label={t('adminPanel.filterStatus')} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}
          options={['all', 'paid', 'pending', 'refunded', 'failed'].map(value => ({ value, label: value === 'all' ? t('adminPanel.all') : t(`orders.status.${value}`) }))} />
      </div>
      <ErrorAlert message={error} onRetry={orders ? undefined : load} />
      {!orders && !error && <LoadingState />}
      {orders?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('orders.empty')}</p>}
      {!!orders?.length && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
          {orders.map(order => (
            <div key={order.id} className="p-4 sm:p-5 space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="font-mono text-[11px] text-slate-400">{order.invoiceNumber || `#${order.id.slice(-8)}`} · {formatDateTime(order.paidAt || order.createdAt, i18n.language)} · {order.provider}</span>
                  <span className="block text-slate-700">{t('adminPanel.buyer', { name: `${order.student?.name || ''} <${order.student?.email || ''}>` })}</span>
                  {order.items.map(item => (
                    <span key={item.itemId} className="block text-slate-900 font-semibold">
                      {item.title} <span className="font-normal text-slate-500">· {t(`orders.itemTypes.${item.itemType}`)} · {item.sellerName} · {t('adminPanel.platformFee', { amount: money(item.platformFee || 0, order.currency) })} ({item.commissionRate}%)</span>
                    </span>
                  ))}
                  {order.refund && <span className="block text-rose-700">{order.refund.reason}</span>}
                  {order.provider === 'offline' && (
                    <span className="block text-slate-600">
                      {t(`offlineUi.methods.${order.paymentMethod || 'cash'}`)}
                      {order.offlinePayment ? ` · ${t('offlineUi.recordedLine', { reference: order.offlinePayment.reference || '—', date: formatDateTime(order.offlinePayment.receivedAt, i18n.language), by: order.offlinePayment.recordedBy || '' })}` : ''}
                      {order.offlinePayment?.hasProof && <button type="button" className="ms-2 underline text-indigo-700" onClick={() => void offlinePaymentApi.downloadProof(order.id).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('offlineUi.viewProof')}</button>}
                    </span>
                  )}
                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-2">
                  <span className="text-sm font-bold tabular-nums">{money(order.totalAmount, order.currency)}</span>
                  <Badge variant={orderStatusVariant[order.status]} size="sm">{t(`orders.status.${order.status}`)}</Badge>
                  {order.status === 'paid' && refunding?.id !== order.id && <Button variant="outline" size="sm" onClick={() => setRefunding({ id: order.id, reason: '' })}>{t('adminPanel.refund')}</Button>}
                </div>
              </div>
              {refunding?.id === order.id && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input aria-label={t('adminPanel.refundReason')} placeholder={t('adminPanel.refundReason')} value={refunding.reason} onChange={event => setRefunding({ id: order.id, reason: event.target.value })} />
                  <Button variant="ghost" size="sm" onClick={() => setRefunding(null)}>{t('platformCommon.cancel')}</Button>
                  <Button variant="danger" size="sm" isLoading={busy} disabled={refunding.reason.trim().length < 3} onClick={() => void refund()}>{t('adminPanel.refundConfirm')}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};

export const AdminPayoutsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('requested');
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); adminPaymentApi.payouts(status).then(setPayouts).catch(cause => setError(apiErrorMessage(t, cause))); }, [status, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminPanel.payoutsTitle')} subtitle={t('adminPanel.payoutsSubtitle')} /><ApiModeNotice /></div>;
  const process = async (payout: Payout, decision: 'paid' | 'rejected') => {
    setBusyId(payout.id); setError('');
    try { await adminPaymentApi.processPayout(payout.id, { status: decision, reference: references[payout.id] }); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('adminPanel.payoutsTitle')} subtitle={t('adminPanel.payoutsSubtitle')} actions={
        <Select aria-label={t('adminPanel.filterStatus')} value={status} onChange={event => setStatus(event.target.value)}
          options={['requested', 'paid', 'rejected', 'all'].map(value => ({ value, label: value === 'all' ? t('adminPanel.all') : t(`revenue.payoutStatus.${value}`) }))} />
      } />
      <NoticeBanner>{t('revenue.manualNotice')}</NoticeBanner>
      <ErrorAlert message={error} onRetry={payouts ? undefined : load} />
      {!payouts && !error && <LoadingState />}
      {payouts?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('adminPanel.noPayouts')}</p>}
      {!!payouts?.length && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
          {payouts.map(payout => (
            <div key={payout.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-sm font-bold tabular-nums">{formatMoney(payout.amount, payout.currency, i18n.language)}</span>
                <span className="block text-slate-600">{payout.seller?.name} · {payout.seller?.email} · {t(`adminPanel.roles.${payout.seller?.role || 'teacher'}`)}</span>
                <span className="block text-slate-400">{formatDateTime(payout.createdAt, i18n.language)}{payout.reference ? ` · ${t('revenue.reference', { reference: payout.reference })}` : ''}</span>
              </div>
              {payout.status === 'requested' ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input aria-label={t('adminPanel.payoutReference')} placeholder={t('adminPanel.payoutReference')} value={references[payout.id] || ''} onChange={event => setReferences(prev => ({ ...prev, [payout.id]: event.target.value }))} />
                  <Button variant="outline" size="sm" disabled={busyId === payout.id} onClick={() => void process(payout, 'rejected')}>{t('adminPanel.rejectPayout')}</Button>
                  <Button variant="success" size="sm" isLoading={busyId === payout.id} disabled={!references[payout.id]?.trim()} onClick={() => void process(payout, 'paid')}>{t('adminPanel.markPaid')}</Button>
                </div>
              ) : <Badge variant={payout.status === 'paid' ? 'success' : 'danger'} size="sm">{t(`revenue.payoutStatus.${payout.status}`)}</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
