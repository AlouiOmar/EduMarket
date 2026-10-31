import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_assess_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir, User, Course, Enrollment, TestAttempt, BankQuestion, Assignment, AssignmentSubmission, GradeColumn, FormResponse;

describe('Assessments on MongoDB (banks, tests, rubrics, assignments, forms)', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-assess-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, assessments, assignments, grades] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/assessments/models.js'), import('../dist/modules/assignments/models.js'), import('../dist/modules/gradebook/models.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; TestAttempt = assessments.TestAttempt; BankQuestion = assessments.BankQuestion;
    FormResponse = assessments.FormResponse; Assignment = assignments.Assignment; AssignmentSubmission = assignments.AssignmentSubmission; GradeColumn = grades.GradeColumn;
    await Promise.all([User.init(), Course.init(), Enrollment.init(), TestAttempt.init(), FormResponse.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (privateUploadDir) await rm(privateUploadDir, { recursive: true, force: true });
  });

  async function account(role, email) {
    const password = `${role}-password-2026`;
    const user = await User.create({ name: `${role} ${email}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active' });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { user, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = who => async (method, url, body) => {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };
  const single = (prompt, correct = 'b', extra = {}) => ({ type: 'single', prompt, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correct: [correct], points: 1, chapter: 'signals', difficulty: 'easy', ...extra });

  let teacher, call, student, studentCall, otherCall, outsiderCall, courseId, otherCourseId, bankId, essayId, testId, attemptId;
  const course = id => `/assessments/${id}`;

  test('setup: two courses managed by the teacher, an enrolled student', async () => {
    teacher = await account('teacher', 'assess-teacher@example.test');
    student = await account('student', 'assess-student@example.test');
    const other = await account('student', 'assess-other@example.test');
    const outsider = await account('teacher', 'assess-outsider@example.test');
    call = api(teacher); studentCall = api(student); otherCall = api(other); outsiderCall = api(outsider);
    const [first, second] = await Course.create([
      { title: 'Application Côté Client', slug: 'acc-assess', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published' },
      { title: 'Classe B', slug: 'acc-assess-b', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published' },
    ]);
    courseId = String(first._id); otherCourseId = String(second._id);
    await Enrollment.create([{ studentId: student.user._id, courseId, accessType: 'free' }, { studentId: other.user._id, courseId: otherCourseId, accessType: 'free' }]);
  });

  test('question bank: validated questions by chapter and difficulty, sanitized prompts', async () => {
    const bank = await call('POST', `${course(courseId)}/banks`, { title: 'Signals', description: 'Chapitre 2' });
    assert.equal(bank.status, 201);
    bankId = bank.body.data.id;
    for (let index = 1; index <= 4; index += 1) assert.equal((await call('POST', `${course(courseId)}/banks/${bankId}/questions`, single(`Question ${index} <script>alert(1)</script>`))).status, 201);
    assert.equal((await call('POST', `${course(courseId)}/banks/${bankId}/questions`, single('Hard', 'a', { difficulty: 'hard' }))).status, 201);
    assert.equal((await call('POST', `${course(courseId)}/banks/${bankId}/questions`, { ...single('Deux bonnes'), correct: ['a', 'b'] })).status, 400, 'single needs exactly one answer');
    assert.equal((await call('POST', `${course(courseId)}/banks/${bankId}/questions`, { type: 'true_false', prompt: 'Vrai ?', correct: ['maybe'] })).status, 400);
    const essay = await call('POST', `${course(courseId)}/banks/${bankId}/questions`, { type: 'essay', prompt: 'Expliquez computed()', points: 4, chapter: 'signals' });
    essayId = essay.body.data.id;
    const questions = (await call('GET', `${course(courseId)}/banks/${bankId}/questions`)).body.data;
    assert.equal(questions.length, 6);
    assert.doesNotMatch(questions[0].prompt, /script/);
  });

  test('test with a random draw: publication checks and gradebook column', async () => {
    const tooMany = await call('POST', `${course(courseId)}/tests`, { title: 'Trop', sections: [{ kind: 'random', bankId, count: 10 }] });
    assert.equal((await call('POST', `${course(courseId)}/tests/${tooMany.body.data.id}/publish`, {})).status, 422);
    const created = await call('POST', `${course(courseId)}/tests`, {
      title: 'Test Signals', instructions: '<p>30 minutes</p>', timeLimitMinutes: 30, maxAttempts: 1, shuffleQuestions: true, shuffleOptions: true,
      sections: [{ kind: 'random', bankId, count: 3, difficulty: 'easy' }, { kind: 'fixed', questionIds: [essayId] }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    testId = created.body.data.id;
    const published = await call('POST', `${course(courseId)}/tests/${testId}/publish`, {});
    assert.equal(published.status, 200);
    assert.equal(published.body.data.maxPoints, 7, '3 × 1 + essay 4');
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'test', 'source.refId': testId }).lean();
    assert.equal(column.maxPoints, 7);
  });

  test('student attempt: no answer key, secure resume, autosave, validation', async () => {
    const list = (await studentCall('GET', `${course(courseId)}/student/tests`)).body.data;
    assert.equal(list.find(test => test.id === testId).open, true);
    const [first, concurrent] = await Promise.all([1, 2].map(() => studentCall('POST', `${course(courseId)}/student/tests/${testId}/attempts`, {})));
    assert.ok([200, 201].includes(first.status) && [200, 201].includes(concurrent.status));
    assert.equal(first.body.data.id, concurrent.body.data.id, 'two tabs share a single attempt');
    attemptId = first.body.data.id;
    const questions = first.body.data.questions;
    assert.equal(questions.length, 4);
    assert.doesNotMatch(JSON.stringify(first.body), /"correct"|explanation/);
    const resumed = await studentCall('POST', `${course(courseId)}/student/tests/${testId}/attempts`, {});
    assert.deepEqual(resumed.body.data.questions.map(question => question.questionId), questions.map(question => question.questionId), 'resume keeps the same draw and order');
    const singles = questions.filter(question => question.type === 'single');
    const bad = await studentCall('PUT', `${course(courseId)}/student/attempts/${attemptId}/answers`, { answers: [{ questionId: singles[0].questionId, optionIds: ['zzz'] }] });
    assert.equal(bad.status, 400);
    const saved = await studentCall('PUT', `${course(courseId)}/student/attempts/${attemptId}/answers`, { answers: [
      ...singles.map((question, index) => ({ questionId: question.questionId, optionIds: [index === 0 ? 'a' : 'b'] })),
      { questionId: essayId, text: 'computed() dérive une valeur' },
    ] });
    assert.equal(saved.status, 200);
    const reloaded = (await studentCall('GET', `${course(courseId)}/student/attempts/${attemptId}`)).body.data;
    assert.equal(reloaded.answers.length, 4, 'answers survive a reload');
    assert.equal((await otherCall('GET', `${course(courseId)}/student/attempts/${attemptId}`)).status, 404, 'another student cannot open it');
  });

  test('editing a bank question afterwards never changes the attempt snapshot', async () => {
    const before = await TestAttempt.findById(attemptId).lean();
    const target = before.questions.find(question => question.type === 'single');
    await call('PUT', `${course(courseId)}/questions/${target.questionId}`, single('Question modifiée', 'c'));
    const after = await TestAttempt.findById(attemptId).lean();
    assert.deepEqual(after.questions.find(question => question.questionId === target.questionId).correct, target.correct);
  });

  test('submission: automatic grading, essay left for manual grading, grade released only when published', async () => {
    const submitted = await studentCall('POST', `${course(courseId)}/student/attempts/${attemptId}/submit`, {});
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.status, 'needs_grading');
    assert.equal(submitted.body.data.score, undefined);
    assert.equal((await studentCall('PUT', `${course(courseId)}/student/attempts/${attemptId}/answers`, { answers: [] })).status, 409, 'closed after submission');
    const attempts = (await call('GET', `${course(courseId)}/tests/${testId}/attempts`)).body.data;
    assert.equal(attempts[0].autoScores.reduce((sum, row) => sum + row.score, 0), 2, 'two correct singles out of three');
    assert.equal((await call('PATCH', `${course(courseId)}/attempts/${attemptId}/grade`, { scores: [{ questionId: essayId, score: 5 }] })).status, 400, 'above the question points');
    const graded = await call('PATCH', `${course(courseId)}/attempts/${attemptId}/grade`, { scores: [{ questionId: essayId, score: 3, feedback: 'Bien' }] });
    assert.equal(graded.body.data.status, 'graded');
    assert.equal(graded.body.data.score, 5);
    let view = (await studentCall('GET', `${course(courseId)}/student/attempts/${attemptId}`)).body.data;
    assert.equal(view.gradePublished, false);
    assert.equal(view.score, undefined);
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'test', 'source.refId': testId }).lean();
    await call('PATCH', `${course(courseId)}/tests/${testId}`, { showCorrectAnswers: true });
    assert.equal((await call('POST', `/gradebook/${courseId}/columns/${column._id}/publish`, {})).body.data.published, 1);
    view = (await studentCall('GET', `${course(courseId)}/student/attempts/${attemptId}`)).body.data;
    assert.equal(view.score, 5);
    assert.ok(view.questions.some(question => Array.isArray(question.correct)), 'key shown after publication when enabled');
  });

  test('attempt limit, individual extra attempt, and expiry with auto-submission', async () => {
    assert.equal((await studentCall('POST', `${course(courseId)}/student/tests/${testId}/attempts`, {})).status, 409);
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'test', 'source.refId': testId }).lean();
    await call('PUT', `/gradebook/${courseId}/entries/${column._id}/${student.user._id}`, { exception: { extraAttempts: 1 } });
    const second = await studentCall('POST', `${course(courseId)}/student/tests/${testId}/attempts`, {});
    assert.equal(second.status, 201);
    assert.equal(second.body.data.number, 2);
    await TestAttempt.updateOne({ _id: second.body.data.id }, { $set: { deadlineAt: new Date(Date.now() - 60_000) } });
    const late = await studentCall('PUT', `${course(courseId)}/student/attempts/${second.body.data.id}/answers`, { answers: [] });
    assert.equal(late.status, 409);
    const closed = await TestAttempt.findById(second.body.data.id).lean();
    assert.notEqual(closed.status, 'in_progress');
    assert.equal(closed.autoSubmitted, true);
    assert.equal((await call('PATCH', `${course(courseId)}/tests/${testId}`, { sections: [{ kind: 'random', bankId, count: 1 }] })).status, 409, 'questions locked once attempted');
  });

  test('banks copy to another managed course without any student data; outsiders refused', async () => {
    const copy = await call('POST', `${course(courseId)}/banks/${bankId}/copy`, { targetCourseId: otherCourseId });
    assert.equal(copy.status, 201);
    assert.equal(copy.body.data.questionCount, 6);
    assert.equal(await TestAttempt.countDocuments({ courseId: otherCourseId }), 0);
    const outsiderCourse = await Course.create({ title: 'Autre', slug: 'other-owner', description: 'x', category: 'Web', teacherId: (await User.findOne({ email: 'assess-outsider@example.test' }))._id, status: 'published' });
    assert.equal((await call('POST', `${course(courseId)}/banks/${bankId}/copy`, { targetCourseId: String(outsiderCourse._id) })).status, 404);
  });

  test('permissions: students and outsiders on teacher endpoints, students of another course', async () => {
    assert.equal((await studentCall('GET', `${course(courseId)}/banks`)).status, 403);
    assert.equal((await outsiderCall('GET', `${course(courseId)}/banks`)).status, 404);
    assert.equal((await outsiderCall('GET', `${course(courseId)}/tests/${testId}/attempts`)).status, 404);
    assert.equal((await outsiderCall('PATCH', `${course(courseId)}/attempts/${attemptId}/grade`, { scores: [{ questionId: essayId, score: 4 }] })).status, 404);
    assert.equal((await otherCall('GET', `${course(courseId)}/student/tests`)).status, 404, 'not enrolled');
    assert.equal((await otherCall('POST', `${course(courseId)}/student/tests/${testId}/attempts`, {})).status, 404);
  });

  test('assignment with rubric, late window and penalty, multiple attempts with history', async () => {
    const rubric = await call('POST', `${course(courseId)}/rubrics`, { title: 'TP', criteria: [
      { id: 'code', title: 'Code', levels: [{ id: 'weak', title: 'Faible', points: 0 }, { id: 'good', title: 'Bon', points: 10 }] },
      { id: 'tests', title: 'Tests', levels: [{ id: 'none', title: 'Aucun', points: 0 }, { id: 'full', title: 'Complets', points: 10 }] },
    ] });
    assert.equal(rubric.status, 201);
    const created = await call('POST', '/assignments', { courseId, title: 'TP Signals', instructions: 'Implémenter le panier', dueAt: new Date(Date.now() + 3_600_000).toISOString(), points: 20,
      rubricId: rubric.body.data.id, lateUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(), latePenaltyPercent: 10, maxAttempts: 2 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const assignmentId = created.body.data.id;
    await Assignment.updateOne({ _id: assignmentId }, { $set: { dueAt: new Date(Date.now() - 60_000) } });
    const visible = (await studentCall('GET', '/assignments')).body.data.find(row => row.id === assignmentId);
    assert.equal(visible.status, 'late_open');
    assert.equal(visible.rubric.title, 'TP', 'rubric visible before submission');
    const form = new FormData(); form.append('answerText', 'Ma solution'); form.append('links', 'https://github.com/student/tp');
    const submitted = await studentCall('POST', `/assignments/${assignmentId}/submissions`, form);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.late, true);
    const submission = await AssignmentSubmission.findOne({ assignmentId }).lean();
    assert.equal((await call('PATCH', `/assignments/${assignmentId}/submissions/${submission._id}/grade`, { rubricRatings: [{ criterionId: 'code', levelId: 'good' }] })).status, 422, 'incomplete rubric');
    const graded = await call('PATCH', `/assignments/${assignmentId}/submissions/${submission._id}/grade`, { rubricRatings: [{ criterionId: 'code', levelId: 'good' }, { criterionId: 'tests', levelId: 'none' }], feedback: 'Ajoutez des tests' });
    assert.equal(graded.status, 200);
    assert.equal(graded.body.data.rawScore, 10);
    assert.equal(graded.body.data.score, 9, '10/20 minus 10 % late penalty');
    const again = new FormData(); again.append('answerText', 'Version 2 avec tests');
    const resubmitted = await studentCall('POST', `/assignments/${assignmentId}/submissions`, again);
    assert.equal(resubmitted.status, 200);
    assert.equal(resubmitted.body.data.attemptCount, 2);
    const stored = await AssignmentSubmission.findOne({ assignmentId }).lean();
    assert.equal(stored.history.length, 1);
    assert.equal(stored.history[0].score, 9);
    assert.equal(stored.score, undefined);
    const third = new FormData(); third.append('answerText', 'Version 3');
    assert.equal((await studentCall('POST', `/assignments/${assignmentId}/submissions`, third)).status, 409, 'two attempts maximum');
    const badLink = new FormData(); badLink.append('links', 'javascript:alert(1)');
    assert.equal((await studentCall('POST', `/assignments/${assignmentId}/submissions`, badLink)).status, 400);
  });

  test('anonymous form: one answer per student, no identity stored, no gradebook column', async () => {
    const created = await call('POST', `${course(courseId)}/forms`, { title: 'Retour sur le module', anonymous: true, questions: [
      { id: 'q1', type: 'scale', prompt: 'Difficulté', required: true }, { id: 'q2', type: 'single', prompt: 'Rythme', options: ['Lent', 'Bon', 'Rapide'] }, { id: 'q3', type: 'text', prompt: 'Commentaire' },
    ] });
    assert.equal(created.status, 201);
    const formId = created.body.data.id;
    assert.equal((await studentCall('POST', `${course(courseId)}/student/forms/${formId}/responses`, { answers: [] })).status, 404, 'draft form');
    await call('PATCH', `${course(courseId)}/forms/${formId}`, { status: 'published' });
    assert.equal((await studentCall('POST', `${course(courseId)}/student/forms/${formId}/responses`, { answers: [{ questionId: 'q2', values: ['Bon'] }] })).status, 422, 'required answer missing');
    assert.equal((await studentCall('POST', `${course(courseId)}/student/forms/${formId}/responses`, { answers: [{ questionId: 'q1', values: ['4'] }, { questionId: 'q2', values: ['Bon'] }, { questionId: 'q3', values: ['Très clair'] }] })).status, 201);
    assert.equal((await studentCall('POST', `${course(courseId)}/student/forms/${formId}/responses`, { answers: [{ questionId: 'q1', values: ['2'] }] })).status, 409, 'answered once');
    const stored = await FormResponse.findOne({ formId }).lean();
    assert.equal(stored.respondentId, null);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(String(student.user._id)));
    const results = (await call('GET', `${course(courseId)}/forms/${formId}/responses`)).body.data;
    assert.equal(results.total, 1);
    assert.equal(results.responses[0].respondent, null);
    assert.equal(results.tallies.find(row => row.questionId === 'q2').counts.Bon, 1);
    assert.equal((await call('PATCH', `${course(courseId)}/forms/${formId}`, { anonymous: false })).status, 409, 'anonymity cannot be lifted after answers');
    assert.equal(await GradeColumn.countDocuments({ courseId, title: 'Retour sur le module' }), 0);
    assert.equal((await studentCall('GET', `${course(courseId)}/student/forms`)).body.data[0].answered, true);
  });
});
