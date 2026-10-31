import crypto from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { Course } from './model.js';
import { ContentVersion } from './version.model.js';
import { CONTENT_FIELDS, contentSnapshot, isLive, quizChanged, workingCopy, type ContentSnapshot } from './publication.js';
import { findItem, plainOutline, visibilityOf, type OutlineItem } from './structure.js';

type Origin = 'manual' | 'scheduled' | 'visibility';
const revisionFilter = (revision: number) => revision === 0 ? { $in: [0, null] } : revision;
const itemPath = (field: string) => `chapters.$[].lessons.$[l].${field}`;

async function archive(courseId: unknown, itemId: string, version: number, snapshot: ContentSnapshot, origin: Origin | 'legacy', actorId?: string) {
  try {
    await ContentVersion.create({
      courseId, itemId, version, title: String(snapshot.title || ''), snapshot, quizId: (snapshot.quiz as { id?: string } | undefined)?.id || '',
      publishedAt: new Date(), publishedBy: actorId || null, origin,
    });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

/**
 * Publishes the working copy of an item atomically: the course document switches from the previous published fields to the new
 * ones in a single update guarded by the item revision, so students never see a half-applied draft. The new version is archived
 * first and removed again if the guarded update loses a race.
 *
 * Assessment integrity: when the quiz changed and students already attempted the published one, the new quiz gets a new id;
 * existing attempts keep pointing to the archived version they answered.
 */
export async function publishItem(courseId: unknown, itemId: string, options: { expectedRevision?: number; actorId?: string; makeVisible?: boolean; origin?: Origin } = {}) {
  const course = await Course.findById(courseId).select('chapters title status settings').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const found = findItem(plainOutline(course.chapters), itemId);
  if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
  const item = found.item;
  const revision = Number(item.revision || 0);
  if (options.expectedRevision !== undefined && options.expectedRevision !== revision) throw new AppError(409, 'ITEM_CONFLICT');

  const next = contentSnapshot(workingCopy(item));
  if (next.type === 'link' && !next.url) throw new AppError(422, 'LINK_URL_REQUIRED');
  if (!String(next.title || '').trim()) throw new AppError(422, 'TITLE_REQUIRED');
  const previousQuiz = item.quiz as { id?: string } | undefined;
  if (previousQuiz?.id && next.quiz && quizChanged(previousQuiz, next.quiz)
    && (next.quiz as { id?: string }).id === previousQuiz.id
    && await QuizAttempt.exists({ courseId: course._id, lessonId: itemId, quizId: previousQuiz.id })) {
    next.quiz = { ...(next.quiz as object), id: `quiz_${crypto.randomUUID().slice(0, 8)}` };
  }

  const current = Number(item.publishedVersion || 0);
  // Content that was live before versioning existed is archived as version 0 the first time it is replaced.
  if (current === 0 && isLive(item)) await archive(course._id, itemId, 0, contentSnapshot(item), 'legacy');
  const version = current + 1;
  if (!await archive(course._id, itemId, version, next, options.origin || 'manual', options.actorId)) throw new AppError(409, 'ITEM_CONFLICT');

  const now = new Date();
  const set: Record<string, unknown> = { [itemPath('publishedVersion')]: version, [itemPath('publishedAt')]: now, [itemPath('publishedBy')]: options.actorId || null };
  const unset: Record<string, ''> = { [itemPath('draft')]: '', [itemPath('scheduledPublishAt')]: '' };
  for (const field of CONTENT_FIELDS) {
    if (next[field] !== undefined) set[itemPath(field)] = next[field];
    else if (item[field] !== undefined) unset[itemPath(field)] = '';
  }
  if (options.makeVisible !== false) set[itemPath('visibility')] = 'visible';
  const result = await Course.updateOne(
    { _id: course._id, chapters: { $elemMatch: { lessons: { $elemMatch: { id: itemId, revision: revisionFilter(revision) } } } } },
    { $set: set, $unset: unset, $inc: { [itemPath('revision')]: 1 } },
    { arrayFilters: [{ 'l.id': itemId }] },
  );
  if (result.matchedCount === 0) {
    await ContentVersion.deleteOne({ courseId: course._id, itemId, version });
    throw new AppError(409, 'ITEM_CONFLICT');
  }
  const becameVisible = options.makeVisible !== false && visibilityOf(item) === 'hidden' && visibilityOf(found.container) === 'visible';
  return { course, item, version, becameVisible, title: String(next.title || item.title) };
}

/** Plans the publication of the working copy. The background job publishes it when due; `null` cancels the plan. */
export async function schedulePublication(courseId: unknown, itemId: string, at: Date | null, expectedRevision: number) {
  const update = at ? { $set: { [itemPath('scheduledPublishAt')]: at }, $inc: { [itemPath('revision')]: 1 } } : { $unset: { [itemPath('scheduledPublishAt')]: '' }, $inc: { [itemPath('revision')]: 1 } };
  const result = await Course.updateOne(
    { _id: courseId, chapters: { $elemMatch: { lessons: { $elemMatch: { id: itemId, revision: revisionFilter(expectedRevision) } } } } },
    update, { arrayFilters: [{ 'l.id': itemId }] },
  );
  if (result.matchedCount === 0) throw new AppError(409, 'ITEM_CONFLICT');
}

/** Drops pending changes; students were never affected by them. */
export async function discardDraft(courseId: unknown, itemId: string, expectedRevision: number) {
  const result = await Course.updateOne(
    { _id: courseId, chapters: { $elemMatch: { lessons: { $elemMatch: { id: itemId, revision: revisionFilter(expectedRevision) } } } } },
    { $unset: { [itemPath('draft')]: '', [itemPath('scheduledPublishAt')]: '' }, $inc: { [itemPath('revision')]: 1 } },
    { arrayFilters: [{ 'l.id': itemId }] },
  );
  if (result.matchedCount === 0) throw new AppError(409, 'ITEM_CONFLICT');
}

/**
 * Items made visible from the outline (visibility toggle, batch) for the first time are published as version 1, so the history is
 * complete. Their content is unchanged: a never-published item has no separate draft.
 */
export async function recordFirstPublications(courseId: unknown, items: OutlineItem[], actorId: string) {
  for (const item of items) {
    if (Number(item.publishedVersion || 0) > 0 || item.visibility !== 'hidden') continue;
    if (await archive(courseId, item.id, 1, contentSnapshot(workingCopy(item)), 'visibility', actorId)) {
      await Course.updateOne({ _id: courseId }, { $set: { [itemPath('publishedVersion')]: 1, [itemPath('publishedAt')]: new Date(), [itemPath('publishedBy')]: actorId } }, { arrayFilters: [{ 'l.id': item.id, 'l.publishedVersion': { $in: [0, null] } }] });
    }
  }
}

/**
 * Background job: publishes every working copy whose planned time has passed. Safe with several API instances: each publication
 * is guarded by the item revision, so a concurrent run fails with ITEM_CONFLICT and is ignored.
 */
export async function publishDueItems(now = new Date(), onPublished?: (course: any, title: string) => Promise<void>) {
  const courses = await Course.find({ 'chapters.lessons.scheduledPublishAt': { $lte: now } }).select('_id chapters').limit(100).lean();
  let published = 0;
  for (const course of courses) {
    const due = plainOutline(course.chapters).flatMap(container => container.lessons)
      .filter(item => item.scheduledPublishAt && new Date(item.scheduledPublishAt as string).getTime() <= now.getTime());
    for (const item of due) {
      try {
        const result = await publishItem(course._id, item.id, { expectedRevision: Number(item.revision || 0), origin: 'scheduled' });
        published += 1;
        if (result.becameVisible && onPublished) await onPublished(result.course, result.title).catch(() => undefined);
      } catch (error) {
        if ((error as AppError).code === 'ITEM_CONFLICT') continue;
        // An invalid working copy (e.g. a link without URL) is not retried every minute: the plan is cancelled and the author
        // sees the item back in "pending changes".
        console.error('Scheduled publication failed', { code: (error as AppError).code || (error as Error).name });
        await Course.updateOne({ _id: course._id }, { $unset: { [itemPath('scheduledPublishAt')]: '' } }, { arrayFilters: [{ 'l.id': item.id }] }).catch(() => undefined);
      }
    }
  }
  return published;
}
