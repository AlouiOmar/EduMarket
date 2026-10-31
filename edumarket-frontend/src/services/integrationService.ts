import { API_BASE_URL, apiRequest } from './apiClient';

/** AI conversation activities, LTI 1.3 tools and SCORM packages. Each reports whether it is configured on the server. */
export interface AiStatus { configured: boolean; provider: 'none' | 'anthropic' | 'openai-compatible'; model: string | null }
export interface DataNotice { collected: string[]; visibleTo: string; retentionDays: number; provider: string }
export interface AiMessage { role: 'user' | 'assistant'; content: string; at: string }
export interface AiActivity { id: string; title: string; instructions: string; systemPrompt?: string; maxTurns: number; retentionDays?: number; graded: boolean; points: number; status: 'draft' | 'published' | 'closed'; availableFrom?: string | null; availableUntil: string | null; dataNotice: DataNotice; conversations?: number }
export interface StudentAiActivity extends AiActivity { open: boolean; conversation: { id: string; messages: AiMessage[]; status: 'active' | 'submitted'; consentAt: string; deleteAfter: string } | null }
export interface AiConversationRow { id: string; studentId: string; studentName: string; turns: number; status: string; submittedAt: string | null; updatedAt: string; deleteAfter: string }
export interface LtiTool { id: string; name: string; clientId: string; deploymentId: string; oidcLoginUrl: string; targetLinkUri: string; redirectUris: string[]; jwksUrl: string; hasPublicKey: boolean; privacy: { sendName: boolean; sendEmail: boolean }; status: 'active' | 'disabled' }
export interface ScormPackageRow { id: string; title: string; version: '1.2' | '2004'; fileCount: number; totalSize: number; createdAt: string }

const send = async <T>(path: string, method = 'GET', body?: unknown) => (await apiRequest<{ data: T }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).data;
const ai = (courseId: string) => `/ai/${encodeURIComponent(courseId)}`;

export const integrationApi = {
  aiActivities: (courseId: string) => send<{ status: AiStatus; activities: AiActivity[] }>(`${ai(courseId)}/activities`),
  createAiActivity: (courseId: string, input: { title: string; instructions: string; systemPrompt: string; maxTurns: number; retentionDays: number; graded: boolean; points: number }) => send<AiActivity>(`${ai(courseId)}/activities`, 'POST', input),
  updateAiActivity: (courseId: string, id: string, input: Partial<Pick<AiActivity, 'status' | 'title'>>) => send<AiActivity>(`${ai(courseId)}/activities/${id}`, 'PATCH', input),
  aiConversations: (courseId: string, id: string) => send<AiConversationRow[]>(`${ai(courseId)}/activities/${id}/conversations`),
  aiTranscript: (courseId: string, conversationId: string) => send<{ studentName: string; messages: AiMessage[]; consentAt: string; deleteAfter: string }>(`${ai(courseId)}/conversations/${conversationId}`),
  gradeAi: (courseId: string, id: string, input: { studentId: string; score: number; feedback: string }) => send<{ score: number }>(`${ai(courseId)}/activities/${id}/grades`, 'POST', input),
  studentAiActivities: (courseId: string) => send<{ status: AiStatus; activities: StudentAiActivity[] }>(`${ai(courseId)}/student/activities`),
  consent: (courseId: string, id: string) => send<{ conversation: StudentAiActivity['conversation'] }>(`${ai(courseId)}/student/activities/${id}/consent`, 'POST', { accepted: true }),
  sendMessage: (courseId: string, id: string, content: string) => send<{ conversation: StudentAiActivity['conversation']; turnsLeft: number }>(`${ai(courseId)}/student/activities/${id}/messages`, 'POST', { content }),
  submitConversation: (courseId: string, id: string) => send<StudentAiActivity['conversation']>(`${ai(courseId)}/student/activities/${id}/submit`, 'POST', {}),
  ltiAdmin: () => send<{ configured: boolean; issuer: string | null; tools: LtiTool[] }>('/lti/tools'),
  registerTool: (input: { name: string; oidcLoginUrl: string; targetLinkUri: string; redirectUris: string[]; jwksUrl: string; publicKeyPem: string; privacy: { sendName: boolean; sendEmail: boolean } }) => send<LtiTool>('/lti/tools', 'POST', input),
  updateTool: (id: string, input: Partial<Pick<LtiTool, 'status'>>) => send<LtiTool>(`/lti/tools/${id}`, 'PATCH', input),
  availableTools: () => send<{ configured: boolean; tools: { id: string; name: string }[] }>('/lti/tools/available'),
  /** LTI launches are browser navigations (OIDC redirects), opened in a new tab with the API session cookie. */
  ltiLaunchUrl: (courseId: string, itemId: string) => `${API_BASE_URL}/lti/launch/${encodeURIComponent(courseId)}/${encodeURIComponent(itemId)}`,
  scormPackages: (courseId: string) => send<{ configured: boolean; packages: ScormPackageRow[] }>(`/scorm/${encodeURIComponent(courseId)}/packages`),
  uploadScorm: async (courseId: string, file: File) => { const body = new FormData(); body.append('package', file); return (await apiRequest<{ data: { id: string; title: string } }>(`/scorm/${encodeURIComponent(courseId)}/packages`, { method: 'POST', body })).data; },
  deleteScorm: (courseId: string, packageId: string) => send<{ id: string }>(`/scorm/${encodeURIComponent(courseId)}/packages/${packageId}`, 'DELETE'),
  scormAttempts: (courseId: string, packageId: string) => send<{ studentName: string; completed: boolean; passed: boolean | null; scorePercent: number | null; sessions: number; lastCommitAt: string | null }[]>(`/scorm/${encodeURIComponent(courseId)}/packages/${packageId}/attempts`),
  launchScorm: (courseId: string, itemId: string) => send<{ playerUrl: string; title: string; version: string; preview: boolean }>(`/scorm/${encodeURIComponent(courseId)}/items/${encodeURIComponent(itemId)}/launch`, 'POST', {}),
};
