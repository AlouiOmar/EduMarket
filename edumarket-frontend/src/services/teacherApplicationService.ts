import { API_BASE_URL, apiRequest, queryString } from './apiClient';

export type ApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'additional_information_required' | 'resubmitted' | 'approved' | 'rejected' | 'suspended';
export type DocumentType = 'identity' | 'cv' | 'diploma' | 'work_certificate' | 'experience_certificate' | 'professional_certification' | 'training_certificate' | 'portfolio' | 'other';
export type DocumentStatus = 'pending_review' | 'verified' | 'rejected' | 'replacement_requested';
export const OPTIONAL_DOCUMENT_TYPES: DocumentType[] = ['work_certificate', 'experience_certificate', 'professional_certification', 'training_certificate', 'portfolio', 'other'];
export const IDENTITY_TYPES = ['national_id', 'passport', 'residence_permit', 'driving_licence', 'other_official'] as const;
export const DEGREE_LEVELS = ['secondary', 'bachelor', 'master', 'doctorate', 'engineering', 'professional', 'other'] as const;

export interface ApplicationDocument {
  id: string; type: DocumentType; degreeId: string | null; originalName: string; mimeType: string; size: number; uploadedAt: string; status: DocumentStatus;
  adminComment: string; reviewedAt: string | null; replacedBy: string | null; purged: boolean; url: string | null;
  reviews: { status: DocumentStatus; comment: string; at: string; by?: string }[]; sha256?: string; reviewedBy?: string | null;
}
export interface Degree { id?: string; level: string; title: string; specialty: string; institution: string; country: string; year: number | null; highest: boolean }
export interface Certification { id?: string; name: string; issuer: string; year: number | null; kind: 'certification' | 'training' }
export interface Experience { id?: string; kind: 'professional' | 'teaching'; title: string; organization: string; startDate: string | null; endDate: string | null; current: boolean; description: string }
export interface Personal { firstName: string; lastName: string; phone: string; country: string; city: string; preferredLanguage: 'fr' | 'en' | 'ar'; birthDate: string | null; nationality: string; address: string }
export interface Identity { documentType: string; documentNumberMasked: string; issuingCountry: string; issuingAuthority: string; issuedAt: string | null; expiresAt: string | null }
export interface Professional {
  headline: string; bio: string; specialties: string[]; expertise: string[]; subjects: string[]; teachingLanguages: string[]; yearsOfExperience: number | null;
  experiences: Experience[]; skills: string[]; portfolioUrl: string; linkedinUrl: string;
}
export interface HistoryEntry { at: string; actorRole: 'candidate' | 'admin' | 'system'; action: string; from: string | null; to: string | null; message: string; actorId?: string | null }
export interface InformationRequest { id: string; at: string; message: string; items: string[]; resolvedAt: string | null }
export interface CandidateApplication {
  id: string; reference: string | null; status: ApplicationStatus; revision: number;
  personal: Personal; identity: Identity; academic: { degrees: Degree[]; certifications: Certification[] }; professional: Professional;
  documents: ApplicationDocument[]; requests: InformationRequest[]; history: HistoryEntry[];
  termsAccepted: boolean; submittedAt: string | null; lastSubmittedAt: string | null; decisionAt: string | null; decisionReason: string;
  missing: string[]; editable: boolean; storageReady: boolean; canReapplyAt: string | null; purged: boolean; updatedAt: string;
}
export interface Eligibility { canStart: boolean; institutional: boolean }
export interface AdminRow {
  id: string; reference: string | null; status: ApplicationStatus; name: string; email: string; country: string; specialties: string[];
  submittedAt: string | null; updatedAt: string; documents: { total: number; verified: number; pending: number; refused: number };
}
export interface AdminApplication extends Omit<CandidateApplication, 'editable' | 'storageReady' | 'canReapplyAt' | 'termsAccepted'> {
  name: string; email: string; country: string; userId: string; account: { role: string; emailVerified: boolean; createdAt: string } | null;
  internalNotes: { id: string; at: string; by: string; text: string }[]; termsAcceptedAt: string | null; reviewerId: string | null;
  decisionCategory: string; approvalBlockers: string[];
}
export interface AdminStats { total: number; drafts: number; new: number; underReview: number; incomplete: number; informationRequired: number; approved: number; rejected: number; suspended: number }

export interface SectionsPatch {
  personal?: Partial<Personal>; identity?: Partial<Omit<Identity, 'documentNumberMasked'>> & { documentNumber?: string };
  academic?: { degrees?: Degree[]; certifications?: Certification[] }; professional?: Partial<Professional>; acceptTerms?: true;
}

type Envelope<T> = { data: T };
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Upload with progress (fetch has no upload progress): same cookie, same error shape as `apiRequest`. */
function uploadWithProgress<T>(path: string, data: FormData, onProgress?: (percent: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE_URL}${path}`);
    request.withCredentials = true;
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)); };
    request.onerror = () => reject(Object.assign(new Error('NETWORK_ERROR'), { status: 0, code: 'NETWORK_ERROR' }));
    request.onload = () => {
      let payload: any;
      try { payload = JSON.parse(request.responseText); } catch { payload = undefined; }
      if (request.status >= 200 && request.status < 300) resolve(payload as T);
      else reject(Object.assign(new Error(payload?.error?.code || 'REQUEST_FAILED'), { status: request.status, code: payload?.error?.code, details: payload?.error?.details }));
    };
    request.send(data);
  });
}

/** Opens a private document (fetched with the session cookie) in a new tab; the object URL is revoked shortly after. */
export async function openPrivateDocument(url: string, download = false) {
  const response = await fetch(`${API_BASE_URL}${url}${download ? '?download=1' : ''}`, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw Object.assign(new Error(payload?.error?.code || 'DOWNLOAD_FAILED'), { status: response.status, code: payload?.error?.code });
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  if (download) {
    const link = document.createElement('a');
    link.href = objectUrl; link.download = decodeURIComponent((response.headers.get('content-disposition') || '').split("''")[1] || 'document');
    document.body.appendChild(link); link.click(); link.remove();
  } else window.open(objectUrl, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export const teacherApplicationService = {
  registerCandidate: async (payload: { email: string; password: string; firstName: string; lastName: string; phone: string; country: string; city: string; preferredLanguage: 'fr' | 'en' | 'ar'; acceptTerms: true }) =>
    (await apiRequest<Envelope<{ previewUrl?: string; email: string }>>('/auth/register', json('POST', { accountType: 'teacher_candidate', ...payload }))).data,
  mine: async () => { const result = await apiRequest<{ data: CandidateApplication | null; eligibility: Eligibility }>('/teacher-applications/mine'); return result; },
  start: async () => (await apiRequest<Envelope<CandidateApplication>>('/teacher-applications', json('POST', {}))).data,
  save: async (revision: number, patch: SectionsPatch) => (await apiRequest<Envelope<CandidateApplication>>('/teacher-applications/mine', json('PATCH', { revision, ...patch }))).data,
  upload: async (file: File, fields: { type: DocumentType; degreeId?: string; replaces?: string }, onProgress?: (percent: number) => void) => {
    const data = new FormData();
    data.append('type', fields.type);
    if (fields.degreeId) data.append('degreeId', fields.degreeId);
    if (fields.replaces) data.append('replaces', fields.replaces);
    data.append('file', file);
    return (await uploadWithProgress<Envelope<CandidateApplication>>('/teacher-applications/mine/documents', data, onProgress)).data;
  },
  removeDocument: async (documentId: string) => (await apiRequest<Envelope<CandidateApplication>>(`/teacher-applications/mine/documents/${documentId}`, json('DELETE'))).data,
  submit: async (revision: number) => (await apiRequest<Envelope<CandidateApplication>>('/teacher-applications/mine/submit', json('POST', { revision }))).data,

  // Central administration
  stats: async () => (await apiRequest<Envelope<AdminStats>>('/teacher-applications/admin/stats')).data,
  list: async (params: { search?: string; status?: string; specialty?: string; country?: string; sort?: string; page?: number; pageSize?: number }) =>
    apiRequest<{ data: AdminRow[]; pagination: { page: number; pageSize: number; total: number }; facets: { specialties: string[]; countries: string[] } }>(`/teacher-applications/admin${queryString(params)}`),
  detail: async (id: string) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}`)).data,
  revealIdentity: async (id: string) => (await apiRequest<Envelope<{ documentNumber: string }>>(`/teacher-applications/admin/${id}/identity-number`, json('POST'))).data.documentNumber,
  startReview: async (id: string, revision: number) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/start-review`, json('POST', { revision }))).data,
  reviewDocument: async (id: string, documentId: string, revision: number, status: 'verified' | 'rejected' | 'replacement_requested', comment = '') =>
    (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/documents/${documentId}/review`, json('POST', { revision, status, comment }))).data,
  requestInformation: async (id: string, revision: number, message: string, items: string[]) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/request-information`, json('POST', { revision, message, items }))).data,
  approve: async (id: string, revision: number) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/approve`, json('POST', { revision, confirm: true }))).data,
  reject: async (id: string, revision: number, reason: string, category: string) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/reject`, json('POST', { revision, reason, category }))).data,
  suspend: async (id: string, revision: number, reason: string) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/suspend`, json('POST', { revision, reason }))).data,
  addNote: async (id: string, text: string) => (await apiRequest<Envelope<AdminApplication>>(`/teacher-applications/admin/${id}/notes`, json('POST', { text }))).data,
};
