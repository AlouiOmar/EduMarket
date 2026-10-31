import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { User } from '../auth/model.js';
import { Enrollment } from '../enrollments/model.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { Assignment, AssignmentSubmission } from '../assignments/models.js';
import { createNotification, type NotificationTemplate } from '../notifications/service.js';
import { CourseAsset } from './assets.model.js';
import { getManageableCourse } from './assets.routes.js';
import { blockAssetIds, blocksSchema } from './blocks.js';
import { toStudentCourse, withCourseAssets } from './dto.js';
import { Course } from './model.js';
import { quizSchema } from './routes.js';
import { canManageCourse, isPrimaryCourseManager, manageableCourseFilter } from './service.js';
import { courseDate } from '../../common/timezone.js';
import { ContentVersion } from './version.model.js';
import { applyDrafts, contentSnapshot, isLive, sameContent, workingCopy } from './publication.js';
import { discardDraft, publishItem, recordFirstPublications, schedulePublication } from './publication.service.js';
import { linkByPosition } from './templates.js';
import { LtiTool } from '../lti/models.js';
import { ScormPackage } from '../scorm/models.js';
import { copyAssessments } from '../assessments/service.js';
import { copyGradebookStructure } from '../gradebook/service.js';
import {
  MAX_CONTAINERS, MAX_ITEMS_PER_CONTAINER, applyMove, cloneContainer, cloneItem, findItem, newOutlineId, plainOutline, remapAssets, renumber,
  visibilityOf, type OutlineContainer, type OutlineItem,
} from './structure.js';

/**
 * Course content API ("Contenu du cours"): granular, permission-checked and persisted operations on the outline.
 *
 * Structural writes (create, move, duplicate, delete, import) replace the outline atomically in a single document update guarded
 * by `structureVersion` (optimistic locking: a stale client gets 409 STRUCTURE_CONFLICT and reloads). Content edits of one item
 * use `revision` the same way, without blocking structural changes made meanwhile by another author.
 */
export const courseStructureRoutes = Router();
const managers = [authenticate, allowRoles('teacher', 'institution', 'admin')];

const idSchema = z.string().trim().min(1).max(100);
const versionSchema = z.number().int().min(0);
// Dates are ISO instants, or local wall-clock values ("2026-11-02T08:30") read in the course time zone (see zonedDates).
const optionalDate = z.union([z.null(), z.string().trim().max(40)]).optional();
const visibilitySchema = z.enum(['hidden', 'visible']);
const webUrl = z.string().trim().max(2000).url().refine(value => /^https?:\/\//i.test(value), 'HTTP_URL_REQUIRED');
// `lti`: launch of a registered LTI 1.3 tool; `scorm`: an imported SCORM package. A plain external link stays `link`.
const itemTypes = z.enum(['text', 'video', 'link', 'interactive', 'lti', 'scorm']);
const refId = z.string().regex(/^[a-f\d]{24}$/i);
const windowIsValid = (value: { availableFrom?: Date | null; availableUntil?: Date | null }) => !value.availableFrom || !value.availableUntil || value.availableFrom < value.availableUntil;

const actorOf = (req: AuthRequest) => ({ userId: req.auth!.userId, role: req.auth!.role, ip: req.ip });

/** Converts the date fields of a validated input to instants, using the course time zone for local values. */
function zonedDates<T extends Record<string, unknown>>(input: T, zone: string | null | undefined, keys: string[] = ['availableFrom', 'availableUntil']) {
  const output: Record<string, unknown> = { ...input };
  for (const key of keys) {
    try { if (key in output) output[key] = courseDate(output[key], zone); } catch { throw new AppError(400, 'INVALID_DATE'); }
  }
  return output as Omit<T, 'availableFrom' | 'availableUntil'> & { availableFrom?: Date | null; availableUntil?: Date | null };
}
const toDate = (value: unknown) => value === null || value === undefined ? null : new Date(value as string);

/** Dates of items live in a Mixed array: keep them as BSON dates after JSON-based cloning. */
const reviveDates = (chapters: OutlineContainer[]) => chapters.map(container => ({
  ...container, availableFrom: toDate(container.availableFrom), availableUntil: toDate(container.availableUntil),
  lessons: container.lessons.map(item => ({ ...item, availableFrom: toDate(item.availableFrom), availableUntil: toDate(item.availableUntil) })),
}));

async function outlineResponse(courseId: unknown) {
  const [course, assets] = await Promise.all([Course.findById(courseId).lean(), CourseAsset.find({ courseId }).lean()]);
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const resolved = withCourseAssets(course, assets);
  return { structureVersion: course.structureVersion || 0, chapters: resolved.chapters };
}

/** Atomically replaces the outline when nobody changed it since `expectedVersion`. */
export async function commitOutline(courseId: unknown, expectedVersion: number, chapters: OutlineContainer[]) {
  const updated = await Course.findOneAndUpdate(
    { _id: courseId, structureVersion: expectedVersion === 0 ? { $in: [0, null] } : expectedVersion },
    { $set: { chapters: reviveDates(renumber(chapters)) }, $inc: { structureVersion: 1 } },
    { new: true, runValidators: true },
  ).select('_id');
  if (!updated) {
    if (!await Course.exists({ _id: courseId })) throw new AppError(404, 'COURSE_NOT_FOUND');
    throw new AppError(409, 'STRUCTURE_CONFLICT');
  }
  return outlineResponse(courseId);
}

export async function loadOutline(req: AuthRequest) {
  const course = await getManageableCourse(req, req.params.courseId);
  const full = await Course.findById(course._id).select('chapters structureVersion title status settings teacherId coOwnerIds').lean();
  if (!full) throw new AppError(404, 'COURSE_NOT_FOUND');
  return { course: full, chapters: plainOutline(full.chapters) };
}

/** Block, thumbnail and banner media must be assets of this course of the right kind. */
async function assertCourseAssets(courseId: unknown, references: Array<{ id: string; kinds: string[] }>) {
  if (!references.length) return;
  const assets = await CourseAsset.find({ courseId, _id: { $in: references.map(reference => reference.id) } }).select('kind').lean();
  for (const reference of references) {
    const asset = assets.find(candidate => String(candidate._id) === reference.id);
    if (!asset || !reference.kinds.includes(asset.kind)) throw new AppError(422, 'INVALID_COURSE_ASSET_REFERENCE');
  }
}

const blockReferences = (blocks: Array<Record<string, unknown>>) => blocks.flatMap(block => {
  const references: Array<{ id: string; kinds: string[] }> = [];
  if (block.type === 'image' && typeof block.assetId === 'string') references.push({ id: block.assetId, kinds: ['image'] });
  if (block.type === 'video' && typeof block.assetId === 'string') references.push({ id: block.assetId, kinds: ['block_video', 'video'] });
  if (block.type === 'video' && typeof block.captionsAssetId === 'string') references.push({ id: block.captionsAssetId, kinds: ['caption'] });
  if (block.type === 'file' && typeof block.assetId === 'string') references.push({ id: block.assetId, kinds: ['block_file', 'resource'] });
  return references;
});

/** Tells enrolled students that new content is visible (course published, notifications enabled). Best effort. */
export async function notifyPublication(course: any, published: { title: string } | { count: number }) {
  if (course.status !== 'published' || course.settings?.notifyStudents === false) return;
  const studentIds = await Enrollment.find({ courseId: course._id }).limit(1000).distinct('studentId');
  const message = 'title' in published ? `"${published.title}" is now available in "${course.title}".` : `${published.count} new element(s) are available in "${course.title}".`;
  const template: NotificationTemplate = 'title' in published
    ? { key: 'courseContentPublished', params: { course: course.title, item: published.title } }
    : { key: 'courseContentPublishedMany', params: { course: course.title, count: published.count } };
  await Promise.allSettled(studentIds.map(studentId => createNotification({ userId: String(studentId), type: 'course', title: 'New course content', message, link: `/learning/${course._id}`, template })));
}

/** An LTI item must point to an active registered tool; a SCORM item to a valid package of the same course. */
async function assertActivityReferences(courseId: unknown, item: OutlineItem) {
  if (item.type === 'lti' && !await LtiTool.exists({ _id: item.ltiToolId, status: 'active' })) throw new AppError(422, 'LTI_TOOL_NOT_FOUND');
  if (item.type === 'scorm' && !await ScormPackage.exists({ _id: item.scormPackageId, courseId })) throw new AppError(422, 'SCORM_PACKAGE_NOT_FOUND');
}

const insertAt = <T>(list: T[], index: number | undefined, value: T) => {
  const position = index === undefined ? list.length : Math.min(Math.max(index, 0), list.length);
  list.splice(position, 0, value);
};

// --- Containers (learning modules and folders) -----------------------------------------------------------------------------

const containerCreateSchema = z.object({
  expectedVersion: versionSchema, kind: z.enum(['module', 'folder']), title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000).default(''), index: z.number().int().min(0).optional(),
}).strict();

courseStructureRoutes.post('/:courseId/structure/containers', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = containerCreateSchema.parse(req.body);
    const { course, chapters } = await loadOutline(req);
    if (chapters.length >= MAX_CONTAINERS) throw new AppError(409, 'COURSE_STRUCTURE_LIMIT');
    const container: OutlineContainer = { id: newOutlineId('chap'), kind: input.kind, title: input.title, description: input.description, visibility: 'hidden', sequential: false, availableFrom: null, availableUntil: null, thumbnail: { assetId: '', alt: '' }, lessons: [] };
    insertAt(chapters, input.index, container);
    res.status(201).json({ success: true, data: { ...await commitOutline(course._id, input.expectedVersion, chapters), createdId: container.id } });
  } catch (error) { next(error); }
});

const containerPatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(), description: z.string().trim().max(4000).optional(),
  kind: z.enum(['module', 'folder']).optional(), visibility: visibilitySchema.optional(),
  availableFrom: optionalDate, availableUntil: optionalDate, sequential: z.boolean().optional(),
  thumbnail: z.object({ assetId: z.union([z.literal(''), z.string().regex(/^[a-f\d]{24}$/i)]), alt: z.string().trim().max(300).default('') }).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required');

/** Settings of one container (no structural change: no version required, last write wins per field). */
courseStructureRoutes.patch('/:courseId/structure/containers/:containerId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const raw = containerPatchSchema.parse(req.body);
    const containerId = idSchema.parse(req.params.containerId);
    const { course, chapters } = await loadOutline(req);
    const input = zonedDates(raw, course.settings?.timezone);
    // Same contract as before time zones: an inconsistent window in the request itself is a validation error (400).
    if (!windowIsValid(input)) throw new AppError(400, 'VALIDATION_ERROR');
    const existing = chapters.find(container => container.id === containerId);
    if (!existing) throw new AppError(404, 'CONTAINER_NOT_FOUND');
    if (input.thumbnail?.assetId) await assertCourseAssets(course._id, [{ id: input.thumbnail.assetId, kinds: ['image'] }]);
    if (input.thumbnail && input.thumbnail.assetId && !input.thumbnail.alt) throw new AppError(422, 'IMAGE_ALT_REQUIRED');
    const nextFrom = input.availableFrom !== undefined ? input.availableFrom : toDate(existing.availableFrom);
    const nextUntil = input.availableUntil !== undefined ? input.availableUntil : toDate(existing.availableUntil);
    if (!windowIsValid({ availableFrom: nextFrom, availableUntil: nextUntil })) throw new AppError(422, 'INVALID_AVAILABILITY_WINDOW');
    const set = Object.fromEntries(Object.entries(input).map(([key, value]) => [`chapters.$[c].${key}`, value]));
    await Course.updateOne({ _id: course._id }, { $set: set }, { arrayFilters: [{ 'c.id': containerId }], runValidators: true });
    if (input.visibility === 'visible' && visibilityOf(existing) === 'hidden') {
      await recordFirstPublications(course._id, existing.lessons, req.auth!.userId).catch(() => undefined);
      await notifyPublication(course, { title: input.title || existing.title });
    }
    res.json({ success: true, data: await outlineResponse(course._id) });
  } catch (error) { next(error); }
});

courseStructureRoutes.delete('/:courseId/structure/containers/:containerId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const expectedVersion = versionSchema.parse(Number(req.query.expectedVersion));
    const containerId = idSchema.parse(req.params.containerId);
    const { course, chapters } = await loadOutline(req);
    const index = chapters.findIndex(container => container.id === containerId);
    if (index < 0) throw new AppError(404, 'CONTAINER_NOT_FOUND');
    const [removed] = chapters.splice(index, 1);
    const data = await commitOutline(course._id, expectedVersion, chapters);
    await AuditEvent.create({ action: 'course.content.container_deleted', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// --- Items (documents, videos, links, interactive pages) ------------------------------------------------------------------

const itemCreateSchema = z.object({
  expectedVersion: versionSchema, containerId: idSchema, index: z.number().int().min(0).optional(),
  type: itemTypes, title: z.string().trim().min(1).max(240), url: webUrl.optional(), ltiToolId: refId.optional(), scormPackageId: refId.optional(),
}).strict().refine(value => value.type !== 'link' || !!value.url, 'LINK_URL_REQUIRED')
  .refine(value => value.type !== 'lti' || !!value.ltiToolId, 'LTI_TOOL_REQUIRED').refine(value => value.type !== 'scorm' || !!value.scormPackageId, 'SCORM_PACKAGE_REQUIRED');

courseStructureRoutes.post('/:courseId/structure/items', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = itemCreateSchema.parse(req.body);
    const { course, chapters } = await loadOutline(req);
    const container = chapters.find(candidate => candidate.id === input.containerId);
    if (!container) throw new AppError(422, 'INVALID_DESTINATION');
    if (container.lessons.length >= MAX_ITEMS_PER_CONTAINER) throw new AppError(409, 'CONTAINER_FULL');
    const item: OutlineItem = {
      id: newOutlineId('les'), chapterId: container.id, title: input.title, type: input.type, description: '', durationMinutes: 0,
      visibility: 'hidden', availableFrom: null, availableUntil: null, resources: [], commentsCount: 0, revision: 0,
      blocks: input.type === 'text' ? [{ id: newOutlineId('blk'), type: 'text', html: '' }] : [],
      ...(input.type === 'link' ? { url: input.url, openInNewTab: true } : {}),
      ...(input.type === 'lti' ? { ltiToolId: input.ltiToolId } : {}),
      ...(input.type === 'scorm' ? { scormPackageId: input.scormPackageId } : {}),
    };
    await assertActivityReferences(course._id, item);
    insertAt(container.lessons, input.index, item);
    res.status(201).json({ success: true, data: { ...await commitOutline(course._id, input.expectedVersion, chapters), createdId: item.id } });
  } catch (error) { next(error); }
});

const itemPatchSchema = z.object({
  expectedRevision: z.number().int().min(0).optional(),
  title: z.string().trim().min(1).max(240).optional(), description: z.string().trim().max(4000).optional(),
  type: itemTypes.optional(), durationMinutes: z.number().int().min(0).max(10000).optional(),
  url: webUrl.optional(), openInNewTab: z.boolean().optional(), ltiToolId: refId.optional(), scormPackageId: refId.optional(),
  blocks: blocksSchema.optional(), quiz: z.union([z.null(), quizSchema]).optional(),
  visibility: visibilitySchema.optional(), availableFrom: optionalDate, availableUntil: optionalDate,
}).strict();
const CONTENT_FIELDS = ['title', 'description', 'type', 'durationMinutes', 'url', 'openInNewTab', 'blocks', 'quiz', 'ltiToolId', 'scormPackageId'] as const;

/**
 * Updates one item. Content fields require `expectedRevision` (concurrent editors cannot silently overwrite each other) and bump
 * the revision; publication fields (visibility, dates) can be changed alone from the outline without it.
 */
courseStructureRoutes.patch('/:courseId/structure/items/:itemId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const raw = itemPatchSchema.parse(req.body);
    const itemId = idSchema.parse(req.params.itemId);
    const { course, chapters } = await loadOutline(req);
    const input = zonedDates(raw, course.settings?.timezone);
    const found = findItem(chapters, itemId);
    if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
    const contentChange = CONTENT_FIELDS.some(field => input[field] !== undefined);
    if (contentChange && input.expectedRevision === undefined) throw new AppError(400, 'EXPECTED_REVISION_REQUIRED');
    const working = workingCopy(found.item);
    const nextType = input.type ?? working.type;
    if (nextType === 'link' && !(input.url ?? working.url)) throw new AppError(422, 'LINK_URL_REQUIRED');
    const nextFrom = input.availableFrom !== undefined ? input.availableFrom : toDate(found.item.availableFrom);
    const nextUntil = input.availableUntil !== undefined ? input.availableUntil : toDate(found.item.availableUntil);
    if (!windowIsValid({ availableFrom: nextFrom, availableUntil: nextUntil })) throw new AppError(422, 'INVALID_AVAILABILITY_WINDOW');
    if (input.blocks) await assertCourseAssets(course._id, blockReferences(input.blocks as Array<Record<string, unknown>>));
    if (input.ltiToolId || input.scormPackageId || input.type) await assertActivityReferences(course._id, { ...working, ...input } as OutlineItem);

    const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
    // A live item (visible, or published before) keeps its published content: edits go to its draft until published.
    const toDraft = contentChange && isLive(found.item);
    for (const [key, value] of Object.entries(input)) {
      if (key === 'expectedRevision' || value === undefined) continue;
      if (toDraft && (CONTENT_FIELDS as readonly string[]).includes(key)) continue;
      if (key === 'quiz' && value === null) unset['chapters.$[].lessons.$[l].quiz'] = '';
      else set[`chapters.$[].lessons.$[l].${key}`] = value;
    }
    if (toDraft) {
      const changes = Object.fromEntries(CONTENT_FIELDS.filter(field => input[field] !== undefined).map(field => [field, input[field]]));
      const draft = contentSnapshot({ ...working, ...changes });
      if (input.quiz === null) delete draft.quiz;
      // Back to the published content: nothing is pending anymore.
      if (sameContent(draft, contentSnapshot(found.item))) unset['chapters.$[].lessons.$[l].draft'] = '';
      else set['chapters.$[].lessons.$[l].draft'] = { ...draft, updatedAt: new Date(), updatedBy: req.auth!.userId };
    }
    const filter: Record<string, unknown> = { 'l.id': itemId };
    if (contentChange) filter['l.revision'] = input.expectedRevision === 0 ? { $in: [0, null] } : input.expectedRevision;
    const update: Record<string, unknown> = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}), ...(contentChange ? { $inc: { 'chapters.$[].lessons.$[l].revision': 1 } } : {}) };
    if (!Object.keys(update).length) throw new AppError(400, 'VALIDATION_ERROR');
    // The revision guard is part of the document query: `modifiedCount` cannot be trusted since timestamps always change.
    const itemQuery = { id: itemId, ...(contentChange ? { revision: filter['l.revision'] } : {}) };
    const result = await Course.updateOne({ _id: course._id, chapters: { $elemMatch: { lessons: { $elemMatch: itemQuery } } } }, update, { arrayFilters: [filter] });
    if (result.matchedCount === 0) {
      const current = findItem(plainOutline((await Course.findById(course._id).select('chapters').lean())?.chapters), itemId);
      if (!current) throw new AppError(404, 'ITEM_NOT_FOUND');
      throw new AppError(409, 'ITEM_CONFLICT');
    }
    if (input.visibility === 'visible' && visibilityOf(found.item) === 'hidden') {
      await recordFirstPublications(course._id, [found.item], req.auth!.userId).catch(() => undefined);
      if (visibilityOf(found.container) === 'visible') await notifyPublication(course, { title: found.item.title });
    }
    const outline = await outlineResponse(course._id);
    const item = outline.chapters.flatMap((container: any) => container.lessons).find((candidate: any) => candidate.id === itemId);
    res.json({ success: true, data: { ...outline, item } });
  } catch (error) { next(error); }
});

courseStructureRoutes.delete('/:courseId/structure/items/:itemId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const expectedVersion = versionSchema.parse(Number(req.query.expectedVersion));
    const itemId = idSchema.parse(req.params.itemId);
    const { course, chapters } = await loadOutline(req);
    const found = findItem(chapters, itemId);
    if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
    found.container.lessons.splice(found.itemIndex, 1);
    const data = await commitOutline(course._id, expectedVersion, chapters);
    await AuditEvent.create({ action: 'course.content.item_deleted', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

// --- Drafts, publication and versions ---------------------------------------------------------------------------------------

const publishSchema = z.object({
  expectedRevision: z.number().int().min(0),
  // Absent or past: publish now. Future (ISO instant or local time in the course time zone): planned publication.
  publishAt: z.union([z.null(), z.string().trim().max(40)]).optional(),
  makeVisible: z.boolean().default(true),
}).strict();

/** Publishes the working copy now, or plans it ("Publication planifiée"). */
courseStructureRoutes.post('/:courseId/structure/items/:itemId/publish', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = publishSchema.parse(req.body);
    const itemId = idSchema.parse(req.params.itemId);
    const { course, chapters } = await loadOutline(req);
    if (!findItem(chapters, itemId)) throw new AppError(404, 'ITEM_NOT_FOUND');
    let publishAt: Date | null | undefined;
    try { publishAt = courseDate(input.publishAt, course.settings?.timezone); } catch { throw new AppError(400, 'INVALID_DATE'); }
    if (publishAt && publishAt.getTime() > Date.now() + 30_000) {
      await schedulePublication(course._id, itemId, publishAt, input.expectedRevision);
      await AuditEvent.create({ action: 'course.content.publication_scheduled', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    } else {
      const result = await publishItem(course._id, itemId, { expectedRevision: input.expectedRevision, actorId: req.auth!.userId, makeVisible: input.makeVisible });
      await AuditEvent.create({ action: 'course.content.published', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
      if (result.becameVisible) await notifyPublication(course, { title: result.title });
    }
    const outline = await outlineResponse(course._id);
    res.json({ success: true, data: { ...outline, item: outline.chapters.flatMap((container: any) => container.lessons).find((candidate: any) => candidate.id === itemId) } });
  } catch (error) { next(error); }
});

/** Cancels a planned publication (the draft stays). */
courseStructureRoutes.delete('/:courseId/structure/items/:itemId/schedule', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const expectedRevision = versionSchema.parse(Number(req.query.expectedRevision));
    const itemId = idSchema.parse(req.params.itemId);
    const { course, chapters } = await loadOutline(req);
    if (!findItem(chapters, itemId)) throw new AppError(404, 'ITEM_NOT_FOUND');
    await schedulePublication(course._id, itemId, null, expectedRevision);
    res.json({ success: true, data: await outlineResponse(course._id) });
  } catch (error) { next(error); }
});

/** Discards pending changes of a published item. */
courseStructureRoutes.delete('/:courseId/structure/items/:itemId/draft', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const expectedRevision = versionSchema.parse(Number(req.query.expectedRevision));
    const itemId = idSchema.parse(req.params.itemId);
    const { course, chapters } = await loadOutline(req);
    if (!findItem(chapters, itemId)) throw new AppError(404, 'ITEM_NOT_FOUND');
    await discardDraft(course._id, itemId, expectedRevision);
    const outline = await outlineResponse(course._id);
    res.json({ success: true, data: { ...outline, item: outline.chapters.flatMap((container: any) => container.lessons).find((candidate: any) => candidate.id === itemId) } });
  } catch (error) { next(error); }
});

/** Published versions of an item (newest first), for authorized authors only. */
courseStructureRoutes.get('/:courseId/structure/items/:itemId/versions', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const itemId = idSchema.parse(req.params.itemId);
    const course = await getManageableCourse(req, req.params.courseId);
    const versions = await ContentVersion.find({ courseId: course._id, itemId }).sort({ version: -1 }).limit(200).populate('publishedBy', 'name').lean();
    res.json({ success: true, data: versions.map(version => ({
      version: version.version, title: version.title, publishedAt: version.publishedAt, origin: version.origin,
      publishedBy: (version.publishedBy as any)?.name || '', snapshot: version.snapshot,
    })) });
  } catch (error) { next(error); }
});

/** Copies an archived version into the draft (history is never rewritten; publishing the draft creates a new version). */
courseStructureRoutes.post('/:courseId/structure/items/:itemId/versions/:version/restore', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { expectedRevision } = z.object({ expectedRevision: z.number().int().min(0) }).strict().parse(req.body);
    const itemId = idSchema.parse(req.params.itemId);
    const versionNumber = z.coerce.number().int().min(0).parse(req.params.version);
    const { course, chapters } = await loadOutline(req);
    const found = findItem(chapters, itemId);
    if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
    const archived = await ContentVersion.findOne({ courseId: course._id, itemId, version: versionNumber }).lean();
    if (!archived) throw new AppError(404, 'VERSION_NOT_FOUND');
    const snapshot = contentSnapshot(archived.snapshot as Record<string, unknown>);
    // The restored quiz keeps the current quiz id only if it is the same quiz; otherwise publishing assigns a new id when needed.
    const update = isLive(found.item)
      ? { $set: { 'chapters.$[].lessons.$[l].draft': { ...snapshot, updatedAt: new Date(), updatedBy: req.auth!.userId } } }
      : { $set: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [`chapters.$[].lessons.$[l].${key}`, value])) };
    const revision = Number(found.item.revision || 0);
    if (expectedRevision !== revision) throw new AppError(409, 'ITEM_CONFLICT');
    const result = await Course.updateOne(
      { _id: course._id, chapters: { $elemMatch: { lessons: { $elemMatch: { id: itemId, revision: revision === 0 ? { $in: [0, null] } : revision } } } } },
      { ...update, $inc: { 'chapters.$[].lessons.$[l].revision': 1 } }, { arrayFilters: [{ 'l.id': itemId }] },
    );
    if (result.matchedCount === 0) throw new AppError(409, 'ITEM_CONFLICT');
    const outline = await outlineResponse(course._id);
    res.json({ success: true, data: { ...outline, item: outline.chapters.flatMap((container: any) => container.lessons).find((candidate: any) => candidate.id === itemId) } });
  } catch (error) { next(error); }
});

// --- Reordering, duplication, batch visibility -------------------------------------------------------------------------------

const moveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('container'), id: idSchema, toIndex: z.number().int().min(0), expectedVersion: versionSchema }).strict(),
  z.object({ type: z.literal('item'), id: idSchema, toContainerId: idSchema, toIndex: z.number().int().min(0), expectedVersion: versionSchema }).strict(),
]);

/** Moves a container, or an item within/between containers. Ids, permissions, destination and position are checked server-side. */
courseStructureRoutes.post('/:courseId/structure/move', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = moveSchema.parse(req.body);
    const { course, chapters } = await loadOutline(req);
    const { expectedVersion, ...move } = input;
    res.json({ success: true, data: await commitOutline(course._id, expectedVersion, applyMove(chapters, move)) });
  } catch (error) { next(error); }
});

courseStructureRoutes.post('/:courseId/structure/containers/:containerId/duplicate', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { expectedVersion, titleSuffix } = z.object({ expectedVersion: versionSchema, titleSuffix: z.string().max(40).default(' (copie)') }).strict().parse(req.body);
    const { course, chapters } = await loadOutline(req);
    const index = chapters.findIndex(container => container.id === req.params.containerId);
    if (index < 0) throw new AppError(404, 'CONTAINER_NOT_FOUND');
    if (chapters.length >= MAX_CONTAINERS) throw new AppError(409, 'COURSE_STRUCTURE_LIMIT');
    const copy = cloneContainer(chapters[index], { titleSuffix });
    chapters.splice(index + 1, 0, copy);
    res.status(201).json({ success: true, data: { ...await commitOutline(course._id, expectedVersion, chapters), createdId: copy.id } });
  } catch (error) { next(error); }
});

courseStructureRoutes.post('/:courseId/structure/items/:itemId/duplicate', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { expectedVersion, titleSuffix } = z.object({ expectedVersion: versionSchema, titleSuffix: z.string().max(40).default(' (copie)') }).strict().parse(req.body);
    const { course, chapters } = await loadOutline(req);
    const found = findItem(chapters, idSchema.parse(req.params.itemId));
    if (!found) throw new AppError(404, 'ITEM_NOT_FOUND');
    if (found.container.lessons.length >= MAX_ITEMS_PER_CONTAINER) throw new AppError(409, 'CONTAINER_FULL');
    const copy = cloneItem(found.item, found.container.id, { titleSuffix });
    found.container.lessons.splice(found.itemIndex + 1, 0, copy);
    res.status(201).json({ success: true, data: { ...await commitOutline(course._id, expectedVersion, chapters), createdId: copy.id } });
  } catch (error) { next(error); }
});

const batchSchema = z.object({
  containerIds: z.array(idSchema).max(MAX_CONTAINERS).default([]), itemIds: z.array(idSchema).max(2000).default([]),
  visibility: visibilitySchema.optional(), availableFrom: optionalDate, availableUntil: optionalDate,
}).strict().refine(value => value.containerIds.length + value.itemIds.length > 0, 'SELECTION_REQUIRED')
  .refine(value => value.visibility !== undefined || value.availableFrom !== undefined || value.availableUntil !== undefined, 'CHANGE_REQUIRED');

/** Batch change of visibility and/or availability dates ("Modification par lot"). */
courseStructureRoutes.post('/:courseId/structure/batch', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const raw = batchSchema.parse(req.body);
    const { course, chapters } = await loadOutline(req);
    const input = zonedDates(raw, course.settings?.timezone);
    if (!windowIsValid(input)) throw new AppError(400, 'VALIDATION_ERROR');
    const known = new Set([...chapters.map(container => container.id), ...chapters.flatMap(container => container.lessons.map(item => item.id))]);
    if ([...input.containerIds, ...input.itemIds].some(id => !known.has(id))) throw new AppError(404, 'ITEM_NOT_FOUND');
    const fields = Object.entries({ visibility: input.visibility, availableFrom: input.availableFrom, availableUntil: input.availableUntil }).filter(([, value]) => value !== undefined);
    const set: Record<string, unknown> = {};
    const arrayFilters: Record<string, unknown>[] = [];
    if (input.containerIds.length) { fields.forEach(([key, value]) => { set[`chapters.$[c].${key}`] = value; }); arrayFilters.push({ 'c.id': { $in: input.containerIds } }); }
    if (input.itemIds.length) { fields.forEach(([key, value]) => { set[`chapters.$[].lessons.$[l].${key}`] = value; }); arrayFilters.push({ 'l.id': { $in: input.itemIds } }); }
    await Course.updateOne({ _id: course._id }, { $set: set }, { arrayFilters });
    if (input.visibility === 'visible') {
      const firstTime = chapters.flatMap(container => input.containerIds.includes(container.id) ? container.lessons : container.lessons.filter(item => input.itemIds.includes(item.id)));
      await recordFirstPublications(course._id, firstTime, req.auth!.userId).catch(() => undefined);
      const published = chapters.filter(container => input.containerIds.includes(container.id) && visibilityOf(container) === 'hidden').length
        + chapters.flatMap(container => container.lessons).filter(item => input.itemIds.includes(item.id) && visibilityOf(item) === 'hidden').length;
      if (published) await notifyPublication(course, { count: published });
    }
    res.json({ success: true, data: await outlineResponse(course._id) });
  } catch (error) { next(error); }
});

/** What an enrolled student without progress would see now ("Aperçu étudiant"). Read-only. */
courseStructureRoutes.get('/:courseId/student-preview', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const managed = await getManageableCourse(req, req.params.courseId);
    const [course, assets] = await Promise.all([Course.findById(managed._id).populate('teacherId', 'name').lean(), CourseAsset.find({ courseId: managed._id }).lean()]);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const completedIds = z.array(idSchema).max(2000).default([]).parse(typeof req.query.completed === 'string' && req.query.completed ? req.query.completed.split(',') : []);
    // `draft=true`: what students will see once every pending draft is published (teachers only, never served to students).
    const source = req.query.draft === 'true' ? { ...course, chapters: applyDrafts(plainOutline(course.chapters)) } : course;
    const preview = toStudentCourse(source, assets, completedIds);
    res.json({ success: true, data: { ...preview, chapters: course.accessState === 'private' ? [] : preview.chapters } });
  } catch (error) { next(error); }
});

// --- Copy, import, export, archive -----------------------------------------------------------------------------------------

/**
 * Copies containers (whole) and/or loose items from a source course the actor manages into `target`. Copies arrive hidden, keep
 * order, descriptions, blocks, quizzes and settings; assets are duplicated as new records sharing the stored file (never student
 * data: enrollments, submissions, attempts, Q&A and reviews are not touched). Returns the copied outline and a per-element report.
 */
async function copyContent(source: any, targetChapters: OutlineContainer[], targetCourseId: unknown, actorId: string, selection: { containerIds?: string[]; itemIds?: string[]; targetContainerId?: string }) {
  const report = { copiedContainers: 0, copiedItems: 0, copiedAssets: 0, skipped: [] as Array<{ id: string; title: string; reason: string }> };
  const sourceChapters = plainOutline(source.chapters);
  const wholeCourse = !selection.containerIds?.length && !selection.itemIds?.length;
  const containers = wholeCourse ? sourceChapters : sourceChapters.filter(container => selection.containerIds?.includes(container.id));
  const looseItems = wholeCourse ? [] : sourceChapters.flatMap(container => container.lessons)
    .filter(item => selection.itemIds?.includes(item.id) && !containers.some(container => container.lessons.some(candidate => candidate.id === item.id)));
  for (const id of [...(selection.containerIds || []), ...(selection.itemIds || [])]) {
    if (!sourceChapters.some(container => container.id === id || container.lessons.some(item => item.id === id))) report.skipped.push({ id, title: '', reason: 'NOT_FOUND' });
  }

  const lessonIdMap = new Map<string, string>();
  const newContainers = containers.map(container => {
    const copy = cloneContainer(container);
    container.lessons.forEach((item, index) => lessonIdMap.set(item.id, copy.lessons[index].id));
    return copy;
  });
  // Loose items go into the chosen existing container, or into a new hidden folder.
  const existingTarget = looseItems.length ? targetChapters.find(container => container.id === selection.targetContainerId) : undefined;
  let looseTarget = existingTarget;
  if (looseItems.length && !looseTarget) {
    looseTarget = { id: newOutlineId('chap'), kind: 'folder', title: `Contenu copié de « ${source.title} »`.slice(0, 240), description: '', visibility: 'hidden', sequential: false, availableFrom: null, availableUntil: null, thumbnail: { assetId: '', alt: '' }, lessons: [] };
    newContainers.push(looseTarget);
  }
  for (const item of looseItems) {
    if (looseTarget!.lessons.length >= MAX_ITEMS_PER_CONTAINER) { report.skipped.push({ id: item.id, title: item.title, reason: 'CONTAINER_FULL' }); continue; }
    const copy = cloneItem(item, looseTarget!.id);
    lessonIdMap.set(item.id, copy.id);
    looseTarget!.lessons.push(copy);
  }
  if (targetChapters.length + newContainers.length > MAX_CONTAINERS) throw new AppError(409, 'COURSE_STRUCTURE_LIMIT');

  // Assets: block/thumbnail media referenced by the copied content, and legacy lesson media of the copied lessons.
  const referenced = new Set<string>([
    ...containers.map(container => container.thumbnail?.assetId).filter((value): value is string => !!value),
    ...[...containers.flatMap(container => container.lessons), ...looseItems].flatMap(item => blockAssetIds(item.blocks)),
  ]);
  const sourceAssets = await CourseAsset.find({ courseId: source._id, $or: [{ _id: { $in: [...referenced].filter(id => /^[a-f\d]{24}$/i.test(id)) } }, { lessonId: { $in: [...lessonIdMap.keys()] } }] }).lean();
  const assetMap = new Map<string, string>();
  for (const asset of sourceAssets) {
    try {
      const { _id, createdAt, updatedAt, ...rest } = asset as any;
      const created = await CourseAsset.create({ ...rest, courseId: targetCourseId, lessonId: asset.lessonId ? lessonIdMap.get(asset.lessonId) || '' : '', uploadedBy: actorId });
      assetMap.set(String(_id), String(created._id));
      report.copiedAssets += 1;
    } catch { report.skipped.push({ id: String(asset._id), title: asset.originalName, reason: 'ASSET_COPY_FAILED' }); }
  }
  // Only copied content is remapped: asset ids already present in the target course stay untouched.
  const remappedNew = remapAssets(newContainers.filter(container => container !== existingTarget), assetMap);
  const remappedTarget = existingTarget ? remapAssets([{ ...existingTarget, thumbnail: { assetId: '', alt: '' }, lessons: existingTarget.lessons.filter(item => [...lessonIdMap.values()].includes(item.id)) }], assetMap)[0] : undefined;
  const chapters = targetChapters.map(container => container !== existingTarget || !remappedTarget ? container : {
    ...container, lessons: container.lessons.map(item => remappedTarget.lessons.find(copy => copy.id === item.id) ?? item),
  });
  report.copiedContainers = remappedNew.length;
  report.copiedItems = lessonIdMap.size;
  return { chapters: [...chapters, ...remappedNew], report };
}

const importSchema = z.object({
  expectedVersion: versionSchema, sourceCourseId: z.string().regex(/^[a-f\d]{24}$/i),
  containerIds: z.array(idSchema).max(MAX_CONTAINERS).default([]), itemIds: z.array(idSchema).max(2000).default([]),
  targetContainerId: idSchema.optional(),
}).strict();

/** "Copier le contenu" from another course the actor manages (whole course or selected containers/items). */
courseStructureRoutes.post('/:courseId/structure/import', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = importSchema.parse(req.body);
    const { course, chapters } = await loadOutline(req);
    if (input.sourceCourseId === String(course._id)) throw new AppError(422, 'SAME_COURSE');
    const source = await Course.findById(input.sourceCourseId).select('title chapters teacherId coOwnerIds').lean();
    if (!source || !await canManageCourse(actorOf(req), source.teacherId, source.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    const { chapters: merged, report } = await copyContent(source, chapters, course._id, req.auth!.userId, input);
    const data = await commitOutline(course._id, input.expectedVersion, merged);
    await AuditEvent.create({ action: 'course.content.imported', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data: { ...data, report } });
  } catch (error) { next(error); }
});

/** Courses the actor can copy from (title + outline summary), for the "Copier le contenu" dialog. */
courseStructureRoutes.get('/:courseId/structure/sources', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const filter = await manageableCourseFilter(actorOf(req));
    const courses = await Course.find({ ...filter, _id: { $ne: course._id } }).sort({ updatedAt: -1 }).limit(100).select('title courseCode chapters.id chapters.title chapters.kind chapters.lessons.id chapters.lessons.title chapters.lessons.type').lean();
    res.json({ success: true, data: courses.map(source => ({ id: String(source._id), title: source.title, courseCode: source.courseCode || '', chapters: source.chapters })) });
  } catch (error) { next(error); }
});

export const packageSchema = z.object({
  format: z.literal('edumarket-course'), version: z.union([z.literal(1), z.literal(2)]),
  chapters: z.array(z.object({
    title: z.string().trim().min(1).max(240), kind: z.enum(['module', 'folder']).default('module'), description: z.string().max(4000).default(''), sequential: z.boolean().default(false),
    lessons: z.array(z.object({
      title: z.string().trim().min(1).max(240), type: itemTypes.default('text'), description: z.string().max(4000).default(''),
      durationMinutes: z.number().int().min(0).max(10000).default(0), url: webUrl.optional(), textContent: z.string().max(20000).optional(),
      blocks: z.array(z.record(z.string(), z.unknown())).max(100).default([]), quiz: quizSchema.optional(),
    })).max(MAX_ITEMS_PER_CONTAINER),
  })).max(MAX_CONTAINERS),
}).passthrough();

/** Imports an exported package (structure, texts, code, embeds, quizzes). Files are not part of a package and are reported as skipped. */
/**
 * Builds hidden containers/items from a package. Blocks referring to a file are kept only when the file was imported with the
 * package (`assetMap`: package asset id → new course asset id); otherwise they are dropped and reported.
 */
export function importedChapters(pkg: z.infer<typeof packageSchema>, assetMap: Map<string, string> = new Map()) {
  const skipped: Array<{ id: string; title: string; reason: string }> = [];
  const remap = (value: unknown) => typeof value === 'string' ? assetMap.get(value) : undefined;
  const imported = pkg.chapters.map(chapter => {
      const containerId = newOutlineId('chap');
      return {
        id: containerId, kind: chapter.kind, title: chapter.title, description: chapter.description, sequential: chapter.sequential, visibility: 'hidden' as const,
        availableFrom: null, availableUntil: null, thumbnail: { assetId: '', alt: '' },
        lessons: chapter.lessons.map(lesson => {
          const kept = lesson.blocks.flatMap(block => {
            if (!block.assetId && !block.captionsAssetId) return [block];
            const assetId = remap(block.assetId);
            if (block.assetId && !assetId) return [];
            const captionsAssetId = remap(block.captionsAssetId);
            return [{ ...block, ...(assetId ? { assetId } : {}), captionsAssetId: captionsAssetId || undefined }];
          });
          if (kept.length !== lesson.blocks.length) skipped.push({ id: '', title: lesson.title, reason: 'FILES_NOT_IN_PACKAGE' });
          const blocks = blocksSchema.safeParse(kept.map(block => ({ ...block, id: newOutlineId('blk') })));
          if (!blocks.success) skipped.push({ id: '', title: lesson.title, reason: 'INVALID_BLOCKS' });
          if (lesson.type === 'link' && !lesson.url) skipped.push({ id: '', title: lesson.title, reason: 'LINK_URL_REQUIRED' });
          return {
            id: newOutlineId('les'), chapterId: containerId, title: lesson.title, type: lesson.type === 'link' && !lesson.url ? 'text' : lesson.type,
            description: lesson.description, durationMinutes: lesson.durationMinutes, ...(lesson.url ? { url: lesson.url, openInNewTab: true } : {}),
            ...(lesson.textContent ? { textContent: lesson.textContent } : {}), ...(lesson.quiz ? { quiz: lesson.quiz } : {}),
            blocks: blocks.success ? blocks.data : [], visibility: 'hidden' as const, availableFrom: null, availableUntil: null, resources: [], commentsCount: 0, revision: 0,
          };
        }),
      };
    });
  return { imported, skipped };
}

courseStructureRoutes.post('/:courseId/structure/import-package', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { expectedVersion, package: pkg } = z.object({ expectedVersion: versionSchema, package: packageSchema }).strict().parse(req.body);
    const { course, chapters } = await loadOutline(req);
    if (chapters.length + pkg.chapters.length > MAX_CONTAINERS) throw new AppError(409, 'COURSE_STRUCTURE_LIMIT');
    const { imported, skipped } = importedChapters(pkg);
    const data = await commitOutline(course._id, expectedVersion, [...chapters, ...imported]);
    res.json({ success: true, data: { ...data, report: { copiedContainers: imported.length, copiedItems: imported.reduce((count, chapter) => count + chapter.lessons.length, 0), copiedAssets: 0, skipped } } });
  } catch (error) { next(error); }
});

export const exportPackage = (course: any, assets: any[]) => ({
  format: 'edumarket-course', version: 1, exportedAt: new Date().toISOString(),
  course: { title: course.title, subtitle: course.subtitle, description: course.description, courseCode: course.courseCode || '', category: course.category, level: course.level, tags: course.tags, settings: course.settings, syllabus: course.syllabus, prerequisites: course.prerequisites, learningOutcomes: course.learningOutcomes },
  // Working copies (latest authoring state), without publication bookkeeping.
  chapters: applyDrafts(plainOutline(course.chapters)).map(({ _id, ...chapter }) => ({
    ...chapter, lessons: chapter.lessons.map(({ draft, scheduledPublishAt, publishedVersion, publishedAt, publishedBy, ...item }) => item),
  })),
  assets: assets.map(asset => ({ id: String(asset._id), kind: asset.kind, name: asset.originalName, mimeType: asset.mimeType, size: asset.size, lessonId: asset.lessonId || '' })),
});

/** Teaching package (structure and content, file manifest, no student data). */
courseStructureRoutes.get('/:courseId/export', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const managed = await getManageableCourse(req, req.params.courseId);
    const [course, assets] = await Promise.all([Course.findById(managed._id).lean(), CourseAsset.find({ courseId: managed._id }).lean()]);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="course-${course._id}-export.json"`, 'Cache-Control': 'no-store' })
      .send(JSON.stringify(exportPackage(course, assets), null, 2));
  } catch (error) { next(error); }
});

/**
 * End-of-session archive: the teaching package plus, on explicit request, student records (progress, quiz scores, assignment grades).
 * Student data is restricted to the primary manager (owner, owning institution, admin) and every archive is audited.
 */
courseStructureRoutes.get('/:courseId/archive', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const managed = await getManageableCourse(req, req.params.courseId);
    const includeStudentData = req.query.includeStudentData === 'true';
    if (includeStudentData && !await isPrimaryCourseManager(actorOf(req), managed.teacherId)) throw new AppError(403, 'COURSE_OWNER_REQUIRED');
    const [course, assets] = await Promise.all([Course.findById(managed._id).lean(), CourseAsset.find({ courseId: managed._id }).lean()]);
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    let students: unknown[] | undefined;
    if (includeStudentData) {
      const [enrollments, attempts, assignments] = await Promise.all([
        Enrollment.find({ courseId: course._id }).populate('studentId', 'name email').lean(),
        QuizAttempt.find({ courseId: course._id }).select('studentId lessonId score passed createdAt').lean(),
        Assignment.find({ courseId: course._id }).select('title points dueAt').lean(),
      ]);
      const submissions = await AssignmentSubmission.find({ assignmentId: { $in: assignments.map(assignment => assignment._id) } }).select('assignmentId studentId status score submittedAt gradedAt').lean();
      students = enrollments.map(enrollment => {
        const student = enrollment.studentId as any, studentId = String(student?._id || enrollment.studentId);
        return {
          name: student?.name || '', email: student?.email || '', accessType: enrollment.accessType, enrolledAt: enrollment.enrolledAt, completedAt: enrollment.completedAt,
          completedLessonIds: enrollment.completedLessonIds,
          quizAttempts: attempts.filter(attempt => String(attempt.studentId) === studentId).map(({ lessonId, score, passed, createdAt }) => ({ lessonId, score, passed, createdAt })),
          assignments: submissions.filter(submission => String(submission.studentId) === studentId).map(submission => ({
            assignment: assignments.find(assignment => String(assignment._id) === String(submission.assignmentId))?.title || '', status: submission.status, score: submission.score ?? null, submittedAt: submission.submittedAt, gradedAt: submission.gradedAt ?? null,
          })),
        };
      });
    }
    await AuditEvent.create({ action: includeStudentData ? 'course.archive.with_student_data' : 'course.archive', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip, severity: includeStudentData ? 'warning' : 'info' }).catch(() => undefined);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="course-${course._id}-archive.json"`, 'Cache-Control': 'no-store' })
      .send(JSON.stringify({ ...exportPackage(course, assets), archive: { createdAt: new Date().toISOString(), includeStudentData, ...(students ? { students } : {}) } }, null, 2));
  } catch (error) { next(error); }
});

/** Duplicates a whole course into a new private draft owned by the actor (an admin keeps the source owner). Student data is never copied. */
/**
 * Duplicates a whole course into a new private draft owned by the actor (an admin keeps the source owner): outline (working copies,
 * hidden), media, assessments (banks, tests, rubrics, forms) and the gradebook structure (categories, manual columns).
 * Never copied: enrollments, grades, submissions, attempts, responses, groups, posts, journals, attendance.
 * `template`: the copy becomes a class instance linked to its template (see templates.ts).
 */
export async function duplicateCourse(req: AuthRequest, sourceId: unknown, options: { title?: string; courseCode?: string; settings?: Record<string, unknown>; asInstance?: boolean } = {}) {
  const source = await Course.findById(sourceId).lean();
  if (!source) throw new AppError(404, 'COURSE_NOT_FOUND');
  if (req.auth!.role === 'teacher' && !await User.exists({ _id: req.auth!.userId, verified: true })) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
  const ownerId = req.auth!.role === 'admin' ? source.teacherId : req.auth!.userId;
  const copyTitle = (options.title || `${source.title} (copie)`).slice(0, 160);
  const slug = `${copyTitle.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const created = await Course.create({
    title: copyTitle, slug, subtitle: source.subtitle, description: source.description, category: source.category, level: source.level,
    price: source.price, tags: source.tags, hasCertification: source.hasCertification, certificationPathway: source.certificationPathway,
    prerequisites: source.prerequisites, learningOutcomes: source.learningOutcomes, visibility: source.visibility,
    teacherId: ownerId, coOwnerIds: req.auth!.role === 'admin' ? source.coOwnerIds : [], status: 'draft', accessState: 'private',
    courseCode: options.courseCode ?? source.courseCode, settings: { ...(source.settings || {}), ...(options.settings || {}) }, syllabus: source.syllabus, copiedFrom: source._id, chapters: [],
    isTemplate: false,
  });
  try {
    const { chapters, report } = await copyContent(source, [], created._id, req.auth!.userId, {});
    let bannerAssetId = '';
    if (source.banner?.assetId) {
      const banner = await CourseAsset.findOne({ _id: source.banner.assetId, courseId: source._id }).lean();
      if (banner) {
        const { _id, createdAt, updatedAt, ...rest } = banner as any;
        bannerAssetId = String((await CourseAsset.create({ ...rest, courseId: created._id, uploadedBy: req.auth!.userId }))._id);
      }
    }
    const finalChapters = reviveDates(renumber(chapters));
    const templateLink = options.asInstance ? { templateId: source._id, syncedAt: new Date(), items: linkByPosition(plainOutline(source.chapters), plainOutline(finalChapters)) } : undefined;
    await Course.updateOne({ _id: created._id }, { $set: { chapters: finalChapters, banner: { assetId: bannerAssetId, alt: source.banner?.alt || '' }, ...(templateLink ? { templateLink } : {}) }, $inc: { structureVersion: 1 } });
    const assessments = await copyAssessments(source._id, created._id);
    await copyGradebookStructure(source._id, created._id);
    await AuditEvent.create({ action: options.asInstance ? 'course.instance.created' : 'course.copied', actorId: req.auth!.userId, targetType: 'course', targetId: String(created._id), ipAddress: req.ip }).catch(() => undefined);
    return { created, report: { ...report, copiedBanks: assessments.banks, copiedQuestions: assessments.questions } };
  } catch (error) {
    await Promise.all([Course.deleteOne({ _id: created._id }), CourseAsset.deleteMany({ courseId: created._id })]).catch(() => undefined);
    throw error;
  }
}

/** Duplicates a whole course ("Dupliquer le cours"). Student data is never copied. */
courseStructureRoutes.post('/:courseId/copy', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { title } = z.object({ title: z.string().trim().min(3).max(160).optional() }).strict().parse(req.body ?? {});
    const managed = await getManageableCourse(req, req.params.courseId);
    const { created, report } = await duplicateCourse(req, managed._id, { title });
    res.status(201).json({ success: true, data: { id: String(created._id), title: created.title, report } });
  } catch (error) { next(error); }
});
