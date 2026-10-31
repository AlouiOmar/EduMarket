import { apiRequest, downloadApiFile } from './apiClient';

/** Participation API: groups, group files, discussions, journals, announcements, attendance; course analytics. */
export interface GroupSet { id: string; name: string; mode: 'manual' | 'random' | 'self'; maxMembers: number; selfSignupOpen: boolean }
export interface CourseGroup { id: string; setId: string; name: string; memberCount: number; mine: boolean; members: { id: string; name: string }[] }
export interface GroupsView { sets: GroupSet[]; groups: CourseGroup[]; students?: { id: string; name: string }[] }
export interface GroupFile { id: string; name: string; size: number; type: string; uploadedBy: string; uploaderId: string; createdAt: string; url: string }
export interface Discussion { id: string; title: string; prompt: string; groupId: string | null; status: 'open' | 'closed'; pinned: boolean; graded: boolean; points: number; dueAt: string | null; createdAt: string; posts?: number }
export interface DiscussionPost { id: string; parentId: string | null; body: string; pinned: boolean; editedAt: string | null; createdAt: string; authorId: string; authorName: string; authorRole: string; status?: 'visible' | 'hidden'; moderationNote?: string }
export interface Participant { studentId: string; name: string; posts: number; replies: number; lastPostAt: string }
export interface Journal { id: string; title: string; instructions: string; status: 'open' | 'closed'; graded: boolean; points: number; createdAt: string; entries?: number; authors?: number; myEntries?: number }
export interface JournalEntry { id: string; authorId: string; authorName: string; body: string; createdAt: string; comments: { authorName: string; body: string; createdAt: string }[] }
export interface Announcement { id: string; title: string; body: string; publishAt: string | null; sentAt: string | null; createdAt: string; status?: 'draft' | 'scheduled' | 'sending' | 'sent'; groupIds?: string[]; sendEmail?: boolean; stats?: { recipients: number; emailsSent: number; emailsFailed: number; emailsSkipped: number } }
export interface AttendanceView {
  sessions: { id: string; title: string; date: string }[]; records: { sessionId: string; studentId: string; status: AttendanceStatus; note: string }[];
  students?: { id: string; name: string; email: string; stats: Record<AttendanceStatus, number> }[]; stats?: Record<AttendanceStatus, number>;
}
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export interface CourseAnalytics {
  course: { id: string; title: string }; inactiveDays: number;
  authoring: { containers: number; items: number; published: number; neverPublished: number; pendingChanges: number; scheduled: number };
  totals: { students: number; activeInPeriod: number; inactive: number; averageProgress: number | null; completionRate: number | null };
  students: { studentId: string; name: string; email: string; progress: number; completedAt: string | null; lastActivityAt: string | null; inactive: boolean; activity: Record<'lessons' | 'quizAttempts' | 'testAttempts' | 'posts' | 'submissions', number> }[];
  assessments: { columnId: string; title: string; kind: string; maxPoints: number; graded: number; pending: number; published: number; averagePercent: number | null }[];
}

const base = (courseId: string) => `/participation/${encodeURIComponent(courseId)}`;
const send = async <T>(path: string, method = 'GET', body?: unknown) => (await apiRequest<{ data: T }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).data;

export const participationApi = {
  groups: (courseId: string) => send<GroupsView>(`${base(courseId)}/groups`),
  createGroupSet: (courseId: string, input: { name: string; mode: GroupSet['mode']; maxMembers: number; groupCount?: number }) => send<{ id: string; groups: number }>(`${base(courseId)}/group-sets`, 'POST', input),
  updateGroupSet: (courseId: string, setId: string, input: Partial<Pick<GroupSet, 'name' | 'selfSignupOpen' | 'maxMembers'>>) => send<GroupSet>(`${base(courseId)}/group-sets/${setId}`, 'PATCH', input),
  setMembers: (courseId: string, groupId: string, memberIds: string[]) => send<{ id: string }>(`${base(courseId)}/groups/${groupId}/members`, 'PUT', { memberIds }),
  joinGroup: (courseId: string, groupId: string) => send<{ id: string }>(`${base(courseId)}/groups/${groupId}/join`, 'POST'),
  leaveGroup: (courseId: string, groupId: string) => send<{ id: string }>(`${base(courseId)}/groups/${groupId}/leave`, 'POST'),
  groupFiles: (courseId: string, groupId: string) => send<GroupFile[]>(`${base(courseId)}/groups/${groupId}/files`),
  uploadGroupFile: async (courseId: string, groupId: string, file: File) => { const body = new FormData(); body.append('file', file); return (await apiRequest<{ data: { id: string } }>(`${base(courseId)}/groups/${groupId}/files`, { method: 'POST', body })).data; },
  downloadGroupFile: (url: string, name: string) => downloadApiFile(url, name),
  deleteGroupFile: (courseId: string, groupId: string, fileId: string) => send<{ id: string }>(`${base(courseId)}/groups/${groupId}/files/${fileId}`, 'DELETE'),
  discussions: (courseId: string) => send<Discussion[]>(`${base(courseId)}/discussions`),
  createDiscussion: (courseId: string, input: { title: string; prompt: string; groupId: string | null; graded: boolean; points: number; dueAt?: string | null }) => send<Discussion>(`${base(courseId)}/discussions`, 'POST', input),
  updateDiscussion: (courseId: string, id: string, input: Partial<Pick<Discussion, 'title' | 'prompt' | 'status' | 'pinned' | 'graded' | 'points'>>) => send<Discussion>(`${base(courseId)}/discussions/${id}`, 'PATCH', input),
  posts: (courseId: string, id: string) => send<{ discussion: Discussion; posts: DiscussionPost[] }>(`${base(courseId)}/discussions/${id}/posts`),
  createPost: (courseId: string, id: string, body: string, parentId: string | null = null) => send<{ id: string }>(`${base(courseId)}/discussions/${id}/posts`, 'POST', { body, parentId }),
  updatePost: (courseId: string, id: string, postId: string, input: { body?: string; status?: 'visible' | 'hidden'; moderationNote?: string; pinned?: boolean }) => send<{ id: string }>(`${base(courseId)}/discussions/${id}/posts/${postId}`, 'PATCH', input),
  participants: (courseId: string, id: string) => send<Participant[]>(`${base(courseId)}/discussions/${id}/participants`),
  gradeDiscussion: (courseId: string, id: string, input: { studentId: string; score: number; feedback: string }) => send<{ score: number }>(`${base(courseId)}/discussions/${id}/grades`, 'POST', input),
  journals: (courseId: string) => send<Journal[]>(`${base(courseId)}/journals`),
  createJournal: (courseId: string, input: { title: string; instructions: string; graded: boolean; points: number }) => send<Journal>(`${base(courseId)}/journals`, 'POST', input),
  updateJournal: (courseId: string, id: string, input: Partial<Pick<Journal, 'status' | 'title'>>) => send<Journal>(`${base(courseId)}/journals/${id}`, 'PATCH', input),
  entries: (courseId: string, id: string, studentId?: string) => send<{ journal: Journal; entries: JournalEntry[] }>(`${base(courseId)}/journals/${id}/entries${studentId ? `?studentId=${studentId}` : ''}`),
  createEntry: (courseId: string, id: string, body: string) => send<{ id: string }>(`${base(courseId)}/journals/${id}/entries`, 'POST', { body }),
  commentEntry: (courseId: string, entryId: string, body: string) => send<{ id: string }>(`${base(courseId)}/journal-entries/${entryId}/comments`, 'POST', { body }),
  gradeJournal: (courseId: string, id: string, input: { studentId: string; score: number; feedback: string }) => send<{ score: number }>(`${base(courseId)}/journals/${id}/grades`, 'POST', input),
  announcements: (courseId: string) => send<Announcement[]>(`${base(courseId)}/announcements`),
  createAnnouncement: (courseId: string, input: { title: string; body: string; groupIds: string[]; sendEmail: boolean; publishAt: string | null; draft: boolean }) => send<Announcement>(`${base(courseId)}/announcements`, 'POST', input),
  deleteAnnouncement: (courseId: string, id: string) => send<{ id: string }>(`${base(courseId)}/announcements/${id}`, 'DELETE'),
  attendance: (courseId: string) => send<AttendanceView>(`${base(courseId)}/attendance`),
  createSession: (courseId: string, input: { title: string; date: string }) => send<{ id: string }>(`${base(courseId)}/attendance/sessions`, 'POST', input),
  saveRecords: (courseId: string, sessionId: string, records: { studentId: string; status: AttendanceStatus; note: string }[]) => send<{ saved: number }>(`${base(courseId)}/attendance/sessions/${sessionId}/records`, 'PUT', { records }),
  deleteSession: (courseId: string, sessionId: string) => send<{ id: string }>(`${base(courseId)}/attendance/sessions/${sessionId}`, 'DELETE'),
  exportAttendance: (courseId: string, format: 'csv' | 'xlsx') => downloadApiFile(`${base(courseId)}/attendance/export?format=${format}`, `attendance.${format}`),
  analytics: (courseId: string, filters: { from?: string; to?: string; classId?: string; inactiveDays?: number }) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
    return send<CourseAnalytics>(`/analytics/courses/${encodeURIComponent(courseId)}${query ? `?${query}` : ''}`);
  },
  analyticsClasses: (courseId: string) => send<{ id: string; name: string; students: number }[]>(`/analytics/courses/${encodeURIComponent(courseId)}/classes`),
};
