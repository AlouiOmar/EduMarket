import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Play } from 'lucide-react';
import { Button } from '../atoms/Button';
import { ErrorAlert } from '../molecules/PageStates';
import { integrationApi } from '../../services/integrationService';
import { apiErrorMessage } from '../../utils/apiErrors';

/** LTI tool launch: a top-level navigation in a new tab (the OIDC exchange happens between the browser, EduMarket and the tool). */
export const LtiLaunch: React.FC<{ courseId: string; itemId: string; title: string }> = ({ courseId, itemId, title }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <p className="text-slate-700">{t('integrationUi.ltiHint')}</p>
      <a href={integrationApi.ltiLaunchUrl(courseId, itemId)} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
        <ExternalLink className="w-3.5 h-3.5" aria-hidden />{t('integrationUi.launchTool', { title })}
      </a>
    </div>
  );
};

/**
 * SCORM player: the package runs in an iframe served by the separate SCORM content origin (no access to the EduMarket session),
 * which reports commits back with postMessage (checked against that origin).
 */
export const ScormPlayer: React.FC<{ courseId: string; itemId: string; title: string; onProgress?: () => void }> = ({ courseId, itemId, title, onProgress }) => {
  const { t } = useTranslation();
  const [player, setPlayer] = useState<{ url: string; preview: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!player) return;
    const origin = new URL(player.url).origin;
    const listener = (event: MessageEvent) => {
      if (event.origin !== origin || (event.data as { type?: string })?.type !== 'scorm:commit') return;
      const ok = (event.data as { ok?: boolean }).ok;
      setStatus(ok ? t('integrationUi.scormSaved') : t('integrationUi.scormSaveFailed'));
      if (ok) onProgress?.();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [player, onProgress, t]);
  const launch = async () => {
    setError('');
    try { const result = await integrationApi.launchScorm(courseId, itemId); setPlayer({ url: result.playerUrl, preview: result.preview }); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <div className="space-y-2">
      <ErrorAlert message={error} />
      {!player ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="text-slate-700">{t('integrationUi.scormHint')}</p>
          <Button size="sm" leftIcon={<Play className="w-3.5 h-3.5" />} onClick={() => void launch()}>{t('integrationUi.launchScorm', { title })}</Button>
        </div>
      ) : (
        <>
          {player.preview && <p className="text-xs text-amber-800">{t('integrationUi.scormPreview')}</p>}
          <p role="status" className="text-xs text-slate-600">{status}</p>
          <iframe title={title} src={player.url} className="h-[70vh] w-full rounded-xl border border-slate-200 bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allow="fullscreen" referrerPolicy="no-referrer" />
        </>
      )}
    </div>
  );
};
