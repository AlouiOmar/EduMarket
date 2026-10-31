import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import type { ApplicationStatus } from './model.js';

/** Allowed status changes and who makes them. Anything else is refused with INVALID_APPLICATION_TRANSITION. */
export const TRANSITIONS: Record<string, { from: ApplicationStatus[]; to: ApplicationStatus; by: 'candidate' | 'admin' }> = {
  submit: { from: ['draft'], to: 'submitted', by: 'candidate' },
  resubmit: { from: ['additional_information_required'], to: 'resubmitted', by: 'candidate' },
  start_review: { from: ['submitted', 'resubmitted'], to: 'under_review', by: 'admin' },
  request_information: { from: ['under_review'], to: 'additional_information_required', by: 'admin' },
  approve: { from: ['under_review'], to: 'approved', by: 'admin' },
  reject: { from: ['under_review'], to: 'rejected', by: 'admin' },
  suspend: { from: ['approved'], to: 'suspended', by: 'admin' },
};
/** States in which the candidate may edit the file and upload documents. */
export const CANDIDATE_EDITABLE: ApplicationStatus[] = ['draft', 'additional_information_required'];
export const MANDATORY_DOCUMENTS = ['identity', 'cv', 'diploma'] as const;

// ------------------------------------------------------------------------------------------------ identity number at rest
const dataKey = () => createHash('sha256').update(env.TEACHER_DATA_KEY ? `edumarket-teacher-data:${env.TEACHER_DATA_KEY}` : `edumarket-teacher-data-derived:${env.JWT_SECRET}`).digest();
export function encryptSensitive(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function decryptSensitive(value: string) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------------------------------------------ completeness
const filled = (value: unknown) => typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
export const activeDocuments = (application: any) => (application.documents || []).filter((document: any) => !document.replacedBy && !document.purgedAt);
const usable = (document: any) => !['rejected', 'replacement_requested'].includes(document.status);

/**
 * What is still missing before the file can be submitted (empty = complete). Codes are stable and translated by the client:
 * `personal.firstName`, `documents.identity`, `documents.diploma:<degreeId>`…
 */
export function missingItems(application: any, now = new Date()) {
  const missing: string[] = [];
  const p = application.personal || {}, id = application.identity || {}, pro = application.professional || {};
  for (const field of ['firstName', 'lastName', 'phone', 'country', 'city', 'nationality'] as const) if (!filled(p[field])) missing.push(`personal.${field}`);
  if (!p.birthDate) missing.push('personal.birthDate');
  else if (new Date(p.birthDate).getTime() > now.getTime() - 18 * 365.25 * 86_400_000) missing.push('personal.adult');
  if (!filled(id.documentType)) missing.push('identity.documentType');
  if (!filled(id.documentNumberLast4)) missing.push('identity.documentNumber');
  if (!filled(id.issuingCountry)) missing.push('identity.issuingCountry');
  if (!id.issuedAt) missing.push('identity.issuedAt');
  if (id.expiresAt && new Date(id.expiresAt) <= now) missing.push('identity.expired');
  const degrees = application.academic?.degrees || [];
  if (!degrees.length) missing.push('academic.degrees');
  degrees.forEach((degree: any) => { if (!['level', 'title', 'specialty', 'institution', 'country', 'year'].every(field => filled(degree[field]))) missing.push(`academic.degree:${degree._id}`); });
  for (const field of ['headline', 'bio'] as const) if (!filled(pro[field])) missing.push(`professional.${field}`);
  if (filled(pro.bio) && pro.bio.trim().length < 100) missing.push('professional.bioLength');
  for (const field of ['specialties', 'subjects', 'teachingLanguages'] as const) if (!(pro[field] || []).length) missing.push(`professional.${field}`);
  if (pro.yearsOfExperience === null || pro.yearsOfExperience === undefined) missing.push('professional.yearsOfExperience');
  if (!(pro.experiences || []).length) missing.push('professional.experiences');
  const documents = activeDocuments(application);
  for (const type of ['identity', 'cv'] as const) if (!documents.some((document: any) => document.type === type && usable(document))) missing.push(`documents.${type}`);
  for (const degree of degrees) if (!documents.some((document: any) => document.type === 'diploma' && String(document.degreeId) === String(degree._id) && usable(document))) missing.push(`documents.diploma:${degree._id}`);
  if (!application.termsAcceptedAt) missing.push('terms');
  return missing;
}

/** Mandatory documents that block an approval (missing, refused, awaiting a replacement or not yet verified). */
export function approvalBlockers(application: any) {
  const blockers = missingItems(application).filter(code => !code.startsWith('documents.'));
  const documents = activeDocuments(application);
  const verified = (match: (document: any) => boolean) => documents.some((document: any) => match(document) && document.status === 'verified');
  if (!verified(document => document.type === 'identity')) blockers.push('documents.identity');
  if (!verified(document => document.type === 'cv')) blockers.push('documents.cv');
  for (const degree of application.academic?.degrees || []) if (!verified(document => document.type === 'diploma' && String(document.degreeId) === String(degree._id))) blockers.push(`documents.diploma:${degree._id}`);
  return blockers;
}

// ------------------------------------------------------------------------------------------------ files
const PDF_DANGER = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/XFA\b/];
/** Real content type from the bytes (the declared type and extension must agree); active PDF content is refused. */
export function inspectDocument(bytes: Buffer, declaredMime: string, originalName: string) {
  let detected: { mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'; extension: 'pdf' | 'png' | 'jpg' } | null = null;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') detected = { mimeType: 'application/pdf', extension: 'pdf' };
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detected = { mimeType: 'image/png', extension: 'png' };
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) detected = { mimeType: 'image/jpeg', extension: 'jpg' };
  if (!detected) return { error: 'INVALID_DOCUMENT_CONTENT' as const };
  const extension = originalName.toLowerCase().split('.').pop() || '';
  const allowedExtensions = detected.extension === 'jpg' ? ['jpg', 'jpeg'] : [detected.extension];
  if (declaredMime !== detected.mimeType || !allowedExtensions.includes(extension)) return { error: 'DOCUMENT_TYPE_MISMATCH' as const };
  if (detected.mimeType === 'application/pdf') {
    const content = bytes.toString('latin1');
    if (PDF_DANGER.some(pattern => pattern.test(content))) return { error: 'DOCUMENT_ACTIVE_CONTENT' as const };
    if (!content.trimEnd().endsWith('%%EOF') && !content.slice(-2048).includes('%%EOF')) return { error: 'INVALID_DOCUMENT_CONTENT' as const };
  }
  return { ...detected, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export const safeOriginalName = (name: string, extension: string) => (name.split(/[\\/]/).pop() || '').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `document.${extension}`;

// ------------------------------------------------------------------------------------------------ views
const documentView = (document: any, base: string) => ({
  id: String(document._id), type: document.type, degreeId: document.degreeId ? String(document.degreeId) : null, originalName: document.originalName,
  mimeType: document.mimeType, size: document.size, uploadedAt: document.uploadedAt, status: document.status, adminComment: document.adminComment || '',
  reviewedAt: document.reviewedAt, replacedBy: document.replacedBy ? String(document.replacedBy) : null, purged: !!document.purgedAt,
  url: document.purgedAt ? null : `${base}/documents/${document._id}`,
  reviews: (document.reviews || []).map((review: any) => ({ status: review.status, comment: review.comment || '', at: review.at })),
});
const sections = (application: any) => ({
  personal: { ...application.personal },
  identity: {
    documentType: application.identity?.documentType || '', documentNumberMasked: application.identity?.documentNumberLast4 ? `•••• ${application.identity.documentNumberLast4}` : '',
    issuingCountry: application.identity?.issuingCountry || '', issuingAuthority: application.identity?.issuingAuthority || '', issuedAt: application.identity?.issuedAt || null, expiresAt: application.identity?.expiresAt || null,
  },
  academic: {
    degrees: (application.academic?.degrees || []).map((degree: any) => ({ id: String(degree._id), level: degree.level, title: degree.title, specialty: degree.specialty, institution: degree.institution, country: degree.country, year: degree.year, highest: degree.highest })),
    certifications: (application.academic?.certifications || []).map((entry: any) => ({ id: String(entry._id), name: entry.name, issuer: entry.issuer, year: entry.year, kind: entry.kind })),
  },
  professional: {
    ...application.professional,
    experiences: (application.professional?.experiences || []).map((entry: any) => ({ id: String(entry._id), kind: entry.kind, title: entry.title, organization: entry.organization, startDate: entry.startDate, endDate: entry.endDate, current: entry.current, description: entry.description })),
  },
});

/** The candidate's own view: no internal notes, no reviewer identity, the identity number masked. */
export function candidateView(application: any, extra: { storageReady: boolean; canReapplyAt?: Date | null }) {
  return {
    id: String(application._id), reference: application.reference, status: application.status, revision: application.revision,
    ...sections(application),
    documents: (application.documents || []).map((document: any) => documentView(document, '/teacher-applications/mine')),
    requests: (application.requests || []).map((request: any) => ({ id: String(request._id), at: request.at, message: request.message, items: request.items, resolvedAt: request.resolvedAt })),
    history: (application.history || []).map((entry: any) => ({ at: entry.at, actorRole: entry.actorRole, action: entry.action, from: entry.from, to: entry.to, message: entry.message || '' })),
    termsAccepted: !!application.termsAcceptedAt, submittedAt: application.submittedAt, lastSubmittedAt: application.lastSubmittedAt,
    decisionAt: application.decisionAt, decisionReason: ['rejected', 'suspended'].includes(application.status) ? application.decisionReason : '',
    missing: CANDIDATE_EDITABLE.includes(application.status) ? missingItems(application) : [],
    editable: CANDIDATE_EDITABLE.includes(application.status), storageReady: extra.storageReady, canReapplyAt: extra.canReapplyAt || null,
    purged: !!application.purgedAt, updatedAt: application.updatedAt,
  };
}

const documentSummary = (application: any) => {
  const documents = activeDocuments(application);
  return { total: documents.length, verified: documents.filter((d: any) => d.status === 'verified').length, pending: documents.filter((d: any) => d.status === 'pending_review').length, refused: documents.filter((d: any) => ['rejected', 'replacement_requested'].includes(d.status)).length };
};

/** Row of the back-office list: never an identity number, an address or a birth date. */
export const adminListView = (application: any) => ({
  id: String(application._id), reference: application.reference, status: application.status,
  name: [application.personal?.firstName, application.personal?.lastName].filter(Boolean).join(' ') || application.userId?.name || '', email: application.userId?.email || '',
  country: application.personal?.country || '', specialties: (application.professional?.specialties || []).slice(0, 3),
  submittedAt: application.submittedAt, updatedAt: application.updatedAt, documents: documentSummary(application),
});

export function adminDetailView(application: any) {
  return {
    ...adminListView(application), revision: application.revision, userId: String(application.userId?._id || application.userId),
    account: application.userId ? { role: application.userId.role, emailVerified: application.userId.emailVerified, createdAt: application.userId.createdAt } : null,
    ...sections(application),
    documents: (application.documents || []).map((document: any) => ({ ...documentView(document, `/teacher-applications/admin/${application._id}`), sha256: document.sha256, reviewedBy: document.reviewedBy ? String(document.reviewedBy) : null, reviews: (document.reviews || []).map((review: any) => ({ status: review.status, comment: review.comment || '', at: review.at, by: String(review.by) })) })),
    requests: (application.requests || []).map((request: any) => ({ id: String(request._id), at: request.at, by: String(request.by), message: request.message, items: request.items, resolvedAt: request.resolvedAt })),
    history: (application.history || []).map((entry: any) => ({ at: entry.at, actorId: entry.actorId ? String(entry.actorId) : null, actorRole: entry.actorRole, action: entry.action, from: entry.from, to: entry.to, message: entry.message || '' })),
    internalNotes: (application.internalNotes || []).map((note: any) => ({ id: String(note._id), at: note.at, by: note.by?.name || String(note.by), text: note.text })),
    termsAcceptedAt: application.termsAcceptedAt, lastSubmittedAt: application.lastSubmittedAt, reviewerId: application.reviewerId ? String(application.reviewerId) : null,
    decisionAt: application.decisionAt, decisionReason: application.decisionReason, decisionCategory: application.decisionCategory,
    missing: missingItems(application), approvalBlockers: application.status === 'under_review' ? approvalBlockers(application) : [], purged: !!application.purgedAt,
  };
}
