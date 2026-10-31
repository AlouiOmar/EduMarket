import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { CourseAsset } from './assets.model.js';
import { getManageableCourse } from './assets.routes.js';
import { blockAssetIds } from './blocks.js';
import { Course } from './model.js';
import { contentSnapshot, isLive, workingCopy } from './publication.js';
import { isPrimaryCourseManager, manageableCourseFilter } from './service.js';
import { MAX_ITEMS_PER_CONTAINER, cloneItem, newOutlineId, plainOutline, remapAssets, renumber, type OutlineContainer, type OutlineItem } from './structure.js';
import { duplicateCourse } from './structure.routes.js';
import { contentHash, diffTemplate, type TemplateLink, type TemplateLinkItem } from './templates.js';

/**
 * Templates and class instances. A template is an ordinary course flagged `isTemplate`; instances are full independent copies
 * (own content, dates, students, assessments, grades, groups). Template changes reach an instance only through an explicit,
 * per-item synchronization that never overwrites a local adaptation unless the author chooses so, and lands in the instance
 * item's draft when that item is already published (students keep seeing the published version).
 */
export const courseTemplateRoutes = Router();
const managers = [authenticate, allowRoles('teacher', 'institution', 'admin')];
const actorOf = (req: AuthRequest) => ({ userId: req.auth!.userId, role: req.auth!.role });
const toDate = (value: unknown) => value === null || value === undefined ? null : new Date(value as string);
const reviveDates = (chapters: OutlineContainer[]) => chapters.map(container => ({
  ...container, availableFrom: toDate(container.availableFrom), availableUntil: toDate(container.availableUntil),
  lessons: container.lessons.map(item => ({ ...item, availableFrom: toDate(item.availableFrom), availableUntil: toDate(item.availableUntil), ...(item.scheduledPublishAt ? { scheduledPublishAt: toDate(item.scheduledPublishAt) } : {}) })),
}));

courseTemplateRoutes.patch('/:courseId/template', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { isTemplate } = z.object({ isTemplate: z.boolean() }).strict().parse(req.body);
    const course = await getManageableCourse(req, req.params.courseId);
    if (!await isPrimaryCourseManager(actorOf(req), course.teacherId)) throw new AppError(403, 'COURSE_OWNER_REQUIRED');
    const full = await Course.findById(course._id).select('templateLink').lean();
    if (isTemplate && full?.templateLink) throw new AppError(409, 'INSTANCE_CANNOT_BE_TEMPLATE');
    await Course.updateOne({ _id: course._id }, { $set: { isTemplate } });
    res.json({ success: true, data: { id: String(course._id), isTemplate } });
  } catch (error) { next(error); }
});

const instanceSchema = z.object({
  title: z.string().trim().min(3).max(160), courseCode: z.string().trim().max(40).optional(),
  startsAt: z.union([z.null(), z.coerce.date()]).optional(), endsAt: z.union([z.null(), z.coerce.date()]).optional(),
}).strict().refine(value => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, 'INVALID_COURSE_DATES');

/** Creates an independent class instance from a template (private draft, hidden content, no student data). */
courseTemplateRoutes.post('/:courseId/instances', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = instanceSchema.parse(req.body);
    const template = await getManageableCourse(req, req.params.courseId);
    const full = await Course.findById(template._id).select('isTemplate settings').lean();
    if (!full?.isTemplate) throw new AppError(409, 'NOT_A_TEMPLATE');
    const { created, report } = await duplicateCourse(req, template._id, {
      title: input.title, courseCode: input.courseCode, asInstance: true,
      settings: { ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}), ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}) },
    });
    res.status(201).json({ success: true, data: { id: String(created._id), title: created.title, report } });
  } catch (error) { next(error); }
});

/** Instances of a template that the actor manages. */
courseTemplateRoutes.get('/:courseId/instances', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const template = await getManageableCourse(req, req.params.courseId);
    const filter = await manageableCourseFilter(actorOf(req));
    const instances = await Course.find({ $and: [filter, { 'templateLink.templateId': template._id }] }).select('title courseCode status accessState studentsCount settings templateLink.syncedAt createdAt').sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: instances.map(instance => ({
      id: String(instance._id), title: instance.title, courseCode: instance.courseCode, status: instance.status, accessState: instance.accessState, studentsCount: instance.studentsCount,
      startsAt: instance.settings?.startsAt ?? null, endsAt: instance.settings?.endsAt ?? null, syncedAt: (instance.templateLink as any)?.syncedAt ?? null,
    })) });
  } catch (error) { next(error); }
});

async function instanceAndTemplate(req: AuthRequest) {
  const managed = await getManageableCourse(req, req.params.courseId);
  const instance = await Course.findById(managed._id).select('title chapters structureVersion templateLink').lean();
  const link = instance?.templateLink as TemplateLink | undefined;
  if (!instance || !link?.templateId) throw new AppError(409, 'NOT_AN_INSTANCE');
  // Reading the template requires managing it too (a coordinator copying a colleague's template, for instance).
  const template = await getManageableCourse(req, String(link.templateId)).catch(() => null);
  if (!template) throw new AppError(404, 'TEMPLATE_NOT_FOUND');
  const full = await Course.findById(template._id).select('title chapters').lean();
  return { instance, link, template: full! };
}

/** What changed since the instance was created / last synchronized, item by item. */
courseTemplateRoutes.get('/:courseId/template-diff', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const { instance, link, template } = await instanceAndTemplate(req);
    const rows = diffTemplate(plainOutline(template.chapters), plainOutline(instance.chapters), link);
    res.json({ success: true, data: { template: { id: String(template._id), title: template.title }, syncedAt: link.syncedAt, structureVersion: instance.structureVersion || 0, rows } });
  } catch (error) { next(error); }
});

/** Copies the course assets referenced by template content into the instance and returns the id map. */
async function copyReferencedAssets(templateId: unknown, instanceId: unknown, items: OutlineItem[], actorId: string) {
  const ids = [...new Set(items.flatMap(item => blockAssetIds(item.blocks)))].filter(id => /^[a-f\d]{24}$/i.test(id));
  const assets = await CourseAsset.find({ courseId: templateId, _id: { $in: ids } }).lean();
  const map = new Map<string, string>();
  for (const asset of assets) {
    const { _id, createdAt, updatedAt, ...rest } = asset as any;
    map.set(String(_id), String((await CourseAsset.create({ ...rest, courseId: instanceId, lessonId: '', uploadedBy: actorId }))._id));
  }
  return map;
}

const syncSchema = z.object({
  expectedVersion: z.number().int().min(0),
  items: z.array(z.object({ templateItemId: z.string().min(1).max(100), action: z.enum(['update', 'add']), overwriteLocal: z.boolean().default(false) }).strict()).min(1).max(500),
}).strict();

/**
 * Applies selected template changes. `update` refuses locally modified items unless `overwriteLocal` is set for that item;
 * published instance items receive the change as a draft. `add` inserts the new template item hidden. Student data (enrollments,
 * grades, submissions, attempts, posts) is never touched. One guarded document update: all selected changes or none.
 */
courseTemplateRoutes.post('/:courseId/template-sync', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const input = syncSchema.parse(req.body);
    const { instance, link, template } = await instanceAndTemplate(req);
    const templateChapters = plainOutline(template.chapters);
    const chapters = plainOutline(instance.chapters);
    const rows = diffTemplate(templateChapters, chapters, link);
    const templateItems = new Map(templateChapters.flatMap(container => container.lessons.map(item => [item.id, { item, container }] as const)));
    const linkItems: TemplateLinkItem[] = link.items.map(entry => ({ ...entry }));
    const applied: Array<{ templateItemId: string; action: string }> = [];
    const toCopy = input.items.map(entry => templateItems.get(entry.templateItemId)?.item).filter((item): item is OutlineItem => !!item);
    const assetMap = await copyReferencedAssets(template._id, instance._id, toCopy, req.auth!.userId);
    const remapItem = (item: OutlineItem) => remapAssets([{ id: 'tmp', title: '', lessons: [item] }], assetMap)[0].lessons[0];

    for (const choice of input.items) {
      const row = rows.find(candidate => candidate.templateItemId === choice.templateItemId);
      const source = templateItems.get(choice.templateItemId);
      if (!row || !source) throw new AppError(404, 'TEMPLATE_ITEM_NOT_FOUND');
      if (choice.action === 'update') {
        if (row.status === 'conflict' && !choice.overwriteLocal) throw new AppError(409, 'LOCAL_CHANGES_PROTECTED');
        if (!['template_changed', 'conflict'].includes(row.status)) throw new AppError(409, 'NOTHING_TO_UPDATE');
        const entry = linkItems.find(candidate => candidate.templateItemId === choice.templateItemId)!;
        const container = chapters.find(candidate => candidate.lessons.some(item => item.id === entry.instanceItemId))!;
        const index = container.lessons.findIndex(item => item.id === entry.instanceItemId);
        const current = container.lessons[index];
        const incoming = contentSnapshot(remapItem({ ...workingCopy(source.item), id: current.id, chapterId: container.id }));
        // Keep the instance quiz id: attempts of this class stay attached to their quiz (publication assigns a new id if needed).
        if (incoming.quiz && current.quiz) incoming.quiz = { ...(incoming.quiz as object), id: (workingCopy(current).quiz as { id?: string })?.id || (current.quiz as { id?: string }).id };
        const updated: OutlineItem = isLive(current)
          ? { ...current, draft: { ...incoming, updatedAt: new Date().toISOString(), updatedBy: req.auth!.userId }, revision: Number(current.revision || 0) + 1 }
          : { ...current, ...incoming, title: String(incoming.title ?? current.title), revision: Number(current.revision || 0) + 1 } as OutlineItem;
        container.lessons[index] = updated;
        entry.templateHash = contentHash(source.item);
        entry.instanceHash = contentHash(updated);
      } else {
        if (row.status !== 'added_in_template') throw new AppError(409, 'NOTHING_TO_ADD');
        const mapped = linkItems.find(candidate => candidate.templateContainerId === source.container.id)?.instanceContainerId;
        let target = chapters.find(container => container.id === mapped);
        if (!target) {
          target = chapters.find(container => container.title === source.container.title) ?? undefined;
          if (!target) {
            target = { id: newOutlineId('chap'), kind: 'folder', title: source.container.title, description: '', visibility: 'hidden', sequential: false, availableFrom: null, availableUntil: null, thumbnail: { assetId: '', alt: '' }, lessons: [] };
            chapters.push(target);
          }
        }
        if (target.lessons.length >= MAX_ITEMS_PER_CONTAINER) throw new AppError(409, 'CONTAINER_FULL');
        const copy = remapItem(cloneItem(source.item, target.id));
        target.lessons.push(copy);
        linkItems.push({ templateItemId: source.item.id, instanceItemId: copy.id, templateContainerId: source.container.id, instanceContainerId: target.id, templateHash: contentHash(source.item), instanceHash: contentHash(copy) });
      }
      applied.push({ templateItemId: choice.templateItemId, action: choice.action });
    }
    const expected = input.expectedVersion === 0 ? { $in: [0, null] } : input.expectedVersion;
    const result = await Course.findOneAndUpdate({ _id: instance._id, structureVersion: expected }, {
      $set: { chapters: reviveDates(renumber(chapters)), templateLink: { templateId: link.templateId, syncedAt: new Date(), items: linkItems } }, $inc: { structureVersion: 1 },
    }, { new: true }).select('_id structureVersion').lean();
    if (!result) throw new AppError(409, 'STRUCTURE_CONFLICT');
    await AuditEvent.create({ action: 'course.instance.synchronized', actorId: req.auth!.userId, targetType: 'course', targetId: String(instance._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data: { applied, structureVersion: result.structureVersion } });
  } catch (error) { next(error); }
});
