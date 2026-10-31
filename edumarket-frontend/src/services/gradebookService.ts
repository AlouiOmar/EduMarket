import { apiRequest, downloadApiFile } from './apiClient';

/** Gradebook API (teacher grid and student published grades). Grades are `null` when absent: never shown as 0. */
export type EntryStatus = 'not_graded' | 'pending' | 'graded' | 'published';
export interface GradeCategory { id: string; name: string; weight: number; order: number; key: string }
export interface GradeColumn {
  id: string; categoryId: string; title: string; maxPoints: number; source: { kind: string; refId: string }; dueAt: string | null;
  countsInFinal: boolean; missingAsZero: boolean; releaseMode: 'manual' | 'auto'; order: number;
}
export interface GradeEntry {
  columnId: string; studentId: string; score: number | null; status: EntryStatus; feedback: string; excused: boolean;
  exception: { dueAt: string | null; extraAttempts: number }; published: { score: number | null; feedback: string; excused: boolean; at: string } | null;
  overridden: boolean; updatedAt: string;
}
export interface GradeTotals { categories: { categoryId: string; name: string; weight: number; counted: number; percent: number | null }[]; percent: number | null; outOf20: number | null }
export interface Gradebook {
  categories: GradeCategory[]; columns: GradeColumn[]; entries: GradeEntry[];
  students: { id: string; name: string; email: string; active: boolean }[];
  totals: { studentId: string; working: GradeTotals; published: GradeTotals }[];
}
export interface StudentGrades {
  categories: { id: string; name: string; weight: number }[];
  columns: { id: string; categoryId: string; title: string; maxPoints: number; dueAt: string | null; kind: string; status: 'published' | 'pending' | 'not_graded'; score: number | null; excused: boolean; feedback: string; percent: number | null }[];
  totals: GradeTotals;
}
export interface EntryInput { score?: number | null; feedback?: string; excused?: boolean; exception?: { dueAt?: string | null; extraAttempts?: number }; expectedUpdatedAt?: string | null }

const base = (courseId: string) => `/gradebook/${encodeURIComponent(courseId)}`;
const send = async <T>(path: string, method: string, body?: unknown) => (await apiRequest<{ data: T }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).data;

export const gradebookApi = {
  load: (courseId: string) => send<Gradebook>(base(courseId), 'GET'),
  createCategory: (courseId: string, input: { name: string; weight: number }) => send<GradeCategory>(`${base(courseId)}/categories`, 'POST', input),
  updateCategory: (courseId: string, id: string, input: { name?: string; weight?: number }) => send<GradeCategory>(`${base(courseId)}/categories/${id}`, 'PATCH', input),
  deleteCategory: (courseId: string, id: string) => send<{ id: string }>(`${base(courseId)}/categories/${id}`, 'DELETE'),
  createColumn: (courseId: string, input: { categoryId: string; title: string; maxPoints: number; dueAt?: string | null; countsInFinal?: boolean; missingAsZero?: boolean }) => send<GradeColumn>(`${base(courseId)}/columns`, 'POST', input),
  updateColumn: (courseId: string, id: string, input: Partial<Pick<GradeColumn, 'categoryId' | 'title' | 'maxPoints' | 'dueAt' | 'countsInFinal' | 'missingAsZero' | 'releaseMode'>>) => send<GradeColumn>(`${base(courseId)}/columns/${id}`, 'PATCH', input),
  deleteColumn: (courseId: string, id: string) => send<{ id: string }>(`${base(courseId)}/columns/${id}`, 'DELETE'),
  saveEntry: (courseId: string, columnId: string, studentId: string, input: EntryInput) => send<GradeEntry>(`${base(courseId)}/entries/${columnId}/${studentId}`, 'PUT', input),
  publish: (courseId: string, columnId: string, studentIds?: string[]) => send<{ published: number }>(`${base(courseId)}/columns/${columnId}/publish`, 'POST', studentIds ? { studentIds } : {}),
  export: (courseId: string, format: 'csv' | 'xlsx', filename: string) => downloadApiFile(`${base(courseId)}/export?format=${format}`, filename),
  mine: (courseId: string) => send<StudentGrades>(`/gradebook/me/${encodeURIComponent(courseId)}`, 'GET'),
};
