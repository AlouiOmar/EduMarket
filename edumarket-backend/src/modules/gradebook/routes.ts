import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { buildXlsx } from '../../common/xlsx.js';
import { AuditEvent } from '../admin/audit.model.js';
import { getManageableCourse } from '../courses/assets.routes.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { computeGrades, round2 } from './compute.js';
import { GradeCategory, GradeColumn, GradeEntry } from './models.js';
import { ensureCategory, publishColumn, syncCourseActivities } from './service.js';

/**
 * Gradebook API. Managers (course owner, co-authors, coordinators, owning institution, admin) see and edit every grade of the
 * course; a student only reads their own published grades. Every write is scoped to the course in the URL.
 */
export const gradebookRoutes = Router();
gradebookRoutes.use(authenticate);
const managers = allowRoles('teacher', 'institution', 'admin');
const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const categoryDto = (category: any) => ({ id: String(category._id), name: category.name, weight: category.weight, order: category.order, key: category.key || '' });
const columnDto = (column: any) => ({
  id: String(column._id), categoryId: String(column.categoryId), title: column.title, maxPoints: column.maxPoints, source: column.source,
  dueAt: column.dueAt, countsInFinal: column.countsInFinal, missingAsZero: column.missingAsZero, releaseMode: column.releaseMode, order: column.order,
});
const entryDto = (entry: any) => ({
  columnId: String(entry.columnId), studentId: String(entry.studentId), score: entry.score, status: entry.status, feedback: entry.feedback, excused: entry.excused,
  exception: entry.exception, published: entry.published, overridden: entry.overridden, gradedAt: entry.gradedAt, updatedAt: entry.updatedAt,
});

async function loadBook(courseId: unknown) {
  const [categories, columns, entries, enrollments] = await Promise.all([
    GradeCategory.find({ courseId }).sort({ order: 1, createdAt: 1 }).lean(),
    GradeColumn.find({ courseId, archivedAt: null }).sort({ order: 1, createdAt: 1 }).lean(),
    GradeEntry.find({ courseId }).lean(),
    Enrollment.find({ courseId }).populate('studentId', 'name email').lean(),
  ]);
  const students = enrollments.filter(row => row.studentId).map(row => ({ id: String((row.studentId as any)._id), name: (row.studentId as any).name, email: (row.studentId as any).email, active: !row.accessExpiresAt || row.accessExpiresAt > new Date() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const categoryInputs = categories.map(category => ({ id: String(category._id), name: category.name, weight: category.weight }));
  const columnInputs = columns.map(column => ({ id: String(column._id), categoryId: String(column.categoryId), maxPoints: column.maxPoints, countsInFinal: column.countsInFinal, missingAsZero: column.missingAsZero, dueAt: column.dueAt }));
  const totals = students.map(student => {
    const own = entries.filter(entry => String(entry.studentId) === student.id);
    return {
      studentId: student.id,
      working: computeGrades(categoryInputs, columnInputs, own.map(entry => ({ columnId: String(entry.columnId), score: entry.score, excused: entry.excused, dueAt: entry.exception?.dueAt }))),
      published: computeGrades(categoryInputs, columnInputs, own.filter(entry => entry.published).map(entry => ({ columnId: String(entry.columnId), score: entry.published!.score ?? null, excused: entry.published!.excused, dueAt: entry.exception?.dueAt }))),
    };
  });
  return { categories, columns, entries, students, totals };
}

gradebookRoutes.get('/:courseId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    await ensureCategory(course._id, 'general');
    await syncCourseActivities(course._id);
    const book = await loadBook(course._id);
    res.json({ success: true, data: { categories: book.categories.map(categoryDto), columns: book.columns.map(columnDto), entries: book.entries.map(entryDto), students: book.students, totals: book.totals } });
  } catch (error) { next(error); }
});

const categorySchema = z.object({ name: z.string().trim().min(1).max(120), weight: z.number().min(0).max(1000) }).strict();
gradebookRoutes.post('/:courseId/categories', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const input = categorySchema.parse(req.body);
    const category = await GradeCategory.create({ ...input, courseId: course._id, order: await GradeCategory.countDocuments({ courseId: course._id }) });
    res.status(201).json({ success: true, data: categoryDto(category) });
  } catch (error) { next(error); }
});
gradebookRoutes.patch('/:courseId/categories/:categoryId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const input = categorySchema.partial().refine(value => Object.keys(value).length > 0).parse(req.body);
    const category = await GradeCategory.findOneAndUpdate({ _id: objectId.parse(req.params.categoryId), courseId: course._id }, { $set: input }, { new: true }).lean();
    if (!category) throw new AppError(404, 'GRADE_CATEGORY_NOT_FOUND');
    res.json({ success: true, data: categoryDto(category) });
  } catch (error) { next(error); }
});
gradebookRoutes.delete('/:courseId/categories/:categoryId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const categoryId = objectId.parse(req.params.categoryId);
    if (await GradeColumn.exists({ courseId: course._id, categoryId, archivedAt: null })) throw new AppError(409, 'GRADE_CATEGORY_NOT_EMPTY');
    const deleted = await GradeCategory.deleteOne({ _id: categoryId, courseId: course._id });
    if (!deleted.deletedCount) throw new AppError(404, 'GRADE_CATEGORY_NOT_FOUND');
    res.json({ success: true, data: { id: categoryId } });
  } catch (error) { next(error); }
});

const columnSchema = z.object({
  categoryId: objectId, title: z.string().trim().min(1).max(200), maxPoints: z.number().min(0.01).max(10000),
  dueAt: z.union([z.null(), z.coerce.date()]).optional(), countsInFinal: z.boolean().optional(), missingAsZero: z.boolean().optional(), releaseMode: z.enum(['manual', 'auto']).optional(),
}).strict();
gradebookRoutes.post('/:courseId/columns', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const input = columnSchema.parse(req.body);
    if (!await GradeCategory.exists({ _id: input.categoryId, courseId: course._id })) throw new AppError(422, 'GRADE_CATEGORY_NOT_FOUND');
    const column = await GradeColumn.create({ ...input, courseId: course._id, source: { kind: 'manual', refId: '' }, order: await GradeColumn.countDocuments({ courseId: course._id }) });
    res.status(201).json({ success: true, data: columnDto(column) });
  } catch (error) { next(error); }
});
gradebookRoutes.patch('/:courseId/columns/:columnId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const input = columnSchema.partial().refine(value => Object.keys(value).length > 0).parse(req.body);
    const column = await GradeColumn.findOne({ _id: objectId.parse(req.params.columnId), courseId: course._id });
    if (!column) throw new AppError(404, 'GRADE_COLUMN_NOT_FOUND');
    if (input.categoryId && !await GradeCategory.exists({ _id: input.categoryId, courseId: course._id })) throw new AppError(422, 'GRADE_CATEGORY_NOT_FOUND');
    // The maximum of a linked column follows its activity; lowering a manual maximum below an existing grade is refused.
    if (input.maxPoints !== undefined && column.source?.kind !== 'manual') throw new AppError(409, 'LINKED_COLUMN_MAX_LOCKED');
    if (input.maxPoints !== undefined && await GradeEntry.exists({ columnId: column._id, score: { $gt: input.maxPoints } })) throw new AppError(409, 'SCORE_EXCEEDS_MAXIMUM');
    Object.assign(column, input);
    await column.save();
    res.json({ success: true, data: columnDto(column) });
  } catch (error) { next(error); }
});
/** Columns with grades are archived (grades kept, excluded from totals), never deleted. */
gradebookRoutes.delete('/:courseId/columns/:columnId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const column = await GradeColumn.findOne({ _id: objectId.parse(req.params.columnId), courseId: course._id });
    if (!column) throw new AppError(404, 'GRADE_COLUMN_NOT_FOUND');
    if (column.source?.kind !== 'manual') throw new AppError(409, 'LINKED_COLUMN_LOCKED');
    if (await GradeEntry.exists({ columnId: column._id, $or: [{ score: { $ne: null } }, { published: { $ne: null } }] })) {
      column.archivedAt = new Date(); await column.save();
    } else await GradeColumn.deleteOne({ _id: column._id });
    res.json({ success: true, data: { id: String(column._id) } });
  } catch (error) { next(error); }
});

const entrySchema = z.object({
  score: z.union([z.null(), z.number().min(0)]).optional(), feedback: z.string().trim().max(4000).optional(), excused: z.boolean().optional(),
  exception: z.object({ dueAt: z.union([z.null(), z.coerce.date()]).optional(), extraAttempts: z.number().int().min(0).max(20).optional() }).strict().optional(),
  // Optimistic locking: the `updatedAt` the client last saw (absent for a new entry).
  expectedUpdatedAt: z.union([z.null(), z.string().datetime({ offset: true })]).optional(),
}).strict();

/** Teacher grade entry / correction / exception for one student. The published grade is unchanged until published again. */
gradebookRoutes.put('/:courseId/entries/:columnId/:studentId', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const input = entrySchema.parse(req.body);
    const column = await GradeColumn.findOne({ _id: objectId.parse(req.params.columnId), courseId: course._id, archivedAt: null }).lean();
    if (!column) throw new AppError(404, 'GRADE_COLUMN_NOT_FOUND');
    const studentId = objectId.parse(req.params.studentId);
    if (!await Enrollment.exists({ courseId: course._id, studentId })) throw new AppError(404, 'STUDENT_NOT_IN_COURSE');
    if (input.score !== undefined && input.score !== null && input.score > column.maxPoints) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
    const current = await GradeEntry.findOne({ columnId: column._id, studentId }).lean();
    if (input.expectedUpdatedAt !== undefined && (current ? current.updatedAt?.toISOString() !== input.expectedUpdatedAt : input.expectedUpdatedAt !== null)) throw new AppError(409, 'GRADE_CONFLICT');
    const next = {
      score: input.score !== undefined ? input.score : current?.score ?? null,
      feedback: input.feedback ?? current?.feedback ?? '', excused: input.excused ?? current?.excused ?? false,
    };
    const gradeChanged = input.score !== undefined || input.feedback !== undefined || input.excused !== undefined;
    const set: Record<string, unknown> = { courseId: course._id, ...next };
    if (input.exception?.dueAt !== undefined) set['exception.dueAt'] = input.exception.dueAt;
    if (input.exception?.extraAttempts !== undefined) set['exception.extraAttempts'] = input.exception.extraAttempts;
    if (gradeChanged) {
      const published = current?.published;
      const samePublished = published && published.score === next.score && published.feedback === next.feedback && published.excused === next.excused;
      set.status = samePublished ? 'published' : next.score === null && !next.excused ? (current?.status === 'pending' ? 'pending' : 'not_graded') : 'graded';
      set.gradedBy = req.auth!.userId; set.gradedAt = new Date();
      if (column.source?.kind !== 'manual') set.overridden = true;
    }
    const filter = current ? { _id: current._id, updatedAt: current.updatedAt } : { columnId: column._id, studentId };
    let entry;
    try { entry = await GradeEntry.findOneAndUpdate(filter, { $set: set }, { new: true, upsert: !current, setDefaultsOnInsert: true }).lean(); }
    catch (error) { if ((error as { code?: number }).code === 11000) throw new AppError(409, 'GRADE_CONFLICT'); throw error; }
    if (!entry) throw new AppError(409, 'GRADE_CONFLICT');
    res.json({ success: true, data: entryDto(entry) });
  } catch (error) { next(error); }
});

/** Individual (studentIds) or global publication of a column's graded entries. */
gradebookRoutes.post('/:courseId/columns/:columnId/publish', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const { studentIds } = z.object({ studentIds: z.array(objectId).max(1000).optional() }).strict().parse(req.body ?? {});
    const published = await publishColumn(course._id, objectId.parse(req.params.columnId), studentIds);
    await AuditEvent.create({ action: 'gradebook.published', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.json({ success: true, data: { published } });
  } catch (error) { next(error); }
});

/** Export (CSV or XLSX) of working grades, per-category percentages, overall percentage and /20. */
gradebookRoutes.get('/:courseId/export', managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const format = z.enum(['csv', 'xlsx']).default('csv').parse(req.query.format);
    await syncCourseActivities(course._id);
    const book = await loadBook(course._id);
    const full = await Course.findById(course._id).select('title').lean();
    const header = ['Student', 'Email', ...book.columns.map(column => `${column.title} (/${column.maxPoints})`), ...book.categories.map(category => `${category.name} %`), 'Total %', 'Total /20', 'Published total /20'];
    const rows = book.students.map(student => {
      const totals = book.totals.find(total => total.studentId === student.id)!;
      return [
        student.name, student.email,
        ...book.columns.map(column => {
          const entry = book.entries.find(candidate => String(candidate.columnId) === String(column._id) && String(candidate.studentId) === student.id);
          if (entry?.excused) return 'EXC';
          return entry?.score ?? (entry?.status === 'pending' ? 'pending' : null);
        }),
        ...book.categories.map(category => totals.working.categories.find(row => row.categoryId === String(category._id))?.percent ?? null),
        totals.working.percent, totals.working.outOf20, totals.published.outOf20,
      ];
    });
    const safeTitle = (full?.title || 'course').normalize('NFKD').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'course';
    const fileName = `gradebook-${safeTitle}-${new Date().toISOString().slice(0, 10)}.${format}`;
    await AuditEvent.create({ action: 'gradebook.exported', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.set({ 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
    if (format === 'xlsx') res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buildXlsx('Grades', [header, ...rows]));
    else res.type('text/csv; charset=utf-8').send('﻿' + [header, ...rows].map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n');
  } catch (error) { next(error); }
});

/** Student: own published grades only (never working grades, other students or unpublished feedback). */
gradebookRoutes.get('/me/:courseId', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const courseId = objectId.safeParse(req.params.courseId);
    if (!courseId.success || !await Enrollment.exists({ courseId: courseId.data, studentId: req.auth!.userId })) throw new AppError(404, 'COURSE_NOT_FOUND');
    const [categories, columns, entries] = await Promise.all([
      GradeCategory.find({ courseId: courseId.data }).sort({ order: 1 }).lean(),
      GradeColumn.find({ courseId: courseId.data, archivedAt: null }).sort({ order: 1 }).lean(),
      GradeEntry.find({ courseId: courseId.data, studentId: req.auth!.userId }).lean(),
    ]);
    const published = entries.filter(entry => entry.published);
    const totals = computeGrades(
      categories.map(category => ({ id: String(category._id), name: category.name, weight: category.weight })),
      columns.map(column => ({ id: String(column._id), categoryId: String(column.categoryId), maxPoints: column.maxPoints, countsInFinal: column.countsInFinal, missingAsZero: column.missingAsZero, dueAt: column.dueAt })),
      published.map(entry => ({ columnId: String(entry.columnId), score: entry.published!.score ?? null, excused: entry.published!.excused, dueAt: entry.exception?.dueAt })),
    );
    res.json({ success: true, data: {
      categories: categories.map(category => ({ id: String(category._id), name: category.name, weight: category.weight })),
      columns: columns.map(column => {
        const entry = entries.find(candidate => String(candidate.columnId) === String(column._id));
        return {
          id: String(column._id), categoryId: String(column.categoryId), title: column.title, maxPoints: column.maxPoints, dueAt: entry?.exception?.dueAt || column.dueAt, kind: column.source?.kind,
          status: entry?.published ? 'published' : entry?.status === 'pending' ? 'pending' : entry && entry.status !== 'not_graded' ? 'pending' : 'not_graded',
          score: entry?.published?.score ?? null, excused: entry?.published?.excused ?? false, feedback: entry?.published?.feedback ?? '',
          percent: entry?.published && entry.published.score !== null && entry.published.score !== undefined ? round2(entry.published.score / column.maxPoints * 100) : null,
        };
      }),
      totals,
    } });
  } catch (error) { next(error); }
});
