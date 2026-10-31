import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, MapPin, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { EmptyState } from '../../components/molecules/EmptyState';
import { ErrorAlert, LoadingState } from '../../components/molecules/PageStates';
import { CourseCard } from '../../components/organisms/CourseCard';
import { courseService } from '../../services/courseService';
import { supportApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { describeApiError } from '../../utils/apiErrors';
import type { Course } from '../../types';

const Prose: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="max-w-3xl mx-auto px-4 py-12 space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
    <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
    {children}
  </div>
);

export const AboutPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">{t('staticUi.aboutTitle')}</h1>
        <p className="text-sm text-slate-600">{t('staticUi.aboutTagline')}</p>
      </div>
      <div className="text-sm text-slate-700 leading-relaxed space-y-4">
        <p>{t('staticUi.aboutP1')}</p>
        <p>{t('staticUi.aboutP2')}</p>
      </div>
    </div>
  );
};

/** API mode opens a support ticket (signed-in users) or a guest ticket answered by e-mail (visitors). */
export const ContactPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!usesApi) { setSubmitted(true); return; }
    setSending(true);
    try {
      if (user) await supportApi.create({ subject: t('staticUi.contactSubject'), category: 'other', message });
      else await supportApi.contact({ name, email, subject: t('staticUi.contactSubject'), message });
      setSubmitted(true);
    } catch (cause) { setError(describeApiError(cause)); }
    finally { setSending(false); }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900">{t('staticUi.contactTitle')}</h1>
        <p className="text-sm text-slate-600">{t('staticUi.contactSubtitle')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-800">{t('staticUi.directContact')}</h2>
          <div className="space-y-3 text-xs text-slate-600">
            <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-indigo-600" /><span>contact@edumarket.org</span></div>
            <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-indigo-600" /><span dir="ltr">+33 1 44 55 66 77</span></div>
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-indigo-600" /><span>15 Boulevard des Sciences, Paris & Lyon</span></div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xs">
          {submitted ? (
            <div role="status" className="p-4 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{user && usesApi ? t('staticUi.contactSentTicket') : t('staticUi.contactSent')}</span>
            </div>
          ) : (
            <>
              <ErrorAlert message={error} />
              <FormField label={t('profileUi.fullName')} required><Input value={name} onChange={e => setName(e.target.value)} readOnly={!!user && usesApi} minLength={2} maxLength={100} required /></FormField>
              <FormField label={t('profileUi.email')} required><Input type="email" value={email} onChange={e => setEmail(e.target.value)} readOnly={!!user && usesApi} required /></FormField>
              <FormField label={t('support.message')} required><Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t('staticUi.messagePlaceholder')} rows={4} minLength={10} maxLength={5000} required /></FormField>
              <Button type="submit" variant="primary" size="md" className="w-full" isLoading={sending}>{t('staticUi.sendMessage')}</Button>
            </>
          )}
        </form>
      </div>
    </div>
  );
};

export const FaqPage: React.FC = () => {
  const { t } = useTranslation();
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const faqs = [1, 2, 3, 4, 5].map(index => ({ q: t(`staticUi.faq.q${index}`), a: t(`staticUi.faq.a${index}`) }));
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900">{t('staticUi.faqTitle')}</h1>
        <p className="text-sm text-slate-600">{t('staticUi.faqSubtitle')}</p>
      </div>
      <div className="space-y-3">
        {faqs.map((faq, i) => (
          <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <button type="button" aria-expanded={openIdx === i} onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full p-4 flex items-center justify-between text-start text-xs sm:text-sm font-bold text-slate-800 hover:bg-slate-50 transition-colors">
              <span>{faq.q}</span>
              {openIdx === i ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {openIdx === i && <div className="p-4 pt-0 text-xs text-slate-600 leading-relaxed border-t border-slate-100">{faq.a}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

export const HelpCenterPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-extrabold text-slate-900">{t('staticUi.helpTitle')}</h1>
        <p className="text-sm text-slate-600">{t('staticUi.helpSubtitle')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(['student', 'teacher', 'institution'] as const).map(guide => (
          <div key={guide} className="p-6 bg-white border border-slate-200 rounded-xl space-y-3">
            <h2 className="text-sm font-bold text-slate-900">{t(`staticUi.guides.${guide}`)}</h2>
            <p className="text-xs text-slate-600">{t(`staticUi.guides.${guide}Text`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TermsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Prose title={t('staticUi.termsTitle')}>
      <p>{t('staticUi.termsUpdated')}</p>
      <p>{t('staticUi.termsIntro')}</p>
      {[1, 2, 3, 4].map(index => (
        <section key={index} className="space-y-2">
          <h2 className="text-sm font-bold text-slate-800">{t(`staticUi.terms.h${index}`)}</h2>
          <p>{t(`staticUi.terms.p${index}`)}</p>
        </section>
      ))}
    </Prose>
  );
};

export const PrivacyPage: React.FC = () => {
  const { t } = useTranslation();
  return <Prose title={t('staticUi.privacyTitle')}><p>{t('staticUi.privacyP1')}</p><p>{t('staticUi.privacyP2')}</p></Prose>;
};

export const CookiesPage: React.FC = () => {
  const { t } = useTranslation();
  return <Prose title={t('staticUi.cookiesTitle')}><p>{t('staticUi.cookiesP1')}</p></Prose>;
};

export const AccessibilityPage: React.FC = () => {
  const { t } = useTranslation();
  return <Prose title={t('staticUi.accessibilityTitle')}><p>{t('staticUi.accessibilityP1')}</p></Prose>;
};

/** Global search over the published catalogue, driven by the `q` (or `search`) query parameter. */
export const GlobalSearchResultsPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const query = (searchParams.get('q') || searchParams.get('search') || '').trim();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setCourses(null); setError('');
    courseService.getCourses({ search: query || undefined }).then(result => { if (active) setCourses(result.data); }).catch(cause => { if (active) setError(describeApiError(cause)); });
    return () => { active = false; };
  }, [query]);
  return (
    <div className="max-w-7xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{query ? t('staticUi.searchResults', { query }) : t('staticUi.searchAll')}</h1>
      <ErrorAlert message={error} />
      {!courses && !error && <LoadingState />}
      {courses?.length === 0 && <EmptyState title={t('catalogUi.noResultsTitle')} description={t('catalogUi.noResultsText')} />}
      {!!courses?.length && <div className="grid grid-cols-1 md:grid-cols-3 gap-6">{courses.map(course => <CourseCard key={course.id} course={course} />)}</div>}
    </div>
  );
};
