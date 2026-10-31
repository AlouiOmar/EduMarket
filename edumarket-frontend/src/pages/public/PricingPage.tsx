import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import { subscriptionApi } from '../../services/platformServices';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatMoney } from '../../utils/format';
import type { SubscriptionOffer, SubscriptionPlan } from '../../types/platform';
import { useTranslation } from 'react-i18next';
import { Check, Sparkles } from 'lucide-react';
import { mockSubscriptionPlans } from '../../mocks/mockData';
import { Button } from '../../components/atoms/Button';

const MockPricingPage: React.FC = () => {
  const { t } = useTranslation();
  const [billingCadence, setBillingCadence] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
          {t('subscriptionUi.title')}
        </h1>
        <p className="text-sm sm:text-base text-slate-600">
          {t('subscriptionUi.subtitle')}
        </p>

        {/* Cadence switch */}
        <div className="pt-4 flex items-center justify-center">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setBillingCadence('monthly')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                billingCadence === 'monthly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('payments.monthly')}
            </button>
            <button
              onClick={() => setBillingCadence('yearly')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                billingCadence === 'yearly' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('payments.yearly')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {mockSubscriptionPlans.map((plan) => {
          const price = billingCadence === 'monthly' ? plan.priceMonthly : Math.round(plan.priceYearly / 12);
          const isPro = plan.popular;

          return (
            <div
              key={plan.id}
              className={`rounded-2xl p-8 flex flex-col justify-between border transition-all ${
                isPro
                  ? 'border-indigo-600 bg-white shadow-xl ring-2 ring-indigo-600'
                  : 'border-slate-200 bg-white shadow-xs'
              }`}
            >
              <div>
                {isPro && (
                  <div className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">
                    <Sparkles className="w-3.5 h-3.5" /> Recommandé
                  </div>
                )}
                <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                <p className="text-xs text-slate-500 mt-1 mb-6">{plan.description}</p>

                <div className="mb-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold text-slate-900 tabular-nums">
                    {price} €
                  </span>
                  <span className="text-xs text-slate-500 font-medium">/ mois</span>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-100">
                  {plan.features.map((feat, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-slate-700">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-8">
                <Button
                  variant={isPro ? 'primary' : 'outline'}
                  size="md"
                  className="w-full"
                >
                  {t('payments.subscribeNow')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Live offer: free discovery tier plus the prepaid catalogue subscription configured by administrators. */
const ApiPricingPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, role } = useAuth();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<SubscriptionOffer | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlan>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { subscriptionApi.offer().then(setOffer).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);

  const subscribe = async () => {
    if (!isAuthenticated) { navigate('/auth/login', { state: { from: '/pricing' } }); return; }
    setBusy(true); setError('');
    try { window.location.assign((await subscriptionApi.checkout(plan)).checkoutUrl); }
    catch (cause) { setError(apiErrorMessage(t, cause)); setBusy(false); }
  };

  const price = offer ? formatMoney(Math.round((plan === 'monthly' ? offer.monthlyPrice : offer.yearlyPrice) * 100), 'eur', i18n.language) : '';
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">{t('subscriptionUi.title')}</h1>
        <p className="text-sm sm:text-base text-slate-600">{t('subscriptionUi.subtitle')}</p>
      </div>
      <ErrorAlert message={error} />
      {!offer && !error && <LoadingState />}
      {offer && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          <div className="rounded-2xl p-8 border border-slate-200 bg-white shadow-xs flex flex-col justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('subscriptionUi.freeTier')}</h2>
              <p className="text-xs text-slate-500 mt-1 mb-6">{t('subscriptionUi.freeTierDesc')}</p>
              <span className="text-4xl font-extrabold text-slate-900">{t('subscriptionUi.freeTierPrice')}</span>
            </div>
            <Link to="/courses?price=free" className="pt-8"><Button variant="outline" size="md" className="w-full">{t('subscriptionUi.explore')}</Button></Link>
          </div>
          <div className="rounded-2xl p-8 border border-indigo-600 ring-2 ring-indigo-600 bg-white shadow-xl flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2"><Sparkles className="w-3.5 h-3.5" />{t('subscriptionUi.title')}</div>
              {!offer.enabled ? <NoticeBanner tone="warning">{t('subscriptionUi.disabled')}</NoticeBanner> : (
                <>
                  <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-lg mb-4">
                    {(['monthly', 'yearly'] as const).map(value => (
                      <button key={value} type="button" onClick={() => setPlan(value)} className={`px-3 py-1.5 text-xs font-semibold rounded-md ${plan === value ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}>{t(`subscriptionUi.${value}`)}</button>
                    ))}
                  </div>
                  <div className="mb-6 flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold text-slate-900 tabular-nums">{price}</span>
                    <span className="text-xs text-slate-500">{plan === 'monthly' ? t('subscriptionUi.perMonth') : t('subscriptionUi.perYear')}</span>
                  </div>
                </>
              )}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                {(['feature1', 'feature2', 'feature3', 'feature4'] as const).map(key => (
                  <div key={key} className="flex items-start gap-2.5 text-xs text-slate-700"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /><span>{t(`subscriptionUi.${key}`)}</span></div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-4">{t('subscriptionUi.prepaidNotice')}</p>
            </div>
            {offer.enabled && (
              <Button variant="primary" size="md" className="w-full mt-8" isLoading={busy} disabled={isAuthenticated && role !== 'student'} onClick={() => void subscribe()}>{t('subscriptionUi.subscribe')}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const PricingPage: React.FC = () => usesApi ? <ApiPricingPage /> : <MockPricingPage />;
