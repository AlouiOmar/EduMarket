import type { CourseChapter, CourseLesson } from '../types';
import type { MoveRequest } from '../services/courseContentService';

/**
 * Client copy of the server move rules, used for optimistic updates only: the server response always replaces the result,
 * and a refused move restores the previous outline.
 */
export function applyMove(chapters: CourseChapter[], move: MoveRequest): CourseChapter[] {
  const next = chapters.map(chapter => ({ ...chapter, lessons: [...chapter.lessons] }));
  if (move.type === 'container') {
    const from = next.findIndex(chapter => chapter.id === move.id);
    if (from < 0 || move.toIndex < 0 || move.toIndex > next.length - 1) return chapters;
    const [moved] = next.splice(from, 1);
    next.splice(move.toIndex, 0, moved);
    return next.map((chapter, index) => ({ ...chapter, order: index }));
  }
  const source = next.find(chapter => chapter.lessons.some(lesson => lesson.id === move.id));
  const target = next.find(chapter => chapter.id === move.toContainerId);
  if (!source || !target) return chapters;
  const from = source.lessons.findIndex(lesson => lesson.id === move.id);
  const [moved] = source.lessons.splice(from, 1);
  if (move.toIndex < 0 || move.toIndex > target.lessons.length) return chapters;
  target.lessons.splice(move.toIndex, 0, { ...moved, chapterId: target.id });
  return next;
}

export const locateItem = (chapters: CourseChapter[], itemId: string) => {
  for (const chapter of chapters) {
    const index = chapter.lessons.findIndex(lesson => lesson.id === itemId);
    if (index >= 0) return { chapter, index, item: chapter.lessons[index] as CourseLesson };
  }
  return null;
};

/**
 * `datetime-local` input value ⇄ API value. With a course time zone the input shows the wall clock of that zone and the local
 * value is sent as is (the API converts it with the course zone); without one, the browser zone is used and an ISO instant is sent.
 */
export const toLocalInput = (iso?: string | null, timeZone?: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(' ', 'T');
    } catch { /* unknown zone: fall back to the browser zone */ }
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const fromLocalInput = (value: string, timeZone?: string | null) => value ? (timeZone ? value : new Date(value).toISOString()) : null;

/** What the author edits: pending draft over the published fields. */
export const workingCopy = (item: CourseLesson): CourseLesson => {
  if (!item.draft) return item;
  const { updatedAt: _updatedAt, ...draft } = item.draft;
  return { ...item, ...draft, quiz: draft.quiz };
};

/** Publication state shown in the outline: hidden, visible, or visible with a future opening / past closing date. */
export function publicationState(entity: { visibility?: string; availableFrom?: string | null; availableUntil?: string | null }, now = Date.now()) {
  if (entity.visibility === 'hidden') return 'hidden' as const;
  if (entity.availableFrom && new Date(entity.availableFrom).getTime() > now) return 'scheduled' as const;
  if (entity.availableUntil && new Date(entity.availableUntil).getTime() < now) return 'expired' as const;
  return 'visible' as const;
}
