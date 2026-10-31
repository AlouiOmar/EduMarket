import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ApplicationStatus, CandidateApplication, DocumentStatus } from '../../services/teacherApplicationService';

/** ISO 3166-1 alpha-2 codes; names come from the browser (`Intl.DisplayNames`) in the interface language. */
const COUNTRY_CODES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');
/** International dialling codes of frequent countries, used to prefill the phone field (any +number is accepted). */
export const DIAL_CODES: Record<string, string> = {
  TN: '+216', DZ: '+213', MA: '+212', LY: '+218', EG: '+20', MR: '+222', FR: '+33', BE: '+32', CH: '+41', CA: '+1', US: '+1', GB: '+44', DE: '+49', ES: '+34', IT: '+39',
  PT: '+351', NL: '+31', SN: '+221', CI: '+225', CM: '+237', ML: '+223', BF: '+226', NE: '+227', TD: '+235', LB: '+961', JO: '+962', SA: '+966', AE: '+971', QA: '+974', KW: '+965', TR: '+90',
};

export function useCountries() {
  const { i18n } = useTranslation();
  return React.useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([i18n.language], { type: 'region' }); } catch { names = null; }
    return COUNTRY_CODES.map(code => ({ code, name: names?.of(code) || code })).sort((left, right) => left.name.localeCompare(right.name, i18n.language));
  }, [i18n.language]);
}
export const CountrySelect: React.FC<{ id?: string; value: string; onChange: (code: string) => void; required?: boolean; className?: string; 'aria-describedby'?: string }> = ({ value, onChange, className, ...rest }) => {
  const { t } = useTranslation();
  const countries = useCountries();
  return (
    <select {...rest} className={className} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{t('teacherApplication.chooseCountry')}</option>
      {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
    </select>
  );
};

export const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  draft: 'bg-slate-100 text-slate-800 border-slate-300', submitted: 'bg-indigo-50 text-indigo-800 border-indigo-200', under_review: 'bg-sky-50 text-sky-900 border-sky-200',
  additional_information_required: 'bg-amber-50 text-amber-900 border-amber-300', resubmitted: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  approved: 'bg-emerald-50 text-emerald-900 border-emerald-300', rejected: 'bg-rose-50 text-rose-900 border-rose-300', suspended: 'bg-rose-50 text-rose-900 border-rose-300',
};
export const StatusBadge: React.FC<{ status: ApplicationStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{t(`teacherApplication.statuses.${status}`)}</span>;
};
const DOCUMENT_STYLE: Record<DocumentStatus, string> = {
  pending_review: 'bg-slate-100 text-slate-800', verified: 'bg-emerald-100 text-emerald-900', rejected: 'bg-rose-100 text-rose-900', replacement_requested: 'bg-amber-100 text-amber-900',
};
export const DocumentStatusBadge: React.FC<{ status: DocumentStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${DOCUMENT_STYLE[status]}`}>{t(`teacherApplication.documentStatuses.${status}`)}</span>;
};

/** Translated label of a missing item code (`personal.firstName`, `documents.diploma:<id>`…). */
export function useMissingLabel(application: Pick<CandidateApplication, 'academic'> | null) {
  const { t } = useTranslation();
  return (code: string) => {
    const [key, reference] = code.split(':');
    if (reference) {
      const degree = application?.academic.degrees.find(entry => entry.id === reference);
      return t(`teacherApplication.missing.${key}`, { name: degree?.title || t('teacherApplication.degreeUntitled') });
    }
    return t(`teacherApplication.missing.${key}`, { defaultValue: code });
  };
}

/** Steps of the review shown to the candidate (the current one highlighted, never a percentage that would mean nothing). */
export const ReviewProgress: React.FC<{ status: ApplicationStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const steps = ['draft', 'submitted', 'under_review', 'decision'] as const;
  const index = status === 'draft' ? 0 : ['submitted', 'resubmitted'].includes(status) ? 1 : ['under_review', 'additional_information_required'].includes(status) ? 2 : 3;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('teacherApplication.progressLabel')}>
      {steps.map((step, position) => (
        <li key={step} aria-current={position === index ? 'step' : undefined} className={`rounded-lg border px-3 py-2 text-xs ${position < index ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : position === index ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-900' : 'border-slate-200 bg-white text-slate-600'}`}>
          <span className="block text-[10px] uppercase tracking-wide">{t('teacherApplication.stepNumber', { number: position + 1 })}{position < index ? ` · ${t('teacherApplication.done')}` : ''}</span>
          {t(`teacherApplication.progress.${step}`)}
        </li>
      ))}
    </ol>
  );
};

export const formatDate = (value: string | null | undefined, language: string, withTime = false) => value ? new Intl.DateTimeFormat(language, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value)) : '—';
export const formatSize = (bytes: number, language: string) => new Intl.NumberFormat(language, { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 }).format(bytes / 1024 / 1024);
