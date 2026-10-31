import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShoppingCart,
  Trash2,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  XCircle,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import { paymentService } from '../../services/paymentService';
import { paymentApi } from '../../services/platformServices';
import { OfflinePaymentOption, OfflineRequestConfirmation } from '../../components/organisms/OfflinePaymentOption';
import { usesApi } from '../../services/apiClient';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { FormField } from '../../components/molecules/FormField';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatMoney, formatPrice } from '../../utils/format';
import type { Order, PaymentConfig } from '../../types/platform';

/**
 * Public purchase flow (cart and checkout). Mock mode keeps the original demo checkout; API mode sends only
 * course identifiers, redirects to the configured provider and waits for the server-confirmed order state.
 */
export const CartPage: React.FC = () => {
  const { t } = useTranslation();
  const { items, removeFromCart, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();

  const tax = Math.round(totalPrice * 0.2 * 100) / 100;
  const finalTotal = totalPrice;

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <ShoppingCart className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{t('payments.cartEmpty')}</h1>
        <p className="text-xs text-slate-500">{t('cartUi.emptyHint')}</p>
        <Link to="/courses">
          <Button variant="primary" size="md">
            {t('payments.exploreCourses')} &rarr;
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('payments.cartTitle')} ({items.length})</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Items Column */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
          {items.map(item => (
            <div key={item.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={item.course.coverImage || undefined}
                  alt={item.course.title}
                  referrerPolicy="no-referrer"
                  className="w-20 h-14 object-cover rounded-lg shrink-0"
                />
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900">{item.course.title}</h3>
                  <span className="text-[11px] text-slate-500">{t('cartUi.byTeacher', { name: item.course.teacherName })}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  {item.course.discountPrice !== undefined ? item.course.discountPrice : item.course.price} €
                </span>
                <button
                  onClick={() => removeFromCart(item.course.id)}
                  aria-label={t('cartUi.remove')}
                  className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary Box */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
            {t('payments.orderSummary')}
          </h2>

          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>{t('payments.subtotal')}</span>
              <span className="tabular-nums font-semibold">{(finalTotal - tax).toFixed(2)} €</span>
            </div>
            <div className="flex justify-between">
              <span>{t('payments.tax')} (20%)</span>
              <span className="tabular-nums font-semibold">{tax.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-3 border-t border-slate-100">
              <span>{t('payments.total')}</span>
              <span className="tabular-nums text-indigo-600">{finalTotal.toFixed(2)} €</span>
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => navigate('/checkout')}
          >
            {t('payments.checkout')} &rarr;
          </Button>

          <p className="text-[11px] text-slate-400 text-center">
            {t('cartUi.secure')}
          </p>
        </div>
      </div>
    </div>
  );
};

const MockCheckoutPage: React.FC = () => {
  const { t } = useTranslation();
  const { items, totalPrice, clearCart } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [paymentMethod, setPaymentMethod] = useState<'card' | 'paypal' | 'transfer'>('card');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [checkoutError, setCheckoutError] = useState('');

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
    const res = await paymentService.processCheckout({
      items: items.map(i => ({ id: i.course.id, title: i.course.title, price: i.course.price })),
      paymentMethod: paymentMethod === 'card' ? 'Carte bancaire (Simulée)' : paymentMethod === 'paypal' ? 'PayPal' : 'Virement',
      userId: user?.id || 'u1',
      userName: user?.name || ''
    });

    setLoading(false);
    if (res.success) {
      setStatus('success');
      clearCart();
    } else {
      setStatus('failed');
    }
    } catch (error) {
      setLoading(false);
      setCheckoutError((error as Error & { code?: string }).code === 'PAYMENT_PROVIDER_NOT_CONFIGURED'
        ? String(t('courses.paymentUnavailable')) : (error instanceof Error ? error.message : String(t('courses.paymentUnavailable'))));
      setStatus('failed');
    }
  };

  if (status === 'success') {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">{t('payments.paymentSuccess')}</h1>
        <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">{t('payments.paymentSuccessDesc')}</p>

        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl font-medium">
          {t('cartUi.demoInvoice', { number: Date.now().toString().slice(-6) })}
        </div>

        <div className="flex justify-center gap-3">
          <Link to="/student/courses">
            <Button variant="primary" size="md">
              {t('cartUi.goToCourses')}
            </Button>
          </Link>
          <Link to="/student/orders">
            <Button variant="outline" size="md">
              {t('cartUi.viewInvoice')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('payments.checkout')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('cartUi.chooseMethod')}</p>
      </div>
      {status === 'failed' && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{checkoutError}</p>}

      <form onSubmit={handlePay} className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-800 block">
            {t('payments.paymentMethod')}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`p-4 rounded-xl border text-xs font-semibold flex flex-col items-center gap-2 transition-all ${
                paymentMethod === 'card' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
              }`}
            >
              <CreditCard className="w-5 h-5" />
              <span>{t('cartUi.card')}</span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('paypal')}
              className={`p-4 rounded-xl border text-xs font-semibold flex flex-col items-center gap-2 transition-all ${
                paymentMethod === 'paypal' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
              }`}
            >
              <span className="font-bold text-sm">PayPal</span>
              <span>{t('cartUi.paypalAccount')}</span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('transfer')}
              className={`p-4 rounded-xl border text-xs font-semibold flex flex-col items-center gap-2 transition-all ${
                paymentMethod === 'transfer' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
              <span>{t('cartUi.sepa')}</span>
            </button>
          </div>
        </div>

        {paymentMethod === 'card' && (
          <div className="space-y-4 pt-2">
            <FormField label={t('cartUi.demoCardNumber')} required>
              <Input defaultValue="4242 •••• •••• 4242" required />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t('cartUi.expiry')} required>
                <Input defaultValue="12/28" required />
              </FormField>
              <FormField label={t('cartUi.cvc')} required>
                <Input defaultValue="123" required />
              </FormField>
            </div>
          </div>
        )}

        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
          <span>{t('cartUi.amountCharged')}</span>
          <span className="text-xl font-extrabold text-slate-900 tabular-nums">
            {totalPrice} €
          </span>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          isLoading={loading}
        >
          {t('payments.payNow')} ({totalPrice} €)
        </Button>
      </form>
    </div>
  );
};


const ApiCheckoutPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { items, clearCart } = useCart();
  const { isAuthenticated, role } = useAuth();
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [offlineRequest, setOfflineRequest] = useState<{ order: Order; instructions: string } | null>(null);
  // One key per checkout screen: double submissions reuse the same server order.
  const idempotencyKey = useRef(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const paidItems = items.filter(item => item.course.price > 0);
  const hasFreeItems = paidItems.length !== items.length;
  const displayTotal = paidItems.reduce((sum, item) => sum + item.course.price, 0);
  const currency = config?.currency || 'eur';

  useEffect(() => { paymentApi.config().then(setConfig).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);

  const pay = async () => {
    setError(''); setRedirecting(true);
    try {
      const session = await paymentApi.checkoutCourses(paidItems.map(item => item.course.id), idempotencyKey.current);
      window.location.assign(session.checkoutUrl);
    } catch (cause) { setError(apiErrorMessage(t, cause)); setRedirecting(false); }
  };

  // The cart is emptied once an offline request exists: keep showing its confirmation instead of the empty cart.
  if (offlineRequest) return <div className="max-w-3xl mx-auto px-4 py-10 space-y-6"><h1 className="text-2xl font-bold text-slate-900">{t('payments.checkout')}</h1><OfflineRequestConfirmation order={offlineRequest.order} instructions={offlineRequest.instructions} /></div>;
  if (items.length === 0) return <CartPage />;
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('payments.checkout')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('checkout.secureNotice')}</p>
      </div>
      {searchParams.get('cancelled') && <NoticeBanner tone="warning">{t('checkout.cancelledNotice')}</NoticeBanner>}
      {config && !config.enabled && !config.offline?.enabled && <NoticeBanner tone="warning">{t('checkout.providerDisabled')}</NoticeBanner>}
      {config?.sandbox && <NoticeBanner>{t('checkout.sandboxNotice')}</NoticeBanner>}
      {hasFreeItems && <NoticeBanner>{t('checkout.freeItemsNotice')}</NoticeBanner>}
      <ErrorAlert message={error} />
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
        {paidItems.map(item => (
          <div key={item.id} className="p-4 flex items-center justify-between gap-4 text-sm">
            <span className="font-semibold text-slate-900">{item.course.title}</span>
            <span className="tabular-nums font-bold">{formatPrice(item.course.price, currency, i18n.language)}</span>
          </div>
        ))}
        <div className="p-4 flex items-center justify-between text-sm font-extrabold">
          <span>{t('payments.total')}</span>
          <span className="tabular-nums text-indigo-600">{formatPrice(displayTotal, currency, i18n.language)}</span>
        </div>
      </div>
      {!isAuthenticated ? (
        <Link to="/auth/login" state={{ from: '/checkout' }}><Button variant="primary" size="lg" className="w-full">{t('nav.login')}</Button></Link>
      ) : (
        <Button variant="primary" size="lg" className="w-full" isLoading={redirecting} leftIcon={<CreditCard className="w-4 h-4" />}
          disabled={!config?.enabled || role !== 'student' || paidItems.length === 0} onClick={() => void pay()}>
          {redirecting ? t('checkout.redirecting') : t('checkout.payWithProvider', { amount: formatPrice(displayTotal, currency, i18n.language) })}
        </Button>
      )}
      {isAuthenticated && role === 'student' && config?.offline?.enabled && paidItems.length > 0 && (
        <OfflinePaymentOption courseIds={paidItems.map(item => item.course.id)} instructions={config.offline.instructions} onRequested={(order, instructions) => { setOfflineRequest({ order, instructions }); clearCart(); }} />
      )}
      <p className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />{t('checkout.secureNotice')}</p>
    </div>
  );
};

export const CheckoutPage: React.FC = () => usesApi ? <ApiCheckoutPage /> : <MockCheckoutPage />;

/** Development-only provider page served by the sandbox adapter (PAYMENT_PROVIDER=sandbox). */
export const SandboxCheckoutPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('order') || '';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'complete' | 'fail' | ''>('');

  useEffect(() => { if (orderId) paymentApi.order(orderId).then(setOrder).catch(cause => setError(apiErrorMessage(t, cause))); }, [orderId, t]);

  const finish = async (outcome: 'complete' | 'fail') => {
    setBusy(outcome); setError('');
    try { await paymentApi.completeSandbox(sessionId, outcome); navigate(`/checkout/complete?order=${encodeURIComponent(orderId)}`, { replace: true }); }
    catch (cause) { setError(apiErrorMessage(t, cause)); setBusy(''); }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-12 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"><FlaskConical className="w-5 h-5" /></div>
        <h1 className="text-xl font-bold text-slate-900">{t('checkout.sandboxTitle')}</h1>
      </div>
      <NoticeBanner tone="warning">{t('checkout.sandboxNotice')}</NoticeBanner>
      <ErrorAlert message={error} />
      {!order && !error && <LoadingState />}
      {order && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm">
          {order.items.map(item => (
            <div key={item.itemId} className="flex justify-between gap-4"><span>{item.title}</span><span className="tabular-nums font-semibold">{formatMoney(item.unitAmount, order.currency, i18n.language)}</span></div>
          ))}
          <div className="flex justify-between pt-3 border-t border-slate-100 font-extrabold"><span>{t('payments.total')}</span><span className="tabular-nums">{formatMoney(order.totalAmount, order.currency, i18n.language)}</span></div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button variant="success" size="md" isLoading={busy === 'complete'} disabled={!order || order.status !== 'pending' || !!busy} onClick={() => void finish('complete')}>{t('checkout.sandboxPay')}</Button>
        <Button variant="outline" size="md" isLoading={busy === 'fail'} disabled={!order || order.status !== 'pending' || !!busy} onClick={() => void finish('fail')}>{t('checkout.sandboxFail')}</Button>
      </div>
    </div>
  );
};

/** Return page after the provider: polls the server-side order until the webhook has confirmed or failed it. */
export const CheckoutCompletePage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  const orderId = searchParams.get('order') || '';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const clearCartRef = useRef(clearCart);
  clearCartRef.current = clearCart;

  useEffect(() => {
    if (!orderId) return;
    let active = true, attempts = 0, timer: number | undefined;
    const poll = async () => {
      try {
        const current = await paymentApi.order(orderId);
        if (!active) return;
        setOrder(current);
        if (current.status === 'paid') { if (current.items.some(item => item.itemType === 'course')) clearCartRef.current(); return; }
        if (current.status !== 'pending') return;
      } catch (cause) { if (active) setError(apiErrorMessage(t, cause)); return; }
      attempts += 1;
      if (attempts >= 15) { setTimedOut(true); return; }
      timer = window.setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [orderId, t]);

  const status = order?.status;
  return (
    <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-6">
      <ErrorAlert message={error} />
      {(!order || status === 'pending') && !error && (
        <>
          <Loader2 className="w-10 h-10 mx-auto text-indigo-600 animate-spin" />
          <h1 className="text-2xl font-extrabold text-slate-900">{t('checkout.confirmingTitle')}</h1>
          <p className="text-sm text-slate-600">{timedOut ? t('checkout.stillPending') : t('checkout.confirmingDesc')}</p>
        </>
      )}
      {status === 'paid' && (
        <>
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto"><CheckCircle2 className="w-8 h-8" /></div>
          <h1 className="text-2xl font-extrabold text-slate-900">{t('checkout.confirmedTitle')}</h1>
          <p className="text-sm text-slate-600">{t('checkout.confirmedDesc', { invoice: order?.invoiceNumber || '' })}</p>
        </>
      )}
      {(status === 'failed' || status === 'refunded') && (
        <>
          <div className="w-16 h-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8" /></div>
          <h1 className="text-2xl font-extrabold text-slate-900">{t('checkout.failedTitle')}</h1>
          <p className="text-sm text-slate-600">{t('checkout.failedDesc')}</p>
        </>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {status === 'paid' && <Link to="/student/courses"><Button variant="primary" size="md">{t('checkout.goToCourses')}</Button></Link>}
        {(status === 'failed' || status === 'refunded') && <Link to="/cart"><Button variant="primary" size="md">{t('checkout.backToCart')}</Button></Link>}
        <Link to="/student/orders"><Button variant="outline" size="md">{t('checkout.viewOrders')}</Button></Link>
      </div>
    </div>
  );
};
