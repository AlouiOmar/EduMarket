import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Course } from '../courses/model.js';
import { Category } from './model.js';

export const adminCategoryRoutes = Router();
adminCategoryRoutes.use(authenticate, allowRoles('admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const names = z.object({ fr: z.string().trim().min(2).max(100), en: z.string().trim().min(2).max(100), ar: z.string().trim().min(2).max(100) }).strict();
const createSchema = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), names, active: z.boolean().default(true), order: z.number().int().min(0).max(1000).default(0) }).strict();
const updateSchema = z.object({ names: names.optional(), active: z.boolean().optional(), order: z.number().int().min(0).max(1000).optional() }).strict().refine(value => Object.keys(value).length > 0);

const categoryDto = (category: any, coursesCount = 0) => ({ id: String(category._id), slug: category.slug, names: category.names, active: category.active, order: category.order, coursesCount });

/** When the taxonomy is configured, course categories must reference an active slug; legacy free-text values stay readable. */
export async function assertCourseCategory(value: string) {
  if (!await Category.exists({})) return;
  if (!await Category.exists({ slug: value, active: true })) throw new AppError(422, 'INVALID_COURSE_CATEGORY');
}

/** Public category list: managed categories first, followed by legacy values still used by published courses. */
export async function listPublicCategories() {
  const [categories, groups] = await Promise.all([
    Category.find({ active: true }).sort({ order: 1, slug: 1 }).lean(),
    Course.aggregate<{ _id: string; coursesCount: number }>([
      { $match: { status: 'published', visibility: { $ne: 'restricted' }, category: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$category', coursesCount: { $sum: 1 } } }, { $sort: { _id: 1 } },
    ]),
  ]);
  const counts = new Map(groups.map(group => [group._id, group.coursesCount]));
  const managed = categories.map(category => ({ id: category.slug, name: category.names?.fr || category.slug, names: category.names, coursesCount: counts.get(category.slug) || 0 }));
  const managedSlugs = new Set(categories.map(category => category.slug));
  const legacy = groups.filter(group => !managedSlugs.has(group._id)).map(group => ({ id: group._id, name: group._id, names: null, coursesCount: group.coursesCount }));
  return [...managed, ...legacy];
}

adminCategoryRoutes.get('/', async (_req, res, next) => {
  try {
    const [categories, groups] = await Promise.all([
      Category.find().sort({ order: 1, slug: 1 }).lean(),
      Course.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    ]);
    const counts = new Map(groups.map(group => [group._id, group.count]));
    res.json({ success: true, data: categories.map(category => categoryDto(category, counts.get(category.slug) || 0)) });
  } catch (error) { next(error); }
});

adminCategoryRoutes.post('/', async (req: AuthRequest, res, next) => {
  try {
    const category = await Category.create(createSchema.parse(req.body));
    await AuditEvent.create({ action: 'catalog.category.created', actorId: req.auth!.userId, targetType: 'category', targetId: category.slug, severity: 'info', ipAddress: req.ip });
    res.status(201).json({ success: true, data: categoryDto(category.toObject()) });
  } catch (error) { next(error); }
});

adminCategoryRoutes.patch('/:categoryId', async (req: AuthRequest, res, next) => {
  try {
    const categoryId = objectId.safeParse(req.params.categoryId); if (!categoryId.success) throw new AppError(404, 'CATEGORY_NOT_FOUND');
    const category = await Category.findByIdAndUpdate(categoryId.data, { $set: updateSchema.parse(req.body) }, { new: true, runValidators: true }).lean();
    if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND');
    await AuditEvent.create({ action: 'catalog.category.updated', actorId: req.auth!.userId, targetType: 'category', targetId: category.slug, severity: 'info', ipAddress: req.ip });
    res.json({ success: true, data: categoryDto(category, await Course.countDocuments({ category: category.slug })) });
  } catch (error) { next(error); }
});

/** Categories in use are deactivated instead of deleted so existing course references stay valid. */
adminCategoryRoutes.delete('/:categoryId', async (req: AuthRequest, res, next) => {
  try {
    const categoryId = objectId.safeParse(req.params.categoryId); if (!categoryId.success) throw new AppError(404, 'CATEGORY_NOT_FOUND');
    const category = await Category.findById(categoryId.data);
    if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND');
    if (await Course.exists({ category: category.slug })) throw new AppError(409, 'CATEGORY_IN_USE');
    await category.deleteOne();
    await AuditEvent.create({ action: 'catalog.category.deleted', actorId: req.auth!.userId, targetType: 'category', targetId: category.slug, severity: 'warning', ipAddress: req.ip });
    res.status(204).end();
  } catch (error) { next(error); }
});
