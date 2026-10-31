import { Router } from 'express';
import mongoose, { Schema, model } from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles, optionalAuthenticate, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Course } from '../courses/model.js';
import { toPublicCourse } from '../courses/dto.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { PUBLIC_COURSE_FILTER } from '../classes/service.js';

/** Curated sequences of published courses (admin-managed, translated), with learner progress when signed in. */
const localized = { fr: { type: String, required: true, trim: true, maxlength: 2000 }, en: { type: String, required: true, trim: true, maxlength: 2000 }, ar: { type: String, required: true, trim: true, maxlength: 2000 } };
const learningPathSchema = new Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 80 },
  title: localized,
  description: localized,
  skills: { type: [{ type: String, trim: true, maxlength: 60 }], default: [], validate: (skills: unknown[]) => skills.length <= 20 },
  courseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Course' }], default: [], validate: (ids: unknown[]) => ids.length <= 30 },
  active: { type: Boolean, default: true, index: true },
  order: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });
export const LearningPath = model('LearningPath', learningPathSchema);

export const learningPathRoutes = Router();
export const adminLearningPathRoutes = Router();
adminLearningPathRoutes.use(authenticate, allowRoles('admin'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const localizedInput = z.object({ fr: z.string().trim().min(2).max(2000), en: z.string().trim().min(2).max(2000), ar: z.string().trim().min(2).max(2000) }).strict();
const pathInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), title: localizedInput, description: localizedInput,
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]), courseIds: z.array(objectId).max(30).default([]),
  active: z.boolean().default(true), order: z.number().int().min(0).max(1000).default(0),
}).strict();

const lessonMinutes = (course: any) => (course.chapters || []).reduce((sum: number, chapter: any) => sum + (chapter.lessons || []).reduce((total: number, lesson: any) => total + (lesson.durationMinutes || 0), 0), 0);

/** Builds DTOs keeping the admin-defined order and only published courses. */
async function toDtos(paths: any[], studentId?: string, includeCourses = false) {
  const courseIds = [...new Set(paths.flatMap(path => path.courseIds.map(String)))];
  const courses = await Course.find({ _id: { $in: courseIds }, ...PUBLIC_COURSE_FILTER }).populate('teacherId', 'name').lean();
  const courseMap = new Map(courses.map(course => [String(course._id), course]));
  const enrollments = studentId ? await Enrollment.find(activeAccess({ studentId, courseId: { $in: courseIds } })).select('courseId completedAt').lean() : [];
  const enrollmentMap = new Map(enrollments.map(enrollment => [String(enrollment.courseId), enrollment]));
  return paths.map(path => {
    const pathCourses = path.courseIds.map(String).map((id: string) => courseMap.get(id)).filter(Boolean);
    return {
      id: String(path._id), slug: path.slug, title: path.title, description: path.description, skills: path.skills,
      coursesCount: pathCourses.length, durationMinutes: pathCourses.reduce((sum: number, course: any) => sum + lessonMinutes(course), 0),
      ...(studentId ? { progress: { enrolled: pathCourses.filter((course: any) => enrollmentMap.has(String(course._id))).length, completed: pathCourses.filter((course: any) => enrollmentMap.get(String(course._id))?.completedAt).length } } : {}),
      ...(includeCourses ? { courses: pathCourses.map(toPublicCourse) } : { courseIds: pathCourses.map((course: any) => String(course._id)) }),
    };
  });
}

learningPathRoutes.get('/', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const paths = await LearningPath.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, data: await toDtos(paths, req.auth?.role === 'student' ? req.auth.userId : undefined) });
  } catch (error) { next(error); }
});

learningPathRoutes.get('/:slug', optionalAuthenticate, async (req: AuthRequest, res, next) => {
  try {
    const slug = z.string().trim().toLowerCase().max(80).parse(req.params.slug);
    const path = await LearningPath.findOne({ slug, active: true }).lean();
    if (!path) throw new AppError(404, 'LEARNING_PATH_NOT_FOUND');
    res.json({ success: true, data: (await toDtos([path], req.auth?.role === 'student' ? req.auth.userId : undefined, true))[0] });
  } catch (error) { next(error); }
});

adminLearningPathRoutes.get('/', async (_req, res, next) => {
  try {
    const paths = await LearningPath.find().sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, data: paths.map(path => ({ id: String(path._id), slug: path.slug, title: path.title, description: path.description, skills: path.skills, courseIds: path.courseIds.map(String), active: path.active, order: path.order })) });
  } catch (error) { next(error); }
});

const assertPublishedCourses = async (courseIds: string[]) => {
  const unique = [...new Set(courseIds)];
  if (unique.length !== courseIds.length) throw new AppError(422, 'DUPLICATE_PATH_COURSE');
  if (unique.length && await Course.countDocuments({ _id: { $in: unique }, ...PUBLIC_COURSE_FILTER }) !== unique.length) throw new AppError(422, 'PATH_COURSE_NOT_PUBLISHED');
};

adminLearningPathRoutes.post('/', async (req: AuthRequest, res, next) => {
  try {
    const input = pathInput.parse(req.body);
    await assertPublishedCourses(input.courseIds);
    const path = await LearningPath.create(input);
    await AuditEvent.create({ action: 'catalog.learning_path.created', actorId: req.auth!.userId, targetType: 'learning_path', targetId: path.slug, ipAddress: req.ip });
    res.status(201).json({ success: true, data: { id: String(path._id), slug: path.slug } });
  } catch (error) { next(error); }
});

adminLearningPathRoutes.put('/:pathId', async (req: AuthRequest, res, next) => {
  try {
    const pathId = objectId.safeParse(req.params.pathId); if (!pathId.success) throw new AppError(404, 'LEARNING_PATH_NOT_FOUND');
    const input = pathInput.parse(req.body);
    await assertPublishedCourses(input.courseIds);
    const path = await LearningPath.findByIdAndUpdate(pathId.data, { $set: { ...input, courseIds: input.courseIds.map(id => new mongoose.Types.ObjectId(id)) } }, { new: true, runValidators: true });
    if (!path) throw new AppError(404, 'LEARNING_PATH_NOT_FOUND');
    await AuditEvent.create({ action: 'catalog.learning_path.updated', actorId: req.auth!.userId, targetType: 'learning_path', targetId: path.slug, ipAddress: req.ip });
    res.json({ success: true, data: { id: String(path._id), slug: path.slug } });
  } catch (error) { next(error); }
});

adminLearningPathRoutes.delete('/:pathId', async (req: AuthRequest, res, next) => {
  try {
    const pathId = objectId.safeParse(req.params.pathId); if (!pathId.success) throw new AppError(404, 'LEARNING_PATH_NOT_FOUND');
    const path = await LearningPath.findByIdAndDelete(pathId.data);
    if (!path) throw new AppError(404, 'LEARNING_PATH_NOT_FOUND');
    await AuditEvent.create({ action: 'catalog.learning_path.deleted', actorId: req.auth!.userId, targetType: 'learning_path', targetId: path.slug, severity: 'warning', ipAddress: req.ip });
    res.status(204).end();
  } catch (error) { next(error); }
});
