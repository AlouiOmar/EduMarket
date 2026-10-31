import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cloud, Download, HardDrive, RefreshCw, Star } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { ProgressBar } from '../../components/atoms/ProgressBar';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { storageApi } from '../../services/platformServices';
import { courseService } from '../../services/courseService';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { CloudProviderName, StorageAccount } from '../../types/platform';
import type { Course } from '../../types';

const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

/** Google Drive / OneDrive accounts of a teacher or institution: course files go to the default account, then the next one with space. */
export const StoragePage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [providers, setProviders] = useState<{ provider: CloudProviderName; configured: boolean }[]>([]);
  const [accounts, setAccounts] = useState<StorageAccount[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [exportCourse, setExportCourse] = useState('');
  const [exportTarget, setExportTarget] = useState('download');
  const [exported, setExported] = useState<{ webUrl: string; accountEmail: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    Promise.all([storageApi.providers(), storageApi.accounts(), courseService.getMyCourses()])
      .then(([list, mine, myCourses]) => { setProviders(list); setAccounts(mine); setCourses(myCourses.data); setExportCourse(current => current || myCourses.data[0]?.id || ''); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);
  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('storageUi.title')} subtitle={t('storageUi.subtitle')} /><ApiModeNotice /></div>;

  const status = searchParams.get('storage');
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await action(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(''); }
  };
  const connect = (provider: CloudProviderName) => run(`connect-${provider}`, async () => { window.location.assign(await storageApi.connect(provider)); });
  const runExport = (event: React.FormEvent) => {
    event.preventDefault(); setExported(null);
    void run('export', async () => {
      if (exportTarget === 'download') await storageApi.downloadGrades(exportCourse);
      else setExported(await storageApi.exportGrades(exportCourse, exportTarget));
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader title={t('storageUi.title')} subtitle={t('storageUi.subtitle')} />
      {status === 'connected' && <NoticeBanner tone="success">{t('storageUi.connected')}</NoticeBanner>}
      {status === 'error' && <NoticeBanner tone="warning">{t('storageUi.connectError')} {searchParams.get('code') ? apiErrorMessage(t, { code: searchParams.get('code') }) : ''} <button type="button" className="underline" onClick={() => setSearchParams({})}>{t('platformCommon.close')}</button></NoticeBanner>}
      <NoticeBanner>{t('storageUi.howItWorks')}</NoticeBanner>
      <ErrorAlert message={error} onRetry={load} />

      <section className="flex flex-wrap gap-3" aria-label={t('storageUi.connectTitle')}>
        {providers.map(item => (
          <Button key={item.provider} variant="outline" leftIcon={<Cloud className="w-4 h-4" />} disabled={!item.configured} isLoading={busy === `connect-${item.provider}`} onClick={() => void connect(item.provider)}
            title={item.configured ? undefined : t('storageUi.notConfigured')}>
            {t(`storageUi.connect.${item.provider}`)}
          </Button>
        ))}
      </section>
      {providers.length > 0 && providers.every(item => !item.configured) && <p className="text-xs text-slate-500">{t('storageUi.notConfigured')}</p>}

      {!accounts && !error && <LoadingState />}
      {accounts?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center flex flex-col items-center gap-2"><HardDrive className="w-6 h-6 text-slate-400" />{t('storageUi.empty')}</p>}
      <ul className="space-y-3">
        {accounts?.map(account => {
          const percent = account.quota.total ? Math.round(account.quota.used / account.quota.total * 100) : 0;
          return (
            <li key={account.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{t(`storageUi.providers.${account.provider}`)}</span>
                    {account.isDefault && <Badge size="sm" variant="success">{t('storageUi.default')}</Badge>}
                    {account.status === 'reconnect_required' && <Badge size="sm" variant="danger">{t('storageUi.reconnect')}</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">{account.accountEmail}{account.displayName ? ` · ${account.displayName}` : ''} · {t('storageUi.files', { count: account.platformFiles || 0 })}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!account.isDefault && <Button size="sm" variant="outline" leftIcon={<Star className="w-3.5 h-3.5" />} isLoading={busy === `default-${account.id}`} onClick={() => void run(`default-${account.id}`, async () => { await storageApi.makeDefault(account.id); load(); })}>{t('storageUi.makeDefault')}</Button>}
                  <Button size="sm" variant="ghost" aria-label={t('storageUi.refresh')} isLoading={busy === `refresh-${account.id}`} onClick={() => void run(`refresh-${account.id}`, async () => { const updated = await storageApi.refresh(account.id); setAccounts(prev => prev && prev.map(item => item.id === account.id ? { ...updated, platformFiles: item.platformFiles } : item)); })}><RefreshCw className="w-4 h-4" /></Button>
                  {account.status === 'reconnect_required' && <Button size="sm" variant="outline" onClick={() => void connect(account.provider)}>{t('storageUi.reconnect')}</Button>}
                  <Button size="sm" variant="ghost" className="text-rose-600" isLoading={busy === `remove-${account.id}`} onClick={() => void run(`remove-${account.id}`, async () => { await storageApi.disconnect(account.id); load(); })}>{t('storageUi.disconnect')}</Button>
                </div>
              </div>
              {account.quota.total ? (
                <div className="space-y-1">
                  <ProgressBar percent={percent} />
                  <p className="text-[11px] text-slate-500">{t('storageUi.quota', { used: formatBytes(account.quota.used), total: formatBytes(account.quota.total), free: formatBytes(account.quota.free || 0) })}{percent >= 95 ? ` · ${t('storageUi.almostFull')}` : ''}</p>
                </div>
              ) : <p className="text-[11px] text-slate-500">{t('storageUi.unlimited', { used: formatBytes(account.quota.used) })}</p>}
            </li>
          );
        })}
      </ul>

      <form onSubmit={runExport} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3" aria-labelledby="grades-export-title">
        <h2 id="grades-export-title" className="text-sm font-bold text-slate-900">{t('storageUi.gradesTitle')}</h2>
        <p className="text-xs text-slate-500">{t('storageUi.gradesHelp')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <select aria-label={t('storageUi.course')} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs min-w-56" value={exportCourse} onChange={event => setExportCourse(event.target.value)} required>
            {courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
          <select aria-label={t('storageUi.destination')} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs" value={exportTarget} onChange={event => setExportTarget(event.target.value)}>
            <option value="download">{t('storageUi.downloadCsv')}</option>
            {accounts?.filter(account => account.status === 'connected').map(account => <option key={account.id} value={account.id}>{t('storageUi.saveTo', { account: `${t(`storageUi.providers.${account.provider}`)} · ${account.accountEmail}` })}</option>)}
          </select>
          <Button type="submit" size="sm" variant="primary" leftIcon={<Download className="w-3.5 h-3.5" />} disabled={!exportCourse} isLoading={busy === 'export'}>{t('storageUi.export')}</Button>
        </div>
        {exported && <p role="status" className="text-xs text-emerald-800">{t('storageUi.exported', { account: exported.accountEmail })} {exported.webUrl && <a href={exported.webUrl} target="_blank" rel="noreferrer noopener" className="underline font-semibold">{t('storageUi.openFile')}</a>}</p>}
      </form>
    </div>
  );
};
