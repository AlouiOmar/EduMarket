import { isDeepStrictEqual } from 'node:util';
import type { OutlineContainer, OutlineItem } from './structure.js';

/**
 * Draft / published lifecycle of a content item.
 *
 * - An item that was never published (hidden, `publishedVersion` 0) is itself the draft: its fields are edited in place.
 * - Once live (visible, or published at least once), content edits go to `item.draft` and students keep the published fields
 *   until the draft is published (immediately or at `scheduledPublishAt`). Each publication is archived as a ContentVersion.
 * - Items created before this lifecycle and already visible are live: they count as published (implicit version 0).
 */
export const CONTENT_FIELDS = ['title', 'description', 'type', 'durationMinutes', 'url', 'openInNewTab', 'blocks', 'quiz', 'textContent', 'ltiToolId', 'scormPackageId'] as const;
export type ContentField = typeof CONTENT_FIELDS[number];
export type ContentSnapshot = Partial<Record<ContentField, unknown>>;
export type PublicationStatus = 'draft' | 'scheduled' | 'published' | 'pending_changes';

export interface DraftState { updatedAt?: string | Date; updatedBy?: string; [key: string]: unknown }

export const isLive = (item: OutlineItem) => item.visibility !== 'hidden' || Number(item.publishedVersion || 0) > 0;
export const hasDraft = (item: OutlineItem) => !!item.draft && typeof item.draft === 'object';

/** Content fields only (no publication or bookkeeping fields), without undefined values. */
export function contentSnapshot(source: Record<string, unknown>): ContentSnapshot {
  const snapshot: ContentSnapshot = {};
  for (const field of CONTENT_FIELDS) if (source[field] !== undefined && source[field] !== null) snapshot[field] = JSON.parse(JSON.stringify(source[field]));
  return snapshot;
}

/** What the author edits: the pending draft over the published fields. */
export function workingCopy(item: OutlineItem): OutlineItem {
  if (!hasDraft(item)) return item;
  const draft = contentSnapshot(item.draft as Record<string, unknown>);
  const base = { ...item };
  for (const field of CONTENT_FIELDS) delete base[field];
  return { ...base, ...contentSnapshot(item), ...draft, ...(('quiz' in draft) ? {} : { quiz: undefined }) } as OutlineItem;
}

/** Status shown to authors. Visibility (hidden/visible) and availability windows stay separate settings. */
export function publicationStatus(item: OutlineItem, now = new Date()): PublicationStatus {
  if (item.scheduledPublishAt && new Date(item.scheduledPublishAt as string).getTime() > now.getTime()) return 'scheduled';
  if (!isLive(item)) return 'draft';
  if (hasDraft(item)) return 'pending_changes';
  if (item.visibility !== 'hidden' && item.availableFrom && new Date(item.availableFrom).getTime() > now.getTime()) return 'scheduled';
  return 'published';
}

/** A quiz whose questions, answers or pass mark changed can no longer be compared with attempts made on the previous one. */
export function quizChanged(previous: unknown, next: unknown) {
  const shape = (quiz: any) => quiz ? { passPercentage: quiz.passPercentage, questions: (quiz.questions || []).map((question: any) => ({ id: question.id, question: question.question, options: question.options, correctOptionIndex: question.correctOptionIndex })) } : null;
  return !isDeepStrictEqual(shape(previous), shape(next));
}

export const sameContent = (a: ContentSnapshot, b: ContentSnapshot) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

/** Outline as it will look once every pending draft is published ("Aperçu du brouillon"). Teachers only. */
export const applyDrafts = (chapters: OutlineContainer[]): OutlineContainer[] =>
  chapters.map(container => ({ ...container, lessons: container.lessons.map(item => ({ ...workingCopy(item), draft: undefined })) }));

/** Fields removed from every learner-facing representation of an item. */
export const AUTHOR_ONLY_FIELDS = ['draft', 'scheduledPublishAt', 'publishedBy', 'revision', 'availableFrom', 'availableUntil'] as const;
