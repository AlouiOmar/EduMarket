import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { ticketStatusVariant } from '../shared/SupportPage';
import { adminCatalogApi, supportApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import type { AuditEntry, ManagedCategory, SupportTicket } from '../../types/platform';

const severityVariant = { info: 'info', warning: 'warning', critical: 'danger' } as const;

export const AdminAuditLogsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!usesApi) return;
    const timer = window.setTimeout(() => {
      adminCatalogApi.auditLogs({ action: action.trim() || undefined, severity: severity || undefined, page })
        .then(result => { setEntries(result.data); setPages(result.pagination.pages || 1); setError(''); })
        .catch(cause => setError(apiErrorMessage(t, cause)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [action, severity, page, t]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('adminPanel.auditTitle')} subtitle={t('adminPanel.auditSubtitle')} />
      {!usesApi ? <ApiModeNotice /> : (
        <div className="flex flex-col sm:flex-row gap-3">
          <Input aria-label={t('adminPanel.filterAction')} placeholder={t('adminPanel.filterAction')} value={action} onChange={event => { setAction(event.target.value); setPage(1); }} />
          <Select aria-label={t('adminPanel.severity.all')} value={severity} onChange={event => { setSeverity(event.target.value); setPage(1); }}
            options={[{ value: '', label: t('adminPanel.severity.all') }, ...(['info', 'warning', 'critical'] as const).map(value => ({ value, label: t(`adminPanel.severity.${value}`) }))]} />
        </div>
      )}
      <ErrorAlert message={error} />
      {usesApi && !entries && !error && <LoadingState />}
      {!!entries?.length && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="p-3 text-start">{t('common.actions')}</th><th className="p-3 text-start">{t('adminPanel.actor')}</th><th className="p-3 text-start">{t('adminPanel.target')}</th><th className="p-3 text-start">IP</th><th className="p-3 text-start">{t('common.date')}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="p-3"><Badge variant={severityVariant[entry.severity]} size="sm">{entry.action}</Badge></td>
                  <td className="p-3">{entry.performedBy} <span className="text-slate-400">({t(`adminPanel.roles.${entry.actorRole}`, { defaultValue: entry.actorRole })})</span></td>
                  <td className="p-3 text-slate-600">{entry.target}</td>
                  <td className="p-3 text-slate-400">{entry.ipAddress}</td>
                  <td className="p-3 text-slate-400 whitespace-nowrap">{formatDateTime(entry.timestamp, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('common.emptyTitle')}</p>}
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};

export const AdminSupportPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    supportApi.staffQueue({ status, page }).then(result => { setTickets(result.data); setPages(result.pagination.pages || 1); }).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [status, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminPanel.supportTitle')} subtitle={t('adminPanel.supportSubtitle')} /><ApiModeNotice /></div>;
  const run = async (ticketId: string, action: () => Promise<SupportTicket>) => {
    setBusyId(ticketId); setError('');
    try { const updated = await action(); setTickets(prev => (prev || []).map(item => item.id === updated.id ? updated : item)); setDrafts(prev => ({ ...prev, [ticketId]: '' })); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader title={t('adminPanel.supportTitle')} subtitle={t('adminPanel.supportSubtitle')} actions={
        <Select aria-label={t('adminPanel.filterStatus')} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}
          options={['open', 'pending_user', 'resolved', 'closed', 'all'].map(value => ({ value, label: value === 'all' ? t('adminPanel.all') : t(`support.status.${value}`) }))} />
      } />
      <ErrorAlert message={error} onRetry={tickets ? undefined : load} />
      {!tickets && !error && <LoadingState />}
      {tickets?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('adminPanel.noTickets')}</p>}
      {tickets?.map(ticket => (
        <article key={ticket.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{ticket.subject}</h3>
              <span className="text-xs text-slate-500">{ticket.requester?.name} · {ticket.requester?.email} · {t(`support.categories.${ticket.category}`)} · {formatDateTime(ticket.createdAt, i18n.language)}</span>
            </div>
            <div className="flex gap-2">
              {ticket.priority === 'high' && <Badge variant="danger" size="sm">!</Badge>}
              <Badge variant={ticketStatusVariant[ticket.status]} size="sm">{t(`support.status.${ticket.status}`)}</Badge>
            </div>
          </header>
          <ol className="space-y-2">
            {ticket.messages.map(message => (
              <li key={message.id} className={`rounded-lg p-3 text-sm ${message.authorRole === 'staff' ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                <span className="block text-[11px] font-semibold text-slate-500">{message.authorName} · {formatDateTime(message.createdAt, i18n.language)}</span>
                <p className="whitespace-pre-line">{message.body}</p>
              </li>
            ))}
          </ol>
          {ticket.status !== 'closed' && (
            <div className="space-y-2">
              <Textarea aria-label={t('adminPanel.reply')} placeholder={t('adminPanel.replyPlaceholder')} rows={2} value={drafts[ticket.id] || ''} onChange={event => setDrafts(prev => ({ ...prev, [ticket.id]: event.target.value }))} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={busyId === ticket.id} onClick={() => void run(ticket.id, () => supportApi.staffUpdate(ticket.id, { status: 'closed' }))}>{t('adminPanel.closeTicket')}</Button>
                <Button variant="outline" size="sm" disabled={busyId === ticket.id || !drafts[ticket.id]?.trim()} onClick={() => void run(ticket.id, () => supportApi.staffReply(ticket.id, drafts[ticket.id], 'resolved'))}>{t('adminPanel.sendAndResolve')}</Button>
                <Button variant="primary" size="sm" isLoading={busyId === ticket.id} disabled={!drafts[ticket.id]?.trim()} onClick={() => void run(ticket.id, () => supportApi.staffReply(ticket.id, drafts[ticket.id], 'pending_user'))}>{t('adminPanel.sendAndWait')}</Button>
              </div>
            </div>
          )}
        </article>
      ))}
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};

const emptyNames = { fr: '', en: '', ar: '' };

export const AdminCategoriesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [categories, setCategories] = useState<ManagedCategory[] | null>(null);
  const [slug, setSlug] = useState('');
  const [names, setNames] = useState(emptyNames);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); adminCatalogApi.categories().then(setCategories).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('adminPanel.categoriesTitle')} subtitle={t('adminPanel.categoriesSubtitle')} /><ApiModeNotice /></div>;
  const language = i18n.language.slice(0, 2) as 'fr' | 'en' | 'ar';
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const category = await adminCatalogApi.createCategory({ slug: slug.trim(), names }); setCategories(prev => [...(prev || []), category]); setSlug(''); setNames(emptyNames); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  const toggle = async (category: ManagedCategory) => {
    try { const updated = await adminCatalogApi.updateCategory(category.id, { active: !category.active }); setCategories(prev => (prev || []).map(item => item.id === updated.id ? updated : item)); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const remove = async (category: ManagedCategory) => {
    try { await adminCatalogApi.deleteCategory(category.id); setCategories(prev => (prev || []).filter(item => item.id !== category.id)); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title={t('adminPanel.categoriesTitle')} subtitle={t('adminPanel.categoriesSubtitle')} />
      <ErrorAlert message={error} />
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label={t('adminPanel.slug')} required><Input value={slug} onChange={event => setSlug(event.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required /></FormField>
        <FormField label={t('adminPanel.nameFr')} required><Input value={names.fr} onChange={event => setNames(prev => ({ ...prev, fr: event.target.value }))} minLength={2} required /></FormField>
        <FormField label={t('adminPanel.nameEn')} required><Input value={names.en} onChange={event => setNames(prev => ({ ...prev, en: event.target.value }))} minLength={2} required /></FormField>
        <FormField label={t('adminPanel.nameAr')} required><Input dir="rtl" value={names.ar} onChange={event => setNames(prev => ({ ...prev, ar: event.target.value }))} minLength={2} required /></FormField>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" size="sm" isLoading={busy} leftIcon={<Plus className="w-3.5 h-3.5" />}>{t('adminPanel.addCategory')}</Button></div>
      </form>
      {!categories && !error && <LoadingState />}
      {categories?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('adminPanel.noCategories')}</p>}
      {!!categories?.length && (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
          {categories.map(category => (
            <li key={category.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
              <div>
                <span className="font-semibold text-slate-900">{category.names[language] || category.names.fr}</span>
                <span className="block text-xs text-slate-500 font-mono">{category.slug} · {t('adminPanel.coursesCount', { count: category.coursesCount })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={category.active ? 'success' : 'default'} size="sm">{category.active ? t('common.active') : t('common.inactive')}</Badge>
                <Button variant="outline" size="sm" onClick={() => void toggle(category)}>{category.active ? t('adminPanel.deactivate') : t('adminPanel.activate')}</Button>
                {category.coursesCount === 0 && <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void remove(category)}>{t('adminPanel.deleteCategory')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
