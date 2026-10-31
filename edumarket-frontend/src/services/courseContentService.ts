import { apiRequest, downloadApiFile } from './apiClient';
import type { Course, CourseChapter, CourseLesson, CourseQuiz, ContentVersionEntry, ContentVisibility, LessonBlock } from '../types';

/**
 * "Contenu du cours" API: every structural operation is persisted by the server, which checks permissions, destinations and
 * the outline version (`structureVersion`). A stale client receives STRUCTURE_CONFLICT (409) and must reload.
 */
export interface Outline { structureVersion: number; chapters: CourseChapter[] }
export interface OutlineWithId extends Outline { createdId: string }
export interface CopyReport { copiedContainers: number; copiedItems: number; copiedAssets: number; skipped: { id: string; title: string; reason: string }[] }
export interface CopySource { id: string; title: string; courseCode: string; chapters: { id: string; title: string; kind?: string; lessons: { id: string; title: string; type: string }[] }[] }
export interface CourseFile { id: string; name: string; kind: string; mimeType: string; size: number; storage: string; createdAt: string; references: { kind: string; label: string }[]; status: 'used' | 'unused' | 'quarantined'; quarantinedAt: string | null; purgeAfter: string | null }
export interface LinkReport { checkedAt: string; trigger: 'manual' | 'scheduled'; truncated: boolean; broken: number; results: { url: string; status: 'ok' | 'redirect' | 'broken' | 'error' | 'blocked'; httpStatus: number | null; finalUrl: string | null; error: string; locations: { itemId: string; title: string; containerTitle: string }[] }[] }
export interface UploadedAsset { id: string; name: string; type: string; size: number; kind: string; url: string }
export type MoveRequest = { type: 'container'; id: string; toIndex: number } | { type: 'item'; id: string; toContainerId: string; toIndex: number };
export interface ItemPatch {
  expectedRevision?: number; title?: string; description?: string; type?: CourseLesson['type']; durationMinutes?: number;
  url?: string; openInNewTab?: boolean; blocks?: LessonBlock[]; quiz?: CourseQuiz | null;
  visibility?: ContentVisibility; availableFrom?: string | null; availableUntil?: string | null;
}
export interface ContainerPatch {
  title?: string; description?: string; kind?: 'module' | 'folder'; visibility?: ContentVisibility;
  availableFrom?: string | null; availableUntil?: string | null; sequential?: boolean; thumbnail?: { assetId: string; alt: string };
}

const base = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`;
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const data = async <T>(path: string, init?: RequestInit) => (await apiRequest<{ data: T }>(path, init)).data;

/** `asset`/`captionsUrl` are resolved by the API on read; they are not part of the stored block and are never sent back. */
const stripBlockAssets = (blocks: LessonBlock[]) => blocks.map(block => {
  const { asset: _asset, captionsUrl: _captions, ...rest } = block as LessonBlock & { asset?: unknown; captionsUrl?: unknown };
  return rest as LessonBlock;
});

export const courseContentApi = {
  outline: async (courseId: string) => {
    const course = await data<Course & { structureVersion?: number }>(`/courses/mine/${encodeURIComponent(courseId)}`);
    return { course, outline: { structureVersion: course.structureVersion || 0, chapters: course.chapters || [] } as Outline };
  },
  createContainer: (courseId: string, input: { expectedVersion: number; kind: 'module' | 'folder'; title: string; description?: string; index?: number }) =>
    data<OutlineWithId>(`${base(courseId)}/structure/containers`, json('POST', input)),
  updateContainer: (courseId: string, containerId: string, patch: ContainerPatch) =>
    data<Outline>(`${base(courseId)}/structure/containers/${encodeURIComponent(containerId)}`, json('PATCH', patch)),
  deleteContainer: (courseId: string, containerId: string, expectedVersion: number) =>
    data<Outline>(`${base(courseId)}/structure/containers/${encodeURIComponent(containerId)}?expectedVersion=${expectedVersion}`, json('DELETE')),
  createItem: (courseId: string, input: { expectedVersion: number; containerId: string; type: CourseLesson['type']; title: string; url?: string; ltiToolId?: string; scormPackageId?: string; index?: number }) =>
    data<OutlineWithId>(`${base(courseId)}/structure/items`, json('POST', input)),
  updateItem: (courseId: string, itemId: string, patch: ItemPatch) =>
    data<Outline & { item: CourseLesson }>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}`, json('PATCH', patch.blocks ? { ...patch, blocks: stripBlockAssets(patch.blocks) } : patch)),
  deleteItem: (courseId: string, itemId: string, expectedVersion: number) =>
    data<Outline>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}?expectedVersion=${expectedVersion}`, json('DELETE')),
  move: (courseId: string, move: MoveRequest, expectedVersion: number) =>
    data<Outline>(`${base(courseId)}/structure/move`, json('POST', { ...move, expectedVersion })),
  duplicateContainer: (courseId: string, containerId: string, expectedVersion: number, titleSuffix?: string) =>
    data<OutlineWithId>(`${base(courseId)}/structure/containers/${encodeURIComponent(containerId)}/duplicate`, json('POST', { expectedVersion, ...(titleSuffix ? { titleSuffix } : {}) })),
  duplicateItem: (courseId: string, itemId: string, expectedVersion: number, titleSuffix?: string) =>
    data<OutlineWithId>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/duplicate`, json('POST', { expectedVersion, ...(titleSuffix ? { titleSuffix } : {}) })),
  batch: (courseId: string, input: { containerIds?: string[]; itemIds?: string[]; visibility?: ContentVisibility; availableFrom?: string | null; availableUntil?: string | null }) =>
    data<Outline>(`${base(courseId)}/structure/batch`, json('POST', input)),
  studentPreview: (courseId: string, draft = false) => data<Course>(`${base(courseId)}/student-preview${draft ? '?draft=true' : ''}`),
  /** Publishes the working copy now, or at `publishAt` (local time of the course zone, or ISO instant). */
  publishItem: (courseId: string, itemId: string, input: { expectedRevision: number; publishAt?: string | null; makeVisible?: boolean }) =>
    data<Outline & { item: CourseLesson }>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/publish`, json('POST', input)),
  cancelSchedule: (courseId: string, itemId: string, expectedRevision: number) =>
    data<Outline>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/schedule?expectedRevision=${expectedRevision}`, json('DELETE')),
  discardDraft: (courseId: string, itemId: string, expectedRevision: number) =>
    data<Outline & { item: CourseLesson }>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/draft?expectedRevision=${expectedRevision}`, json('DELETE')),
  versions: (courseId: string, itemId: string) => data<ContentVersionEntry[]>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/versions`),
  restoreVersion: (courseId: string, itemId: string, version: number, expectedRevision: number) =>
    data<Outline & { item: CourseLesson }>(`${base(courseId)}/structure/items/${encodeURIComponent(itemId)}/versions/${version}/restore`, json('POST', { expectedRevision })),
  copySources: (courseId: string) => data<CopySource[]>(`${base(courseId)}/structure/sources`),
  importContent: (courseId: string, input: { expectedVersion: number; sourceCourseId: string; containerIds?: string[]; itemIds?: string[]; targetContainerId?: string }) =>
    data<Outline & { report: CopyReport }>(`${base(courseId)}/structure/import`, json('POST', input)),
  importPackage: (courseId: string, expectedVersion: number, pkg: unknown) =>
    data<Outline & { report: CopyReport }>(`${base(courseId)}/structure/import-package`, json('POST', { expectedVersion, package: pkg })),
  copyCourse: (courseId: string, title?: string) => data<{ id: string; title: string; report: CopyReport }>(`${base(courseId)}/copy`, json('POST', title ? { title } : {})),
  exportCourse: (courseId: string, filename: string) => downloadApiFile(`${base(courseId)}/export`, filename),
  archiveCourse: (courseId: string, filename: string, includeStudentData: boolean) => downloadApiFile(`${base(courseId)}/archive?includeStudentData=${includeStudentData}`, filename),
  files: (courseId: string) => data<CourseFile[]>(`${base(courseId)}/files`),
  quarantineFile: (courseId: string, assetId: string) => data<{ id: string }>(`${base(courseId)}/files/${assetId}/quarantine`, json('POST')),
  restoreFile: (courseId: string, assetId: string) => data<{ id: string }>(`${base(courseId)}/files/${assetId}/restore`, json('POST')),
  deleteFile: (courseId: string, assetId: string) => data<{ id: string }>(`${base(courseId)}/files/${assetId}`, json('DELETE')),
  linkReport: (courseId: string) => data<LinkReport | null>(`${base(courseId)}/link-check`),
  runLinkCheck: (courseId: string) => data<LinkReport>(`${base(courseId)}/link-check`, json('POST')),
  exportArchive: (courseId: string, filename: string) => downloadApiFile(`${base(courseId)}/export-archive`, filename),
  importArchive: async (courseId: string, expectedVersion: number, file: File) => {
    const body = new FormData(); body.append('expectedVersion', String(expectedVersion)); body.append('archive', file);
    return data<Outline & { report: CopyReport }>(`${base(courseId)}/structure/import-archive`, { method: 'POST', body });
  },
  uploadMedia: async (courseId: string, kind: 'image' | 'block_video' | 'block_file' | 'caption', file: File, storage = 'default') => {
    const body = new FormData(); body.append('file', file);
    return data<UploadedAsset>(`${base(courseId)}/media?kind=${kind}&storage=${encodeURIComponent(storage)}`, { method: 'POST', body });
  },
};

/** Error code of a failed API call (`STRUCTURE_CONFLICT`, `NETWORK_ERROR`, …). */
export const errorCode = (error: unknown) => (error as { code?: string })?.code || (error as Error)?.message || 'REQUEST_FAILED';
