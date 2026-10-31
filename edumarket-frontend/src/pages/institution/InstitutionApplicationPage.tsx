import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../../utils/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { institutionService, type InstitutionApplication } from '../../services/institutionService';

/** Institution verification request: a student account applies; admins approve before the profile becomes public. */
export const InstitutionApplicationPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [application, setApplication] = useState<InstitutionApplication | null>(null);
  const [form, setForm] = useState({ name: '', description: '', country: '', city: '', website: '', contactEmail: user?.email || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!user) return;
    institutionService.application().then(value => {
      setApplication(value);
      if (value) setForm({ name: value.name, description: value.description, country: value.country, city: value.city, website: value.website, contactEmail: value.contactEmail });
    }).catch(cause => setError(describeApiError(cause)));
  }, [user?.id]);
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await institutionService.submitApplication(form);
      setApplication(await institutionService.application());
    } catch (cause) { setError(describeApiError(cause)); }
    finally { setSaving(false); }
  };

  if (!user) return (
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <h1 className="text-2xl font-bold">{t('institutionApplyUi.title')}</h1>
      <p className="text-sm text-slate-600">{t('institutionApplyUi.signInFirst')}</p>
      <div className="flex gap-3">
        <Link to="/auth/register"><Button variant="primary">{t('institutionApplyUi.createAccount')}</Button></Link>
        <Link to="/auth/login"><Button variant="outline">{t('nav.login')}</Button></Link>
      </div>
    </div>
  );
  if (user.role !== 'student' && user.role !== 'institution') return <p className="mx-auto max-w-xl py-10 text-sm text-rose-700">{t('institutionApplyUi.notAllowed')}</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('institutionApplyUi.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('institutionApplyUi.subtitle')}</p>
      </div>
      {application?.status === 'approved' && <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{t('institutionApplyUi.approved')} <Link className="font-semibold underline" to="/institution/dashboard">{t('institutionApplyUi.openWorkspace')}</Link></div>}
      {application?.status === 'pending' && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{t('institutionApplyUi.pending')}</p>}
      {application?.status === 'rejected' && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{t('institutionApplyUi.rejected', { note: application.reviewNote || t('institutionApplyUi.rejectedDefault') })}</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {application?.status !== 'approved' && application?.status !== 'pending' && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <FormField label={t('institutionApplyUi.name')} required><Input required minLength={3} maxLength={160} value={form.name} onChange={e => update('name', e.target.value)} /></FormField>
          <FormField label={t('institutionApplyUi.description')} required hint={t('institutionApplyUi.descriptionHint')}><Textarea required minLength={30} maxLength={4000} rows={5} value={form.description} onChange={e => update('description', e.target.value)} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('institutionApplyUi.country')} required><Input required value={form.country} onChange={e => update('country', e.target.value)} /></FormField>
            <FormField label={t('institutionApplyUi.city')} required><Input required value={form.city} onChange={e => update('city', e.target.value)} /></FormField>
          </div>
          <FormField label={t('institutionApplyUi.website')}><Input type="url" value={form.website} onChange={e => update('website', e.target.value)} /></FormField>
          <FormField label={t('institutionApplyUi.contactEmail')} required><Input type="email" required value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)} /></FormField>
          <Button type="submit" variant="primary" isLoading={saving}>{application?.status === 'rejected' ? t('institutionApplyUi.resubmit') : t('institutionApplyUi.submit')}</Button>
        </form>
      )}
    </div>
  );
};
