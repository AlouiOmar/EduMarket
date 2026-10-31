import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { adminRecordsApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatDateTime, formatMoney, formatPrice } from '../../utils/format';
import type { AdminCertificate, AdminExam, AdminUserDetail } from '../../types/platform';

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{children}</p>;

/** All online and in-person exams on the platform, with publish/withdraw control. */
export const AdminExamsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState({ type: '', status: '', search: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: AdminExam[]; pages: number } | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(() => {
    setError('');
    adminRecordsApi.exams({ ...filters, page }).then(response => setResult({ data: response.data, pages: response.pagination.pages })).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [filters, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminRecordsUi.examsTitle')} subtitle={t('adminRecordsUi.examsSubtitle')} /><ApiModeNotice /></div>;

  const toggle = async (exam: AdminExam) => {
    setBusyId(exam.id); setError('');
    try { const updated = await adminRecordsApi.setExamStatus(exam.id, exam.status === 'published' ? 'draft' : 'published'); setResult(prev => prev && { ...prev, data: prev.data.map(item => item.id === exam.id ? { ...item, status: updated.status as AdminExam['status'] } : item) }); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };
  const update = (patch: Partial<typeof filters>) => { setFilters(prev => ({ ...prev, ...patch })); setPage(1); };
  return (
    <div className="space-y-6">
      <PageHeader title={t('adminRecordsUi.examsTitle')} subtitle={t('adminRecordsUi.examsSubtitle')} />
      <div className="flex flex-wrap gap-2">
        <Input aria-label={t('platformCommon.search')} placeholder={t('platformCommon.search')} value={filters.search} onChange={event => update({ search: event.target.value })} className="max-w-xs" />
        <select aria-label={t('adminRecordsUi.type')} className="rounded-lg border border-slate-300 bg-white px-2 text-xs" value={filters.type} onChange={event => update({ type: event.target.value })}>
          <option value="">{t('adminRecordsUi.allTypes')}</option><option value="online">{t('adminRecordsUi.types.online')}</option><option value="in_person">{t('adminRecordsUi.types.in_person')}</option>
        </select>
        <select aria-label={t('common.status')} className="rounded-lg border border-slate-300 bg-white px-2 text-xs" value={filters.status} onChange={event => update({ status: event.target.value })}>
          <option value="">{t('adminRecordsUi.allStatuses')}</option><option value="published">{t('adminRecordsUi.examStatus.published')}</option><option value="draft">{t('adminRecordsUi.examStatus.draft')}</option>
        </select>
      </div>
      <ErrorAlert message={error} onRetry={load} />
      {!result && !error && <LoadingState />}
      {result?.data.length === 0 && <Empty>{t('adminRecordsUi.noExams')}</Empty>}
      {!!result?.data.length && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="p-3 text-start">{t('adminRecordsUi.exam')}</th><th className="p-3 text-start">{t('adminRecordsUi.type')}</th><th className="p-3 text-start">{t('adminRecordsUi.date')}</th>
              <th className="p-3 text-start">{t('adminRecordsUi.fee')}</th><th className="p-3 text-start">{t('adminRecordsUi.registered')}</th><th className="p-3 text-start">{t('common.status')}</th><th className="p-3" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {result.data.map(exam => (
                <tr key={exam.id}>
                  <td className="p-3"><span className="font-semibold text-slate-900 block">{exam.title}</span><span className="text-slate-500">{exam.courseTitle} · {exam.creatorName}</span></td>
                  <td className="p-3">{t(`adminRecordsUi.types.${exam.type}`)}{exam.city ? ` · ${exam.city}` : ''}</td>
                  <td className="p-3 whitespace-nowrap">{exam.date ? formatDateTime(exam.date, i18n.language) : '—'}</td>
                  <td className="p-3">{exam.fee ? formatPrice(exam.fee, 'eur', i18n.language) : t('adminRecordsUi.free')}</td>
                  <td className="p-3 tabular-nums">{exam.registeredCount}{exam.capacity ? ` / ${exam.capacity}` : ''}</td>
                  <td className="p-3"><Badge size="sm" variant={exam.status === 'published' ? 'success' : 'default'}>{t(`adminRecordsUi.examStatus.${exam.status}`)}</Badge></td>
                  <td className="p-3 text-end"><Button size="sm" variant="outline" isLoading={busyId === exam.id} onClick={() => void toggle(exam)}>{exam.status === 'published' ? t('adminRecordsUi.withdraw') : t('adminRecordsUi.publish')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <SimplePager page={page} pages={result.pages} onChange={setPage} />}
    </div>
  );
};

/** Issued certificates with search, revocation (reason required) and restoration. */
export const AdminCertificatesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: AdminCertificate[]; pages: number } | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError('');
    adminRecordsApi.certificates({ search: search.trim() || undefined, status, page }).then(response => setResult({ data: response.data, pages: response.pagination.pages })).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [search, status, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminRecordsUi.certificatesTitle')} subtitle={t('adminRecordsUi.certificatesSubtitle')} /><ApiModeNotice /></div>;

  const apply = async (id: string, input: { status: 'revoked'; reason: string } | { status: 'valid' }) => {
    setBusy(true); setError('');
    try { const updated = await adminRecordsApi.setCertificateStatus(id, input); setResult(prev => prev && { ...prev, data: prev.data.map(item => item.id === id ? updated : item) }); setRevoking(null); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t('adminRecordsUi.certificatesTitle')} subtitle={t('adminRecordsUi.certificatesSubtitle')} />
      <div className="flex flex-wrap gap-2">
        <Input aria-label={t('adminRecordsUi.certificateSearch')} placeholder={t('adminRecordsUi.certificateSearch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="max-w-sm" />
        <select aria-label={t('common.status')} className="rounded-lg border border-slate-300 bg-white px-2 text-xs" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          {['all', 'valid', 'revoked'].map(value => <option key={value} value={value}>{t(`adminRecordsUi.certificateStatus.${value}`)}</option>)}
        </select>
      </div>
      <ErrorAlert message={error} onRetry={load} />
      {!result && !error && <LoadingState />}
      {result?.data.length === 0 && <Empty>{t('adminRecordsUi.noCertificates')}</Empty>}
      <ul className="space-y-3">
        {result?.data.map(certificate => (
          <li key={certificate.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-slate-900 block">{certificate.courseTitle}</span>
                <span className="text-slate-500">{certificate.student.name} · {certificate.student.email} · {formatDate(certificate.issuedAt, i18n.language)}</span>
                <span className="block font-mono text-slate-500 mt-0.5">{certificate.code}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge size="sm" variant={certificate.status === 'valid' ? 'success' : 'danger'}>{t(`adminRecordsUi.certificateStatus.${certificate.status}`)}</Badge>
                {certificate.status === 'valid'
                  ? <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setRevoking({ id: certificate.id, reason: '' })}>{t('adminRecordsUi.revoke')}</Button>
                  : <Button size="sm" variant="outline" isLoading={busy} onClick={() => void apply(certificate.id, { status: 'valid' })}>{t('adminRecordsUi.restore')}</Button>}
              </div>
            </div>
            {certificate.status === 'revoked' && <p className="text-rose-700">{t('adminRecordsUi.revokedOn', { date: formatDate(certificate.revokedAt || '', i18n.language), reason: certificate.revokedReason })}</p>}
            {revoking?.id === certificate.id && (
              <form className="flex flex-wrap gap-2 items-end" onSubmit={event => { event.preventDefault(); void apply(certificate.id, { status: 'revoked', reason: revoking.reason.trim() }); }}>
                <Input aria-label={t('adminRecordsUi.revokeReason')} placeholder={t('adminRecordsUi.revokeReason')} value={revoking.reason} minLength={5} maxLength={500} required onChange={event => setRevoking({ id: certificate.id, reason: event.target.value })} className="max-w-md" />
                <Button type="submit" size="sm" variant="primary" isLoading={busy}>{t('adminRecordsUi.confirmRevoke')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRevoking(null)}>{t('platformCommon.cancel')}</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {result && <SimplePager page={page} pages={result.pages} onChange={setPage} />}
    </div>
  );
};

/** Account detail: profile, affiliation, activity counters and the latest audit events. */
export const AdminUserDetailPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { userId = '' } = useParams();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); adminRecordsApi.userDetail(userId).then(setUser).catch(cause => setError(apiErrorMessage(t, cause))); }, [userId, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminRecordsUi.userTitle')} /><ApiModeNotice /></div>;
  const back = <Link to="/admin/users" className="text-xs font-semibold text-indigo-700 hover:underline">{t('adminRecordsUi.backToUsers')}</Link>;
  if (!user) return <div className="space-y-6">{back}<ErrorAlert message={error} onRetry={load} />{!error && <LoadingState />}</div>;

  const stat = (label: string, value: React.ReactNode) => <div className="bg-white border border-slate-200 rounded-xl p-4"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="text-lg font-bold text-slate-900 tabular-nums">{value}</dd></div>;
  const courseCount = Object.values(user.stats.coursesByStatus).reduce((sum, count) => sum + count, 0);
  const paid = user.stats.ordersByStatus.paid;
  return (
    <div className="space-y-6 max-w-5xl">
      {back}
      <PageHeader title={user.name} subtitle={user.email} />
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge size="sm" variant="info">{t(`adminPanel.roles.${user.role}`)}</Badge>
        <Badge size="sm" variant={user.status === 'active' ? 'success' : 'danger'}>{t(`adminPanel.userStatus.${user.status}`)}</Badge>
        {user.teacherVerificationStatus && <Badge size="sm" variant="default">{t('adminRecordsUi.verification', { status: user.teacherVerificationStatus })}</Badge>}
        <span className="text-slate-500">{t('adminRecordsUi.memberSince', { date: formatDate(user.createdAt, i18n.language) })}</span>
      </div>
      {(user.headline || user.phone) && <p className="text-sm text-slate-600">{[user.headline, user.phone].filter(Boolean).join(' · ')}</p>}
      {user.affiliation && <p className="text-sm text-slate-700">{t('adminRecordsUi.affiliation', { name: user.affiliation.institutionName, role: t(`membersUi.roles.${user.affiliation.internalRole}`), percent: user.affiliation.revenueSharePercent })}</p>}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stat(t('adminRecordsUi.enrollments'), user.stats.enrollments)}
        {stat(t('adminRecordsUi.certificates'), user.stats.certificates)}
        {stat(t('adminRecordsUi.courses'), courseCount)}
        {stat(t('adminRecordsUi.paidOrders'), paid ? `${paid.count} · ${formatMoney(paid.amount, 'eur', i18n.language)}` : 0)}
        {stat(t('adminRecordsUi.tickets'), user.stats.supportTickets)}
        {stat(t('adminRecordsUi.reportsAgainst'), user.stats.reportsAgainst)}
      </dl>
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <h2 className="text-sm font-bold text-slate-900 mb-3">{t('adminRecordsUi.recentActivity')}</h2>
        {user.audit.length === 0 ? <p className="text-xs text-slate-500">{t('adminRecordsUi.noActivity')}</p> : (
          <ul className="divide-y divide-slate-100 font-mono text-xs">
            {user.audit.map(event => <li key={event.id} className="py-2 flex flex-wrap justify-between gap-2"><span><span className="font-bold text-indigo-600 me-2">{event.action}</span><span className="text-slate-600">{event.actor}</span></span><span className="text-slate-400">{formatDateTime(event.createdAt, i18n.language)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
};
