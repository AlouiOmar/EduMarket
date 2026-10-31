import crypto from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { GradeColumn, GradeEntry } from '../gradebook/models.js';
import { ensureColumn, recordSourceGrade } from '../gradebook/service.js';
import { attemptTotal, autoScore, drawQuestions, keptScore, shuffle } from './grading.js';
import { BankQuestion, Form, FormResponse, QuestionBank, Rubric, Test, TestAttempt } from './models.js';

const GRACE_MS = 30_000;

/** Questions a section can use (archived questions are never drawn). */
async function sectionPool(section: any) {
  if (section.kind === 'fixed') return BankQuestion.find({ _id: { $in: section.questionIds }, archivedAt: null }).lean();
  return BankQuestion.find({ bankId: section.bankId, archivedAt: null }).lean();
}

/** Maximum points of a test when it is deterministic (fixed questions, or random draws from equally weighted questions). */
export async function testMaxPoints(test: any): Promise<number | null> {
  let total = 0;
  for (const section of test.sections) {
    const pool = await sectionPool(section);
    if (section.kind === 'fixed') { total += pool.reduce((sum, question) => sum + (question.points ?? 1), 0); continue; }
    const eligible = pool.filter(question => (!section.chapter || question.chapter === section.chapter) && (!section.difficulty || question.difficulty === section.difficulty));
    const points = new Set(eligible.map(question => question.points ?? 1));
    if (points.size !== 1) return null;
    total += section.count * [...points][0];
  }
  return Math.round(total * 100) / 100;
}

/** Publication checks: every section can be served (enough questions for each draw). Creates the gradebook column. */
export async function validateAndLinkTest(test: any) {
  if (!test.sections.length) throw new AppError(422, 'TEST_HAS_NO_QUESTIONS');
  for (const section of test.sections) {
    const pool = await sectionPool(section);
    if (section.kind === 'fixed' && pool.length !== section.questionIds.length) throw new AppError(422, 'TEST_QUESTION_MISSING');
    if (section.kind === 'random') {
      try { drawQuestions(pool as any[], section.count, { chapter: section.chapter, difficulty: section.difficulty }); }
      catch { throw new AppError(422, 'NOT_ENOUGH_QUESTIONS'); }
    }
  }
  const max = await testMaxPoints(test);
  await ensureColumn(test.courseId, 'test', String(test._id), { title: test.title, maxPoints: max ?? 100, dueAt: test.availableUntil });
  return max;
}

/** Builds the questions of a new attempt: snapshot (with answer key, kept server-side), draws and shuffles. */
export async function buildAttemptQuestions(test: any) {
  const used = new Set<string>();
  let questions: any[] = [];
  for (const section of test.sections) {
    const pool = (await sectionPool(section)).filter(question => !used.has(String(question._id)));
    const picked = section.kind === 'fixed' ? pool : drawQuestions(pool as any[], section.count, { chapter: section.chapter, difficulty: section.difficulty });
    for (const question of picked) used.add(String(question._id));
    questions.push(...picked);
  }
  if (test.shuffleQuestions) questions = shuffle(questions);
  return questions.map(question => ({
    questionId: String(question._id), type: question.type, prompt: question.prompt, correct: question.correct, caseSensitive: question.caseSensitive,
    points: question.points ?? 1, explanation: question.explanation,
    options: test.shuffleOptions && ['single', 'multiple'].includes(question.type) ? shuffle(question.options) : question.options,
  }));
}

/** Grade kept in the gradebook for this student (best or last graded attempt), scaled to the column maximum. */
export async function syncTestGrade(test: any, studentId: unknown) {
  const attempts = await TestAttempt.find({ testId: test._id, studentId, status: { $ne: 'in_progress' } }).lean();
  if (!attempts.length) return;
  const max = await testMaxPoints(test);
  const columnMax = max ?? 100;
  const scaled = attempts.map(attempt => ({ ...attempt, score: attempt.score === null || attempt.score === undefined || !attempt.maxScore ? attempt.score ?? null : Math.round(attempt.score / attempt.maxScore * columnMax * 100) / 100 }));
  const kept = keptScore(scaled, test.gradePolicy);
  // Essays awaiting correction keep the entry "pending" until a graded attempt exists.
  await recordSourceGrade({ courseId: test.courseId, kind: 'test', refId: String(test._id), studentId, score: kept, status: kept === null ? 'pending' : 'graded', title: test.title, maxPoints: columnMax, dueAt: test.availableUntil });
}

/** Closes an attempt: automatic grading, essays left for the teacher. Idempotent (only an in-progress attempt changes). */
export async function finalizeAttempt(attemptId: unknown, options: { auto?: boolean } = {}) {
  const attempt = await TestAttempt.findOne({ _id: attemptId, status: 'in_progress' }).lean();
  if (!attempt) return TestAttempt.findById(attemptId).lean();
  const autoScores = attempt.questions.map(question => ({ questionId: question.questionId, score: autoScore(question as any, attempt.answers.find(answer => answer.questionId === question.questionId) as any) }));
  const total = attemptTotal(attempt.questions as any[], autoScores, attempt.manual as any[]);
  const maxScore = attempt.questions.reduce((sum, question) => sum + (question.points ?? 0), 0);
  const updated = await TestAttempt.findOneAndUpdate({ _id: attempt._id, status: 'in_progress' }, {
    $set: { status: total === null ? 'needs_grading' : 'graded', score: total, maxScore, autoScores: autoScores.filter(entry => entry.score !== null), submittedAt: new Date(), autoSubmitted: !!options.auto },
  }, { new: true }).lean();
  if (updated) {
    const test = await Test.findById(attempt.testId).lean();
    if (test) await syncTestGrade(test, attempt.studentId);
  }
  return updated ?? TestAttempt.findById(attemptId).lean();
}

export const attemptExpired = (attempt: { deadlineAt?: Date | null }, now = Date.now()) => !!attempt.deadlineAt && now > new Date(attempt.deadlineAt).getTime() + GRACE_MS;

/** Background job: attempts whose time is up are submitted with the answers saved so far. */
export async function finalizeExpiredAttempts(now = new Date()) {
  const expired = await TestAttempt.find({ status: 'in_progress', deadlineAt: { $ne: null, $lt: new Date(now.getTime() - GRACE_MS) } }).select('_id').limit(200).lean();
  for (const attempt of expired) await finalizeAttempt(attempt._id, { auto: true }).catch(error => console.error('Attempt finalization failed', { name: (error as Error).name }));
  return expired.length;
}

/** Extra attempts and extended due date granted to the student in the gradebook. */
export async function studentException(courseId: unknown, testId: unknown, studentId: unknown) {
  const column = await GradeColumn.findOne({ courseId, 'source.kind': 'test', 'source.refId': String(testId) }).select('_id').lean();
  const entry = column ? await GradeEntry.findOne({ columnId: column._id, studentId }).select('exception published status').lean() : null;
  return { extraAttempts: entry?.exception?.extraAttempts ?? 0, dueAt: entry?.exception?.dueAt ?? null, published: entry?.published ?? null };
}

/** Anonymous-form key: stable per student and form (prevents double answers) without storing who answered. */
export const respondentKey = (secret: string, formId: string, studentId: string) => crypto.createHmac('sha256', secret).update(`${formId}:${studentId}`).digest('hex');

/** Copies banks (with questions), rubrics, tests and forms to another course. Attempts, responses and grades are never copied. */
export async function copyAssessments(sourceCourseId: unknown, targetCourseId: unknown) {
  const bankMap = new Map<string, unknown>(), questionMap = new Map<string, unknown>();
  for (const bank of await QuestionBank.find({ courseId: sourceCourseId }).lean()) {
    const created = await QuestionBank.create({ courseId: targetCourseId, title: bank.title, description: bank.description, copiedFrom: bank._id });
    bankMap.set(String(bank._id), created._id);
    for (const question of await BankQuestion.find({ bankId: bank._id, archivedAt: null }).lean()) {
      const { _id, createdAt, updatedAt, ...rest } = question as any;
      const copy = await BankQuestion.create({ ...rest, courseId: targetCourseId, bankId: created._id });
      questionMap.set(String(_id), copy._id);
    }
  }
  for (const rubric of await Rubric.find({ courseId: sourceCourseId }).lean()) {
    const { _id, createdAt, updatedAt, ...rest } = rubric as any;
    await Rubric.create({ ...rest, courseId: targetCourseId, copiedFrom: _id });
  }
  for (const test of await Test.find({ courseId: sourceCourseId }).lean()) {
    const { _id, createdAt, updatedAt, ...rest } = test as any;
    await Test.create({
      ...rest, courseId: targetCourseId, status: 'draft',
      sections: test.sections.map((section: any) => ({ ...section, bankId: section.bankId ? bankMap.get(String(section.bankId)) ?? null : null, questionIds: section.questionIds.map((id: unknown) => questionMap.get(String(id))).filter(Boolean) })),
    });
  }
  for (const form of await Form.find({ courseId: sourceCourseId }).lean()) {
    const { _id, createdAt, updatedAt, ...rest } = form as any;
    await Form.create({ ...rest, courseId: targetCourseId, status: 'draft' });
  }
  return { banks: bankMap.size, questions: questionMap.size };
}

export { FormResponse };
