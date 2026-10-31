import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Clock, TrendingUp, Percent } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { StatCard } from '../../components/molecules/StatCard';
import { ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { paymentApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatMoney } from '../../utils/format';
import type { LedgerEntry, PaymentConfig, Payout, SellerBalance } from '../../types/platform';

/** Seller earnings shared by teachers and institutions: server ledger, holding period and manual payout requests. */
export const SellerRevenuePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [balance, setBalance] = useState<SellerBalance | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(() => {
    setError('');
    Promise.all([paymentApi.earnings(), paymentApi.myPayouts(), paymentApi.config()])
      .then(([earnings, payoutList, paymentConfig]) => { setBalance(earnings.balance); setEntries(earnings.entries); setPayouts(payoutList); setConfig(paymentConfig); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(load, [load]);

  const money = (amount: number) => formatMoney(amount, balance?.currency || 'eur', i18n.language);
  const requestPayout = async () => {
    setRequesting(true); setError(''); setNotice('');
    try { await paymentApi.requestPayout(); setNotice(t('revenue.payoutRequested')); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setRequesting(false); }
  };

  if (!balance && !error) return <LoadingState />;
  const hasOpenPayout = payouts.some(payout => payout.status === 'requested');
  return (
    <div className="space-y-8">
      <PageHeader title={t('revenue.title')} subtitle={t('revenue.subtitle')} actions={balance && (
        <Button variant="primary" size="sm" isLoading={requesting} disabled={hasOpenPayout || balance.available < Math.max(1, balance.payoutMinimum)} onClick={() => void requestPayout()}>
          {t('revenue.requestPayout', { amount: money(balance.available) })}
        </Button>
      )} />
      {config && !config.enabled && <NoticeBanner tone="warning">{t('revenue.providerDisabled')}</NoticeBanner>}
      <ErrorAlert message={error} onRetry={load} />
      {notice && <NoticeBanner tone="success">{notice}</NoticeBanner>}
      {balance && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t('revenue.available')} value={money(balance.available)} icon={<Wallet className="w-5 h-5" />} />
            <StatCard label={t('revenue.pending')} value={money(balance.pending)} icon={<Clock className="w-5 h-5" />} />
            <StatCard label={t('revenue.earned')} value={money(balance.earned)} icon={<TrendingUp className="w-5 h-5" />} hint={`${t('revenue.refunded')} : ${money(balance.refunded)}`} />
            <StatCard label={t('revenue.platformFees')} value={money(balance.platformFees)} icon={<Percent className="w-5 h-5" />} hint={`${t('revenue.paidOut')} : ${money(balance.paidOut)}`} />
          </div>
          <NoticeBanner>{t('revenue.holdNotice', { days: balance.holdDays, minimum: money(balance.payoutMinimum) })} {t('revenue.manualNotice')}</NoticeBanner>
        </>
      )}
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900">{t('revenue.ledgerTitle')}</h2>
        {entries.length === 0 ? <p className="text-sm text-slate-500">{t('revenue.ledgerEmpty')}</p> : (
          <div className="divide-y divide-slate-100 text-xs">
            {entries.map(entry => (
              <div key={entry.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="font-bold text-slate-800 block">{entry.title}</span>
                  <span className="text-slate-400">{formatDate(entry.createdAt, i18n.language)} · {t(`orders.itemTypes.${entry.itemType}`)} · {t(`ledgerTypes.${entry.type}`)}{entry.amount > 0 ? ` · ${t('revenue.availableOn', { date: formatDate(entry.availableAt, i18n.language) })}` : ''}</span>
                </div>
                <div className="text-end">
                  <span className={`font-bold block tabular-nums ${entry.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{entry.amount >= 0 ? '+' : ''}{money(entry.amount)}</span>
                  <span className="text-[10px] text-slate-400">{t('revenue.gross', { amount: money(entry.grossAmount) })} · {t('revenue.fee', { amount: money(entry.platformFee) })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900">{t('revenue.payoutsTitle')}</h2>
        {payouts.length === 0 ? <p className="text-sm text-slate-500">{t('revenue.payoutsEmpty')}</p> : (
          <div className="divide-y divide-slate-100 text-xs">
            {payouts.map(payout => (
              <div key={payout.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="font-bold tabular-nums text-slate-800">{money(payout.amount)}</span>
                  <span className="text-slate-400 block">{formatDate(payout.createdAt, i18n.language)}{payout.reference ? ` · ${t('revenue.reference', { reference: payout.reference })}` : ''}</span>
                </div>
                <Badge variant={payout.status === 'paid' ? 'success' : payout.status === 'rejected' ? 'danger' : 'warning'} size="sm">{t(`revenue.payoutStatus.${payout.status}`)}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
