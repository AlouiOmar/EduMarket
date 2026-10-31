import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { PasswordInput } from '../../components/atoms/PasswordInput';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice } from '../../components/molecules/PageStates';
import { usesApi } from '../../services/apiClient';
import { teacherApplicationService } from '../../services/teacherApplicationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { CountrySelect, DIAL_CODES, fieldClass } from './applicationShared';

/** Step 1 of an independent teacher application: the account, created through the existing registration and e-mail check. */
export const TeacherSignupPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '', phone: '', country: '', city: '', preferredLanguage: (['fr', 'en', 'ar'].includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : 'fr') as 'fr' | 'en' | 'ar', acceptTerms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(previous => ({ ...previous, [key]: value }));

  if (!usesApi) return <div className="space-y-4"><h1 className="text-xl font-bold text-slate-900">{t('teacherApplication.signupTitle')}</h1><ApiModeNotice /></div>;

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.firstName.trim()) next.firstName = t('teacherApplication.errors.required');
    if (!form.lastName.trim()) next.lastName = t('teacherApplication.errors.required');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = t('teacherApplication.errors.email');
    if (form.password.length < 10) next.password = t('teacherApplication.errors.passwordLength');
    if (form.password !== form.confirm) next.confirm = t('auth.passwordMismatch');
    if (!/^\+[1-9]\d{6,14}$/.test(form.phone.replace(/[\s.-]/g, ''))) next.phone = t('teacherApplication.errors.phone');
    if (!form.country) next.country = t('teacherApplication.errors.required');
    if (!form.city.trim()) next.city = t('teacherApplication.errors.required');
    if (!form.acceptTerms) next.acceptTerms = t('teacherApplication.errors.terms');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!validate() || submitting) return;
    setSubmitting(true);
    try {
      const result = await teacherApplicationService.registerCandidate({ email: form.email.trim(), password: form.password, firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.replace(/[\s.-]/g, ''), country: form.country, city: form.city.trim(), preferredLanguage: form.preferredLanguage, acceptTerms: true });
      navigate(`/auth/verify-email?email=${encodeURIComponent(form.email.trim())}`, { replace: true, state: { email: form.email.trim(), previewUrl: result.previewUrl } });
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold text-slate-900">{t('teacherApplication.signupTitle')}</h1>
        <p className="text-xs text-slate-600">{t('teacherApplication.signupSubtitle')}</p>
      </div>
      <ol className="flex flex-wrap justify-center gap-2 text-[11px] text-slate-600" aria-label={t('teacherApplication.journeyLabel')}>
        {(['account', 'identity', 'academic', 'professional', 'documents', 'review'] as const).map((step, index) => (
          <li key={step} aria-current={index === 0 ? 'step' : undefined} className={`rounded-full border px-2 py-0.5 ${index === 0 ? 'border-indigo-400 bg-indigo-50 font-semibold text-indigo-800' : 'border-slate-200'}`}>{index + 1}. {t(`teacherApplication.steps.${step}`)}</li>
        ))}
      </ol>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700">{error}</p>}
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('teacherApplication.fields.firstName')} required error={errors.firstName}><Input autoComplete="given-name" value={form.firstName} maxLength={60} onChange={event => set('firstName', event.target.value)} /></FormField>
          <FormField label={t('teacherApplication.fields.lastName')} required error={errors.lastName}><Input autoComplete="family-name" value={form.lastName} maxLength={60} onChange={event => set('lastName', event.target.value)} /></FormField>
        </div>
        <FormField label={t('auth.email')} required error={errors.email}><Input type="email" autoComplete="email" value={form.email} onChange={event => set('email', event.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('auth.password')} required error={errors.password} hint={t('teacherApplication.passwordHint')}><PasswordInput autoComplete="new-password" value={form.password} onChange={event => set('password', event.target.value)} /></FormField>
          <FormField label={t('auth.confirmPassword')} required error={errors.confirm}><PasswordInput autoComplete="new-password" value={form.confirm} onChange={event => set('confirm', event.target.value)} /></FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('teacherApplication.fields.country')} required error={errors.country}>
            <CountrySelect className={fieldClass} value={form.country} onChange={code => setForm(previous => ({ ...previous, country: code, phone: previous.phone && previous.phone !== DIAL_CODES[previous.country] ? previous.phone : DIAL_CODES[code] || previous.phone }))} />
          </FormField>
          <FormField label={t('teacherApplication.fields.city')} required error={errors.city}><Input autoComplete="address-level2" value={form.city} maxLength={100} onChange={event => set('city', event.target.value)} /></FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('teacherApplication.fields.phone')} required error={errors.phone} hint={t('teacherApplication.phoneHint')}><Input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="+216 20 000 000" value={form.phone} onChange={event => set('phone', event.target.value)} /></FormField>
          <FormField label={t('teacherApplication.fields.preferredLanguage')} required>
            <select className={fieldClass} value={form.preferredLanguage} onChange={event => set('preferredLanguage', event.target.value as 'fr' | 'en' | 'ar')}>
              {(['fr', 'en', 'ar'] as const).map(language => <option key={language} value={language}>{t(`teacherApplication.languages.${language}`)}</option>)}
            </select>
          </FormField>
        </div>
        <div>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={form.acceptTerms} aria-invalid={!!errors.acceptTerms} aria-describedby={errors.acceptTerms ? 'terms-error' : undefined} onChange={event => set('acceptTerms', event.target.checked)} />
            <span>{t('teacherApplication.acceptTermsPrefix')} <Link className="text-indigo-700 underline" to="/terms" target="_blank">{t('teacherApplication.terms')}</Link> {t('teacherApplication.and')} <Link className="text-indigo-700 underline" to="/privacy" target="_blank">{t('teacherApplication.privacy')}</Link>.</span>
          </label>
          {errors.acceptTerms && <p id="terms-error" className="mt-1 text-xs text-rose-700">{errors.acceptTerms}</p>}
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">{t('teacherApplication.signupNotice')}</p>
        <Button type="submit" className="w-full" isLoading={submitting}>{t('teacherApplication.createAccount')}</Button>
      </form>
      <div className="space-y-1 border-t border-slate-100 pt-3 text-center text-xs text-slate-600">
        <p>{t('teacherApplication.institutionalNotice')}</p>
        <p>{t('auth.alreadyHaveAccount')} <Link to="/auth/login" className="font-semibold text-indigo-700 hover:underline">{t('nav.login')}</Link></p>
      </div>
    </div>
  );
};
