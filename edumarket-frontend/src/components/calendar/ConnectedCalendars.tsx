import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Unplug } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';
import { ConfirmationDialog } from '../molecules/ConfirmationDialog';
import { calendarService, type CalendarConnection, type ProvidersStatus } from '../../services/calendarService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

interface Props { providers: ProvidersStatus | null; connections: CalendarConnection[]; onChanged: (connections: CalendarConnection[]) => void }

const fieldClass = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

/**
 * "Calendriers connectés": a provider is shown as connected only once the API returned the connection; a provider the server
 * is not configured for says so instead of offering a button that would do nothing.
 */
export const ConnectedCalendars: React.FC<Props> = ({ providers, connections, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [disconnecting, setDisconnecting] = useState<CalendarConnection | null>(null);

  const run = async (key: string, action: () => Promise<CalendarConnection[] | void>, success?: string) => {
    setBusy(key); setError(''); setNotice('');
    try { const result = await action(); if (result) onChanged(result); if (success) setNotice(success); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(''); }
  };
  const replace = (updated: CalendarConnection) => connections.map(connection => connection.id === updated.id ? updated : connection);
  const connect = (provider: 'google' | 'microsoft', access: 'read' | 'write') => run(`connect-${provider}`, async () => { window.location.assign(await calendarService.connect(provider, access)); });

  const statusBadge = (connection: CalendarConnection) => {
    if (connection.status === 'expired') return <Badge variant="danger" size="sm">{t('calendarUi.connection.expired')}</Badge>;
    if (connection.status === 'error') return <Badge variant="warning" size="sm">{t('calendarUi.connection.error')}</Badge>;
    if (connection.status === 'syncing') return <Badge variant="info" size="sm">{t('calendarUi.connection.syncing')}</Badge>;
    return <Badge variant="success" size="sm">{connection.lastSyncAt ? t('calendarUi.connection.synced') : t('calendarUi.connection.connected')}</Badge>;
  };

  return (
    <section aria-labelledby="connected-calendars-title" className="space-y-4">
      <div>
        <h2 id="connected-calendars-title" className="text-sm font-bold text-slate-900">{t('calendarUi.connectedTitle')}</h2>
        <p className="text-xs text-slate-500">{providers?.pushNotifications ? t('calendarUi.syncTimingPush') : t('calendarUi.syncTimingPolling')}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
      {(['google', 'microsoft'] as const).map(provider => {
        const connection = connections.find(entry => entry.provider === provider);
        const configured = providers?.[provider];
        return (
          <article key={provider} aria-label={t(`calendarUi.providers.${provider}`)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{t(`calendarUi.providerTitles.${provider}`)}</h3>
                {connection && <p className="text-xs text-slate-500">{connection.accountLabel || t('calendarUi.connection.account')} · {t(`calendarUi.access.${connection.access}`)}</p>}
              </div>
              {connection ? statusBadge(connection) : <Badge variant="default" size="sm">{configured ? t('calendarUi.connection.notConnected') : t('calendarUi.connection.notConfigured')}</Badge>}
            </div>

            {!connection && !configured && <p className="text-xs text-slate-600">{t(`calendarUi.notConfiguredHelp.${provider}`)}</p>}
            {!connection && configured && (
              <div className="space-y-2">
                <p className="text-xs text-slate-600">{t(`calendarUi.connectHelp.${provider}`)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" isLoading={busy === `connect-${provider}`} onClick={() => void connect(provider, 'write')}>{t('calendarUi.connectWrite')}</Button>
                  <Button size="sm" variant="outline" isLoading={busy === `connect-${provider}`} onClick={() => void connect(provider, 'read')}>{t('calendarUi.connectRead')}</Button>
                </div>
              </div>
            )}

            {connection && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-600">
                  {connection.lastSyncAt ? t('calendarUi.lastSync', { date: formatDateTime(connection.lastSyncAt, i18n.language) }) : t('calendarUi.neverSynced')}
                  {connection.lastError && connection.status !== 'expired' && <span className="block text-amber-800">{t(`calendarUi.syncErrors.${connection.lastError}`, { defaultValue: connection.lastError })}</span>}
                </p>
                {connection.status === 'expired' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2 text-rose-800">
                    <span>{t('calendarUi.expiredHelp')}</span>
                    <Button size="sm" onClick={() => void connect(provider, connection.access)}>{t('calendarUi.reconnect')}</Button>
                  </div>
                )}
                {connection.lastError === 'CONSENT_REQUIRED' && <p className="rounded-lg bg-amber-50 p-2 text-amber-900">{t('calendarUi.consentHelp')} <button type="button" className="underline" onClick={() => void connect(provider, connection.access)}>{t('calendarUi.reconnect')}</button></p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 font-semibold text-slate-700">{t('calendarUi.syncMode')}
                    <select className={fieldClass} value={connection.syncMode} disabled={!!busy} onChange={event => void run(`mode-${provider}`, async () => replace(await calendarService.updateConnection(connection.id, { syncMode: event.target.value as CalendarConnection['syncMode'] })), t('calendarUi.settingsSaved'))}>
                      {(['read_only', 'push', 'two_way'] as const).map(mode => <option key={mode} value={mode} disabled={mode !== 'read_only' && connection.access !== 'write'}>{t(`calendarUi.syncModes.${mode}`)}</option>)}
                    </select>
                    <span className="font-normal text-slate-500">{t(`calendarUi.syncModeHelp.${connection.syncMode}`)}</span>
                  </label>
                  {connection.access === 'write' && (
                    <label className="flex flex-col gap-1 font-semibold text-slate-700">{t('calendarUi.defaultCalendar')}
                      <select className={fieldClass} value={connection.defaultCalendarId} disabled={!!busy} onChange={event => void run(`default-${provider}`, async () => replace(await calendarService.updateConnection(connection.id, { defaultCalendarId: event.target.value })), t('calendarUi.settingsSaved'))}>
                        {connection.calendars.filter(calendar => calendar.canEdit).map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <fieldset>
                  <legend className="mb-1 font-semibold text-slate-700">{t('calendarUi.calendarsToShow')}</legend>
                  <ul className="space-y-1">
                    {connection.calendars.map(calendar => (
                      <li key={calendar.id}>
                        <label className="flex items-center gap-2 text-slate-800">
                          <input type="checkbox" checked={calendar.selected} disabled={!!busy} onChange={event => void run(`select-${calendar.id}`, async () => replace(await calendarService.updateConnection(connection.id, { calendars: [{ id: calendar.id, selected: event.target.checked }] })))} />
                          {calendar.name}
                          {calendar.primary && <span className="text-slate-500">({t('calendarUi.primary')})</span>}
                          {!calendar.canEdit && <span className="text-slate-500">· {t('calendarUi.readOnlyCalendar')}</span>}
                          {calendar.teamsAvailable && <span className="text-slate-500">· Teams</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-3 w-3" />} disabled={connection.status === 'expired'} isLoading={busy === `sync-${provider}`} onClick={() => void run(`sync-${provider}`, async () => replace(await calendarService.syncConnection(connection.id)), t('calendarUi.syncDone'))}>{t('calendarUi.syncNow')}</Button>
                  <Button size="sm" variant="ghost" disabled={connection.status === 'expired'} isLoading={busy === `refresh-${provider}`} onClick={() => void run(`refresh-${provider}`, async () => replace(await calendarService.refreshCalendars(connection.id)))}>{t('calendarUi.refreshList')}</Button>
                  <Button size="sm" variant="danger" leftIcon={<Unplug className="h-3 w-3" />} onClick={() => setDisconnecting(connection)}>{t('calendarUi.disconnect')}</Button>
                </div>
              </div>
            )}
          </article>
        );
      })}
      <ConfirmationDialog
        isOpen={!!disconnecting} isDangerous isLoading={busy === 'disconnect'}
        title={t('calendarUi.disconnectTitle', { provider: disconnecting ? t(`calendarUi.providers.${disconnecting.provider}`) : '' })}
        description={t('calendarUi.disconnectText')} confirmLabel={t('calendarUi.disconnect')}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => { const target = disconnecting!; void run('disconnect', async () => { await calendarService.disconnect(target.id); setDisconnecting(null); return connections.filter(connection => connection.id !== target.id); }, t('calendarUi.disconnected')); }}
      />
    </section>
  );
};
