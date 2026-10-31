import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Eye, KeyRound, ShieldAlert, XCircle } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { LmsDialog } from '../../components/organisms/LmsShared';
import { usesApi } from '../../services/apiClient';
import { openPrivateDocument, teacherApplicationService, type AdminApplication, type AdminRow, type AdminStats, type ApplicationDocument } from '../../services/teacherApplicationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { DocumentStatusBadge, StatusBadge, fieldClass, formatDate, formatSize, useCountries, useMissingLabel } from '../teacher-application/applicationShared';

const STATUS_FILTERS = ['', 'to_review', 'under_review', 'additional_information_required', 'approved', 'rejected', 'suspended', 'draft'] as const;

/** Central administration only (route guarded `admin`; the API enforces the same rule). */
export const TeacherApplicationsAdminPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const countries = useCountries();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [facets, setFacets] = useState<{ specialties: string[]; countries: string[] }>({ specialties: [], countries: [] });
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ search: '', status: 'to_review', specialty: '', country: '', sort: 'submitted_desc', page: 1 });
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, figures] = await Promise.all([teacherApplicationService.list({ ...filters, pageSize }), teacherApplicationService.stats()]);
      setRows(list.data); setTotal(list.pagination.total); setFacets(list.facets); setStats(figures);
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setLoading(false); }
  }, [filters, t]);
  useEffect(() => { if (!usesApi) return; const handle = window.setTimeout(() => void load(), filters.search ? 300 : 0); return () => window.clearTimeout(handle); }, [load]);

  if (!usesApi) return <div className="space-y-4"><PageHeader title={t('teacherApplication.admin.title')} /><ApiModeNotice /></div>;
  const set = (patch: Partial<typeof filters>) => setFilters(previous => ({ ...previous, page: 1, ...patch }));
  const countryName = (code: string) => countries.find(country => country.code === code)?.name || code;
  const cards: { key: keyof AdminStats; filter?: string }[] = [{ key: 'total', filter: '' }, { key: 'new', filter: 'to_review' }, { key: 'underReview', filter: 'under_review' }, { key: 'incomplete' }, { key: 'informationRequired', filter: 'additional_information_required' }, { key: 'approved', filter: 'approved' }, { key: 'rejected', filter: 'rejected' }, { key: 'suspended', filter: 'suspended' }];

  return (
    <div className="space-y-5">
      <PageHeader title={t('teacherApplication.admin.title')} subtitle={t('teacherApplication.admin.subtitle')} />
      {stats && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t('teacherApplication.admin.indicators')}>
          {cards.map(card => (
            <li key={card.key}>
              <button type="button" disabled={card.filter === undefined} onClick={() => card.filter !== undefined && set({ status: card.filter })} aria-pressed={card.filter !== undefined && filters.status === card.filter} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-start shadow-xs enabled:hover:border-indigo-300 aria-pressed:border-indigo-500">
                <span className="block text-2xl font-bold tabular-nums text-slate-900">{stats[card.key]}</span>
                <span className="text-xs text-slate-600">{t(`teacherApplication.admin.stats.${card.key}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div role="search" className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t('teacherApplication.admin.search')}><input className={fieldClass} type="search" value={filters.search} placeholder={t('teacherApplication.admin.searchPlaceholder')} onChange={event => set({ search: event.target.value })} /></FormField>
        <FormField label={t('teacherApplication.admin.status')}><select className={fieldClass} value={filters.status} onChange={event => set({ status: event.target.value })}>{STATUS_FILTERS.map(status => <option key={status} value={status}>{status ? t(`teacherApplication.admin.filters.${status}`) : t('teacherApplication.admin.filters.all')}</option>)}</select></FormField>
        <FormField label={t('teacherApplication.admin.specialty')}><select className={fieldClass} value={filters.specialty} onChange={event => set({ specialty: event.target.value })}><option value="">{t('teacherApplication.admin.allSpecialties')}</option>{facets.specialties.map(value => <option key={value} value={value}>{value}</option>)}</select></FormField>
        <FormField label={t('teacherApplication.admin.country')}><select className={fieldClass} value={filters.country} onChange={event => set({ country: event.target.value })}><option value="">{t('teacherApplication.admin.allCountries')}</option>{facets.countries.map(code => <option key={code} value={code}>{countryName(code)}</option>)}</select></FormField>
        <FormField label={t('teacherApplication.admin.sort')}><select className={fieldClass} value={filters.sort} onChange={event => set({ sort: event.target.value })}>{['submitted_desc', 'submitted_asc', 'updated_desc'].map(sort => <option key={sort} value={sort}>{t(`teacherApplication.admin.sorts.${sort}`)}</option>)}</select></FormField>
      </div>
      <ErrorAlert message={error} onRetry={error ? () => void load() : undefined} />
      {loading ? <LoadingState /> : rows.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">{t('teacherApplication.admin.empty')}</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">{t('teacherApplication.admin.tableCaption', { count: total })}</caption>
            <thead className="bg-slate-50 text-start text-xs uppercase text-slate-600">
              <tr>{['candidate', 'country', 'specialties', 'submitted', 'status', 'documents', 'updated'].map(column => <th key={column} scope="col" className="px-3 py-2 text-start font-semibold">{t(`teacherApplication.admin.columns.${column}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2"><Link to={`/admin/teacher-applications/${row.id}`} className="font-semibold text-indigo-700 hover:underline">{row.name || t('teacherApplication.admin.unnamed')}</Link><span className="block text-xs text-slate-600">{row.email}{row.reference && ` · ${row.reference}`}</span></td>
                  <td className="px-3 py-2">{row.country ? countryName(row.country) : '—'}</td>
                  <td className="px-3 py-2 text-xs">{row.specialties.join(', ') || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(row.submittedAt, i18n.language)}</td>
                  <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                  <td className="px-3 py-2 text-xs">{t('teacherApplication.admin.documentSummary', row.documents)}</td>
                  <td className="px-3 py-2 tabular-nums text-xs">{formatDate(row.updatedAt, i18n.language, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && <SimplePager page={filters.page} pages={Math.ceil(total / pageSize)} onChange={page => setFilters(previous => ({ ...previous, page }))} />}
    </div>
  );
};

type Dialog = null | { kind: 'reject-document' | 'replace-document'; document: ApplicationDocument } | { kind: 'request' } | { kind: 'approve' } | { kind: 'reject' } | { kind: 'suspend' };

export const TeacherApplicationAdminDetailPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { applicationId = '' } = useParams();
  const countries = useCountries();
  const [application, setApplication] = useState<AdminApplication | null>(null);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('incomplete');
  const [items, setItems] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const missingLabel = useMissingLabel(application);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setApplication(await teacherApplicationService.detail(applicationId)); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setLoading(false); }
  }, [applicationId, t]);
  useEffect(() => { if (usesApi) void load(); }, [load]);

  if (!usesApi) return <ApiModeNotice />;
  if (loading) return <LoadingState />;
  if (!application) return <ErrorAlert message={error || t('apiErrors.APPLICATION_NOT_FOUND')} onRetry={() => void load()} />;

  const countryName = (code: string) => countries.find(country => country.code === code)?.name || code || '—';
  const run = async (action: () => Promise<AdminApplication>, message: string) => {
    setBusy(true); setError(''); setStatus('');
    try { setApplication(await action()); setStatus(message); setDialog(null); setText(''); setItems([]); }
    catch (cause) {
      setError(apiErrorMessage(t, cause));
      // Someone else acted meanwhile: show the current file rather than a stale one.
      if ((cause as { code?: string }).code === 'APPLICATION_REVISION_CONFLICT') void load();
    } finally { setBusy(false); }
  };
  const reviewing = application.status === 'under_review';
  const active = application.documents.filter(document => !document.replacedBy);
  const replaced = application.documents.filter(document => document.replacedBy);
  const open = (document: ApplicationDocument, download = false) => { if (document.url) openPrivateDocument(document.url, download).catch(cause => setError(apiErrorMessage(t, cause))); };
  const docLabel = (document: ApplicationDocument) => document.type === 'diploma' ? t('teacherApplication.diplomaFor', { name: application.academic.degrees.find(degree => degree.id === document.degreeId)?.title || t('teacherApplication.degreeUntitled') }) : t(`teacherApplication.documentTypes.${document.type}`);
  const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-bold text-slate-900">{title}</h2>{children}</section>;
  const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => <><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="text-sm text-slate-900">{value || '—'}</dd></>;

  return (
    <div className="space-y-4">
      <Link to="/admin/teacher-applications" className="text-xs text-indigo-700 underline">← {t('teacherApplication.admin.backToList')}</Link>
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{application.name || t('teacherApplication.admin.unnamed')}</h1>
          <p className="text-xs text-slate-600">{application.email} · {application.reference || t('teacherApplication.noReferenceYet')} · {t('teacherApplication.submittedOn', { date: formatDate(application.submittedAt, i18n.language, true) })}</p>
          {application.account && <p className="text-xs text-slate-500">{t('teacherApplication.admin.accountInfo', { role: t(`common.roles.${application.account.role}`, { defaultValue: application.account.role }), date: formatDate(application.account.createdAt, i18n.language) })}{application.account.emailVerified ? '' : ` · ${t('teacherApplication.admin.emailNotVerified')}`}</p>}
        </div>
        <StatusBadge status={application.status} />
      </header>

      <div role="toolbar" aria-label={t('teacherApplication.admin.actions')} className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
        {['submitted', 'resubmitted'].includes(application.status) && <Button size="sm" isLoading={busy} onClick={() => void run(() => teacherApplicationService.startReview(application.id, application.revision), t('teacherApplication.admin.reviewStarted'))}>{t('teacherApplication.admin.startReview')}</Button>}
        {reviewing && <Button size="sm" variant="outline" onClick={() => { setItems([]); setText(''); setDialog({ kind: 'request' }); }}>{t('teacherApplication.admin.requestInformation')}</Button>}
        {reviewing && <Button size="sm" variant="success" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={application.approvalBlockers.length > 0} title={application.approvalBlockers.length ? t('teacherApplication.admin.approvalBlocked') : undefined} onClick={() => setDialog({ kind: 'approve' })}>{t('teacherApplication.admin.approve')}</Button>}
        {reviewing && <Button size="sm" variant="danger" leftIcon={<XCircle className="h-3.5 w-3.5" />} onClick={() => { setText(''); setDialog({ kind: 'reject' }); }}>{t('teacherApplication.admin.reject')}</Button>}
        {application.status === 'approved' && <Button size="sm" variant="danger" leftIcon={<ShieldAlert className="h-3.5 w-3.5" />} onClick={() => { setText(''); setDialog({ kind: 'suspend' }); }}>{t('teacherApplication.admin.suspend')}</Button>}
        {!['submitted', 'resubmitted', 'under_review', 'approved'].includes(application.status) && <p className="text-xs text-slate-600">{t(`teacherApplication.admin.noActionHint.${application.status}`, { defaultValue: t('teacherApplication.admin.noAction') })}</p>}
      </div>
      {reviewing && application.approvalBlockers.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">{t('teacherApplication.admin.approvalBlocked')}</p><ul className="list-disc ps-5">{application.approvalBlockers.map(code => <li key={code}>{missingLabel(code)}</li>)}</ul></div>
      )}
      <p role="status" aria-live="polite" className={status ? 'rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800' : 'sr-only'}>{status}</p>
      <ErrorAlert message={error} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title={`1. ${t('teacherApplication.admin.sections.identity')}`}>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
            <Row label={t('teacherApplication.fields.documentType')} value={application.identity.documentType && t(`teacherApplication.identityTypes.${application.identity.documentType}`)} />
            <Row label={t('teacherApplication.fields.documentNumber')} value={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="font-mono">{identityNumber || application.identity.documentNumberMasked}</span>{!identityNumber && application.identity.documentNumberMasked && <Button size="sm" variant="ghost" leftIcon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => teacherApplicationService.revealIdentity(application.id).then(setIdentityNumber).catch(cause => setError(apiErrorMessage(t, cause)))}>{t('teacherApplication.admin.reveal')}</Button>}</span>} />
            <Row label={t('teacherApplication.fields.issuingCountry')} value={countryName(application.identity.issuingCountry)} />
            <Row label={t('teacherApplication.fields.issuingAuthority')} value={application.identity.issuingAuthority} />
            <Row label={t('teacherApplication.fields.issuedAt')} value={formatDate(application.identity.issuedAt, i18n.language)} />
            <Row label={t('teacherApplication.fields.expiresAt')} value={formatDate(application.identity.expiresAt, i18n.language)} />
          </dl>
          <p className="text-[11px] text-slate-500">{t('teacherApplication.admin.revealAudited')}</p>
        </Section>
        <Section title={`2. ${t('teacherApplication.admin.sections.personal')}`}>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
            <Row label={t('teacherApplication.fields.birthDate')} value={formatDate(application.personal.birthDate, i18n.language)} />
            <Row label={t('teacherApplication.fields.nationality')} value={countryName(application.personal.nationality)} />
            <Row label={t('teacherApplication.fields.country')} value={`${countryName(application.personal.country)} — ${application.personal.city}`} />
            <Row label={t('teacherApplication.fields.address')} value={application.personal.address} />
            <Row label={t('teacherApplication.fields.phone')} value={<span dir="ltr">{application.personal.phone}</span>} />
            <Row label={t('teacherApplication.fields.preferredLanguage')} value={t(`teacherApplication.languages.${application.personal.preferredLanguage}`)} />
          </dl>
        </Section>
        <Section title={`3. ${t('teacherApplication.admin.sections.academic')}`}>
          <ul className="space-y-1 text-sm">{application.academic.degrees.map(degree => <li key={degree.id}><span className="font-semibold">{degree.title}</span> — {t(`teacherApplication.degreeLevels.${degree.level}`, { defaultValue: degree.level })}, {degree.specialty} · {degree.institution} ({countryName(degree.country)}, {degree.year}){degree.highest && ` · ${t('teacherApplication.fields.highest')}`}</li>)}</ul>
          {application.academic.certifications.length > 0 && <ul className="list-disc ps-5 text-xs text-slate-700">{application.academic.certifications.map(entry => <li key={entry.id}>{entry.name} — {entry.issuer} {entry.year} ({t(`teacherApplication.kinds.${entry.kind}`)})</li>)}</ul>}
        </Section>
        <Section title={`4–5. ${t('teacherApplication.admin.sections.experience')}`}>
          <ul className="space-y-2 text-sm">{application.professional.experiences.map(entry => <li key={entry.id}><span className="font-semibold">{entry.title}</span> · {entry.organization} <span className="text-xs text-slate-600">({t(`teacherApplication.experienceKinds.${entry.kind}`)}, {formatDate(entry.startDate, i18n.language)} – {entry.current ? t('teacherApplication.fields.current') : formatDate(entry.endDate, i18n.language)})</span>{entry.description && <p className="text-xs text-slate-700">{entry.description}</p>}</li>)}</ul>
        </Section>
        <Section title={`6–7. ${t('teacherApplication.admin.sections.profile')}`}>
          <p className="text-sm font-semibold">{application.professional.headline}</p>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{application.professional.bio}</p>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
            <Row label={t('teacherApplication.fields.specialties')} value={application.professional.specialties.join(', ')} />
            <Row label={t('teacherApplication.fields.subjects')} value={application.professional.subjects.join(', ')} />
            <Row label={t('teacherApplication.fields.expertise')} value={application.professional.expertise.join(', ')} />
            <Row label={t('teacherApplication.fields.teachingLanguages')} value={application.professional.teachingLanguages.join(', ')} />
            <Row label={t('teacherApplication.fields.yearsOfExperience')} value={application.professional.yearsOfExperience} />
            <Row label={t('teacherApplication.fields.skills')} value={application.professional.skills.join(', ')} />
            <Row label={t('teacherApplication.fields.portfolioUrl')} value={application.professional.portfolioUrl && <a className="text-indigo-700 underline" href={application.professional.portfolioUrl} target="_blank" rel="noopener noreferrer nofollow">{application.professional.portfolioUrl}</a>} />
            <Row label={t('teacherApplication.fields.linkedinUrl')} value={application.professional.linkedinUrl && <a className="text-indigo-700 underline" href={application.professional.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow">{application.professional.linkedinUrl}</a>} />
          </dl>
        </Section>
      </div>

      <Section title={`8. ${t('teacherApplication.admin.sections.documents')}`}>
        <ul className="divide-y divide-slate-100">
          {active.map(document => (
            <li key={document.id} className="space-y-1.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-sm font-semibold text-slate-900">{docLabel(document)}</p><p className="text-xs text-slate-600">{document.originalName} · {document.mimeType} · {formatSize(document.size, i18n.language)} · {formatDate(document.uploadedAt, i18n.language, true)}</p><p className="font-mono text-[10px] text-slate-500" title={t('teacherApplication.admin.fingerprint')}>SHA-256 {document.sha256?.slice(0, 16)}…</p></div>
                <DocumentStatusBadge status={document.status} />
              </div>
              {document.adminComment && <p className="text-xs text-slate-700">{t('teacherApplication.admin.commentToCandidate')}: {document.adminComment}</p>}
              <div className="flex flex-wrap gap-2">
                {document.url && <Button size="sm" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => open(document)} aria-label={`${t('teacherApplication.preview')} — ${docLabel(document)}`}>{t('teacherApplication.preview')}</Button>}
                {document.url && <Button size="sm" variant="ghost" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => open(document, true)} aria-label={`${t('teacherApplication.admin.download')} — ${docLabel(document)}`}>{t('teacherApplication.admin.download')}</Button>}
                {reviewing && document.status !== 'verified' && <Button size="sm" variant="success" isLoading={busy} onClick={() => void run(() => teacherApplicationService.reviewDocument(application.id, document.id, application.revision, 'verified'), t('teacherApplication.admin.documentVerified'))} aria-label={`${t('teacherApplication.admin.verify')} — ${docLabel(document)}`}>{t('teacherApplication.admin.verify')}</Button>}
                {reviewing && <Button size="sm" variant="outline" onClick={() => { setText(''); setDialog({ kind: 'replace-document', document }); }} aria-label={`${t('teacherApplication.admin.askReplacement')} — ${docLabel(document)}`}>{t('teacherApplication.admin.askReplacement')}</Button>}
                {reviewing && document.status !== 'rejected' && <Button size="sm" variant="danger" onClick={() => { setText(''); setDialog({ kind: 'reject-document', document }); }} aria-label={`${t('teacherApplication.admin.refuse')} — ${docLabel(document)}`}>{t('teacherApplication.admin.refuse')}</Button>}
              </div>
            </li>
          ))}
        </ul>
        {replaced.length > 0 && <details className="text-xs text-slate-700"><summary className="cursor-pointer font-semibold">{t('teacherApplication.admin.previousVersions', { count: replaced.length })}</summary><ul className="mt-1 space-y-1">{replaced.map(document => <li key={document.id}>{docLabel(document)} — {document.originalName} · {document.reviews.map(review => `${t(`teacherApplication.documentStatuses.${review.status}`)} ${formatDate(review.at, i18n.language)}${review.comment ? ` (${review.comment})` : ''}`).join(' · ')} {document.url && <button type="button" className="text-indigo-700 underline" onClick={() => open(document)}>{t('teacherApplication.preview')}</button>}</li>)}</ul></details>}
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title={`9. ${t('teacherApplication.admin.sections.history')}`}>
          <ol className="space-y-1 text-xs text-slate-700">{[...application.history].reverse().map((entry, index) => <li key={index}><time className="tabular-nums text-slate-500" dateTime={entry.at}>{formatDate(entry.at, i18n.language, true)}</time> · {t(`teacherApplication.historyActions.${entry.action}`, { defaultValue: entry.action })} <span className="text-slate-500">({t(`teacherApplication.actorRoles.${entry.actorRole}`)})</span>{entry.message && <span> — {entry.message}</span>}</li>)}</ol>
          {application.requests.length > 0 && <div className="border-t border-slate-100 pt-2 text-xs"><p className="font-semibold">{t('teacherApplication.requestsTitle')}</p>{application.requests.map(request => <p key={request.id}>{formatDate(request.at, i18n.language)} — {request.message} {request.resolvedAt ? `(${t('teacherApplication.admin.resolved')})` : `(${t('teacherApplication.admin.pending')})`}</p>)}</div>}
        </Section>
        <Section title={`10. ${t('teacherApplication.admin.sections.notes')}`}>
          <p className="text-[11px] text-slate-500">{t('teacherApplication.admin.notesPrivate')}</p>
          <ul className="space-y-1 text-sm">{application.internalNotes.map(entry => <li key={entry.id} className="rounded bg-slate-50 p-2"><span className="text-xs text-slate-500">{entry.by} · {formatDate(entry.at, i18n.language, true)}</span><p className="whitespace-pre-wrap">{entry.text}</p></li>)}</ul>
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (note.trim()) void run(() => teacherApplicationService.addNote(application.id, note.trim()), t('teacherApplication.admin.noteAdded')).then(() => setNote('')); }}>
            <FormField label={t('teacherApplication.admin.newNote')}><Textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></FormField>
            <Button type="submit" size="sm" variant="outline" disabled={!note.trim()}>{t('teacherApplication.admin.addNote')}</Button>
          </form>
        </Section>
      </div>

      {/* Decisions with a reason (shown to the candidate) */}
      {dialog && dialog.kind !== 'approve' && (
        <LmsDialog title={t(`teacherApplication.admin.dialogs.${dialog.kind}`)} onClose={() => setDialog(null)} wide>
          <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (dialog.kind === 'reject-document' || dialog.kind === 'replace-document') void run(() => teacherApplicationService.reviewDocument(application.id, dialog.document.id, application.revision, dialog.kind === 'reject-document' ? 'rejected' : 'replacement_requested', text.trim()), t('teacherApplication.admin.documentUpdated'));
            else if (dialog.kind === 'request') void run(() => teacherApplicationService.requestInformation(application.id, application.revision, text.trim(), items), t('teacherApplication.admin.requestSent'));
            else if (dialog.kind === 'reject') void run(() => teacherApplicationService.reject(application.id, application.revision, text.trim(), category), t('teacherApplication.admin.rejected'));
            else void run(() => teacherApplicationService.suspend(application.id, application.revision, text.trim()), t('teacherApplication.admin.suspended'));
          }}>
            {'document' in dialog && <p className="text-sm text-slate-700">{docLabel(dialog.document)} — {dialog.document.originalName}</p>}
            {dialog.kind === 'request' && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-semibold text-slate-700">{t('teacherApplication.admin.itemsToFix')}</legend>
                {[...['personal', 'identity', 'academic', 'professional'].map(value => ({ value, label: t(`teacherApplication.requestItemLabels.${value}`) })), ...active.map(document => ({ value: `document:${document.id}`, label: `${docLabel(document)} — ${document.originalName}` }))].map(option => (
                  <label key={option.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={items.includes(option.value)} onChange={event => setItems(previous => event.target.checked ? [...previous, option.value] : previous.filter(item => item !== option.value))} /> {option.label}</label>
                ))}
              </fieldset>
            )}
            {dialog.kind === 'reject' && <FormField label={t('teacherApplication.admin.category')}><select className={fieldClass} value={category} onChange={event => setCategory(event.target.value)}>{['incomplete', 'unverifiable', 'insufficient_qualification', 'policy', 'other'].map(value => <option key={value} value={value}>{t(`teacherApplication.admin.categories.${value}`)}</option>)}</select></FormField>}
            <FormField label={t(dialog.kind === 'request' ? 'teacherApplication.admin.messageToCandidate' : 'teacherApplication.admin.reasonToCandidate')} required hint={t('teacherApplication.admin.visibleToCandidate')}>
              <Textarea rows={4} maxLength={2000} value={text} onChange={event => setText(event.target.value)} />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDialog(null)}>{t('teacherApplication.admin.cancel')}</Button>
              <Button type="submit" size="sm" variant={['reject', 'suspend', 'reject-document'].includes(dialog.kind) ? 'danger' : 'primary'} isLoading={busy} disabled={text.trim().length < (dialog.kind.endsWith('document') ? 5 : 10) || (dialog.kind === 'request' && !items.length)}>{t(`teacherApplication.admin.confirm.${dialog.kind}`)}</Button>
            </div>
          </form>
        </LmsDialog>
      )}
      <ConfirmationDialog
        isOpen={dialog?.kind === 'approve'} isLoading={busy} title={t('teacherApplication.admin.approveTitle')} description={t('teacherApplication.admin.approveText', { name: application.name })}
        confirmLabel={t('teacherApplication.admin.approve')} onCancel={() => setDialog(null)}
        onConfirm={() => void run(() => teacherApplicationService.approve(application.id, application.revision), t('teacherApplication.admin.approved'))}
      />
    </div>
  );
};
