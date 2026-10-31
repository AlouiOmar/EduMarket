import { apiRequest } from './apiClient';

/** Templates and class instances: creation, listing, comparison, item-by-item synchronization. */
export type DiffStatus = 'unchanged' | 'template_changed' | 'locally_modified' | 'conflict' | 'added_in_template' | 'removed_in_template' | 'removed_locally';
export interface TemplateInstance { id: string; title: string; courseCode: string; status: string; accessState: string; studentsCount: number; startsAt: string | null; endsAt: string | null; syncedAt: string | null }
export interface TemplateDiff { template: { id: string; title: string }; syncedAt: string; structureVersion: number; rows: { status: DiffStatus; templateItemId?: string; instanceItemId?: string; title: string; templateContainerTitle?: string; instanceTitle?: string }[] }
export interface ClassComparison {
  inactiveDays: number;
  classes: { id: string; title: string; courseCode: string; startsAt: string | null; students: number; activeInPeriod: number; inactive: number; averageProgress: number | null; completionRate: number | null; publishedItems: number; items: number; grades: { average: number | null; gradedStudents: number } }[];
}
export interface CourseTemplateInfo { _id: string; title: string; isTemplate?: boolean; templateLink?: { templateId: string; syncedAt: string } }

const send = async <T>(path: string, method = 'GET', body?: unknown) => (await apiRequest<{ data: T }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).data;
const course = (id: string) => `/courses/${encodeURIComponent(id)}`;

export const templateApi = {
  info: (courseId: string) => send<CourseTemplateInfo>(`/courses/mine/${encodeURIComponent(courseId)}`),
  setTemplate: (courseId: string, isTemplate: boolean) => send<{ isTemplate: boolean }>(`${course(courseId)}/template`, 'PATCH', { isTemplate }),
  instances: (courseId: string) => send<TemplateInstance[]>(`${course(courseId)}/instances`),
  createInstance: (courseId: string, input: { title: string; courseCode?: string; startsAt?: string | null; endsAt?: string | null }) => send<{ id: string; title: string }>(`${course(courseId)}/instances`, 'POST', input),
  compare: (courseId: string) => send<ClassComparison>(`/analytics/templates/${encodeURIComponent(courseId)}/compare`),
  diff: (courseId: string) => send<TemplateDiff>(`${course(courseId)}/template-diff`),
  sync: (courseId: string, expectedVersion: number, items: { templateItemId: string; action: 'update' | 'add'; overwriteLocal?: boolean }[]) => send<{ applied: unknown[]; structureVersion: number }>(`${course(courseId)}/template-sync`, 'POST', { expectedVersion, items }),
};
