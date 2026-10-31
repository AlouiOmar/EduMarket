import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LifeBuoy, Send } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { EmptyState } from '../../components/molecules/EmptyState';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { supportApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import type { SupportTicket, TicketCategory, TicketStatus } from '../../types/platform';

export const ticketStatusVariant: Record<TicketStatus, 'warning' | 'info' | 'success' | 'default'> = { open: 'warning', pending_user: 'info', resolved: 'success', closed: 'default' };
const categories: TicketCategory[] = ['account', 'billing', 'course', 'technical', 'other'];

/** Shared personal support centre for every signed-in role; tickets are private to their requester. */
export const SupportPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('technical');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(() => { setError(''); supportApi.mine().then(setTickets).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="max-w-4xl mx-auto space-y-6"><PageHeader title={t('support.title')} subtitle={t('support.subtitle')} /><ApiModeNotice /></div>;

  const replace = (ticket: SupportTicket) => setTickets(prev => (prev || []).map(item => item.id === ticket.id ? ticket : item));
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setSending(true); setError(''); setNotice('');
    try {
      const ticket = await supportApi.create({ subject, category, message });
      setTickets(prev => [ticket, ...(prev || [])]); setSubject(''); setMessage(''); setNotice(t('support.created'));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setSending(false); }
  };
  const reply = async (ticketId: string) => {
    const body = replies[ticketId]?.trim(); if (!body) return;
    try { replace(await supportApi.reply(ticketId, body)); setReplies(prev => ({ ...prev, [ticketId]: '' })); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const close = async (ticketId: string) => {
    try { replace(await supportApi.close(ticketId)); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('support.title')} subtitle={t('support.subtitle')} />
      <ErrorAlert message={error} onRetry={tickets ? undefined : load} />
      {notice && <NoticeBanner tone="success">{notice}</NoticeBanner>}
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-indigo-600" />{t('support.newTicket')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label={t('support.subject')} required className="sm:col-span-2"><Input value={subject} onChange={event => setSubject(event.target.value)} minLength={5} maxLength={180} required /></FormField>
          <FormField label={t('support.category')} required>
            <Select value={category} onChange={event => setCategory(event.target.value as TicketCategory)} options={categories.map(value => ({ value, label: t(`support.categories.${value}`) }))} />
          </FormField>
        </div>
        <FormField label={t('support.message')} required><Textarea value={message} onChange={event => setMessage(event.target.value)} rows={4} minLength={10} maxLength={5000} required /></FormField>
        <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" isLoading={sending} leftIcon={<Send className="w-3.5 h-3.5" />}>{t('support.send')}</Button></div>
      </form>
      {!tickets && !error && <LoadingState />}
      {tickets?.length === 0 && <EmptyState title={t('support.empty')} description={t('support.subtitle')} />}
      {tickets?.map(ticket => (
        <article key={ticket.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{ticket.subject}</h3>
              <span className="text-xs text-slate-500">{t(`support.categories.${ticket.category}`)} · {formatDateTime(ticket.createdAt, i18n.language)}</span>
            </div>
            <Badge variant={ticketStatusVariant[ticket.status]} size="sm">{t(`support.status.${ticket.status}`)}</Badge>
          </header>
          <ol className="space-y-3">
            {ticket.messages.map(item => (
              <li key={item.id} className={`rounded-lg p-3 text-sm ${item.authorRole === 'staff' ? 'bg-indigo-50 text-indigo-950' : 'bg-slate-50 text-slate-800'}`}>
                <span className="block text-[11px] font-semibold text-slate-500 mb-1">{item.authorRole === 'staff' ? t('support.supportTeam') : t('support.you')} · {formatDateTime(item.createdAt, i18n.language)}</span>
                <p className="whitespace-pre-line">{item.body}</p>
              </li>
            ))}
          </ol>
          {ticket.status !== 'closed' && (
            <div className="space-y-2">
              <Textarea aria-label={t('support.reply')} placeholder={t('support.reply')} value={replies[ticket.id] || ''} onChange={event => setReplies(prev => ({ ...prev, [ticket.id]: event.target.value }))} rows={2} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => void close(ticket.id)}>{t('support.closeTicket')}</Button>
                <Button variant="outline" size="sm" disabled={!replies[ticket.id]?.trim()} onClick={() => void reply(ticket.id)}>{t('support.send')}</Button>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
};
