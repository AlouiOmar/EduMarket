import { Router } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Assignment, AssignmentSubmission } from '../assignments/models.js';
import { TestAttempt } from '../assessments/models.js';
import { ClassGroup } from '../classes/model.js';
import { getManageableCourse } from '../courses/assets.routes.js';
import { Course } from '../courses/model.js';
import { publicationStatus } from '../courses/publication.js';
import { manageableCourseFilter } from '../courses/service.js';
import { plainOutline, progressPercent, visibilityOf } from '../courses/structure.js';
import { Enrollment } from '../enrollments/model.js';
import { LessonActivity } from '../enrollments/lesson-activity.model.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { GradeCategory, GradeColumn, GradeEntry } from '../gradebook/models.js';
import { computeGrades } from '../gradebook/compute.js';
import { CourseDiscussionPost } from '../participation/models.js';

/**
 * Course analytics from real records only. Three different notions are kept apart:
 * - authoring progress (how much of the outline is published, drafts pending),
 * - publication (what students can open now),
 * - learner progress (completed published items) and activity (dated events in the period).
 */
export const courseAnalyticsRoutes = Router();
// Per-route guards: this router shares the /analytics prefix with the existing analytics routes.
const managers = [authenticate, allowRoles('teacher', 'institution', 'admin')];
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const querySchema = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), classId: objectId.optional(),
  inactiveDays: z.coerce.number().int().min(1).max(365).default(14),
});

const maxDate = (...dates: (Date | null | undefined)[]) => dates.filter(Boolean).reduce<Date | null>((latest, value) => !latest || value! > latest ? value! : latest, null);

export async function courseAnalytics(courseId: unknown, options: { from?: Date; to?: Date; classId?: string; inactiveDays: number }) {
  const course = await Course.findById(courseId).select('title chapters').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const now = new Date();
  const items = plainOutline(course.chapters).flatMap(container => container.lessons.map(item => ({ item, containerVisible: visibilityOf(container) === 'visible' })));
  const statuses = items.map(({ item }) => publicationStatus(item, now));
  const authoring = {
    containers: course.chapters.length, items: items.length,
    published: items.filter(({ item, containerVisible }) => containerVisible && visibilityOf(item) === 'visible').length,
    neverPublished: statuses.filter(status => status === 'draft').length,
    pendingChanges: statuses.filter(status => status === 'pending_changes').length,
    scheduled: statuses.filter(status => status === 'scheduled').length,
  };

  let enrollments = await Enrollment.find({ courseId: course._id }).populate('studentId', 'name email').lean();
  if (options.classId) {
    const group = await ClassGroup.findOne({ _id: options.classId, courseIds: course._id }).select('studentIds').lean();
    if (!group) throw new AppError(404, 'CLASS_NOT_FOUND');
    const members = new Set(group.studentIds.map(String));
    enrollments = enrollments.filter(row => members.has(String((row.studentId as any)?._id || row.studentId)));
  }
  const studentIds = enrollments.map(row => (row.studentId as any)?._id || row.studentId);
  const period = { ...(options.from ? { $gte: options.from } : {}), ...(options.to ? { $lte: options.to } : {}) };
  const inPeriod = (value?: Date | null) => !!value && (!options.from || value >= options.from) && (!options.to || value <= options.to);
  const assignments = await Assignment.find({ courseId: course._id }).select('_id').lean();
  const [lessons, quizzes, tests, posts, submissions, columns] = await Promise.all([
    LessonActivity.find({ courseId: course._id, studentId: { $in: studentIds } }).select('studentId completedAt').lean(),
    QuizAttempt.find({ courseId: course._id, studentId: { $in: studentIds } }).select('studentId createdAt').lean(),
    TestAttempt.find({ courseId: course._id, studentId: { $in: studentIds }, submittedAt: { $ne: null } }).select('studentId submittedAt').lean(),
    CourseDiscussionPost.find({ courseId: course._id, authorId: { $in: studentIds } }).select('authorId createdAt').lean(),
    AssignmentSubmission.find({ assignmentId: { $in: assignments.map(row => row._id) }, studentId: { $in: studentIds } }).select('studentId submittedAt').lean(),
    GradeColumn.find({ courseId: course._id, archivedAt: null }).sort({ order: 1 }).lean(),
  ]);
  const threshold = new Date(now.getTime() - options.inactiveDays * 86_400_000);
  const students = enrollments.filter(row => row.studentId).map(row => {
    const id = String((row.studentId as any)._id);
    const own = <T extends Record<string, any>>(list: T[], key = 'studentId') => list.filter(entry => String(entry[key]) === id);
    const events = [
      ...own(lessons).map(entry => entry.completedAt), ...own(quizzes).map(entry => (entry as any).createdAt), ...own(tests).map(entry => entry.submittedAt),
      ...own(posts, 'authorId').map(entry => (entry as any).createdAt), ...own(submissions).map(entry => entry.submittedAt),
    ] as Date[];
    const lastActivityAt = maxDate(row.lastAccessedAt, ...events);
    return {
      studentId: id, name: (row.studentId as any).name, email: (row.studentId as any).email,
      progress: progressPercent(course.chapters as any, row.completedLessonIds || []), completedAt: row.completedAt, lastActivityAt,
      activity: {
        lessons: own(lessons).filter(entry => inPeriod(entry.completedAt)).length, quizAttempts: own(quizzes).filter(entry => inPeriod((entry as any).createdAt)).length,
        testAttempts: own(tests).filter(entry => inPeriod(entry.submittedAt)).length, posts: own(posts, 'authorId').filter(entry => inPeriod((entry as any).createdAt)).length,
        submissions: own(submissions).filter(entry => inPeriod(entry.submittedAt)).length,
      },
      inactive: !lastActivityAt || lastActivityAt < threshold,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const entries = await GradeEntry.find({ columnId: { $in: columns.map(column => column._id) }, studentId: { $in: studentIds } }).select('columnId score status published').lean();
  const assessments = columns.map(column => {
    const own = entries.filter(entry => String(entry.columnId) === String(column._id));
    const graded = own.filter(entry => entry.score !== null && entry.score !== undefined);
    return {
      columnId: String(column._id), title: column.title, kind: column.source?.kind, maxPoints: column.maxPoints,
      graded: graded.length, pending: own.filter(entry => entry.status === 'pending').length, published: own.filter(entry => entry.published).length,
      // Average of existing grades only (missing grades are not zeros), in percent of the maximum.
      averagePercent: graded.length ? Math.round(graded.reduce((sum, entry) => sum + (entry.score as number), 0) / graded.length / column.maxPoints * 1000) / 10 : null,
    };
  });
  const activeInPeriod = students.filter(student => Object.values(student.activity).some(count => count > 0)).length;
  return {
    course: { id: String(course._id), title: course.title }, period: { from: options.from ?? null, to: options.to ?? null }, inactiveDays: options.inactiveDays,
    authoring,
    totals: {
      students: students.length, activeInPeriod, inactive: students.filter(student => student.inactive).length,
      averageProgress: students.length ? Math.round(students.reduce((sum, student) => sum + student.progress, 0) / students.length) : null,
      completionRate: students.length ? Math.round(students.filter(student => student.completedAt).length / students.length * 100) : null,
    },
    students, assessments, filterApplied: { classId: options.classId ?? null, ...(Object.keys(period).length ? { period: true } : {}) },
  };
}

courseAnalyticsRoutes.get('/courses/:courseId', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const query = querySchema.parse(req.query);
    if (query.from && query.to && query.from > query.to) throw new AppError(400, 'INVALID_PERIOD');
    res.json({ success: true, data: await courseAnalytics(course._id, query) });
  } catch (error) { next(error); }
});

/** Classes the course is assigned to (for the class filter). */
courseAnalyticsRoutes.get('/courses/:courseId/classes', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const course = await getManageableCourse(req, req.params.courseId);
    const classes = await ClassGroup.find({ courseIds: course._id, archivedAt: null }).select('name studentIds').lean();
    res.json({ success: true, data: classes.map(group => ({ id: String(group._id), name: group.name, students: group.studentIds.length })) });
  } catch (error) { next(error); }
});

/** Courses the actor manages (used by the comparative dashboard of class instances). */
export const manageableCourses = async (req: AuthRequest) => Course.find(await manageableCourseFilter({ userId: req.auth!.userId, role: req.auth!.role })).select('_id title templateId isTemplate').lean();

/** Average overall grade (/20, working grades) over the students who have at least one counted grade. */
async function averageGrade(courseId: unknown) {
  const [categories, columns, entries, students] = await Promise.all([
    GradeCategory.find({ courseId }).lean(), GradeColumn.find({ courseId, archivedAt: null }).lean(), GradeEntry.find({ courseId }).lean(), Enrollment.find({ courseId }).distinct('studentId'),
  ]);
  const categoryInputs = categories.map(category => ({ id: String(category._id), name: category.name, weight: category.weight }));
  const columnInputs = columns.map(column => ({ id: String(column._id), categoryId: String(column.categoryId), maxPoints: column.maxPoints, countsInFinal: column.countsInFinal, missingAsZero: column.missingAsZero, dueAt: column.dueAt }));
  const totals = students.map(studentId => computeGrades(categoryInputs, columnInputs, entries.filter(entry => String(entry.studentId) === String(studentId)).map(entry => ({ columnId: String(entry.columnId), score: entry.score, excused: entry.excused, dueAt: entry.exception?.dueAt }))).outOf20)
    .filter((value): value is number => value !== null);
  return { average: totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length * 100) / 100 : null, gradedStudents: totals.length };
}

/** Comparative dashboard of a template's class instances (each figure computed from that class's own records). */
courseAnalyticsRoutes.get('/templates/:templateId/compare', ...managers, async (req: AuthRequest, res, next) => {
  try {
    const template = await getManageableCourse(req, req.params.templateId);
    const filter = await manageableCourseFilter({ userId: req.auth!.userId, role: req.auth!.role });
    const instances = await Course.find({ $and: [filter, { 'templateLink.templateId': template._id }] }).select('_id title courseCode settings').sort({ createdAt: 1 }).lean();
    const inactiveDays = querySchema.parse(req.query).inactiveDays;
    const rows = [];
    for (const instance of instances) {
      const report = await courseAnalytics(instance._id, { inactiveDays });
      rows.push({ id: String(instance._id), title: instance.title, courseCode: instance.courseCode, startsAt: instance.settings?.startsAt ?? null, ...report.totals, publishedItems: report.authoring.published, items: report.authoring.items, grades: await averageGrade(instance._id) });
    }
    res.json({ success: true, data: { template: { id: String(template._id) }, inactiveDays, classes: rows } });
  } catch (error) { next(error); }
});
