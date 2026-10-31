import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Eye, FileUp, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice } from '../../components/molecules/PageStates';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import {
  DEGREE_LEVELS, IDENTITY_TYPES, OPTIONAL_DOCUMENT_TYPES, openPrivateDocument, teacherApplicationService,
  type ApplicationDocument, type CandidateApplication, type Certification, type Degree, type DocumentType, type Eligibility, type Experience, type Personal, type Professional, type SectionsPatch,
} from '../../services/teacherApplicationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { CountrySelect, DocumentStatusBadge, ReviewProgress, StatusBadge, fieldClass, formatDate, formatSize, useMissingLabel } from './applicationShared';

type Step = 'identity' | 'academic' | 'professional' | 'documents' | 'review';
const STEPS: Step[] = ['identity', 'academic', 'professional', 'documents', 'review'];
const ACCEPT = 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg';
const CLIENT_MAX_BYTES = 10 * 1024 * 1024;
const dateInput = (value: string | null) => value ? value.slice(0, 10) : '';

interface Draft {
  personal: Personal;
  identity: { documentType: string; documentNumber: string; issuingCountry: string; issuingAuthority: string; issuedAt: string | null; expiresAt: string | null };
  academic: { degrees: Degree[]; certifications: Certification[] };
  professional: Professional;
}
const draftOf = (application: CandidateApplication): Draft => ({
  personal: { ...application.personal, birthDate: dateInput(application.personal.birthDate) || null },
  identity: { documentType: application.identity.documentType, documentNumber: '', issuingCountry: application.identity.issuingCountry, issuingAuthority: application.identity.issuingAuthority, issuedAt: dateInput(application.identity.issuedAt) || null, expiresAt: dateInput(application.identity.expiresAt) || null },
  academic: { degrees: application.academic.degrees.map(degree => ({ ...degree })), certifications: application.academic.certifications.map(entry => ({ ...entry })) },
  professional: { ...application.professional, experiences: application.professional.experiences.map(entry => ({ ...entry, startDate: dateInput(entry.startDate) || null, endDate: dateInput(entry.endDate) || null })) },
});
type Section = keyof Draft;
const STEP_SECTIONS: Record<Step, Section[]> = { identity: ['personal', 'identity'], academic: ['academic'], professional: ['professional'], documents: [], review: [] };

/** Chips for short lists (specialties, subjects, languages…), keyboard friendly: Enter or comma adds, the × button removes. */
const TagInput: React.FC<{ id?: string; label: string; values: string[]; onChange: (values: string[]) => void; max?: number; hint?: string }> = ({ label, values, onChange, max = 20, hint }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const inputId = React.useId();
  const add = () => { const value = text.trim().replace(/,$/, ''); if (value && !values.includes(value) && values.length < max) onChange([...values, value]); setText(''); };
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-xs font-semibold text-slate-700">{label}</label>
      <div className="flex flex-wrap gap-1.5" aria-live="polite">
        {values.map(value => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-900">
            {value}<button type="button" className="rounded-full p-0.5 hover:bg-indigo-100" aria-label={t('teacherApplication.removeTag', { value })} onClick={() => onChange(values.filter(entry => entry !== value))}><X className="h-3 w-3" aria-hidden /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input id={inputId} className={fieldClass} value={text} maxLength={80} aria-describedby={hint ? `${inputId}-hint` : undefined} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} />
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!text.trim() || values.length >= max}>{t('teacherApplication.add')}</Button>
      </div>
      {hint && <p id={`${inputId}-hint`} className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
};

export const TeacherApplicationPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [application, setApplication] = useState<CandidateApplication | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState<Set<Section>>(new Set());
  const [step, setStep] = useState<Step>('identity');
  const [loading, setLoading] = useState(usesApi);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [certify, setCertify] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const missingLabel = useMissingLabel(application);

  const adopt = useCallback((next: CandidateApplication, resetDraft = true) => {
    setApplication(next);
    if (resetDraft) { setDraft(draftOf(next)); setDirty(new Set()); }
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(''); setConflict(false);
    try {
      const result = await teacherApplicationService.mine();
      setEligibility(result.eligibility);
      if (result.data) adopt(result.data); else setApplication(null);
      // Approval changes the account server-side: the session view of the role is refreshed.
      if (result.data?.status === 'approved' && user?.role !== 'teacher') await refreshUser().catch(() => undefined);
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setLoading(false); }
  }, [adopt, t, user?.role, refreshUser]);
  useEffect(() => { if (usesApi) void load(); }, []);

  const save = useCallback(async (sections: Section[] = [...dirty]) => {
    const current = draftRef.current;
    if (!application || !current || !application.editable) return application;
    const toSend = sections.filter(section => dirty.has(section));
    if (!toSend.length) return application;
    const snapshot = JSON.stringify(current);
    const patch: SectionsPatch = {};
    if (toSend.includes('personal')) patch.personal = { ...current.personal, birthDate: current.personal.birthDate || null };
    if (toSend.includes('identity')) {
      const { documentNumber, ...identity } = current.identity;
      patch.identity = { ...identity, issuedAt: identity.issuedAt || null, expiresAt: identity.expiresAt || null, ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}) };
    }
    if (toSend.includes('academic')) patch.academic = current.academic;
    if (toSend.includes('professional')) patch.professional = { ...current.professional, experiences: current.professional.experiences.map(entry => ({ ...entry, startDate: entry.startDate || null, endDate: entry.current ? null : entry.endDate || null })) };
    setSaving(true); setError('');
    try {
      const next = await teacherApplicationService.save(application.revision, patch);
      // Fields typed while the request was in flight are kept; otherwise the saved values (with new ids) are adopted.
      const unchanged = JSON.stringify(draftRef.current) === snapshot;
      adopt(next, unchanged);
      if (!unchanged) setDirty(previous => new Set([...previous].filter(section => !toSend.includes(section))));
      setSavedAt(new Date());
      return next;
    } catch (cause) {
      if ((cause as { code?: string }).code === 'APPLICATION_REVISION_CONFLICT') setConflict(true);
      setError(apiErrorMessage(t, cause));
      return null;
    } finally { setSaving(false); }
  }, [application, dirty, adopt, t]);

  // Automatic draft save a few seconds after the last change.
  useEffect(() => {
    if (!dirty.size || conflict) return;
    const handle = window.setTimeout(() => void save(), 2500);
    return () => window.clearTimeout(handle);
  }, [draft, dirty, conflict, save]);

  if (!usesApi) return <div className="mx-auto max-w-4xl space-y-4"><h1 className="text-xl font-bold text-slate-900">{t('teacherApplication.pageTitle')}</h1><ApiModeNotice /></div>;
  if (loading) return <p role="status" className="p-6 text-sm text-slate-600">{t('teacherApplication.loading')}</p>;

  const update = <S extends Section>(section: S, value: Draft[S]) => { setDraft(previous => previous ? { ...previous, [section]: value } : previous); setDirty(previous => new Set(previous).add(section)); };
  const start = async () => {
    setError('');
    try { adopt(await teacherApplicationService.start()); setEligibility(previous => previous ? { ...previous, canStart: false } : previous); setStep('identity'); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const goTo = async (next: Step) => { if (dirty.size) { const saved = await save(); if (!saved) return; } setStep(next); window.scrollTo({ top: 0 }); };

  // ----------------------------------------------------------------------------------------------------- no file yet
  if (!application || !draft) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{t('teacherApplication.pageTitle')}</h1>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {eligibility?.institutional ? <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">{t('teacherApplication.institutionalAccount')}</p>
          : user?.role === 'teacher' ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">{t('teacherApplication.alreadyTeacher')} <Link className="font-semibold underline" to="/teacher/dashboard">{t('teacherApplication.openDashboard')}</Link></p>
            : eligibility?.canStart ? (
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm text-slate-700">{t('teacherApplication.startIntro')}</p>
                <ul className="list-disc space-y-1 ps-5 text-xs text-slate-600">{(['identity', 'cv', 'diploma'] as const).map(type => <li key={type}>{t(`teacherApplication.documentTypes.${type}`)}</li>)}</ul>
                <Button onClick={() => void start()}>{t('teacherApplication.start')}</Button>
              </section>
            ) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">{t('teacherApplication.notEligible')}</p>}
      </div>
    );
  }

  // ----------------------------------------------------------------------------------------------------- documents
  const active = application.documents.filter(document => !document.replacedBy);
  const upload = async (key: string, file: File | undefined, fields: { type: DocumentType; degreeId?: string; replaces?: string }) => {
    if (!file) return;
    setError(''); setStatus('');
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name) || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { setError(t('apiErrors.UNSUPPORTED_DOCUMENT_TYPE')); return; }
    if (file.size > CLIENT_MAX_BYTES) { setError(t('apiErrors.DOCUMENT_TOO_LARGE')); return; }
    if (dirty.size) { const saved = await save(); if (!saved) return; }
    setUploads(previous => ({ ...previous, [key]: 0 }));
    try {
      const next = await teacherApplicationService.upload(file, fields, percent => setUploads(previous => ({ ...previous, [key]: percent })));
      adopt(next, false); setStatus(t('teacherApplication.uploaded', { name: file.name }));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setUploads(previous => { const next = { ...previous }; delete next[key]; return next; }); }
  };
  const remove = async (document: ApplicationDocument) => {
    try { adopt(await teacherApplicationService.removeDocument(document.id), false); setStatus(t('teacherApplication.removed')); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const view = (document: ApplicationDocument) => { if (document.url) openPrivateDocument(document.url).catch(cause => setError(apiErrorMessage(t, cause))); };

  const DocumentRow: React.FC<{ rowKey: string; label: string; type: DocumentType; degreeId?: string; document?: ApplicationDocument; required?: boolean }> = ({ rowKey, label, type, degreeId, document, required }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const progress = uploads[rowKey];
    const replaceable = !!document && application.editable && (application.status === 'draft' || ['rejected', 'replacement_requested'].includes(document.status));
    return (
      <li className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{label}{required && <span className="text-rose-700"> *</span>}</p>
            {document ? <p className="truncate text-xs text-slate-600">{document.originalName} · {formatSize(document.size, i18n.language)} · {formatDate(document.uploadedAt, i18n.language)}</p> : <p className="text-xs text-slate-500">{t('teacherApplication.noDocument')}</p>}
          </div>
          {document ? <DocumentStatusBadge status={document.status} /> : required && <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">{t('teacherApplication.missingDocument')}</span>}
        </div>
        {document?.adminComment && ['rejected', 'replacement_requested'].includes(document.status) && <p className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{document.adminComment}</p>}
        {progress !== undefined && <div role="progressbar" aria-label={t('teacherApplication.uploading', { name: label })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>}
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={event => { void upload(rowKey, event.target.files?.[0], { type, degreeId, ...(document ? { replaces: document.id } : {}) }); event.target.value = ''; }} data-testid={`file-${rowKey}`} />
          {application.editable && (!document || replaceable) && <Button type="button" size="sm" variant={document ? 'outline' : 'primary'} leftIcon={document ? <RefreshCw className="h-3.5 w-3.5" /> : <FileUp className="h-3.5 w-3.5" />} disabled={progress !== undefined} onClick={() => inputRef.current?.click()} aria-label={`${document ? t('teacherApplication.replace') : t('teacherApplication.upload')} — ${label}`}>{document ? t('teacherApplication.replace') : t('teacherApplication.upload')}</Button>}
          {document?.url && <Button type="button" size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => view(document)} aria-label={`${t('teacherApplication.preview')} — ${label}`}>{t('teacherApplication.preview')}</Button>}
          {document && application.status === 'draft' && !document.reviewedAt && <Button type="button" size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void remove(document)} aria-label={`${t('teacherApplication.remove')} — ${label}`}>{t('teacherApplication.remove')}</Button>}
        </div>
        {document && document.reviews.length > 0 && <p className="text-[11px] text-slate-500">{t('teacherApplication.reviewHistory')}: {document.reviews.map(review => `${t(`teacherApplication.documentStatuses.${review.status}`)} (${formatDate(review.at, i18n.language)})`).join(' · ')}</p>}
      </li>
    );
  };

  const savedDegrees = application.academic.degrees.filter(degree => degree.id);
  const documentsPanel = (
    <section aria-labelledby="documents-title" className="space-y-4">
      <h2 id="documents-title" className="text-base font-bold text-slate-900">{t('teacherApplication.steps.documents')}</h2>
      <p className="text-xs text-slate-600">{t('teacherApplication.documentsIntro')}</p>
      <h3 className="text-sm font-semibold text-slate-800">{t('teacherApplication.mandatoryDocuments')}</h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        <DocumentRow rowKey="identity" label={t('teacherApplication.documentTypes.identity')} type="identity" required document={active.find(document => document.type === 'identity')} />
        <DocumentRow rowKey="cv" label={t('teacherApplication.documentTypes.cv')} type="cv" required document={active.find(document => document.type === 'cv')} />
        {savedDegrees.map(degree => <DocumentRow key={degree.id} rowKey={`diploma-${degree.id}`} label={t('teacherApplication.diplomaFor', { name: degree.title || t('teacherApplication.degreeUntitled') })} type="diploma" degreeId={degree.id} required document={active.find(document => document.type === 'diploma' && document.degreeId === degree.id)} />)}
        {!savedDegrees.length && <li className="p-3 text-xs text-amber-900">{t('teacherApplication.addDegreeFirst')} <button type="button" className="underline" onClick={() => void goTo('academic')}>{t('teacherApplication.steps.academic')}</button></li>}
      </ul>
      <h3 className="text-sm font-semibold text-slate-800">{t('teacherApplication.optionalDocuments')}</h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {active.filter(document => OPTIONAL_DOCUMENT_TYPES.includes(document.type)).map(document => <DocumentRow key={document.id} rowKey={document.id} label={t(`teacherApplication.documentTypes.${document.type}`)} type={document.type} document={document} />)}
        {application.editable && <OptionalUpload onPick={(type, file) => void upload(`new-${type}`, file, { type })} progress={Object.entries(uploads).find(([key]) => key.startsWith('new-'))?.[1]} />}
      </ul>
    </section>
  );

  // ----------------------------------------------------------------------------------------------------- read-only summary
  const summary = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h3 className="text-sm font-bold text-slate-900">{t('teacherApplication.steps.identity')}</h3>
        <p>{application.personal.firstName} {application.personal.lastName} · {application.personal.city} ({application.personal.country})</p>
        <p className="text-slate-600">{application.personal.phone} · {t(`teacherApplication.languages.${application.personal.preferredLanguage}`)}</p>
        <p className="text-slate-600">{application.identity.documentType && t(`teacherApplication.identityTypes.${application.identity.documentType}`)} {application.identity.documentNumberMasked}</p>
      </section>
      <section className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h3 className="text-sm font-bold text-slate-900">{t('teacherApplication.steps.academic')}</h3>
        <ul className="list-disc ps-5">{application.academic.degrees.map(degree => <li key={degree.id}>{degree.title} — {degree.institution} ({degree.year})</li>)}</ul>
      </section>
      <section className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm md:col-span-2">
        <h3 className="text-sm font-bold text-slate-900">{t('teacherApplication.steps.professional')}</h3>
        <p className="font-medium">{application.professional.headline}</p>
        <p className="text-slate-600">{application.professional.specialties.join(', ')} · {t('teacherApplication.yearsCount', { count: application.professional.yearsOfExperience || 0 })}</p>
      </section>
    </div>
  );

  // ----------------------------------------------------------------------------------------------------- page
  const unresolved = application.requests.filter(request => !request.resolvedAt);
  const reapplyOpen = application.status === 'rejected' && application.canReapplyAt && new Date(application.canReapplyAt).getTime() <= Date.now();
  const p = draft.personal, id = draft.identity, pro = draft.professional;
  const stepIndex = STEPS.indexOf(step);
  const missingFor = (target: Step) => application.missing.filter(code => target === 'identity' ? /^(personal|identity|terms)/.test(code) : target === 'academic' ? code.startsWith('academic') : target === 'professional' ? code.startsWith('professional') : target === 'documents' ? code.startsWith('documents') : false);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{t('teacherApplication.pageTitle')}</h1>
            <p className="text-xs text-slate-600">{application.reference ? t('teacherApplication.referenceLabel', { reference: application.reference }) : t('teacherApplication.noReferenceYet')}{application.submittedAt && ` · ${t('teacherApplication.submittedOn', { date: formatDate(application.submittedAt, i18n.language, true) })}`}</p>
          </div>
          <StatusBadge status={application.status} />
        </div>
        <ReviewProgress status={application.status} />
        <p role="status" className="text-sm text-slate-800">{t(`teacherApplication.statusMessages.${application.status}`)}</p>
        {application.status === 'approved' && <Link to="/teacher/dashboard" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden />{t('teacherApplication.openDashboard')}</Link>}
        {application.decisionReason && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-semibold">{t('teacherApplication.decisionReason')}</p><p className="whitespace-pre-wrap">{application.decisionReason}</p></div>}
        {application.status === 'rejected' && application.canReapplyAt && (reapplyOpen
          ? <Button size="sm" onClick={() => void start()}>{t('teacherApplication.reapply')}</Button>
          : <p className="text-xs text-slate-600">{t('teacherApplication.reapplyFrom', { date: formatDate(application.canReapplyAt, i18n.language) })}</p>)}
      </header>

      {unresolved.length > 0 && (
        <section aria-labelledby="requests-title" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 id="requests-title" className="text-sm font-bold text-amber-900">{t('teacherApplication.requestsTitle')}</h2>
          {unresolved.map(request => (
            <div key={request.id} className="text-sm text-amber-950">
              <p className="whitespace-pre-wrap">{request.message}</p>
              <p className="text-xs">{t('teacherApplication.requestItems')}: {request.items.map(item => item.startsWith('document:') ? t(`teacherApplication.documentTypes.${application.documents.find(document => document.id === item.slice(9))?.type || 'other'}`) : t(`teacherApplication.requestItemLabels.${item.split(':')[0]}`, { defaultValue: item })).join(', ')} · {formatDate(request.at, i18n.language)}</p>
            </div>
          ))}
        </section>
      )}
      {application.editable && !application.storageReady && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t('teacherApplication.storageNotReady')}</p>}
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}{conflict && <Button size="sm" variant="outline" onClick={() => void load()}>{t('teacherApplication.reload')}</Button>}</div>}
      <p role="status" aria-live="polite" className={status ? 'rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800' : 'sr-only'}>{status}</p>

      {application.editable ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr]">
          <nav aria-label={t('teacherApplication.stepsLabel')}>
            <ol className="flex gap-1 overflow-x-auto lg:flex-col">
              {STEPS.map((entry, index) => {
                const open = missingFor(entry).length;
                return (
                  <li key={entry} className="shrink-0">
                    <button type="button" aria-current={entry === step ? 'step' : undefined} onClick={() => void goTo(entry)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm ${entry === step ? 'bg-indigo-600 text-white' : 'bg-white text-slate-800 hover:bg-slate-50'}`}>
                      <span>{index + 2}. {t(`teacherApplication.steps.${entry}`)}</span>
                      {entry !== 'review' && (open ? <span className={`rounded-full px-1.5 text-[10px] font-bold ${entry === step ? 'bg-white/25' : 'bg-amber-100 text-amber-900'}`}>{t('teacherApplication.toComplete', { count: open })}</span> : <CheckCircle2 className="h-4 w-4" aria-label={t('teacherApplication.complete')} />)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs" onSubmit={event => { event.preventDefault(); void save(); }}>
            {step === 'identity' && (
              <>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.personalTitle')}</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t('teacherApplication.fields.firstName')} required><Input value={p.firstName} maxLength={60} onChange={event => update('personal', { ...p, firstName: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.lastName')} required><Input value={p.lastName} maxLength={60} onChange={event => update('personal', { ...p, lastName: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.birthDate')} required><Input type="date" value={p.birthDate || ''} onChange={event => update('personal', { ...p, birthDate: event.target.value || null })} /></FormField>
                    <FormField label={t('teacherApplication.fields.nationality')} required><CountrySelect className={fieldClass} value={p.nationality} onChange={code => update('personal', { ...p, nationality: code })} /></FormField>
                    <FormField label={t('teacherApplication.fields.country')} required><CountrySelect className={fieldClass} value={p.country} onChange={code => update('personal', { ...p, country: code })} /></FormField>
                    <FormField label={t('teacherApplication.fields.city')} required><Input value={p.city} maxLength={100} onChange={event => update('personal', { ...p, city: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.phone')} required hint={t('teacherApplication.phoneHint')}><Input type="tel" dir="ltr" value={p.phone} onChange={event => update('personal', { ...p, phone: event.target.value.replace(/[\s.-]/g, '') })} /></FormField>
                    <FormField label={t('teacherApplication.fields.preferredLanguage')}><select className={fieldClass} value={p.preferredLanguage} onChange={event => update('personal', { ...p, preferredLanguage: event.target.value as Personal['preferredLanguage'] })}>{(['fr', 'en', 'ar'] as const).map(language => <option key={language} value={language}>{t(`teacherApplication.languages.${language}`)}</option>)}</select></FormField>
                  </div>
                  <FormField label={t('teacherApplication.fields.address')} hint={t('teacherApplication.addressHint')}><Input value={p.address} maxLength={300} autoComplete="street-address" onChange={event => update('personal', { ...p, address: event.target.value })} /></FormField>
                </fieldset>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.identityTitle')}</legend>
                  <p className="text-xs text-slate-600">{t('teacherApplication.identityPrivacy')}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t('teacherApplication.fields.documentType')} required><select className={fieldClass} value={id.documentType} onChange={event => update('identity', { ...id, documentType: event.target.value })}><option value="">{t('teacherApplication.choose')}</option>{IDENTITY_TYPES.map(type => <option key={type} value={type}>{t(`teacherApplication.identityTypes.${type}`)}</option>)}</select></FormField>
                    <FormField label={t('teacherApplication.fields.documentNumber')} required hint={application.identity.documentNumberMasked ? t('teacherApplication.documentNumberSaved', { masked: application.identity.documentNumberMasked }) : t('teacherApplication.documentNumberHint')}><Input dir="ltr" autoComplete="off" value={id.documentNumber} maxLength={30} onChange={event => update('identity', { ...id, documentNumber: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.issuingCountry')} required><CountrySelect className={fieldClass} value={id.issuingCountry} onChange={code => update('identity', { ...id, issuingCountry: code })} /></FormField>
                    <FormField label={t('teacherApplication.fields.issuingAuthority')}><Input value={id.issuingAuthority} maxLength={160} onChange={event => update('identity', { ...id, issuingAuthority: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.issuedAt')} required><Input type="date" value={id.issuedAt || ''} onChange={event => update('identity', { ...id, issuedAt: event.target.value || null })} /></FormField>
                    <FormField label={t('teacherApplication.fields.expiresAt')} hint={t('teacherApplication.expiresHint')}><Input type="date" value={id.expiresAt || ''} onChange={event => update('identity', { ...id, expiresAt: event.target.value || null })} /></FormField>
                  </div>
                </fieldset>
              </>
            )}

            {step === 'academic' && (
              <>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.degreesTitle')}</legend>
                  <p className="text-xs text-slate-600">{t('teacherApplication.degreesIntro')}</p>
                  {draft.academic.degrees.map((degree, index) => {
                    const change = (patch: Partial<Degree>) => update('academic', { ...draft.academic, degrees: draft.academic.degrees.map((entry, position) => position === index ? { ...entry, ...patch } : entry) });
                    return (
                      <div key={degree.id || `new-${index}`} role="group" aria-label={t('teacherApplication.degreeNumber', { number: index + 1 })} className="space-y-3 rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{t('teacherApplication.degreeNumber', { number: index + 1 })}</h3><Button type="button" size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => update('academic', { ...draft.academic, degrees: draft.academic.degrees.filter((_, position) => position !== index) })}>{t('teacherApplication.remove')}</Button></div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <FormField label={t('teacherApplication.fields.level')} required><select className={fieldClass} value={degree.level} onChange={event => change({ level: event.target.value })}><option value="">{t('teacherApplication.choose')}</option>{DEGREE_LEVELS.map(level => <option key={level} value={level}>{t(`teacherApplication.degreeLevels.${level}`)}</option>)}</select></FormField>
                          <FormField label={t('teacherApplication.fields.degreeTitle')} required><Input value={degree.title} maxLength={200} onChange={event => change({ title: event.target.value })} /></FormField>
                          <FormField label={t('teacherApplication.fields.specialty')} required><Input value={degree.specialty} maxLength={160} onChange={event => change({ specialty: event.target.value })} /></FormField>
                          <FormField label={t('teacherApplication.fields.institution')} required><Input value={degree.institution} maxLength={200} onChange={event => change({ institution: event.target.value })} /></FormField>
                          <FormField label={t('teacherApplication.fields.institutionCountry')} required><CountrySelect className={fieldClass} value={degree.country} onChange={code => change({ country: code })} /></FormField>
                          <FormField label={t('teacherApplication.fields.year')} required><Input type="number" min={1950} max={new Date().getFullYear()} value={degree.year ?? ''} onChange={event => change({ year: event.target.value ? Number(event.target.value) : null })} /></FormField>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={degree.highest} onChange={event => update('academic', { ...draft.academic, degrees: draft.academic.degrees.map((entry, position) => ({ ...entry, highest: position === index ? event.target.checked : event.target.checked ? false : entry.highest })) })} /> {t('teacherApplication.fields.highest')}</label>
                      </div>
                    );
                  })}
                  {draft.academic.degrees.length < 10 && <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => update('academic', { ...draft.academic, degrees: [...draft.academic.degrees, { level: '', title: '', specialty: '', institution: '', country: '', year: null, highest: draft.academic.degrees.length === 0 }] })}>{t('teacherApplication.addDegree')}</Button>}
                </fieldset>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.certificationsTitle')}</legend>
                  {draft.academic.certifications.map((entry, index) => {
                    const change = (patch: Partial<Certification>) => update('academic', { ...draft.academic, certifications: draft.academic.certifications.map((item, position) => position === index ? { ...item, ...patch } : item) });
                    return (
                      <div key={entry.id || `new-${index}`} role="group" aria-label={t('teacherApplication.certificationNumber', { number: index + 1 })} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_7rem_9rem_auto]">
                        <FormField label={t('teacherApplication.fields.certificationName')}><Input value={entry.name} maxLength={200} onChange={event => change({ name: event.target.value })} /></FormField>
                        <FormField label={t('teacherApplication.fields.issuer')}><Input value={entry.issuer} maxLength={200} onChange={event => change({ issuer: event.target.value })} /></FormField>
                        <FormField label={t('teacherApplication.fields.year')}><Input type="number" min={1950} max={new Date().getFullYear()} value={entry.year ?? ''} onChange={event => change({ year: event.target.value ? Number(event.target.value) : null })} /></FormField>
                        <FormField label={t('teacherApplication.fields.kind')}><select className={fieldClass} value={entry.kind} onChange={event => change({ kind: event.target.value as Certification['kind'] })}><option value="certification">{t('teacherApplication.kinds.certification')}</option><option value="training">{t('teacherApplication.kinds.training')}</option></select></FormField>
                        <Button type="button" size="sm" variant="ghost" aria-label={t('teacherApplication.removeNamed', { name: entry.name || t('teacherApplication.certificationNumber', { number: index + 1 }) })} onClick={() => update('academic', { ...draft.academic, certifications: draft.academic.certifications.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                      </div>
                    );
                  })}
                  <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => update('academic', { ...draft.academic, certifications: [...draft.academic.certifications, { name: '', issuer: '', year: null, kind: 'certification' }] })}>{t('teacherApplication.addCertification')}</Button>
                </fieldset>
              </>
            )}

            {step === 'professional' && (
              <>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.profileTitle')}</legend>
                  <FormField label={t('teacherApplication.fields.headline')} required hint={t('teacherApplication.headlineHint')}><Input value={pro.headline} maxLength={160} onChange={event => update('professional', { ...pro, headline: event.target.value })} /></FormField>
                  <FormField label={t('teacherApplication.fields.bio')} required hint={t('teacherApplication.bioHint', { count: pro.bio.trim().length })}><Textarea rows={5} maxLength={4000} value={pro.bio} onChange={event => update('professional', { ...pro, bio: event.target.value })} /></FormField>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TagInput label={`${t('teacherApplication.fields.specialties')} *`} values={pro.specialties} max={15} onChange={values => update('professional', { ...pro, specialties: values })} hint={t('teacherApplication.tagHint')} />
                    <TagInput label={`${t('teacherApplication.fields.subjects')} *`} values={pro.subjects} max={30} onChange={values => update('professional', { ...pro, subjects: values })} />
                    <TagInput label={t('teacherApplication.fields.expertise')} values={pro.expertise} onChange={values => update('professional', { ...pro, expertise: values })} />
                    <TagInput label={`${t('teacherApplication.fields.teachingLanguages')} *`} values={pro.teachingLanguages} max={10} onChange={values => update('professional', { ...pro, teachingLanguages: values })} />
                    <TagInput label={t('teacherApplication.fields.skills')} values={pro.skills} max={30} onChange={values => update('professional', { ...pro, skills: values })} />
                    <FormField label={t('teacherApplication.fields.yearsOfExperience')} required><Input type="number" min={0} max={70} value={pro.yearsOfExperience ?? ''} onChange={event => update('professional', { ...pro, yearsOfExperience: event.target.value === '' ? null : Number(event.target.value) })} /></FormField>
                    <FormField label={t('teacherApplication.fields.portfolioUrl')} hint={t('teacherApplication.optionalHttps')}><Input type="url" dir="ltr" placeholder="https://" value={pro.portfolioUrl} onChange={event => update('professional', { ...pro, portfolioUrl: event.target.value })} /></FormField>
                    <FormField label={t('teacherApplication.fields.linkedinUrl')} hint={t('teacherApplication.optionalHttps')}><Input type="url" dir="ltr" placeholder="https://www.linkedin.com/in/…" value={pro.linkedinUrl} onChange={event => update('professional', { ...pro, linkedinUrl: event.target.value })} /></FormField>
                  </div>
                </fieldset>
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-slate-900">{t('teacherApplication.experiencesTitle')}</legend>
                  {pro.experiences.map((entry, index) => {
                    const change = (patch: Partial<Experience>) => update('professional', { ...pro, experiences: pro.experiences.map((item, position) => position === index ? { ...item, ...patch } : item) });
                    return (
                      <div key={entry.id || `new-${index}`} role="group" aria-label={t('teacherApplication.experienceNumber', { number: index + 1 })} className="space-y-3 rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">{t('teacherApplication.experienceNumber', { number: index + 1 })}</h3><Button type="button" size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => update('professional', { ...pro, experiences: pro.experiences.filter((_, position) => position !== index) })}>{t('teacherApplication.remove')}</Button></div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <FormField label={t('teacherApplication.fields.experienceKind')}><select className={fieldClass} value={entry.kind} onChange={event => change({ kind: event.target.value as Experience['kind'] })}><option value="professional">{t('teacherApplication.experienceKinds.professional')}</option><option value="teaching">{t('teacherApplication.experienceKinds.teaching')}</option></select></FormField>
                          <FormField label={t('teacherApplication.fields.jobTitle')} required><Input value={entry.title} maxLength={160} onChange={event => change({ title: event.target.value })} /></FormField>
                          <FormField label={t('teacherApplication.fields.organization')}><Input value={entry.organization} maxLength={200} onChange={event => change({ organization: event.target.value })} /></FormField>
                          <FormField label={t('teacherApplication.fields.startDate')}><Input type="date" value={entry.startDate || ''} onChange={event => change({ startDate: event.target.value || null })} /></FormField>
                          {!entry.current && <FormField label={t('teacherApplication.fields.endDate')}><Input type="date" value={entry.endDate || ''} onChange={event => change({ endDate: event.target.value || null })} /></FormField>}
                          <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-700"><input type="checkbox" checked={entry.current} onChange={event => change({ current: event.target.checked, endDate: event.target.checked ? null : entry.endDate })} /> {t('teacherApplication.fields.current')}</label>
                        </div>
                        <FormField label={t('teacherApplication.fields.responsibilities')}><Textarea rows={2} maxLength={2000} value={entry.description} onChange={event => change({ description: event.target.value })} /></FormField>
                      </div>
                    );
                  })}
                  {pro.experiences.length < 20 && <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => update('professional', { ...pro, experiences: [...pro.experiences, { kind: 'professional', title: '', organization: '', startDate: null, endDate: null, current: false, description: '' }] })}>{t('teacherApplication.addExperience')}</Button>}
                </fieldset>
              </>
            )}

            {step === 'documents' && documentsPanel}

            {step === 'review' && (
              <section aria-labelledby="review-title" className="space-y-4">
                <h2 id="review-title" className="text-base font-bold text-slate-900">{t('teacherApplication.steps.review')}</h2>
                {application.missing.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900">{t('teacherApplication.missingTitle', { count: application.missing.length })}</p>
                    <ul className="list-disc space-y-0.5 ps-5 text-sm text-amber-950">{application.missing.map(code => <li key={code}>{missingLabel(code)}</li>)}</ul>
                  </div>
                ) : <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" aria-hidden />{t('teacherApplication.readyToSubmit')}</p>}
                {summary}
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
                  {active.map(document => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 p-2"><span>{t(`teacherApplication.documentTypes.${document.type}`)} — {document.originalName}</span><DocumentStatusBadge status={document.status} /></li>)}
                </ul>
                <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" className="mt-1" checked={certify} onChange={event => setCertify(event.target.checked)} /> {t('teacherApplication.certify')}</label>
                <Button type="button" isLoading={submitting} disabled={application.missing.length > 0 || !certify || !application.storageReady || dirty.size > 0}
                  onClick={async () => {
                    if (submitting) return;
                    setSubmitting(true); setError('');
                    try { adopt(await teacherApplicationService.submit(application.revision)); setStatus(t(application.status === 'draft' ? 'teacherApplication.submittedNotice' : 'teacherApplication.resubmittedNotice')); window.scrollTo({ top: 0 }); }
                    catch (cause) { setError(apiErrorMessage(t, cause)); if ((cause as { details?: { missing?: string[] } }).details?.missing) void load(); }
                    finally { setSubmitting(false); }
                  }}>{application.status === 'draft' ? t('teacherApplication.submit') : t('teacherApplication.resubmit')}</Button>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500" aria-live="polite">{saving ? t('teacherApplication.saving') : dirty.size ? t('teacherApplication.unsaved') : savedAt ? t('teacherApplication.savedAt', { time: savedAt.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) }) : ''}</p>
              <div className="flex flex-wrap gap-2">
                {stepIndex > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => void goTo(STEPS[stepIndex - 1])}>{t('teacherApplication.previous')}</Button>}
                {STEP_SECTIONS[step].length > 0 && <Button type="submit" size="sm" variant="outline" isLoading={saving} disabled={!dirty.size}>{t('teacherApplication.saveDraft')}</Button>}
                {stepIndex < STEPS.length - 1 && <Button type="button" size="sm" onClick={() => void goTo(STEPS[stepIndex + 1])}>{t('teacherApplication.next')}</Button>}
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {summary}
          <section aria-labelledby="documents-readonly" className="space-y-2">
            <h2 id="documents-readonly" className="text-base font-bold text-slate-900">{t('teacherApplication.steps.documents')}</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {active.map(document => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>{t(`teacherApplication.documentTypes.${document.type}`)} — {document.originalName}</span>
                  <span className="flex items-center gap-2"><DocumentStatusBadge status={document.status} />{document.url && <Button size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => view(document)}>{t('teacherApplication.preview')}</Button>}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <section aria-labelledby="history-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="history-title" className="text-sm font-bold text-slate-900">{t('teacherApplication.historyTitle')}</h2>
        <ol className="space-y-1.5 text-xs text-slate-700">
          {[...application.history].reverse().map((entry, index) => (
            <li key={index} className="flex flex-wrap gap-x-2"><time className="tabular-nums text-slate-500" dateTime={entry.at}>{formatDate(entry.at, i18n.language, true)}</time><span>{t(`teacherApplication.historyActions.${entry.action}`, { defaultValue: entry.action })}</span>{entry.message && entry.actorRole === 'admin' && <span className="text-slate-500">— {entry.message}</span>}</li>
          ))}
        </ol>
        <Link to="/notifications" className="text-xs text-indigo-700 underline">{t('teacherApplication.seeNotifications')}</Link>
      </section>
    </div>
  );
};

/** Complementary document: choose its kind, then the file. */
const OptionalUpload: React.FC<{ onPick: (type: DocumentType, file: File | undefined) => void; progress?: number }> = ({ onPick, progress }) => {
  const { t } = useTranslation();
  const [type, setType] = useState<DocumentType>('work_certificate');
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className="flex flex-wrap items-end gap-2 p-3">
      <FormField label={t('teacherApplication.optionalType')} className="sm:max-w-xs"><select className={fieldClass} value={type} onChange={event => setType(event.target.value as DocumentType)}>{OPTIONAL_DOCUMENT_TYPES.map(entry => <option key={entry} value={entry}>{t(`teacherApplication.documentTypes.${entry}`)}</option>)}</select></FormField>
      <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden data-testid="file-optional" onChange={event => { onPick(type, event.target.files?.[0]); event.target.value = ''; }} />
      <Button type="button" size="sm" variant="outline" leftIcon={<FileUp className="h-3.5 w-3.5" />} disabled={progress !== undefined} onClick={() => inputRef.current?.click()}>{t('teacherApplication.addOptional')}</Button>
      {progress !== undefined && <span role="progressbar" aria-label={t('teacherApplication.uploading', { name: t(`teacherApplication.documentTypes.${type}`) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="text-xs text-slate-600">{progress} %</span>}
    </li>
  );
};
