import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_grade_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir, User, Course, Enrollment, AssignmentSubmission, readZip;

describe('Gradebook on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-grade-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, assignments, zip] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/assignments/models.js'), import('../dist/common/zip.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; AssignmentSubmission = assignments.AssignmentSubmission; readZip = zip.readZip;
    await Promise.all([User.init(), Course.init(), Enrollment.init()]);
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
  const api = who => async (method, url, body, raw = false) => {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    if (raw) return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };

  let call, alice, bob, aliceCall, bobCall, outsiderCall, courseId, assignmentId;
  const book = async () => (await call('GET', `/gradebook/${courseId}`)).body.data;
  const columnOf = (data, kind) => data.columns.find(column => column.source.kind === kind);

  test('setup: course, two students, an assignment submitted and corrected', async () => {
    const teacher = await account('teacher', 'grade-teacher@example.test');
    alice = await account('student', 'alice@example.test'); bob = await account('student', 'bob@example.test');
    const outsider = await account('teacher', 'grade-outsider@example.test');
    call = api(teacher); aliceCall = api(alice); bobCall = api(bob); outsiderCall = api(outsider);
    const course = await Course.create({
      title: 'Application Côté Client', slug: 'acc-grades', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published',
      chapters: [{ id: 'c1', title: 'Chapitre 1', order: 0, visibility: 'visible', lessons: [{ id: 'l1', chapterId: 'c1', title: 'Signals', type: 'text', durationMinutes: 5, resources: [], commentsCount: 0,
        quiz: { id: 'q', title: 'Quiz', durationMinutes: 5, passPercentage: 50, questions: [{ id: 'q1', question: '?', options: ['a', 'b'], correctOptionIndex: 0, explanation: '' }] } }] }],
    });
    courseId = String(course._id);
    await Enrollment.create([{ studentId: alice.user._id, courseId, accessType: 'free' }, { studentId: bob.user._id, courseId, accessType: 'free' }]);
    const created = await call('POST', '/assignments', { courseId, title: 'TP Signals', instructions: 'Implémenter un compteur', dueAt: new Date(Date.now() + 86_400_000).toISOString(), points: 20, status: 'published' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assignmentId = created.body.data.id;
    for (const student of [aliceCall, bobCall]) {
      const form = new FormData(); form.append('answerText', 'Mon travail');
      assert.equal((await student('POST', `/assignments/${assignmentId}/submissions`, form)).status, 201);
    }
    const data = await book();
    const column = columnOf(data, 'assignment');
    assert.equal(column.maxPoints, 20);
    assert.equal(data.categories.find(category => category.id === column.categoryId).key, 'assignments', 'linked to the Assignments category');
    assert.deepEqual(data.entries.filter(entry => entry.columnId === column.id).map(entry => entry.status), ['pending', 'pending']);

    const submission = await AssignmentSubmission.findOne({ studentId: alice.user._id }).lean();
    const graded = await call('PATCH', `/assignments/${assignmentId}/submissions/${submission._id}/grade`, { score: 16, feedback: 'Bien' });
    assert.equal(graded.status, 200);
  });

  test('a corrected grade stays private until published', async () => {
    const data = await book();
    const entry = data.entries.find(candidate => candidate.columnId === columnOf(data, 'assignment').id && candidate.studentId === String(alice.user._id));
    assert.equal(entry.status, 'graded'); assert.equal(entry.score, 16); assert.equal(entry.published, null);
    const list = (await aliceCall('GET', '/assignments')).body.data[0];
    assert.equal(list.submission.score, undefined, 'assignment list hides the unpublished grade');
    assert.equal(list.submission.feedback, '');
    const mine = (await aliceCall('GET', `/gradebook/me/${courseId}`)).body.data;
    assert.equal(mine.columns.find(column => column.kind === 'assignment').score, null);
    assert.equal(mine.totals.outOf20, null, 'nothing published: no total, not 0');
  });

  test('lesson quiz attempts feed an automatically released column', async () => {
    assert.equal((await aliceCall('POST', `/enrollments/${courseId}/lessons/l1/quiz-attempts`, { answers: [{ questionId: 'q1', selectedOptionIndex: 1 }] })).status, 201);
    assert.equal((await aliceCall('POST', `/enrollments/${courseId}/lessons/l1/quiz-attempts`, { answers: [{ questionId: 'q1', selectedOptionIndex: 0 }] })).status, 201);
    const data = await book();
    const quiz = columnOf(data, 'lesson_quiz');
    assert.equal(quiz.releaseMode, 'auto');
    const entry = data.entries.find(candidate => candidate.columnId === quiz.id && candidate.studentId === String(alice.user._id));
    assert.equal(entry.score, 100, 'best attempt');
    assert.equal(entry.status, 'published');
  });

  test('manual column, validation, conflicts and weighted totals out of 20', async () => {
    let data = await book();
    const general = data.categories.find(category => category.key === 'general');
    const created = await call('POST', `/gradebook/${courseId}/columns`, { categoryId: general.id, title: 'Oral', maxPoints: 10 });
    assert.equal(created.status, 201);
    const oral = created.body.data;
    assert.equal((await call('PUT', `/gradebook/${courseId}/entries/${oral.id}/${alice.user._id}`, { score: 11 })).status, 400, 'above maximum');
    assert.equal((await call('PUT', `/gradebook/${courseId}/entries/${oral.id}/${(await User.findOne({ email: 'grade-outsider@example.test' }))._id}`, { score: 5 })).status, 404, 'not a student of the course');
    const first = await call('PUT', `/gradebook/${courseId}/entries/${oral.id}/${alice.user._id}`, { score: 5, expectedUpdatedAt: null });
    assert.equal(first.status, 200);
    assert.equal((await call('PUT', `/gradebook/${courseId}/entries/${oral.id}/${alice.user._id}`, { score: 6, expectedUpdatedAt: null })).status, 409, 'stale client');
    // Weights: Assignments 50, Quiz 0 (excluded), General 50.
    data = await book();
    for (const category of data.categories) await call('PATCH', `/gradebook/${courseId}/categories/${category.id}`, { weight: category.key === 'quizzes' ? 0 : 50 });
    data = await book();
    const totals = data.totals.find(total => total.studentId === String(alice.user._id)).working;
    // Assignments 16/20 = 80 %, General 5/10 = 50 % → 65 % → 13/20.
    assert.equal(totals.percent, 65);
    assert.equal(totals.outOf20, 13);
    const bobTotals = data.totals.find(total => total.studentId === String(bob.user._id)).working;
    assert.equal(bobTotals.outOf20, null, 'Bob has no grade yet: null, never 0');
  });

  test('individual then global publication; a later correction needs a new publication', async () => {
    let data = await book();
    const column = columnOf(data, 'assignment');
    const bobSubmission = await AssignmentSubmission.findOne({ studentId: bob.user._id }).lean();
    await call('PATCH', `/assignments/${assignmentId}/submissions/${bobSubmission._id}/grade`, { score: 12, feedback: 'Correct' });
    let published = await call('POST', `/gradebook/${courseId}/columns/${column.id}/publish`, { studentIds: [String(alice.user._id)] });
    assert.equal(published.body.data.published, 1);
    assert.equal((await aliceCall('GET', '/assignments')).body.data[0].submission.score, 16);
    assert.equal((await bobCall('GET', '/assignments')).body.data[0].submission.score, undefined);
    published = await call('POST', `/gradebook/${courseId}/columns/${column.id}/publish`, {});
    assert.equal(published.body.data.published, 1);
    assert.equal((await bobCall('GET', '/assignments')).body.data[0].submission.score, 12);
    // Correction after publication.
    data = await book();
    const entry = data.entries.find(candidate => candidate.columnId === column.id && candidate.studentId === String(alice.user._id));
    const corrected = await call('PUT', `/gradebook/${courseId}/entries/${column.id}/${alice.user._id}`, { score: 18, expectedUpdatedAt: entry.updatedAt });
    assert.equal(corrected.body.data.status, 'graded');
    assert.equal(corrected.body.data.overridden, true);
    const mine = (await aliceCall('GET', `/gradebook/me/${courseId}`)).body.data;
    assert.equal(mine.columns.find(row => row.kind === 'assignment').score, 16, 'student still sees the published grade');
    assert.equal(mine.columns.find(row => row.kind === 'assignment').feedback, 'Bien');
    assert.ok(mine.totals.outOf20 !== null);
    assert.doesNotMatch(JSON.stringify(mine), /"score":18/);
  });

  test('exceptions: extension of the due date and excused grades', async () => {
    const data = await book();
    const general = data.categories.find(category => category.key === 'general');
    const late = (await call('POST', `/gradebook/${courseId}/columns`, { categoryId: general.id, title: 'Rapport', maxPoints: 20, missingAsZero: true, dueAt: new Date(Date.now() - 86_400_000).toISOString() })).body.data;
    const extended = await call('PUT', `/gradebook/${courseId}/entries/${late.id}/${bob.user._id}`, { exception: { dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), extraAttempts: 1 } });
    assert.equal(extended.status, 200);
    let totals = (await book()).totals;
    const aliceBefore = totals.find(total => total.studentId === String(alice.user._id)).working.categories.find(category => category.categoryId === general.id).percent;
    // Alice: Oral 5/10 + Rapport missing (due date passed) = 0/20 → 5/30.
    assert.equal(aliceBefore, 16.67);
    const bobGeneral = totals.find(total => total.studentId === String(bob.user._id)).working.categories.find(category => category.categoryId === general.id).percent;
    assert.equal(bobGeneral, null, 'Bob has an extension: his missing report is not counted yet');
    await call('PUT', `/gradebook/${courseId}/entries/${late.id}/${alice.user._id}`, { excused: true });
    totals = (await book()).totals;
    assert.equal(totals.find(total => total.studentId === String(alice.user._id)).working.categories.find(category => category.categoryId === general.id).percent, 50);
  });

  test('permissions: students, outsiders and other students are refused', async () => {
    assert.equal((await aliceCall('GET', `/gradebook/${courseId}`)).status, 403);
    assert.equal((await outsiderCall('GET', `/gradebook/${courseId}`)).status, 404);
    const data = await book();
    const column = data.columns[0];
    assert.equal((await aliceCall('PUT', `/gradebook/${courseId}/entries/${column.id}/${alice.user._id}`, { score: 1 })).status, 403);
    assert.equal((await outsiderCall('POST', `/gradebook/${courseId}/columns/${column.id}/publish`, {})).status, 404);
    assert.equal((await outsiderCall('GET', `/gradebook/${courseId}/export?format=csv`)).status, 404);
    const stranger = await account('student', 'stranger@example.test');
    assert.equal((await api(stranger)('GET', `/gradebook/me/${courseId}`)).status, 404);
    const bobView = JSON.stringify((await bobCall('GET', `/gradebook/me/${courseId}`)).body);
    assert.doesNotMatch(bobView, new RegExp(String(alice.user._id)));
  });

  test('exports: CSV with BOM and formula neutralization, XLSX workbook', async () => {
    const data = await book();
    const general = data.categories.find(category => category.key === 'general');
    await call('POST', `/gradebook/${courseId}/columns`, { categoryId: general.id, title: '=cmd|calc', maxPoints: 5 });
    const csv = await call('GET', `/gradebook/${courseId}/export?format=csv`, undefined, true);
    assert.equal(csv.status, 200);
    const text = csv.buffer.toString('utf8');
    assert.ok(text.startsWith('﻿Student,Email'));
    assert.match(text, /'=cmd\|calc/);
    assert.match(text, /Total \/20/);
    const xlsx = await call('GET', `/gradebook/${courseId}/export?format=xlsx`, undefined, true);
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
    const sheet = readZip(xlsx.buffer).find(entry => entry.path === 'xl/worksheets/sheet1.xml').data.toString();
    assert.match(sheet, /alice@example.test/);
  });
});
