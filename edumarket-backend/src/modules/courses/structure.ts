import crypto from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { blockAssetIds } from './blocks.js';
import { workingCopy } from './publication.js';

/**
 * Pure course-outline operations shared by the structure routes, the student DTOs and the tests.
 *
 * The outline has exactly two levels: containers (`chapters`: learning modules or folders) and content items (`lessons`).
 * Positions are the array indexes; `order` fields are renumbered on every structural write so they never drift.
 */
export type Visibility = 'hidden' | 'visible';
export interface OutlineItem { id: string; chapterId: string; title: string; visibility?: Visibility; availableFrom?: Date | string | null; availableUntil?: Date | string | null; blocks?: unknown[]; [key: string]: unknown }
export interface OutlineContainer { id: string; title: string; order?: number; kind?: 'module' | 'folder'; visibility?: Visibility; availableFrom?: Date | string | null; availableUntil?: Date | string | null; sequential?: boolean; thumbnail?: { assetId?: string; alt?: string }; lessons: OutlineItem[]; [key: string]: unknown }

export type MoveRequest =
  | { type: 'container'; id: string; toIndex: number }
  | { type: 'item'; id: string; toContainerId: string; toIndex: number };

export const MAX_CONTAINERS = 100;
export const MAX_ITEMS_PER_CONTAINER = 100;

export const newOutlineId = (prefix: 'chap' | 'les' | 'blk') => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** Content created before per-item publication has no visibility and stays visible. */
export const visibilityOf = (entity: { visibility?: Visibility }) => entity.visibility === 'hidden' ? 'hidden' : 'visible';

/** Visible flag set and inside its availability window. */
export function isAvailable(entity: { visibility?: Visibility; availableFrom?: Date | string | null; availableUntil?: Date | string | null }, now = new Date()) {
  if (visibilityOf(entity) === 'hidden') return false;
  if (entity.availableFrom && new Date(entity.availableFrom).getTime() > now.getTime()) return false;
  if (entity.availableUntil && new Date(entity.availableUntil).getTime() < now.getTime()) return false;
  return true;
}

/** Deep-ish copy that keeps plain data only (Mongoose subdocuments become plain objects). */
export const plainOutline = (chapters: unknown): OutlineContainer[] => JSON.parse(JSON.stringify(chapters ?? []));

export function renumber(chapters: OutlineContainer[]): OutlineContainer[] {
  return chapters.map((container, index) => ({
    ...container, order: index,
    lessons: container.lessons.map((item, itemIndex) => ({ ...item, chapterId: container.id, order: itemIndex })),
  }));
}

export function findItem(chapters: OutlineContainer[], itemId: string) {
  for (let containerIndex = 0; containerIndex < chapters.length; containerIndex += 1) {
    const itemIndex = chapters[containerIndex].lessons.findIndex(item => item.id === itemId);
    if (itemIndex >= 0) return { container: chapters[containerIndex], containerIndex, item: chapters[containerIndex].lessons[itemIndex], itemIndex };
  }
  return null;
}

/**
 * Applies a move and returns a new outline. Rejects unknown ids, invalid destinations (an item can only go into a container,
 * a container only at the root: no cycle or third level is representable) and out-of-range positions.
 * `toIndex` is the final position in the destination list.
 */
export function applyMove(source: OutlineContainer[], move: MoveRequest): OutlineContainer[] {
  const chapters = plainOutline(source);
  if (!Number.isInteger(move.toIndex) || move.toIndex < 0) throw new AppError(422, 'INVALID_POSITION');
  if (move.type === 'container') {
    const from = chapters.findIndex(container => container.id === move.id);
    if (from < 0) throw new AppError(404, 'CONTAINER_NOT_FOUND');
    if (move.toIndex > chapters.length - 1) throw new AppError(422, 'INVALID_POSITION');
    const [moved] = chapters.splice(from, 1);
    chapters.splice(move.toIndex, 0, moved);
    return renumber(chapters);
  }
  const found = findItem(chapters, move.id);
  if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
  if (move.toContainerId === move.id) throw new AppError(422, 'INVALID_DESTINATION');
  const destination = chapters.find(container => container.id === move.toContainerId);
  if (!destination) throw new AppError(422, 'INVALID_DESTINATION');
  const [moved] = found.container.lessons.splice(found.itemIndex, 1);
  if (move.toIndex > destination.lessons.length) throw new AppError(422, 'INVALID_POSITION');
  if (destination !== found.container && destination.lessons.length >= MAX_ITEMS_PER_CONTAINER) throw new AppError(409, 'CONTAINER_FULL');
  destination.lessons.splice(move.toIndex, 0, { ...moved, chapterId: destination.id });
  return renumber(chapters);
}

export interface StudentOutlineOptions { now?: Date; completedIds?: Iterable<string> }

/**
 * What a student may see: hidden or out-of-window containers disappear with all their children (a visible child of a hidden
 * parent stays unreachable), hidden items disappear, and sequential modules lock every item after the first uncompleted one.
 * Locked items keep only their identity so the outline can show a padlock.
 */
export function studentOutline(source: OutlineContainer[], options: StudentOutlineOptions = {}): OutlineContainer[] {
  const now = options.now ?? new Date();
  const completed = new Set(options.completedIds ?? []);
  return plainOutline(source).filter(container => isAvailable(container, now)).map(container => {
    let blocked = false;
    const lessons = container.lessons.filter(item => isAvailable(item, now)).map(item => {
      if (blocked) return { id: item.id, chapterId: container.id, title: item.title, type: item.type, durationMinutes: item.durationMinutes, locked: true, resources: [], commentsCount: 0 } as OutlineItem;
      if (container.sequential && !completed.has(item.id)) blocked = true;
      return item;
    });
    return { ...container, lessons };
  });
}

/** Items a student can open now (visible, in window, not locked). */
export function accessibleItems(source: OutlineContainer[], options: StudentOutlineOptions = {}) {
  return studentOutline(source, options).flatMap(container => container.lessons.filter(item => !item.locked));
}

/** Items that count towards completion: everything published (visible flag), whatever its dates. */
export const countableItems = (source: OutlineContainer[]) =>
  plainOutline(source).filter(container => visibilityOf(container) === 'visible').flatMap(container => container.lessons.filter(item => visibilityOf(item) === 'visible'));

/** Whether a student may download an asset: lesson media of an open item, block media of an open item, or a visible thumbnail/banner. */
export function studentCanAccessAsset(course: { chapters: OutlineContainer[]; banner?: { assetId?: string } }, asset: { _id: unknown; lessonId?: string }, options: StudentOutlineOptions = {}) {
  const assetId = String(asset._id);
  if (course.banner?.assetId === assetId) return true;
  const outline = studentOutline(course.chapters, options);
  if (outline.some(container => container.thumbnail?.assetId === assetId)) return true;
  const open = outline.flatMap(container => container.lessons.filter(item => !item.locked));
  if (asset.lessonId) return open.some(item => item.id === asset.lessonId);
  return open.some(item => blockAssetIds(item.blocks).includes(assetId));
}

/** Copies an item with fresh ids (item and blocks), hidden by default. Answers keys of quizzes are kept: this is authoring data. */
export function cloneItem(item: OutlineItem, containerId: string, options: { titleSuffix?: string; hidden?: boolean } = {}): OutlineItem {
  // A copy starts from the latest authoring state and has its own publication history: it never shares a draft with its source.
  const copy = JSON.parse(JSON.stringify(workingCopy(item))) as OutlineItem;
  for (const field of ['draft', 'scheduledPublishAt', 'publishedVersion', 'publishedAt', 'publishedBy']) delete copy[field];
  return {
    ...copy, id: newOutlineId('les'), chapterId: containerId,
    title: `${copy.title}${options.titleSuffix ?? ''}`.slice(0, 240),
    visibility: options.hidden === false ? visibilityOf(item) : 'hidden',
    commentsCount: 0, revision: 0,
    blocks: Array.isArray(copy.blocks) ? copy.blocks.map((block: any) => ({ ...block, id: newOutlineId('blk') })) : copy.blocks,
    ...(copy.quiz && typeof copy.quiz === 'object' ? { quiz: { ...(copy.quiz as object), id: `quiz_${crypto.randomUUID().slice(0, 8)}` } } : {}),
  };
}

export function cloneContainer(container: OutlineContainer, options: { titleSuffix?: string; hidden?: boolean } = {}): OutlineContainer {
  const copy = JSON.parse(JSON.stringify(container)) as OutlineContainer;
  const id = newOutlineId('chap');
  delete copy._id;
  return {
    ...copy, id, title: `${copy.title}${options.titleSuffix ?? ''}`.slice(0, 240),
    visibility: options.hidden === false ? visibilityOf(container) : 'hidden',
    lessons: copy.lessons.map(item => cloneItem(item, id, { hidden: options.hidden })),
  };
}

/** Rewrites asset ids (block media, thumbnails) after the assets were copied into another course. */
export function remapAssets(chapters: OutlineContainer[], assetMap: Map<string, string>): OutlineContainer[] {
  const swap = (value: unknown) => typeof value === 'string' && assetMap.has(value) ? assetMap.get(value)! : undefined;
  return chapters.map(container => ({
    ...container,
    thumbnail: container.thumbnail?.assetId ? { ...container.thumbnail, assetId: swap(container.thumbnail.assetId) ?? '' } : container.thumbnail,
    lessons: container.lessons.map(item => ({
      ...item,
      blocks: Array.isArray(item.blocks) ? item.blocks.flatMap((block: any) => {
        if (!block?.assetId && !block?.captionsAssetId) return [block];
        const assetId = block.assetId ? swap(block.assetId) : undefined;
        if (block.assetId && !assetId) return [];
        const captionsAssetId = block.captionsAssetId ? swap(block.captionsAssetId) : undefined;
        return [{ ...block, ...(assetId ? { assetId } : {}), ...(captionsAssetId ? { captionsAssetId } : { captionsAssetId: undefined }) }];
      }) : item.blocks,
    })),
  }));
}

/** Progress (0–100) over published content only, so hidden or deleted items never skew the percentage. */
export function progressPercent(chapters: OutlineContainer[], completedIds: Iterable<string> = []) {
  const countable = countableItems(chapters);
  if (!countable.length) return 0;
  const completed = new Set(completedIds);
  return Math.round(countable.filter(item => completed.has(item.id)).length / countable.length * 100);
}
