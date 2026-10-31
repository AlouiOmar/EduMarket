import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { offlinePaymentApi, type OfflinePaymentDetails } from '../../services/platformServices';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import type { OfflineMethod, Order, SubscriptionPlan } from '../../types/platform';
import type { Course } from '../../types';

const METHODS: OfflineMethod[] = ['cash', 'cheque', 'bank_transfer'];
const today = () => new Date().toISOString().slice(0, 10);
const emptyPayment = (): OfflinePaymentDetails & { receivedOn: string } => ({ method: 'cash', reference: '', bankName: '', payerName: '', note: '', receivedOn: today() });

/** Payment details + proof scan, shared by "settle a request" and "register at the desk". */
const PaymentFields: React.FC<{ value: ReturnType<typeof emptyPayment>; onChange: (value: ReturnType<typeof emptyPayment>) => void; proof: File | null; onProof: (file: File | null) => void }> = ({ value, onChange, proof, onProof }) => {
  const { t } = useTranslation();
  const set = (patch: Partial<ReturnType<typeof emptyPayment>>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <FormField label={t('offlineUi.method')} required>
        <select className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" value={value.method} onChange={event => set({ method: event.target.value as OfflineMethod })}>
          {METHODS.map(method => <option key={method} value={method}>{t(`offlineUi.methods.${method}`)}</option>)}
        </select>
      </FormField>
      <FormField label={t(value.method === 'cash' ? 'offlineUi.receiptNumber' : 'offlineUi.reference')} required={value.method !== 'cash'}>
        <Input value={value.reference} onChange={event => set({ reference: event.target.value })} maxLength={120} required={value.method !== 'cash'} placeholder={value.method === 'cheque' ? '0042117' : ''} />
      </FormField>
      <FormField label={t('offlineUi.receivedOn')} required><Input type="date" value={value.receivedOn} max={today()} onChange={event => set({ receivedOn: event.target.value })} required /></FormField>
      {value.method !== 'cash' && <FormField label={t('offlineUi.bank')}><Input value={value.bankName} onChange={event => set({ bankName: event.target.value })} maxLength={120} /></FormField>}
      <FormField label={t('offlineUi.payer')}><Input value={value.payerName} onChange={event => set({ payerName: event.target.value })} maxLength={120} /></FormField>
      <FormField label={t('offlineUi.proof')} hint={t('offlineUi.proofHint')}>
        <input type="file" accept="image/jpeg,image/png,application/pdf" className="block w-full text-xs" onChange={event => onProof(event.target.files?.[0] || null)} />
        {proof && <span className="text-[11px] text-slate-500">{proof.name}</span>}
      </FormField>
      <FormField label={t('offlineUi.note')} className="sm:col-span-3"><Input value={value.note} onChange={event => set({ note: event.target.value })} maxLength={1000} /></FormField>
    </div>
  );
};
const toDetails = ({ receivedOn, ...payment }: ReturnType<typeof emptyPayment>): OfflinePaymentDetails => ({ ...payment, receivedAt: new Date(`${receivedOn}T12:00:00`).toISOString() });

export const AdminOfflinePaymentsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'pending' | 'paid' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<{ data: Order[]; pages: number } | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [payment, setPayment] = useState(emptyPayment);
  const [proof, setProof] = useState<File | null>(null);
  const [desk, setDesk] = useState({ studentEmail: '', courseIds: [] as string[], plan: '' as '' | SubscriptionPlan });
  const [courses, setCourses] = useState<Course[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    offlinePaymentApi.adminOrders({ status, page }).then(result => setOrders({ data: result.data, pages: result.pagination.pages })).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [status, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  useEffect(() => { if (usesApi) courseService.getCourses({ price: 'paid', sort: 'newest' }).then(result => setCourses(result.data)).catch(() => undefined); }, []);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('offlineUi.adminTitle')} subtitle={t('offlineUi.adminSubtitle')} /><ApiModeNotice /></div>;

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(''); }
  };
  const reset = () => { setPayment(emptyPayment()); setProof(null); };
  const settle = (order: Order) => (event: React.FormEvent) => {
    event.preventDefault();
    void run(`settle-${order.id}`, async () => { await offlinePaymentApi.record(order.id, toDetails(payment), proof); setSettling(null); reset(); setMessage(t('offlineUi.recorded')); load(); });
  };
  const registerDesk = (event: React.FormEvent) => {
    event.preventDefault();
    void run('desk', async () => {
      await offlinePaymentApi.registerAtDesk({ studentEmail: desk.studentEmail, courseIds: desk.courseIds, ...(desk.plan ? { plan: desk.plan } : {}) }, toDetails(payment), proof);
      setDesk({ studentEmail: '', courseIds: [], plan: '' }); reset(); setMessage(t('offlineUi.recorded')); load();
    });
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader title={t('offlineUi.adminTitle')} subtitle={t('offlineUi.adminSubtitle')} />
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}

      <form onSubmit={registerDesk} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4" aria-labelledby="desk-title">
        <div>
          <h2 id="desk-title" className="text-sm font-bold text-slate-900">{t('offlineUi.deskTitle')}</h2>
          <p className="text-xs text-slate-500">{t('offlineUi.deskHelp')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label={t('offlineUi.studentEmail')} required><Input type="email" value={desk.studentEmail} onChange={event => setDesk({ ...desk, studentEmail: event.target.value })} required /></FormField>
          <FormField label={t('offlineUi.courses')} className="sm:col-span-1">
            <select multiple className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs h-24" value={desk.courseIds} onChange={event => setDesk({ ...desk, courseIds: Array.from(event.target.selectedOptions, option => option.value) })}>
              {courses.map(course => <option key={course.id} value={course.id}>{course.title} · {formatMoney(Math.round(course.price * 100), 'eur', i18n.language)}</option>)}
            </select>
          </FormField>
          <FormField label={t('offlineUi.subscription')}>
            <select className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" value={desk.plan} onChange={event => setDesk({ ...desk, plan: event.target.value as '' | SubscriptionPlan })}>
              <option value="">—</option><option value="monthly">{t('offlineUi.plans.monthly')}</option><option value="yearly">{t('offlineUi.plans.yearly')}</option>
            </select>
          </FormField>
        </div>
        {settling === null && <PaymentFields value={payment} onChange={setPayment} proof={proof} onProof={setProof} />}
        <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" disabled={settling !== null || (!desk.courseIds.length && !desk.plan)} isLoading={busy === 'desk'}>{t('offlineUi.registerPaid')}</Button></div>
      </form>

      <section className="space-y-3" aria-labelledby="requests-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="requests-title" className="text-sm font-bold text-slate-900">{t('offlineUi.requestsTitle')}</h2>
          <div className="flex gap-1" role="group" aria-label={t('common.status')}>
            {(['pending', 'paid', 'all'] as const).map(value => <Button key={value} size="sm" variant={status === value ? 'primary' : 'outline'} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{t(`offlineUi.filters.${value}`)}</Button>)}
          </div>
        </div>
        {!orders && !error && <LoadingState />}
        {orders?.data.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('offlineUi.noRequests')}</p>}
        <ul className="space-y-3">
          {orders?.data.map(order => (
            <li key={order.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-semibold text-slate-900 block">{order.student?.name} · {order.student?.email}</span>
                  <span className="text-slate-600 block">{order.items.map(item => item.title).join(', ')}</span>
                  <span className="text-slate-500 block">{formatDateTime(order.createdAt, i18n.language)}{order.status === 'pending' && order.expiresAt ? ` · ${t('offlineUi.expires', { date: formatDate(order.expiresAt, i18n.language) })}` : ''}</span>
                  {order.offlinePayment && <span className="text-slate-500 block">{t('offlineUi.recordedLine', { reference: order.offlinePayment.reference || '—', date: formatDate(order.offlinePayment.receivedAt, i18n.language), by: order.offlinePayment.recordedBy || '' })}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{formatMoney(order.totalAmount, order.currency, i18n.language)}</span>
                  <Badge size="sm" variant="info">{t(`offlineUi.methods.${order.paymentMethod || 'cash'}`)}</Badge>
                  <Badge size="sm" variant={order.status === 'paid' ? 'success' : order.status === 'pending' ? 'warning' : 'default'}>{t(`orders.status.${order.status}`)}</Badge>
                  {order.offlinePayment?.hasProof && <Button size="sm" variant="ghost" onClick={() => void offlinePaymentApi.downloadProof(order.id).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('offlineUi.viewProof')}</Button>}
                  {order.status === 'pending' && settling !== order.id && <Button size="sm" variant="primary" onClick={() => { reset(); setPayment({ ...emptyPayment(), method: (order.paymentMethod && order.paymentMethod !== 'online' ? order.paymentMethod : 'cash') }); setSettling(order.id); }}>{t('offlineUi.recordPayment')}</Button>}
                  {order.status === 'pending' && <Button size="sm" variant="ghost" className="text-rose-600" isLoading={busy === `cancel-${order.id}`} onClick={() => void run(`cancel-${order.id}`, async () => { await offlinePaymentApi.adminCancel(order.id); load(); })}>{t('offlineUi.cancelRequest')}</Button>}
                </div>
              </div>
              {settling === order.id && (
                <form onSubmit={settle(order)} className="border-t border-slate-100 pt-3 space-y-3">
                  <PaymentFields value={payment} onChange={setPayment} proof={proof} onProof={setProof} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setSettling(null); reset(); }}>{t('platformCommon.cancel')}</Button>
                    <Button type="submit" size="sm" variant="primary" isLoading={busy === `settle-${order.id}`}>{t('offlineUi.confirmPaid')}</Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
        {orders && <SimplePager page={page} pages={orders.pages} onChange={setPage} />}
      </section>
    </div>
  );
};
