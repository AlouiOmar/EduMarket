import React, { useCallback, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Users, 
  ShieldCheck, 
  DollarSign, 
  BookOpen, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Settings, 
  Search, 
  Lock, 
  Unlock,
  Radio,
  FileText
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { teacherVerificationService } from '../../services/teacherVerificationService';
import { courseService } from '../../services/courseService';
import { User, TeacherVerificationRequest, Course, AuditLog } from '../../types';
import { StatCard } from '../../components/molecules/StatCard';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { Select } from '../../components/atoms/Select';
import { FormField } from '../../components/molecules/FormField';
import { DataTable } from '../../components/organisms/DataTable';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { usesApi } from '../../services/apiClient';
import { adminCatalogApi } from '../../services/platformServices';
import { ErrorAlert, LoadingState, PageHeader } from '../../components/molecules/PageStates';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import type { AdminOverview, AuditEntry } from '../../types/platform';

const MockAdminDashboardPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<TeacherVerificationRequest[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    adminService.getUsers().then(res => setUsers(res.data));
    adminService.getVerificationRequests().then(res => setRequests(res.data));
    adminService.getAuditLogs().then(res => setLogs(res.data));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('admin.dashboardTitle')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('demoUi.adminSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('admin.totalUsers')}
          value={users.length}
          icon={<Users className="w-5 h-5" />}
          hint={t('demoUi.allRoles')}
        />
        <StatCard
          label={t('admin.totalPlatformRevenue')}
          value="48 200 €"
          icon={<DollarSign className="w-5 h-5" />}
          trend="up"
          change="+14.2%"
        />
        <StatCard
          label={t('admin.pendingApprovals')}
          value={requests.filter(r => r.status === 'pending').length}
          icon={<ShieldCheck className="w-5 h-5" />}
          hint={t('demoUi.teacherFiles')}
        />
        <StatCard
          label={t('demoUi.systemHealth')}
          value="100 %"
          icon={<CheckCircle2 className="w-5 h-5" />}
          hint={t('demoUi.systemNominal')}
        />
      </div>

      {/* Verification requests queue */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">{t('demoUi.pendingFiles')}</h2>
          <span className="text-xs text-slate-400 tabular-nums">{t('demoUi.requestsCount', { count: requests.length })}</span>
        </div>

        <div className="divide-y divide-slate-100">
          {requests.map(req => (
            <div key={req.id} className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900">{req.teacherName}</h3>
                  <Badge variant={req.status === 'approved' ? 'success' : req.status === 'pending' ? 'warning' : 'danger'} size="sm">
                    {req.status}
                  </Badge>
                </div>
                <span className="text-slate-500 block mt-0.5">{req.email} · {t('demoUi.specialty', { value: req.specialty })}</span>
                {req.registrationNumber && <span className="text-slate-500 block mt-1">{t('demoUi.registration', { value: req.registrationNumber })}</span>}
                {req.credentialsSummary && <p className="text-slate-600 mt-2 max-w-2xl leading-relaxed">{req.credentialsSummary}</p>}
                {req.documents?.map((document, index) => <button key={`${document.url}-${index}`} type="button" onClick={() => void teacherVerificationService.downloadDocument(document).catch(() => undefined)} className="text-indigo-700 underline underline-offset-2 block mt-2">{document.name} · {t('teacherVerification.downloadDocument')}</button>)}
                <span className="text-[11px] text-slate-400">{t('demoUi.submittedOn', { date: formatDate(req.submittedAt, i18n.language) })}</span>
              </div>

              {req.status === 'pending' && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await adminService.reviewTeacherRequest(req.id, 'rejected');
                      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
                    }}
                  >
                    {t('demoUi.reject')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      await adminService.reviewTeacherRequest(req.id, 'approved');
                      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
                    }}
                  >
                    {t('demoUi.approve')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Security Audit Log Preview */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900">{t('admin.auditLogs')}</h2>
        <div className="divide-y divide-slate-100 font-mono text-xs">
          {logs.map(log => (
            <div key={log.id} className="py-2.5 flex items-center justify-between">
              <div>
                <span className="font-bold text-indigo-600 me-2">{log.action}</span>
                <span className="text-slate-600">{log.performedBy} &rarr; {log.target}</span>
              </div>
              <span className="text-slate-400 text-[11px] tabular-nums">{log.timestamp}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ApiAdminDashboardPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    Promise.all([adminCatalogApi.overview(), adminCatalogApi.auditLogs({ page: 1 })])
      .then(([data, logs]) => { setOverview(data); setAudit(logs.data.slice(0, 6)); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(load, [load]);

  if (!overview) return <div className="space-y-6"><PageHeader title={t('admin.dashboardTitle')} subtitle={t('adminPanel.dashboardSubtitle')} /><ErrorAlert message={error} onRetry={load} />{!error && <LoadingState />}</div>;
  const maxSignups = Math.max(1, ...overview.dailySignups.map(day => day.count));
  const queues = [
    { label: t('adminPanel.pendingTeachers'), value: overview.queues.pendingTeachers, to: '/admin/verifications' },
    { label: t('adminPanel.pendingInstitutions'), value: overview.queues.pendingInstitutions, to: '/admin/institutions' },
    { label: t('adminPanel.pendingCourseReviews'), value: overview.queues.pendingCourseReviews, to: '/admin/courses' },
    { label: t('adminPanel.openReports'), value: overview.queues.openReports, to: '/admin/moderation' },
    { label: t('adminPanel.openTickets'), value: overview.queues.openTickets, to: '/admin/support' },
  ];
  return (
    <div className="space-y-8">
      <PageHeader title={t('admin.dashboardTitle')} subtitle={t('adminPanel.dashboardSubtitle')} />
      <ErrorAlert message={error} onRetry={load} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('adminPanel.usersTotal')} value={overview.users.total} icon={<Users className="w-5 h-5" />} hint={`${t('adminPanel.userStatus.suspended')} : ${overview.users.byStatus.suspended || 0}`} />
        <StatCard label={t('adminPanel.grossRevenue')} value={formatMoney(overview.revenue.grossAmount, 'eur', i18n.language)} icon={<DollarSign className="w-5 h-5" />} hint={t('adminPanel.paidOrders', { count: overview.revenue.paidOrders })} />
        <StatCard label={t('adminPanel.enrollments')} value={overview.learning.enrollments} icon={<BookOpen className="w-5 h-5" />} hint={t('adminPanel.completions', { count: overview.learning.completedEnrollments })} />
        <StatCard label={t('adminPanel.certificates')} value={overview.learning.certificates} icon={<ShieldCheck className="w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900">{t('adminPanel.queuesTitle')}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {queues.map(queue => (
              <li key={queue.to}><Link to={queue.to} className="py-2.5 flex items-center justify-between hover:text-indigo-700">
                <span>{queue.label}</span><Badge variant={queue.value ? 'warning' : 'default'} size="sm">{queue.value}</Badge>
              </Link></li>
            ))}
          </ul>
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3 lg:col-span-2">
          <h2 className="text-base font-bold text-slate-900">{t('adminPanel.signupsTitle')}</h2>
          <div className="flex items-end gap-1.5 h-32" role="img" aria-label={t('adminPanel.signupsTitle')}>
            {overview.dailySignups.map(day => (
              <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${formatDate(day.date, i18n.language)} : ${day.count}`}>
                <span className="text-[10px] tabular-nums text-slate-500">{day.count || ''}</span>
                <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(2, (day.count / maxSignups) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {Object.entries(overview.users.byRole).map(([role, count]) => <Badge key={role} variant="info" size="sm">{t(`adminPanel.roles.${role}`, { defaultValue: role })} · {count}</Badge>)}
          </div>
        </section>
      </div>
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{t('adminPanel.recentAudit')}</h2>
          <Link to="/admin/audit-logs" className="text-xs font-semibold text-indigo-700">{t('adminPanel.seeAll')}</Link>
        </div>
        <ul className="divide-y divide-slate-100 font-mono text-xs">
          {audit.map(entry => (
            <li key={entry.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span><span className="font-bold text-indigo-600 me-2">{entry.action}</span><span className="text-slate-600">{entry.performedBy} &rarr; {entry.target}</span></span>
              <span className="text-slate-400 text-[11px] tabular-nums">{formatDateTime(entry.timestamp, i18n.language)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export const AdminDashboardPage: React.FC = () => usesApi ? <ApiAdminDashboardPage /> : <MockAdminDashboardPage />;

/** Teacher accreditation queue (dedicated route; previously only embedded in the dashboard). */
export const AdminVerificationsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<TeacherVerificationRequest[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); adminService.getVerificationRequests().then(result => setRequests(result.data)).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(load, [load]);

  const review = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id); setError('');
    try { await adminService.reviewTeacherRequest(id, status); setRequests(prev => (prev || []).map(item => item.id === id ? { ...item, status } : item)); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };
  const pending = (requests || []).filter(item => item.status === 'pending');
  const processed = (requests || []).filter(item => item.status !== 'pending');

  const renderRequest = (req: TeacherVerificationRequest) => (
    <div key={req.id} className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">{req.teacherName}</h3>
          <Badge variant={req.status === 'approved' ? 'success' : req.status === 'pending' ? 'warning' : 'danger'} size="sm">{t(`common.${req.status}`)}</Badge>
        </div>
        <span className="text-slate-500 block">{req.email} · {t('adminPanel.specialty', { value: req.specialty })}</span>
        {req.registrationNumber && <span className="text-slate-500 block">{t('adminPanel.registrationNumber', { value: req.registrationNumber })}</span>}
        {req.credentialsSummary && <p className="text-slate-600 max-w-2xl leading-relaxed">{req.credentialsSummary}</p>}
        {req.documents?.map((document, index) => (
          <button key={`${document.url}-${index}`} type="button" onClick={() => void teacherVerificationService.downloadDocument(document).catch(cause => setError(apiErrorMessage(t, cause)))} className="text-indigo-700 underline underline-offset-2 block">
            {document.name} · {t('teacherVerification.downloadDocument')}
          </button>
        ))}
        <span className="text-[11px] text-slate-400 block">{t('adminPanel.submittedOn', { date: formatDate(req.submittedAt, i18n.language) })}</span>
      </div>
      {req.status === 'pending' && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busyId === req.id} onClick={() => void review(req.id, 'rejected')}>{t('adminPanel.reject')}</Button>
          <Button variant="primary" size="sm" isLoading={busyId === req.id} onClick={() => void review(req.id, 'approved')}>{t('adminPanel.approve')}</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('adminPanel.verificationsTitle')} subtitle={t('adminPanel.verificationsSubtitle')} />
      <ErrorAlert message={error} onRetry={requests ? undefined : load} />
      {!requests && !error && <LoadingState />}
      {requests && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          {pending.length === 0 ? <p className="text-sm text-slate-500">{t('adminPanel.noPendingVerifications')}</p> : <div className="divide-y divide-slate-100">{pending.map(renderRequest)}</div>}
        </section>
      )}
      {processed.length > 0 && <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs opacity-90"><div className="divide-y divide-slate-100">{processed.map(renderRequest)}</div></section>}
    </div>
  );
};

const assignableRoles: User['role'][] = ['student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'];

export const AdminUsersPage: React.FC = () => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [savingUserId, setSavingUserId] = useState('');

  useEffect(() => {
    adminService.getUsers().then(res => setUsers(res.data)).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);

  const handleRoleChange = async (userId: string, newRole: User['role']) => {
    setSavingUserId(userId); setError('');
    try {
      const result = await adminService.updateUserRole(userId, newRole);
      if (result.data) setUsers(prev => prev.map(u => u.id === userId ? result.data! : u));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setSavingUserId(''); }
  };

  const handleStatusChange = async (userId: string, newStatus: User['status']) => {
    setSavingUserId(userId); setError('');
    try {
      const result = await adminService.updateUserStatus(userId, newStatus);
      if (result.data) setUsers(prev => prev.map(u => u.id === userId ? result.data! : u));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setSavingUserId(''); }
  };

  const query = search.trim().toLowerCase();
  const visible = query ? users.filter(u => u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)) : users;
  return (
    <div className="space-y-6">
      <PageHeader title={t('adminPanel.usersTitle')} subtitle={t('adminPanel.usersSubtitle')} />
      <Input aria-label={t('adminPanel.searchUsers')} placeholder={t('adminPanel.searchUsers')} value={search} onChange={event => setSearch(event.target.value)} />
      <ErrorAlert message={error} />
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs divide-y divide-slate-100">
        {visible.map(u => (
          <div key={u.id} className="p-4 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">{u.name}</h3>
                <Badge variant={u.status === 'active' ? 'success' : u.status === 'pending' ? 'warning' : 'danger'} size="sm">{t(`adminPanel.userStatus.${u.status}`)}</Badge>
              </div>
              <span className="text-slate-500 block mt-0.5">{u.email}</span>
              {usesApi && <Link to={`/admin/users/${u.id}`} className="text-indigo-700 font-semibold hover:underline mt-1 inline-block">{t('adminRecordsUi.openDetail')}</Link>}
            </div>
            <div className="flex items-center gap-3">
              <select
                aria-label={t('common.status')}
                value={u.role}
                onChange={(e) => void handleRoleChange(u.id, e.target.value as User['role'])}
                disabled={savingUserId === u.id}
                className="bg-slate-100 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                {assignableRoles.map(role => <option key={role} value={role}>{t(`adminPanel.roles.${role}`)}</option>)}
              </select>
              <Button
                variant={u.status === 'active' ? 'ghost' : 'outline'}
                size="sm"
                onClick={() => void handleStatusChange(u.id, u.status === 'active' ? 'suspended' : 'active')}
                disabled={savingUserId === u.id}
                className={u.status === 'active' ? 'text-rose-600' : 'text-emerald-600'}
              >
                {u.status === 'active' ? t('adminPanel.suspend') : t('adminPanel.reactivate')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const AdminSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [commissionRate, setCommissionRate] = useState(20);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [subscription, setSubscription] = useState({ enabled: false, monthlyPrice: 29, yearlyPrice: 279 });
  const [offlinePayments, setOfflinePayments] = useState({ enabled: true, instructions: '' });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(usesApi);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    adminService.getPlatformSettings().then(settings => {
      if (active) { setCommissionRate(settings.commissionRate); setMaintenanceMode(settings.maintenanceMode); setSubscription(settings.subscription); if (settings.offlinePayments) setOfflinePayments(settings.offlinePayments); }
    }).catch(cause => { if (active) setError(apiErrorMessage(t, cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const save = async () => {
    if (usesApi) {
      setSaving(true); setSaved(false); setError('');
      try {
        const settings = await adminService.updatePlatformSettings({ commissionRate, maintenanceMode, subscription, offlinePayments });
        setCommissionRate(settings.commissionRate); setMaintenanceMode(settings.maintenanceMode); setSubscription(settings.subscription); if (settings.offlinePayments) setOfflinePayments(settings.offlinePayments); setSaved(true);
      } catch (cause) { setError(apiErrorMessage(t, cause)); }
      finally { setSaving(false); }
    } else setSaved(true);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={t('adminPanel.settingsTitle')} subtitle={t('adminPanel.settingsSubtitle')} />
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600" role="note">{usesApi ? t('adminPanel.settingsServerNotice') : t('admin.settingsDemoNotice')}</p>
        {loading && <LoadingState />}
        <FormField label={t('adminPanel.commissionRate')} hint={t('adminPanel.commissionHint')}>
          <Input type="number" value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value))} min={0} max={50} />
        </FormField>
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div>
            <span className="text-xs font-bold text-slate-900 block">{t('adminPanel.maintenanceMode')}</span>
            <span className="text-[11px] text-slate-500">{t('adminPanel.maintenanceHint')}</span>
          </div>
          <input type="checkbox" aria-label={t('adminPanel.maintenanceMode')} checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} className="w-4 h-4 rounded text-indigo-600" />
        </div>
        {usesApi && (<>
          <fieldset className="pt-4 border-t border-slate-100 space-y-4">
            <legend className="text-xs font-bold text-slate-900">{t('adminPanel.subscriptionTitle')}</legend>
            <p className="text-[11px] text-slate-500">{t('adminPanel.subscriptionHint')}</p>
            <label className="flex items-center justify-between text-xs font-semibold text-slate-800">
              {t('adminPanel.subscriptionEnabled')}
              <input type="checkbox" checked={subscription.enabled} onChange={event => setSubscription(prev => ({ ...prev, enabled: event.target.checked }))} className="w-4 h-4 rounded text-indigo-600" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t('adminPanel.monthlyPrice')}><Input type="number" min={1} step="0.01" value={subscription.monthlyPrice} onChange={event => setSubscription(prev => ({ ...prev, monthlyPrice: Number(event.target.value) }))} /></FormField>
              <FormField label={t('adminPanel.yearlyPrice')}><Input type="number" min={1} step="0.01" value={subscription.yearlyPrice} onChange={event => setSubscription(prev => ({ ...prev, yearlyPrice: Number(event.target.value) }))} /></FormField>
            </div>
          </fieldset>
          <fieldset className="pt-4 border-t border-slate-100 space-y-3">
            <legend className="text-xs font-bold text-slate-900">{t('offlineUi.settingsTitle')}</legend>
            <label className="flex items-center justify-between gap-3 text-[11px] text-slate-600">
              <span>{t('offlineUi.settingsEnabled')}</span>
              <input type="checkbox" checked={offlinePayments.enabled} onChange={event => setOfflinePayments(prev => ({ ...prev, enabled: event.target.checked }))} className="w-4 h-4 rounded text-indigo-600" />
            </label>
            <FormField label={t('offlineUi.settingsInstructions')} hint={t('offlineUi.settingsInstructionsHint')}>
              <Textarea rows={3} maxLength={2000} value={offlinePayments.instructions} onChange={event => setOfflinePayments(prev => ({ ...prev, instructions: event.target.value }))} />
            </FormField>
          </fieldset>
        </>)}

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button variant="primary" size="md" onClick={() => void save()} disabled={saving || loading || commissionRate < 0 || commissionRate > 50}>
            {saving ? t('platformCommon.saving') : t('adminPanel.saveSettings')}
          </Button>
        </div>
        {saved && (
          <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{usesApi ? t('adminPanel.settingsSaved') : t('admin.settingsDemoNotice')}</span>
          </div>
        )}
        <ErrorAlert message={error} />
      </div>
    </div>
  );
};
