import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Course } from '../courses/model.js';
import { toPublicCourse } from '../courses/dto.js';
import { Enrollment } from '../enrollments/model.js';
import { createNotification } from '../notifications/service.js';
import { ClassGroup } from './model.js';
import { assertAssignableCourses, canManageClass, manageableClassFilter, newJoinCode, studentsByEmail, syncClassAccess } from './service.js';

export const classRoutes = Router();
classRoutes.use(authenticate);

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const joinLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const classInput = z.object({
  name: z.string().trim().min(2).max(120), level: z.string().trim().max(80).default(''), academicYear: z.string().trim().max(20).default(''),
  description: z.string().trim().max(2000).default(''), joinEnabled: z.boolean().default(true),
}).strict();

const summaryDto = (group: any) => ({
  id: String(group._id), name: group.name, level: group.level, academicYear: group.academicYear, description: group.description,
  ownerRole: group.ownerRole, ownerName: group.ownerId?.name || '', joinCode: group.joinCode, joinEnabled: group.joinEnabled,
  archived: !!group.archivedAt, studentsCount: group.studentIds.length, coursesCount: group.courseIds.length, createdAt: group.createdAt,
});
const audit = (req: AuthRequest, action: string, groupId: unknown, severity: 'info' | 'warning' = 'info') =>
  AuditEvent.create({ action, actorId: req.auth!.userId, targetType: 'class', targetId: String(groupId), severity, ipAddress: req.ip });
const actorOf = (req: AuthRequest) => ({ userId: req.auth!.userId, role: req.auth!.role });

async function loadManaged(req: AuthRequest) {
  const groupId = objectId.safeParse(req.params.classId); if (!groupId.success) throw new AppError(404, 'CLASS_NOT_FOUND');
  const group = await ClassGroup.findById(groupId.data);
  if (!group || !await canManageClass(actorOf(req), group)) throw new AppError(404, 'CLASS_NOT_FOUND');
  return group;
}

async function detailDto(group: any) {
  const [owner, students, courses, enrollments] = await Promise.all([
    User.findById(group.ownerId).select('name').lean(),
    User.find({ _id: { $in: group.studentIds } }).select('name email status').sort({ name: 1 }).lean(),
    Course.find({ _id: { $in: group.courseIds } }).select('title status visibility chapters.lessons.id teacherId').populate('teacherId', 'name').lean(),
    Enrollment.find({ studentId: { $in: group.studentIds }, courseId: { $in: group.courseIds } }).select('studentId courseId completedLessonIds completedAt').lean(),
  ]);
  const lessonCount = new Map(courses.map(course => [String(course._id), course.chapters.reduce((sum: number, chapter: any) => sum + (chapter.lessons?.length || 0), 0)]));
  const progress = new Map(enrollments.map(row => {
    const total = lessonCount.get(String(row.courseId)) || 0;
    return [`${row.studentId}:${row.courseId}`, { percent: total ? Math.min(100, Math.round((row.completedLessonIds?.length || 0) / total * 100)) : 0, completed: !!row.completedAt }];
  }));
  return {
    ...summaryDto({ ...group.toObject?.() ?? group, ownerId: owner }),
    courses: courses.map(course => ({ id: String(course._id), title: course.title, status: course.status, visibility: course.visibility || 'public', teacherName: (course.teacherId as any)?.name || '' })),
    students: students.map(student => ({
      id: String(student._id), name: student.name, email: student.email, status: student.status,
      progress: courses.map(course => ({ courseId: String(course._id), ...(progress.get(`${student._id}:${course._id}`) || { percent: 0, completed: false }) })),
    })),
  };
}

// ---------------------------------------------------------------- student side

/** Classes of the signed-in student with the courses they open. */
classRoutes.get('/mine', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const groups = await ClassGroup.find({ studentIds: req.auth!.userId, archivedAt: null }).sort({ createdAt: -1 }).populate('ownerId', 'name').lean();
    const courses = await Course.find({ _id: { $in: groups.flatMap(group => group.courseIds) }, status: 'published' }).populate('teacherId', 'name').lean();
    res.json({ success: true, data: groups.map(group => ({
      id: String(group._id), name: group.name, level: group.level, academicYear: group.academicYear, description: group.description,
      ownerRole: group.ownerRole, ownerName: (group.ownerId as any)?.name || '',
      courses: courses.filter(course => group.courseIds.some(id => String(id) === String(course._id))).map(toPublicCourse),
    })) });
  } catch (error) { next(error); }
});

classRoutes.post('/join', allowRoles('student'), joinLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/) }).strict().parse(req.body);
    const group = await ClassGroup.findOneAndUpdate({ joinCode: code, joinEnabled: true, archivedAt: null, 'studentIds.499': { $exists: false } }, { $addToSet: { studentIds: req.auth!.userId } }, { new: true });
    if (!group) throw new AppError(404, 'CLASS_CODE_INVALID');
    await syncClassAccess({ studentIds: [req.auth!.userId] });
    void createNotification({ userId: String(group.ownerId), type: 'account', title: 'New class member', message: `A student joined "${group.name}".`, link: '/classes', template: { key: 'classMemberJoined', params: { name: group.name } } }).catch(() => undefined);
    res.json({ success: true, data: { id: String(group._id), name: group.name } });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------- manager side (teacher, institution, admin)

const managers = allowRoles('teacher', 'institution', 'admin');

classRoutes.get('/', managers, async (req: AuthRequest, res, next) => {
  try {
    const groups = await ClassGroup.find(await manageableClassFilter(actorOf(req))).sort({ archivedAt: 1, createdAt: -1 }).populate('ownerId', 'name').lean();
    res.json({ success: true, data: groups.map(summaryDto) });
  } catch (error) { next(error); }
});

classRoutes.post('/', allowRoles('teacher', 'institution'), async (req: AuthRequest, res, next) => {
  try {
    const input = classInput.parse(req.body);
    if (req.auth!.role === 'teacher' && !await User.exists({ _id: req.auth!.userId, verified: true })) throw new AppError(403, 'TEACHER_NOT_VERIFIED');
    let group;
    for (let attempt = 0; attempt < 5 && !group; attempt += 1) {
      try { group = await ClassGroup.create({ ...input, ownerId: req.auth!.userId, ownerRole: req.auth!.role, joinCode: newJoinCode() }); }
      catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    }
    if (!group) throw new AppError(409, 'CLASS_CODE_CONFLICT');
    await audit(req, 'class.created', group._id);
    res.status(201).json({ success: true, data: await detailDto(group) });
  } catch (error) { next(error); }
});

classRoutes.get('/:classId', managers, async (req: AuthRequest, res, next) => {
  try { res.json({ success: true, data: await detailDto(await loadManaged(req)) }); }
  catch (error) { next(error); }
});

classRoutes.patch('/:classId', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    const input = classInput.partial().extend({ archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0).parse(req.body);
    const { archived, ...fields } = input;
    Object.assign(group, fields);
    if (archived !== undefined) group.archivedAt = archived ? new Date() : null;
    await group.save();
    if (archived !== undefined) {
      await syncClassAccess({ studentIds: group.studentIds, courseIds: group.courseIds });
      await audit(req, archived ? 'class.archived' : 'class.restored', group._id, 'warning');
    }
    res.json({ success: true, data: await detailDto(group) });
  } catch (error) { next(error); }
});

classRoutes.delete('/:classId', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    if (group.studentIds.length) throw new AppError(409, 'CLASS_NOT_EMPTY');
    await group.deleteOne();
    await audit(req, 'class.deleted', group._id, 'warning');
    res.status(204).end();
  } catch (error) { next(error); }
});

/** Replaces the courses opened to the class. Members gain or lose access accordingly. */
classRoutes.put('/:classId/courses', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    const { courseIds } = z.object({ courseIds: z.array(objectId).max(100) }).strict().parse(req.body);
    const unique = [...new Set(courseIds)];
    await assertAssignableCourses(group, unique);
    const previous = group.courseIds.map(String);
    group.courseIds = unique as any;
    await group.save();
    await syncClassAccess({ studentIds: group.studentIds, courseIds: [...new Set([...previous, ...unique])] });
    await audit(req, 'class.courses.updated', group._id);
    res.json({ success: true, data: await detailDto(group) });
  } catch (error) { next(error); }
});

/** Adds existing student accounts by e-mail; unknown or non-student addresses are reported back, never created. */
classRoutes.post('/:classId/students', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    const { emails } = z.object({ emails: z.array(z.string().trim().email().max(254)).min(1).max(200) }).strict().parse(req.body);
    const { students, notFound } = await studentsByEmail(emails);
    const newcomers = students.filter(student => !group.studentIds.some(id => String(id) === String(student._id)));
    if (group.studentIds.length + newcomers.length > 500) throw new AppError(409, 'CLASS_FULL');
    group.studentIds.push(...newcomers.map(student => student._id) as any);
    await group.save();
    await syncClassAccess({ studentIds: newcomers.map(student => student._id) });
    await Promise.all(newcomers.map(student => createNotification({ userId: String(student._id), type: 'course', title: 'Added to a class', message: `You were added to "${group.name}".`, link: '/student/classes', template: { key: 'classJoined', params: { name: group.name } } }).catch(() => undefined)));
    if (newcomers.length) await audit(req, 'class.students.added', group._id);
    res.json({ success: true, data: { added: newcomers.length, notFound, class: await detailDto(group) } });
  } catch (error) { next(error); }
});

classRoutes.delete('/:classId/students/:studentId', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    const studentId = objectId.safeParse(req.params.studentId); if (!studentId.success) throw new AppError(404, 'CLASS_MEMBER_NOT_FOUND');
    if (!group.studentIds.some(id => String(id) === studentId.data)) throw new AppError(404, 'CLASS_MEMBER_NOT_FOUND');
    group.studentIds = group.studentIds.filter(id => String(id) !== studentId.data) as any;
    await group.save();
    await syncClassAccess({ studentIds: [studentId.data] });
    await audit(req, 'class.students.removed', group._id, 'warning');
    res.json({ success: true, data: await detailDto(group) });
  } catch (error) { next(error); }
});

classRoutes.post('/:classId/join-code', managers, async (req: AuthRequest, res, next) => {
  try {
    const group = await loadManaged(req);
    group.joinCode = newJoinCode();
    await group.save();
    res.json({ success: true, data: { joinCode: group.joinCode } });
  } catch (error) { next(error); }
});
