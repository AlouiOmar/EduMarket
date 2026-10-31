import { AppError } from '../../common/errors.js';
import { Course } from '../courses/model.js';
import { plainOutline, visibilityOf } from '../courses/structure.js';
import { Assignment, AssignmentSubmission } from '../assignments/models.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { createNotification } from '../notifications/service.js';
import { GradeCategory, GradeColumn, GradeEntry, SOURCE_KINDS } from './models.js';

type SourceKind = typeof SOURCE_KINDS[number];
type Language = 'fr' | 'en' | 'ar';

/** Default categories, created on demand in the course language (teachers rename and re-weight them freely). */
const DEFAULT_CATEGORIES: Record<string, Record<Language, string>> = {
  general: { fr: 'Général', en: 'General', ar: 'عام' },
  assignments: { fr: 'Devoirs', en: 'Assignments', ar: 'الواجبات' },
  quizzes: { fr: 'Quiz', en: 'Quizzes', ar: 'الاختبارات القصيرة' },
  tests: { fr: 'Tests', en: 'Tests', ar: 'الاختبارات' },
  participation: { fr: 'Participation', en: 'Participation', ar: 'المشاركة' },
  activities: { fr: 'Activités interactives', en: 'Interactive activities', ar: 'الأنشطة التفاعلية' },
};
const CATEGORY_OF: Record<SourceKind, string> = {
  manual: 'general', assignment: 'assignments', lesson_quiz: 'quizzes', test: 'tests', discussion: 'participation', journal: 'participation', scorm: 'activities', ai_conversation: 'activities', lti: 'activities',
};

export async function ensureCategory(courseId: unknown, key: string) {
  const existing = await GradeCategory.findOne({ courseId, key });
  if (existing) return existing;
  const course = await Course.findById(courseId).select('settings').lean();
  const language = (course?.settings?.language || 'fr') as Language;
  const order = await GradeCategory.countDocuments({ courseId });
  try {
    return await GradeCategory.create({ courseId, key, name: DEFAULT_CATEGORIES[key]?.[language] || key, weight: 1, order });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return (await GradeCategory.findOne({ courseId, key }))!;
    throw error;
  }
}

/** Column of a graded activity, created on first use (every graded activity has exactly one column, in a fitting category). */
export async function ensureColumn(courseId: unknown, kind: SourceKind, refId: string, values: { title: string; maxPoints: number; dueAt?: Date | null }) {
  const existing = await GradeColumn.findOne({ courseId, 'source.kind': kind, 'source.refId': refId });
  if (existing) {
    // Title/maximum follow the activity; the teacher's own settings (category, weight flags) are kept.
    if (existing.title !== values.title || existing.maxPoints !== values.maxPoints || String(existing.dueAt ?? '') !== String(values.dueAt ?? '')) {
      await GradeColumn.updateOne({ _id: existing._id }, { $set: { title: values.title.slice(0, 200), maxPoints: values.maxPoints, dueAt: values.dueAt ?? null } });
    }
    return existing;
  }
  const category = await ensureCategory(courseId, CATEGORY_OF[kind]);
  try {
    // Lesson quiz scores are shown to the student right after each attempt: their column is released automatically.
    return await GradeColumn.create({ courseId, categoryId: category._id, title: values.title.slice(0, 200), maxPoints: values.maxPoints, dueAt: values.dueAt ?? null, source: { kind, refId }, releaseMode: kind === 'lesson_quiz' ? 'auto' : 'manual', order: await GradeColumn.countDocuments({ courseId }) });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return (await GradeColumn.findOne({ courseId, 'source.kind': kind, 'source.refId': refId }))!;
    throw error;
  }
}

/**
 * Grade coming from an activity (automatic grading, assignment correction, submission awaiting grading).
 * A teacher override is never replaced by a later synchronization. With `releaseMode: auto` the grade is published at once.
 */
export async function recordSourceGrade(input: { courseId: unknown; kind: SourceKind; refId: string; studentId: unknown; score: number | null; status: 'pending' | 'graded'; feedback?: string; title: string; maxPoints: number; dueAt?: Date | null; graderId?: unknown; publishNow?: boolean }) {
  const column = await ensureColumn(input.courseId, input.kind, input.refId, { title: input.title, maxPoints: input.maxPoints, dueAt: input.dueAt });
  const current = await GradeEntry.findOne({ columnId: column._id, studentId: input.studentId }).lean();
  if (current?.overridden) return current;
  if (input.status === 'pending' && current && current.score !== null) return current;
  const set: Record<string, unknown> = { courseId: input.courseId, status: input.status, ...(input.status === 'graded' ? { score: input.score, gradedAt: new Date(), gradedBy: input.graderId || null } : {}) };
  if (input.feedback !== undefined) set.feedback = input.feedback;
  if (input.status === 'graded' && (column.releaseMode === 'auto' || input.publishNow)) {
    set.status = 'published';
    set.published = { score: input.score, feedback: input.feedback ?? current?.feedback ?? '', excused: current?.excused ?? false, at: new Date() };
  }
  return GradeEntry.findOneAndUpdate({ columnId: column._id, studentId: input.studentId }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}

/**
 * Links every graded activity of the course to a column and imports existing results (idempotent; run on gradebook load).
 * Lesson quizzes: best attempt, in percent (out of 100). Assignments: graded score, or "pending" when submitted.
 */
export async function syncCourseActivities(courseId: unknown) {
  const course = await Course.findById(courseId).select('chapters').lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
  const [assignments, attempts] = await Promise.all([
    Assignment.find({ courseId }).select('title points dueAt status').lean(),
    QuizAttempt.find({ courseId }).select('studentId lessonId score').lean(),
  ]);
  for (const assignment of assignments) {
    const column = await ensureColumn(courseId, 'assignment', String(assignment._id), { title: assignment.title, maxPoints: assignment.points, dueAt: assignment.dueAt });
    const submissions = await AssignmentSubmission.find({ assignmentId: assignment._id }).select('studentId status score feedback graderId').lean();
    const known = new Set((await GradeEntry.find({ columnId: column._id }).select('studentId').lean()).map(entry => String(entry.studentId)));
    for (const submission of submissions) {
      // Grades given before the gradebook existed were already shown to the student: they are imported as published.
      const legacyGrade = submission.status === 'graded' && !known.has(String(submission.studentId));
      await recordSourceGrade({ publishNow: legacyGrade, courseId, kind: 'assignment', refId: String(assignment._id), studentId: submission.studentId, score: submission.status === 'graded' ? submission.score ?? null : null, status: submission.status === 'graded' ? 'graded' : 'pending', feedback: submission.feedback, title: assignment.title, maxPoints: assignment.points, dueAt: assignment.dueAt, graderId: submission.graderId });
    }
  }
  const quizItems = plainOutline(course.chapters).flatMap(container => container.lessons.filter(item => item.quiz && (visibilityOf(item) === 'visible' || Number(item.publishedVersion || 0) > 0)));
  for (const item of quizItems) {
    const title = `Quiz : ${item.title}`;
    const column = await ensureColumn(courseId, 'lesson_quiz', item.id, { title, maxPoints: 100 });
    const best = new Map<string, number>();
    for (const attempt of attempts.filter(candidate => candidate.lessonId === item.id)) best.set(String(attempt.studentId), Math.max(best.get(String(attempt.studentId)) ?? 0, attempt.score));
    const known = new Map((await GradeEntry.find({ columnId: column._id }).select('studentId score').lean()).map(entry => [String(entry.studentId), entry.score]));
    for (const [studentId, score] of best) {
      if (known.get(studentId) !== score) await recordSourceGrade({ courseId, kind: 'lesson_quiz', refId: item.id, studentId, score, status: 'graded', title, maxPoints: 100 });
    }
  }
}

/** Publishes graded entries of a column (all, or the given students). Ungraded entries are never published. */
export async function publishColumn(courseId: unknown, columnId: unknown, studentIds?: string[]) {
  const column = await GradeColumn.findOne({ _id: columnId, courseId }).lean();
  if (!column) throw new AppError(404, 'GRADE_COLUMN_NOT_FOUND');
  const filter: Record<string, unknown> = { columnId: column._id, status: 'graded', ...(studentIds?.length ? { studentId: { $in: studentIds } } : {}) };
  const entries = await GradeEntry.find(filter).lean();
  const at = new Date();
  let published = 0;
  for (const entry of entries) {
    if (entry.score === null && !entry.excused) continue;
    // Guarded by the entry's update time: a grade changed meanwhile is not published blindly.
    const result = await GradeEntry.updateOne({ _id: entry._id, updatedAt: entry.updatedAt }, { $set: { status: 'published', published: { score: entry.score, feedback: entry.feedback, excused: entry.excused, at } } });
    if (result.modifiedCount) {
      published += 1;
      void createNotification({ userId: String(entry.studentId), type: 'course', title: 'Grade published', message: `A grade was published for "${column.title}".`, link: `/student/courses/${courseId}/grades`, template: { key: 'gradePublished', params: { column: column.title } } }).catch(() => undefined);
    }
  }
  return published;
}

/** Copies categories (names, weights) and manual columns to another course; grades are never copied. Linked columns are recreated by the activities themselves. */
export async function copyGradebookStructure(sourceCourseId: unknown, targetCourseId: unknown) {
  const categoryMap = new Map<string, unknown>();
  for (const category of await GradeCategory.find({ courseId: sourceCourseId }).sort({ order: 1 }).lean()) {
    const copy = await GradeCategory.findOneAndUpdate(
      category.key ? { courseId: targetCourseId, key: category.key } : { courseId: targetCourseId, name: category.name, key: '' },
      { $set: { name: category.name, weight: category.weight, order: category.order }, $setOnInsert: { courseId: targetCourseId, key: category.key || '' } },
      { upsert: true, new: true },
    ).lean();
    categoryMap.set(String(category._id), copy!._id);
  }
  const manual = await GradeColumn.find({ courseId: sourceCourseId, 'source.kind': 'manual', archivedAt: null }).lean();
  for (const column of manual) {
    const { _id, createdAt, updatedAt, ...rest } = column as any;
    await GradeColumn.create({ ...rest, courseId: targetCourseId, categoryId: categoryMap.get(String(column.categoryId)) });
  }
  return { categories: categoryMap.size, columns: manual.length };
}
