import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, optionalAuthenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { isValidTimeZone } from '../../common/timezone.js';
import { Course } from './model.js';
import { User } from '../auth/model.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { toPublicCourse, toStudentCourse } from './dto.js';
import { withCourseAssets } from './dto.js';
import { CourseAsset } from './assets.model.js';
import { canManageCourse, isPrimaryCourseManager, manageableCourseFilter, submitCourseForReview } from './service.js';
import { AuditEvent } from '../admin/audit.model.js';
import { createNotification } from '../notifications/service.js';
import { assertCourseCategory, listPublicCategories } from '../categories/routes.js';
import { PUBLIC_COURSE_FILTER, canViewRestrictedCourse } from '../classes/service.js';

export const courseRoutes = Router();
const quizQuestionSchema = z.object({ id: z.string().min(1).max(100), question: z.string().min(1).max(2000), options: z.array(z.string().min(1).max(500)).min(2).max(10), correctOptionIndex: z.number().int().min(0).max(9), explanation: z.string().max(2000).default('') }).refine(question => question.correctOptionIndex < question.options.length, 'Correct answer must reference an option');
const optionalDate = z.union([z.null(), z.coerce.date()]);
export const quizSchema = z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(240), durationMinutes: z.number().int().min(1).max(600), passPercentage: z.number().min(0).max(100), questions: z.array(quizQuestionSchema).min(1).max(100) });
const lessonSchema = z.object({ id: z.string().max(100), title: z.string().max(240), chapterId: z.string().max(100), durationMinutes: z.number().int().min(0).max(10000), type: z.enum(['video', 'text', 'interactive', 'link', 'lti', 'scorm']), url: z.string().trim().max(2000).url().refine(value => /^https?:\/\//i.test(value)).optional(), videoUrl: z.string().max(2000).optional(), textContent: z.string().max(20000).optional(), resources: z.array(z.record(z.string(), z.unknown())).max(50).default([]), commentsCount: z.number().int().min(0).default(0), quiz: quizSchema.optional() });
const chapterSchema = z.object({ id: z.string().max(100), title: z.string().trim().min(1).max(240), order: z.number().int().min(0), lessons: z.array(lessonSchema).max(100) });
const createSchema = z.object({ title: z.string().trim().min(3).max(160), subtitle: z.string().max(240).optional(), description: z.string().min(1).max(12000), category: z.string().min(1).max(100), level: z.enum(['beginner', 'intermediate', 'advanced']).optional(), price: z.number().min(0).max(1000000).optional(), status: z.enum(['draft', 'published']).optional(), chapters: z.array(chapterSchema).max(100).optional(), hasCertification: z.boolean().optional(), certificationPathway: z.enum(['learning_and_quiz', 'online_exam', 'in_person_exam', 'both']).optional(), prerequisites: z.array(z.string().max(300)).max(30).optional(), learningOutcomes: z.array(z.string().max(300)).max(30).optional(), tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(15).transform(tags => [...new Set(tags)]).optional(), visibility: z.enum(['public', 'restricted']).optional(),
  courseCode: z.string().trim().max(40).optional(), accessState: z.enum(['open', 'private', 'completed']).optional(),
  settings: z.object({ language: z.enum(['fr', 'en', 'ar']).default('fr'), startsAt: optionalDate.default(null), endsAt: optionalDate.default(null), notifyStudents: z.boolean().default(true), timezone: z.union([z.null(), z.string().max(64).refine(isValidTimeZone, 'INVALID_TIMEZONE')]).default(null) })
    .refine(value => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, 'INVALID_COURSE_DATES').optional(),
  syllabus: z.array(z.object({ id: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(240), description: z.string().trim().max(2000).default(''), startsAt: z.coerce.date(), durationMinutes: z.number().int().min(0).max(1440).default(90) })).max(200).optional(),
  banner: z.object({ assetId: z.union([z.literal(''), z.string().regex(/^[a-f\d]{24}$/i)]), alt: z.string().trim().max(300).default('') }).refine(value => !value.assetId || value.alt.length > 0, 'IMAGE_ALT_REQUIRED').optional() });
const PRESERVED_CONTAINER_FIELDS = ['kind', 'description', 'visibility', 'availableFrom', 'availableUntil', 'sequential', 'thumbnail'];
const PRESERVED_ITEM_FIELDS = ['blocks', 'visibility', 'availableFrom', 'availableUntil', 'description', 'url', 'openInNewTab', 'revision', 'draft', 'publishedVersion', 'publishedAt', 'publishedBy', 'scheduledPublishAt'];
/** The legacy whole-curriculum save does not know the newer outline fields: keep them for containers and items it still contains. */
function mergeLegacyChapters(incoming: Array<Record<string, any>>, existing: Array<Record<string, any>>) {
  const keep = (target: Record<string, any>, source: Record<string, any> | undefined, fields: string[]) => {
    if (!source) return target;
    const preserved = Object.fromEntries(fields.filter(field => target[field] === undefined && source[field] !== undefined).map(field => [field, source[field]]));
    return { ...preserved, ...target };
  };
  const existingItems = existing.flatMap(chapter => chapter.lessons || []);
  return incoming.map((chapter, index) => ({
    ...keep(chapter, existing.find(candidate => candidate.id === chapter.id), PRESERVED_CONTAINER_FIELDS), order: index,
    lessons: chapter.lessons.map((lesson: Record<string, any>) => ({ ...keep(lesson, existingItems.find(candidate => candidate.id === lesson.id), PRESERVED_ITEM_FIELDS), chapterId: chapter.id })),
  }));
}
const updateSchema = createSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
const slugify = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
courseRoutes.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const query: Record<string, unknown> = { ...PUBLIC_COURSE_FILTER };
    if (typeof req.query.category === 'string') query.category = req.query.category;
    if (typeof req.query.level === 'string') {
      const level = z.enum(['beginner', 'intermediate', 'advanced']).safeParse(req.query.level);
      if (!level.success) throw new AppError(400, 'INVALID_COURSE_FILTER');
      query.level = level.data;
    }
    if (req.query.price === 'free') query.price = 0;
    else if (req.query.price === 'paid') query.price = { $gt: 0 };
    else if (req.query.price && req.query.price !== 'all') throw new AppError(400, 'INVALID_COURSE_FILTER');
    if (typeof req.query.tag === 'string' && req.query.tag.trim()) query.tags = req.query.tag.trim().toLowerCase().slice(0, 40);
    if (typeof req.query.search === 'string' && req.query.search.trim()) query.$text = { $search: req.query.search.trim().slice(0, 100) };
    const sortBy = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const sortOptions = {
      popular: { studentsCount: -1, createdAt: -1 }, rating: { rating: -1, createdAt: -1 },
      newest: { createdAt: -1 }, price_asc: { price: 1 }, price_desc: { price: -1 },
    } as const;
    if (!Object.hasOwn(sortOptions, sortBy)) throw new AppError(400, 'INVALID_COURSE_FILTER');
    const sort = sortOptions[sortBy as keyof typeof sortOptions];
    const [data, total] = await Promise.all([Course.find(query).sort(sort).skip((page - 1) * limit).limit(limit).populate('teacherId', 'name').lean(), Course.countDocuments(query)]);
    res.json({ success: true, data: data.map(toPublicCourse), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

courseRoutes.get('/mine', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const query = await manageableCourseFilter({ userId: req.auth!.userId, role: req.auth!.role });
    const data = await Course.find(query).sort({ updatedAt: -1 }).populate('teacherId', 'name').lean();
    res.json({ success: true, data, total: data.length });
  } catch (error) { next(error); }
});

courseRoutes.get('/mine/:id', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const course = await Course.findById(req.params.id).populate('teacherId', 'name').lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const actor = { userId: req.auth!.userId, role: req.auth!.role }, ownerId = (course.teacherId as any)._id || course.teacherId;
    if (!await canManageCourse(actor, ownerId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    const canManageCommercial = await isPrimaryCourseManager(actor, ownerId);
    const [assets, coOwners] = await Promise.all([CourseAsset.find({ courseId: course._id }).lean(), User.find({ _id: { $in: course.coOwnerIds || [] } }).select('name email').lean()]);
    res.json({ success: true, data: { ...withCourseAssets(course, assets), canManageCommercial, coOwners: coOwners.map(user => ({ id: String(user._id), name: user.name, email: user.email })) } });
  } catch (error) { next(error); }
});

courseRoutes.get('/categories', async (_req, res, next) => {
  try { res.json({ success: true, data: await listPublicCategories() }); }
  catch (error) { next(error); }
});

courseRoutes.get('/:id', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const routeId = String(req.params.id);
    const course = await Course.findOne({ $or: [{ _id: routeId.match(/^[0-9a-f]{24}$/i) ? routeId : null }, { slug: routeId }], status: 'published' }).populate('teacherId', 'name').lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    // Restricted courses only exist for class members, course managers and admins.
    if (course.visibility === 'restricted' && !await canViewRestrictedCourse(req.auth ? { userId: req.auth.userId, role: req.auth.role } : undefined, { _id: course._id, teacherId: (course.teacherId as any)?._id || course.teacherId, coOwnerIds: course.coOwnerIds })) throw new AppError(404, 'COURSE_NOT_FOUND');
    const enrollment = req.auth?.status !== 'suspended' && req.auth?.role === 'student' ? await Enrollment.findOne(activeAccess({ studentId: req.auth.userId, courseId: course._id })).select('completedLessonIds').lean() : null;
    // A private course keeps its catalogue page but hides its content from enrolled students.
    if (!enrollment || course.accessState === 'private') return res.json({ success: true, data: { ...toPublicCourse(course), ...(enrollment ? { enrolled: true } : {}) } });
    const assets = await CourseAsset.find({ courseId: course._id }).lean();
    res.json({ success: true, data: toStudentCourse(course, assets, enrollment.completedLessonIds) });
  } catch (error) { next(error); }
});

courseRoutes.post('/', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    if (req.auth!.role === 'teacher') {
      const teacher = await User.findById(req.auth!.userId).select('verified');
      if (!teacher?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    }
    await assertCourseCategory(input.category);
    const slug = `${slugify(input.title)}-${Date.now().toString(36)}`;
    const course = await Course.create({ ...input, slug, teacherId: req.auth!.userId, status: req.auth!.role === 'admin' ? input.status ?? 'published' : 'draft' });
    res.status(201).json({ success: true, data: course });
  } catch (error) { next(error); }
});

courseRoutes.patch('/:id', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const updates = updateSchema.parse(req.body);
    if (req.auth!.role === 'teacher') {
      const teacher = await User.findById(req.auth!.userId).select('verified');
      if (!teacher?.verified) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    }
    if (req.auth!.role !== 'admin' && updates.status === 'published') throw new AppError(403, 'COURSE_REVIEW_REQUIRED');
    if (updates.category !== undefined && !await Course.exists({ _id: req.params.id, category: updates.category })) await assertCourseCategory(updates.category);
    const actor = { userId: req.auth!.userId, role: req.auth!.role };
    const existing = /^[a-f\d]{24}$/i.test(String(req.params.id)) ? await Course.findById(req.params.id).select('teacherId coOwnerIds chapters').lean() : null;
    if (!existing || !await canManageCourse(actor, existing.teacherId, existing.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    // Price and status stay with the primary owner; co-owners and coordinators edit content only.
    if ((updates.price !== undefined || updates.status !== undefined || updates.visibility !== undefined || updates.accessState !== undefined) && !await isPrimaryCourseManager(actor, existing.teacherId)) throw new AppError(403, 'COURSE_OWNER_REQUIRED');
    if (updates.banner?.assetId && !await CourseAsset.exists({ _id: updates.banner.assetId, courseId: req.params.id, kind: 'image' })) throw new AppError(422, 'INVALID_COURSE_ASSET_REFERENCE');
    const { chapters, ...fields } = updates;
    const set: Record<string, unknown> = { ...fields };
    if (chapters) set.chapters = mergeLegacyChapters(chapters, (existing.chapters || []) as Array<Record<string, any>>);
    // Owners may only withdraw to draft; moderation states are changed through the review workflow.
    const query = req.auth!.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, ...(updates.status ? { status: { $ne: 'suspended' } } : {}) };
    const course = await Course.findOneAndUpdate(query, { $set: set, ...(chapters ? { $inc: { structureVersion: 1 } } : {}) }, { new: true, runValidators: true });
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    res.json({ success: true, data: course });
  } catch (error) { next(error); }
});

/** Replaces the co-owner list (verified teachers identified by email). Primary owner, owning institution or admin only. */
courseRoutes.put('/:id/co-owners', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const courseId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.id);
    if (!courseId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const { emails } = z.object({ emails: z.array(z.string().trim().toLowerCase().email().max(254)).max(10) }).strict().parse(req.body);
    const course = await Course.findById(courseId.data).select('teacherId coOwnerIds title');
    const actor = { userId: req.auth!.userId, role: req.auth!.role };
    if (!course || !await canManageCourse(actor, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
    if (!await isPrimaryCourseManager(actor, course.teacherId)) throw new AppError(403, 'COURSE_OWNER_REQUIRED');
    const teachers = await User.find({ email: { $in: [...new Set(emails)] }, role: 'teacher', verified: true, status: 'active' }).select('name email').lean();
    if (teachers.length !== new Set(emails).size) throw new AppError(404, 'VERIFIED_TEACHER_NOT_FOUND');
    if (teachers.some(teacher => String(teacher._id) === String(course.teacherId))) throw new AppError(400, 'OWNER_CANNOT_BE_CO_OWNER');
    const previous = new Set(course.coOwnerIds.map(String));
    course.coOwnerIds = teachers.map(teacher => teacher._id) as any;
    await course.save();
    await AuditEvent.create({ action: 'course.co_owners.updated', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip });
    await Promise.all(teachers.filter(teacher => !previous.has(String(teacher._id))).map(teacher => createNotification({ userId: String(teacher._id), type: 'course', title: 'Course co-ownership', message: `You were added as a co-owner of "${course.title}".`, link: `/teacher/courses/${course._id}/edit`, template: { key: 'courseCoOwner', params: { course: course.title } } }).catch(() => undefined)));
    res.json({ success: true, data: teachers.map(teacher => ({ id: String(teacher._id), name: teacher.name, email: teacher.email })) });
  } catch (error) { next(error); }
});

courseRoutes.post('/:id/submit-review', authenticate, allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const courseId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.id);
    if (!courseId.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const course = await submitCourseForReview(courseId.data, { userId: req.auth!.userId, role: req.auth!.role, ip: req.ip });
    res.json({ success: true, data: course });
  } catch (error) { next(error); }
});
