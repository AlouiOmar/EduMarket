import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Printer, FileText } from 'lucide-react';
import { mockTransactions } from '../../mocks/mockData';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { EmptyState } from '../../components/molecules/EmptyState';
import { ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { offlinePaymentApi, paymentApi, subscriptionApi } from '../../services/platformServices';
import { OfflinePaymentOption } from '../../components/organisms/OfflinePaymentOption';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatMoney } from '../../utils/format';
import type { Invoice, Order, OrderStatus, SubscriptionOffer, SubscriptionPlan, SubscriptionStatus } from '../../types/platform';

/** Student purchases: order history, invoices and subscription status. */
const MockOrdersHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const transactions = mockTransactions;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('payments.transactionHistory')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('cartUi.ordersSubtitle')}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs overflow-hidden">
        {transactions.map(tx => (
          <div key={tx.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-[11px] font-mono font-bold text-slate-400 block mb-0.5">#{tx.id} · {tx.date}</span>
              <h3 className="text-sm font-bold text-slate-900">{tx.itemName}</h3>
              <span className="text-slate-500">{tx.paymentMethod}</span>
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
              <div className="text-start sm:text-end">
                <span className="text-sm font-bold text-slate-900 tabular-nums">{tx.amount} {tx.currency}</span>
                <Badge variant={tx.status === 'succeeded' ? 'success' : 'default'} size="sm">
                  {tx.status === 'succeeded' ? t('cartUi.paid') : tx.status}
                </Badge>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => alert(t('cartUi.demoInvoiceDownload', { id: tx.id }))}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                {t('cartUi.invoice')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MockStudentSubscriptionPage: React.FC = () => {
  const { t } = useTranslation();
  const [cancelled, setCancelled] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('payments.subscriptions')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('cartUi.demoSubscriptionSubtitle')}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
          <div>
            <span className="text-xs font-bold text-indigo-600 uppercase">{t('cartUi.activePlan')}</span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">{t('cartUi.demoPlan')}</h2>
            <span className="text-xs text-slate-500">{t('cartUi.demoBilling')}</span>
          </div>
          <Badge variant="success" size="md">{t('cartUi.activeSubscription')}</Badge>
        </div>

        <div className="space-y-2 text-xs text-slate-600">
          <p>{t('cartUi.demoFeature1')}</p>
          <p>{t('cartUi.demoFeature2')}</p>
          <p>{t('cartUi.demoFeature3')}</p>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button
            variant="danger"
            size="sm"
            onClick={() => setCancelled(true)}
          >
            {t('payments.cancelSubscription')}
          </Button>
        </div>

        {cancelled && (
          <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold">
            {t('cartUi.demoCancelled')}
          </div>
        )}
      </div>
    </div>
  );
};

export const orderStatusVariant: Record<OrderStatus, 'success' | 'warning' | 'danger' | 'default'> = { paid: 'success', pending: 'warning', failed: 'danger', refunded: 'default' };

const ApiOrdersHistoryPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    paymentApi.myOrders().then(setOrders).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(load, [load]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
      <ErrorAlert message={error} onRetry={load} />
      {!orders && !error && <LoadingState />}
      {orders?.length === 0 && <EmptyState title={t('orders.empty')} description={t('orders.subtitle')} />}
      {!!orders?.length && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs overflow-hidden">
          {orders.map(order => (
            <div key={order.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-[11px] font-mono font-bold text-slate-400 block">{order.invoiceNumber || `#${order.id.slice(-8)}`} · {t('orders.orderedOn', { date: formatDate(order.createdAt, i18n.language) })}</span>
                {order.items.map(item => (
                  <h3 key={item.itemId} className="text-sm font-bold text-slate-900">{item.title} <span className="font-normal text-slate-500">· {t(`orders.itemTypes.${item.itemType}`)}</span></h3>
                ))}
                {order.refund && <span className="text-slate-500 block">{t('orders.refundedOn', { date: formatDate(order.refund.refundedAt, i18n.language) })}</span>}
                {order.provider === 'offline' && (
                  <span className="text-slate-600 block">
                    {t(`offlineUi.methods.${order.paymentMethod || 'cash'}`)}
                    {order.status === 'pending' && order.expiresAt ? ` · ${t('offlineUi.awaiting', { date: formatDate(order.expiresAt, i18n.language) })}` : ''}
                    {order.offlinePayment?.reference ? ` · ${t('offlineUi.referenceShort', { reference: order.offlinePayment.reference })}` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                <div className="text-start sm:text-end space-y-1">
                  <span className="text-sm font-bold text-slate-900 tabular-nums block">{formatMoney(order.totalAmount, order.currency, i18n.language)}</span>
                  <Badge variant={orderStatusVariant[order.status]} size="sm">{t(`orders.status.${order.status}`)}</Badge>
                </div>
                {order.invoiceNumber && (
                  <Link to={`/student/orders/${order.id}/invoice`}><Button variant="outline" size="sm" leftIcon={<Download className="w-3.5 h-3.5" />}>{t('orders.viewInvoice')}</Button></Link>
                )}
                {order.status === 'pending' && order.checkoutUrl && (
                  <Button variant="primary" size="sm" onClick={() => window.location.assign(order.checkoutUrl!)}>{t('orders.resumePayment')}</Button>
                )}
                {order.offlinePayment?.hasProof && <Button variant="ghost" size="sm" onClick={() => void offlinePaymentApi.downloadProof(order.id).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('offlineUi.viewProof')}</Button>}
                {order.provider === 'offline' && order.status === 'pending' && (
                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void offlinePaymentApi.cancel(order.id).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('offlineUi.cancelRequest')}</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const OrdersHistoryPage: React.FC = () => usesApi ? <ApiOrdersHistoryPage /> : <MockOrdersHistoryPage />;

/** Printable invoice built from the server-side order snapshot. */
export const InvoicePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { orderId = '' } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { paymentApi.invoice(orderId).then(setInvoice).catch(cause => setError(apiErrorMessage(t, cause))); }, [orderId, t]);

  if (error) return <ErrorAlert message={error} />;
  if (!invoice) return <LoadingState />;
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex justify-end print:hidden">
        <Button variant="outline" size="sm" leftIcon={<Printer className="w-3.5 h-3.5" />} onClick={() => window.print()}>{t('orders.print')}</Button>
      </div>
      <article className="bg-white border border-slate-200 rounded-xl p-6 sm:p-10 space-y-8 text-sm">
        <header className="flex flex-col sm:flex-row justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-indigo-700 font-extrabold text-lg"><FileText className="w-5 h-5" />EduMarket</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mt-2">{t('orders.invoiceTitle')}</h1>
          </div>
          <dl className="text-xs space-y-1 sm:text-end">
            <div><dt className="inline text-slate-500">{t('orders.invoiceNumber')} : </dt><dd className="inline font-mono font-bold">{invoice.invoiceNumber}</dd></div>
            <div><dt className="inline text-slate-500">{t('orders.issuedOn')} : </dt><dd className="inline">{formatDate(invoice.issuedAt, i18n.language)}</dd></div>
            {invoice.refund && <div><Badge variant="danger" size="sm">{t('orders.refundedStamp')} · {formatDate(invoice.refund.refundedAt, i18n.language)}</Badge></div>}
            <p className="text-xs text-slate-600">{t('offlineUi.paidWith', { method: t(`offlineUi.methods.${invoice.paymentMethod || 'online'}`) })}{invoice.paymentReference ? ` · ${t('offlineUi.referenceShort', { reference: invoice.paymentReference })}` : ''}</p>
          </dl>
        </header>
        <section>
          <h2 className="text-xs font-bold uppercase text-slate-500">{t('orders.buyer')}</h2>
          <p className="font-semibold text-slate-900">{invoice.buyer.name}</p>
          <p className="text-slate-600">{invoice.buyer.email}</p>
        </section>
        <table className="w-full text-start text-xs">
          <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 text-start">{t('orders.description')}</th><th className="py-2 text-start">{t('orders.seller')}</th><th className="py-2 text-end">{t('orders.amount')}</th></tr></thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-100"><td className="py-2">{line.description} <span className="text-slate-400">· {t(`orders.itemTypes.${line.itemType}`)}</span></td><td className="py-2">{line.seller}</td><td className="py-2 text-end tabular-nums">{formatMoney(line.amount, invoice.currency, i18n.language)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="pt-4 font-extrabold">{t('orders.totalTtc')}</td><td className="pt-4 text-end font-extrabold tabular-nums">{formatMoney(invoice.totalAmount, invoice.currency, i18n.language)}</td></tr></tfoot>
        </table>
        {invoice.pricesIncludeTax && <p className="text-[11px] text-slate-500">{t('orders.pricesIncludeTax')}</p>}
      </article>
    </div>
  );
};

/** Prepaid catalogue subscription: status, chained periods, renewal and reminder opt-out. */
const ApiStudentSubscriptionPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [offer, setOffer] = useState<SubscriptionOffer | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [offline, setOffline] = useState<{ enabled: boolean; instructions: string } | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlan>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    Promise.all([subscriptionApi.offer(), subscriptionApi.mine()]).then(([currentOffer, currentStatus]) => { setOffer(currentOffer); setStatus(currentStatus); if (currentStatus.plan) setPlan(currentStatus.plan); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(load, [load]);
  useEffect(() => { paymentApi.config().then(config => setOffline(config.offline || null)).catch(() => undefined); }, []);

  const checkout = async () => {
    setBusy(true); setError('');
    try { window.location.assign((await subscriptionApi.checkout(plan)).checkoutUrl); }
    catch (cause) { setError(apiErrorMessage(t, cause)); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { setStatus(await subscriptionApi.cancel()); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(false); }
  };

  if (!offer || !status) return <div className="space-y-6 max-w-4xl mx-auto"><PageHeader title={t('subscriptionUi.title')} /><ErrorAlert message={error} onRetry={load} />{!error && <LoadingState />}</div>;
  const price = (value: number) => formatMoney(Math.round(value * 100), 'eur', i18n.language);
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title={t('subscriptionUi.title')} subtitle={t('subscriptionUi.subtitle')} />
      <ErrorAlert message={error} />
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{status.active ? t('subscriptionUi.active') : t('subscriptionUi.notActive')}</h2>
            {status.active && status.currentPeriodEnd && <p className="text-sm text-slate-600">{t('subscriptionUi.activeUntil', { date: formatDate(status.currentPeriodEnd, i18n.language) })}</p>}
          </div>
          {status.active && <Badge variant="success" size="md">{t(`subscriptionUi.${status.plan || 'monthly'}`)}</Badge>}
        </div>
        <NoticeBanner>{t('subscriptionUi.prepaidNotice')}</NoticeBanner>
        {status.cancelledAt && status.active && <NoticeBanner tone="warning">{t('subscriptionUi.cancelledNotice')}</NoticeBanner>}
        {!offer.enabled ? <NoticeBanner tone="warning">{t('subscriptionUi.disabled')}</NoticeBanner> : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-lg" role="radiogroup" aria-label={t('subscriptionUi.title')}>
              {(['monthly', 'yearly'] as const).map(value => (
                <button key={value} type="button" role="radio" aria-checked={plan === value} onClick={() => setPlan(value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md ${plan === value ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}>
                  {t(`subscriptionUi.${value}`)} · {price(value === 'monthly' ? offer.monthlyPrice : offer.yearlyPrice)}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" isLoading={busy} onClick={() => void checkout()}>{status.active ? t('subscriptionUi.renew') : t('subscriptionUi.subscribe')}</Button>
            {status.active && !status.cancelledAt && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel()}>{t('subscriptionUi.cancel')}</Button>}
          </div>
        )}
        {offer.enabled && offline?.enabled && <OfflinePaymentOption key={plan} plan={plan} instructions={offline.instructions} />}
      </section>
      {status.periods.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900">{t('subscriptionUi.periods')}</h2>
          <ul className="divide-y divide-slate-100 text-xs">
            {status.periods.map(period => (
              <li key={period.id} className="py-2.5 flex items-center justify-between gap-3">
                <span>{formatDate(period.startsAt, i18n.language)} → {formatDate(period.endsAt, i18n.language)} · {t(`subscriptionUi.${period.plan}`)}</span>
                <span className="flex items-center gap-2"><span className="tabular-nums font-semibold">{formatMoney(period.amount, period.currency, i18n.language)}</span><Badge variant={period.status === 'active' ? 'success' : 'default'} size="sm">{t(`subscriptionUi.periodStatus.${period.status}`)}</Badge></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export const StudentSubscriptionPage: React.FC = () => usesApi ? <ApiStudentSubscriptionPage /> : <MockStudentSubscriptionPage />;
