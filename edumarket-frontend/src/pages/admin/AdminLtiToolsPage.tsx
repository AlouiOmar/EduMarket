import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, NoticeBanner, PageHeader } from '../../components/molecules/PageStates';
import { usesApi } from '../../services/apiClient';
import { integrationApi, type LtiTool } from '../../services/integrationService';
import { apiErrorMessage } from '../../utils/apiErrors';

/** LTI 1.3 tool registration (administrators only): the platform generates the client id and deployment id. */
export const AdminLtiToolsPage: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<{ configured: boolean; issuer: string | null; tools: LtiTool[] } | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', oidcLoginUrl: 'https://', targetLinkUri: 'https://', redirectUris: '', jwksUrl: '', publicKeyPem: '', sendName: false, sendEmail: false });
  const load = useCallback(() => integrationApi.ltiAdmin().then(setData).catch(cause => setError(apiErrorMessage(t, cause))), [t]);
  useEffect(() => { if (usesApi) void load(); }, [load]);
  if (!usesApi) return <div className="max-w-5xl mx-auto"><ApiModeNotice /></div>;
  const register = async () => {
    setError('');
    try {
      await integrationApi.registerTool({ name: form.name.trim(), oidcLoginUrl: form.oidcLoginUrl.trim(), targetLinkUri: form.targetLinkUri.trim(), redirectUris: form.redirectUris.split('\n').map(value => value.trim()).filter(Boolean), jwksUrl: form.jwksUrl.trim(), publicKeyPem: form.publicKeyPem.trim(), privacy: { sendName: form.sendName, sendEmail: form.sendEmail } });
      setForm({ name: '', oidcLoginUrl: 'https://', targetLinkUri: 'https://', redirectUris: '', jwksUrl: '', publicKeyPem: '', sendName: false, sendEmail: false });
      await load();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <PageHeader title={t('integrationUi.adminLtiTitle')} subtitle={t('integrationUi.adminLtiSubtitle')} />
      <ErrorAlert message={error} />
      {!data ? <LoadingState /> : (
        <>
          {data.configured ? <NoticeBanner tone="success">{t('integrationUi.platformInfo', { issuer: data.issuer })}</NoticeBanner> : <NoticeBanner tone="warning">{t('integrationUi.notConfigured.lti')}</NoticeBanner>}
          <ul className="space-y-2">
            {data.tools.map(tool => (
              <li key={tool.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{tool.name} <Badge size="sm" variant={tool.status === 'active' ? 'success' : 'default'}>{t(`integrationUi.toolStatus.${tool.status}`)}</Badge></p>
                  <Button size="sm" variant="outline" onClick={() => integrationApi.updateTool(tool.id, { status: tool.status === 'active' ? 'disabled' : 'active' }).then(load).catch(cause => setError(apiErrorMessage(t, cause)))}>{tool.status === 'active' ? t('integrationUi.disable') : t('integrationUi.enable')}</Button>
                </div>
                <p><span className="font-semibold">Client ID</span> : <code>{tool.clientId}</code> · <span className="font-semibold">Deployment ID</span> : <code>{tool.deploymentId}</code></p>
                <p>{t('integrationUi.loginUrl')} : {tool.oidcLoginUrl} · {t('integrationUi.redirects')} : {tool.redirectUris.join(', ')}</p>
                <p>{tool.jwksUrl ? `JWKS : ${tool.jwksUrl}` : t('integrationUi.pemKey')} · {t('integrationUi.privacyFlags', { name: tool.privacy.sendName ? t('lmsCommon.yes') : t('lmsCommon.no'), email: tool.privacy.sendEmail ? t('lmsCommon.yes') : t('lmsCommon.no') })}</p>
              </li>
            ))}
            {!data.tools.length && <li className="text-sm text-slate-500">{t('integrationUi.noTools')}</li>}
          </ul>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="register-tool">
            <h2 id="register-tool" className="text-sm font-semibold text-slate-900">{t('integrationUi.registerTool')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label={t('integrationUi.toolName')} required><Input value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
              <FormField label={t('integrationUi.loginUrl')} required><Input type="url" value={form.oidcLoginUrl} onChange={event => setForm({ ...form, oidcLoginUrl: event.target.value })} /></FormField>
              <FormField label={t('integrationUi.targetLink')} required><Input type="url" value={form.targetLinkUri} onChange={event => setForm({ ...form, targetLinkUri: event.target.value })} /></FormField>
              <FormField label={t('integrationUi.jwksUrl')}><Input type="url" value={form.jwksUrl} onChange={event => setForm({ ...form, jwksUrl: event.target.value })} /></FormField>
            </div>
            <FormField label={t('integrationUi.redirects')} hint={t('integrationUi.redirectsHint')} required><Textarea rows={2} value={form.redirectUris} onChange={event => setForm({ ...form, redirectUris: event.target.value })} /></FormField>
            <FormField label={t('integrationUi.publicKey')} hint={t('integrationUi.publicKeyHint')}><Textarea rows={3} value={form.publicKeyPem} onChange={event => setForm({ ...form, publicKeyPem: event.target.value })} /></FormField>
            <div className="flex flex-wrap gap-4 text-xs text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sendName} onChange={event => setForm({ ...form, sendName: event.target.checked })} />{t('integrationUi.sendName')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.sendEmail} onChange={event => setForm({ ...form, sendEmail: event.target.checked })} />{t('integrationUi.sendEmailFlag')}</label>
            </div>
            <div className="flex justify-end"><Button size="sm" disabled={!form.name.trim() || !form.redirectUris.trim() || (!form.jwksUrl.trim() && !form.publicKeyPem.trim())} onClick={() => void register()}>{t('integrationUi.register')}</Button></div>
          </section>
        </>
      )}
    </div>
  );
};
