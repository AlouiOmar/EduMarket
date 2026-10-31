import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Own database (…_pub_test): suites run in parallel and each one drops its database on start.
const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_pub_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir, User, Course, Enrollment, QuizAttempt, ContentVersion, publishDueItems;

describe('Drafts, publication and versions on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-pub-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, attempts, versions, service] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/enrollments/quiz-attempt.model.js'), import('../dist/modules/courses/version.model.js'), import('../dist/modules/courses/publication.service.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; QuizAttempt = attempts.QuizAttempt; ContentVersion = versions.ContentVersion; publishDueItems = service.publishDueItems;
    await Promise.all([User.init(), Course.init(), Enrollment.init(), ContentVersion.init()]);
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
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };
  const quiz = correct => ({ id: 'quiz_signals', title: 'Quiz', durationMinutes: 5, passPercentage: 50, questions: [{ id: 'q1', question: 'signal() ?', options: ['A', 'B'], correctOptionIndex: correct, explanation: '' }] });

  let call, studentCall, outsiderCall, student, courseId, itemId, containerId;
  const teacherItem = async () => (await call('GET', `/courses/mine/${courseId}`)).body.data.chapters.flatMap(chapter => chapter.lessons).find(lesson => lesson.id === itemId);
  const studentItem = async () => (await studentCall('GET', `/courses/${courseId}`)).body.data.chapters.flatMap(chapter => chapter.lessons).find(lesson => lesson.id === itemId);

  test('setup: a published lesson with a quiz, an enrolled student', async () => {
    const teacher = await account('teacher', 'pub-teacher@example.test');
    student = await account('student', 'pub-student@example.test');
    const outsider = await account('teacher', 'pub-outsider@example.test');
    call = api(teacher); studentCall = api(student); outsiderCall = api(outsider);
    const created = await call('POST', '/courses', { title: 'Application Côté Client', description: 'Angular', category: 'Web', price: 0, settings: { language: 'fr', startsAt: null, endsAt: null, notifyStudents: false, timezone: 'Africa/Tunis' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    courseId = created.body.data._id;
    await Course.updateOne({ _id: courseId }, { $set: { status: 'published' } });
    let response = await call('POST', `/courses/${courseId}/structure/containers`, { expectedVersion: 0, kind: 'module', title: 'Chapitre 1' });
    containerId = response.body.data.createdId;
    response = await call('POST', `/courses/${courseId}/structure/items`, { expectedVersion: response.body.data.structureVersion, containerId, type: 'text', title: 'Signals v1' });
    itemId = response.body.data.createdId;
    // Never published yet: edited in place.
    response = await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: 0, blocks: [{ id: 'b1', type: 'text', html: '<p>Version 1</p>' }], quiz: quiz(0) });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.item.publicationStatus, 'draft');
    assert.equal(response.body.data.item.draft, undefined);
    await call('PATCH', `/courses/${courseId}/structure/containers/${containerId}`, { visibility: 'visible' });
    response = await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { visibility: 'visible' });
    assert.equal(response.body.data.item.publicationStatus, 'published');
    assert.equal(response.body.data.item.publishedVersion, 1, 'first visibility is version 1');
    await Enrollment.create({ studentId: student.user._id, courseId, accessType: 'free' });
    assert.equal((await studentItem()).blocks[0].html, '<p>Version 1</p>');
  });

  test('editing a published lesson changes the draft only; students keep the published version', async () => {
    const before = await teacherItem();
    const response = await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: before.revision, title: 'Signals v2', blocks: [{ id: 'b1', type: 'text', html: '<p>Version 2 <script>x</script></p>' }] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const item = response.body.data.item;
    assert.equal(item.publicationStatus, 'pending_changes');
    assert.equal(item.title, 'Signals v1', 'published fields untouched');
    assert.equal(item.draft.title, 'Signals v2');
    assert.equal(item.draft.blocks[0].html, '<p>Version 2 </p>', 'draft is sanitized too');
    const seen = await studentItem();
    assert.equal(seen.title, 'Signals v1');
    assert.equal(seen.blocks[0].html, '<p>Version 1</p>');
    assert.equal(seen.draft, undefined);
    const enrolled = await studentCall('GET', '/enrollments');
    assert.doesNotMatch(JSON.stringify(enrolled.body), /Version 2|Signals v2/);
    // Teacher previews: published by default, draft on request.
    const preview = await call('GET', `/courses/${courseId}/student-preview`);
    assert.equal(preview.body.data.chapters[0].lessons[0].title, 'Signals v1');
    const draftPreview = await call('GET', `/courses/${courseId}/student-preview?draft=true`);
    assert.equal(draftPreview.body.data.chapters[0].lessons[0].title, 'Signals v2');
  });

  test('students and outsiders cannot reach drafts, versions or publication endpoints', async () => {
    const item = await teacherItem();
    for (const [method, url, body] of [
      ['GET', `/courses/${courseId}/student-preview?draft=true`], ['GET', `/courses/${courseId}/structure/items/${itemId}/versions`],
      ['POST', `/courses/${courseId}/structure/items/${itemId}/publish`, { expectedRevision: item.revision }],
      ['DELETE', `/courses/${courseId}/structure/items/${itemId}/draft?expectedRevision=${item.revision}`],
    ]) {
      assert.equal((await studentCall(method, url, body)).status, 403, `${method} ${url} (student)`);
      assert.equal((await outsiderCall(method, url, body)).status, 404, `${method} ${url} (outsider)`);
    }
    assert.equal((await studentItem()).title, 'Signals v1');
  });

  test('publication is atomic and guarded: two concurrent publishes, only one wins', async () => {
    const item = await teacherItem();
    const results = await Promise.all([1, 2].map(() => call('POST', `/courses/${courseId}/structure/items/${itemId}/publish`, { expectedRevision: item.revision })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const published = results.find(result => result.status === 200).body.data.item;
    assert.equal(published.title, 'Signals v2');
    assert.equal(published.publicationStatus, 'published');
    assert.equal(published.publishedVersion, 2);
    assert.equal(published.draft, undefined);
    assert.equal((await studentItem()).blocks[0].html, '<p>Version 2 </p>');
    assert.equal(await ContentVersion.countDocuments({ courseId, itemId }), 2, 'the losing publish left no orphan version');
  });

  test('a quiz already attempted keeps its attempts: the changed quiz is published under a new id', async () => {
    const attempt = await studentCall('POST', `/enrollments/${courseId}/lessons/${itemId}/quiz-attempts`, { answers: [{ questionId: 'q1', selectedOptionIndex: 0 }] });
    assert.equal(attempt.status, 201, JSON.stringify(attempt.body));
    assert.equal(attempt.body.data.passed, true);
    let item = await teacherItem();
    let response = await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: item.revision, quiz: quiz(1) });
    assert.equal(response.status, 200);
    response = await call('POST', `/courses/${courseId}/structure/items/${itemId}/publish`, { expectedRevision: response.body.data.item.revision });
    item = response.body.data.item;
    assert.notEqual(item.quiz.id, 'quiz_signals');
    const stored = await QuizAttempt.findOne({ studentId: student.user._id }).lean();
    assert.equal(stored.quizId, 'quiz_signals');
    assert.equal(stored.score, 100, 'historical score unchanged');
    const archived = await ContentVersion.findOne({ courseId, itemId, version: 2 }).lean();
    assert.equal(archived.snapshot.quiz.questions[0].correctOptionIndex, 0, 'the answered version is archived');
  });

  test('planned publication in the course time zone, published by the job', async () => {
    let item = await teacherItem();
    let response = await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: item.revision, title: 'Signals v4' });
    const tomorrow = new Date(Date.now() + 86_400_000);
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(tomorrow).replace(' ', 'T');
    response = await call('POST', `/courses/${courseId}/structure/items/${itemId}/publish`, { expectedRevision: response.body.data.item.revision, publishAt: local });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    item = response.body.data.item;
    assert.equal(item.publicationStatus, 'scheduled');
    assert.ok(Math.abs(new Date(item.scheduledPublishAt).getTime() - tomorrow.getTime()) < 61_000, 'local Tunis time converted to the right instant');
    assert.equal(await publishDueItems(new Date()), 0, 'not due yet');
    assert.equal((await studentItem()).title, 'Signals v2');
    assert.equal(await publishDueItems(new Date(Date.now() + 2 * 86_400_000)), 1);
    assert.equal(await publishDueItems(new Date(Date.now() + 2 * 86_400_000)), 0, 'idempotent');
    assert.equal((await studentItem()).title, 'Signals v4');
    assert.equal((await ContentVersion.findOne({ courseId, itemId }).sort({ version: -1 }).lean()).origin, 'scheduled');
  });

  test('history is readable by authors and a version can be restored into the draft', async () => {
    const versions = await call('GET', `/courses/${courseId}/structure/items/${itemId}/versions`);
    assert.equal(versions.status, 200);
    assert.deepEqual(versions.body.data.map(version => version.version), [4, 3, 2, 1]);
    assert.equal(versions.body.data.at(-1).snapshot.title, 'Signals v1');
    let item = await teacherItem();
    let response = await call('POST', `/courses/${courseId}/structure/items/${itemId}/versions/1/restore`, { expectedRevision: item.revision });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.item.draft.title, 'Signals v1');
    assert.equal((await studentItem()).title, 'Signals v4', 'restoring only fills the draft');
    const stale = await call('POST', `/courses/${courseId}/structure/items/${itemId}/versions/1/restore`, { expectedRevision: item.revision });
    assert.equal(stale.status, 409);
    item = response.body.data.item;
    response = await call('DELETE', `/courses/${courseId}/structure/items/${itemId}/draft?expectedRevision=${item.revision}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.item.publicationStatus, 'published');
  });

  test('copies start from the working copy and never change their source', async () => {
    let item = await teacherItem();
    await call('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: item.revision, title: 'Signals v5 draft' });
    const copy = await call('POST', `/courses/${courseId}/copy`, { title: 'Classe B' });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    const copied = (await call('GET', `/courses/mine/${copy.body.data.id}`)).body.data.chapters[0].lessons[0];
    assert.equal(copied.title, 'Signals v5 draft');
    assert.equal(copied.draft, undefined);
    assert.equal(copied.publicationStatus, 'draft');
    assert.notEqual(copied.id, itemId);
    await call('PATCH', `/courses/${copy.body.data.id}/structure/items/${copied.id}`, { expectedRevision: copied.revision, title: 'Modifié en classe B' });
    item = await teacherItem();
    assert.equal(item.draft.title, 'Signals v5 draft');
    assert.equal(item.title, 'Signals v4');
  });
});
