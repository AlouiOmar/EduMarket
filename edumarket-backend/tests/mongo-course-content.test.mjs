import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Own database (…_content_test): node --test runs files in parallel and every suite drops its database on start.
const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_content_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir;
let User, Course, Enrollment, CourseAsset, Assignment, AssignmentSubmission, QuizAttempt;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('Course content (outline, blocks, visibility, copy) on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-content-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, assets, assignments, attempts] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'),
      import('../dist/modules/enrollments/model.js'), import('../dist/modules/courses/assets.model.js'), import('../dist/modules/assignments/models.js'),
      import('../dist/modules/enrollments/quiz-attempt.model.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; CourseAsset = assets.CourseAsset;
    Assignment = assignments.Assignment; AssignmentSubmission = assignments.AssignmentSubmission; QuizAttempt = attempts.QuizAttempt;
    await Promise.all([User.init(), Course.init(), Enrollment.init(), CourseAsset.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (privateUploadDir) await rm(privateUploadDir, { recursive: true, force: true });
  });

  async function account(role, email, extra = {}) {
    const password = `${role}-password-2026`;
    const user = await User.create({ name: `${role} ${email}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active', ...extra });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { user, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = (who) => async (method, url, body) => {
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json, headers: response.headers };
  };

  let teacher, student, outsider, call, studentCall, courseId, version;
  const outline = async () => (await call('GET', `/courses/mine/${courseId}`)).body.data;
  const itemsOf = chapters => chapters.map(chapter => `${chapter.title}:${chapter.lessons.map(lesson => lesson.title).join(',')}`);

  test('teacher builds an outline: modules hidden by default, items at chosen positions (R01, R02)', async () => {
    teacher = await account('teacher', 'content-teacher@example.test');
    student = await account('student', 'content-student@example.test');
    outsider = await account('teacher', 'content-outsider@example.test');
    call = api(teacher); studentCall = api(student);
    const created = await call('POST', '/courses', { title: 'Application Côté Client', description: 'Angular 21', category: 'Web', price: 0 });
    assert.equal(created.status, 201);
    courseId = created.body.data._id;
    await Course.updateOne({ _id: courseId }, { $set: { status: 'published' } });
    version = 0;
    for (const title of ['Chapitre 1 : Bases', 'Chapitre 2 : Composants', 'Chapitre 3 : Routage']) {
      const response = await call('POST', `/courses/${courseId}/structure/containers`, { expectedVersion: version, kind: 'module', title, description: 'Module de 3 h' });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      version = response.body.data.structureVersion;
    }
    const folder = await call('POST', `/courses/${courseId}/structure/containers`, { expectedVersion: version, kind: 'folder', title: 'Anciens Examens' });
    version = folder.body.data.structureVersion;
    const [c1, c2] = folder.body.data.chapters;
    assert.ok(folder.body.data.chapters.every(chapter => chapter.visibility === 'hidden'), 'EX-CRE-04: new containers are hidden');
    for (const [containerId, title, type, extra] of [[c1.id, 'C1 - Signals', 'text'], [c1.id, 'C1 - Contrôle de flux', 'text'], [c1.id, 'C1 - Documentation', 'link', { url: 'https://angular.dev' }], [c2.id, 'C2 - Inputs', 'text']]) {
      const response = await call('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId, type, title, ...extra });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      version = response.body.data.structureVersion;
    }
    const inserted = await call('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: c1.id, type: 'text', title: 'C1 - Introduction', index: 0 });
    version = inserted.body.data.structureVersion;
    assert.deepEqual(itemsOf(inserted.body.data.chapters).slice(0, 2), ['Chapitre 1 : Bases:C1 - Introduction,C1 - Signals,C1 - Contrôle de flux,C1 - Documentation', 'Chapitre 2 : Composants:C2 - Inputs']);
    const link = inserted.body.data.chapters[0].lessons[3];
    assert.equal(link.type, 'link'); assert.equal(link.url, 'https://angular.dev'); assert.equal(link.visibility, 'hidden');
    const badLink = await call('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: c1.id, type: 'link', title: 'x', url: 'javascript:alert(1)' });
    assert.equal(badLink.status, 400);
  });

  test('reorders persist: chapter 3 before chapter 1, lesson to last position, lesson to another module (R03)', async () => {
    let data = await outline();
    const [c1, c2, c3] = data.chapters;
    let response = await call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: c3.id, toIndex: 0, expectedVersion: version });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    version = response.body.data.structureVersion;
    response = await call('POST', `/courses/${courseId}/structure/move`, { type: 'item', id: c1.lessons[0].id, toContainerId: c1.id, toIndex: 3, expectedVersion: version });
    version = response.body.data.structureVersion;
    response = await call('POST', `/courses/${courseId}/structure/move`, { type: 'item', id: c2.lessons[0].id, toContainerId: c3.id, toIndex: 0, expectedVersion: version });
    version = response.body.data.structureVersion;
    // "Refresh": a new read returns the persisted order.
    data = await outline();
    assert.deepEqual(itemsOf(data.chapters), [
      'Chapitre 3 : Routage:C2 - Inputs', 'Chapitre 1 : Bases:C1 - Signals,C1 - Contrôle de flux,C1 - Documentation,C1 - Introduction', 'Chapitre 2 : Composants:', 'Anciens Examens:',
    ]);
    assert.equal(data.chapters[0].lessons[0].chapterId, data.chapters[0].id);
    assert.deepEqual(data.chapters.map(chapter => chapter.order), [0, 1, 2, 3]);
    assert.equal(data.structureVersion, version);
  });

  test('stale versions, invalid destinations and non-managers are rejected without changing the outline', async () => {
    const before = await outline();
    const stale = await call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: before.chapters[1].id, toIndex: 0, expectedVersion: version - 1 });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STRUCTURE_CONFLICT');
    const intoItem = await call('POST', `/courses/${courseId}/structure/move`, { type: 'item', id: before.chapters[1].lessons[0].id, toContainerId: before.chapters[1].lessons[1].id, toIndex: 0, expectedVersion: version });
    assert.equal(intoItem.status, 422);
    const outOfRange = await call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: before.chapters[0].id, toIndex: 99, expectedVersion: version });
    assert.equal(outOfRange.status, 422);
    const byStudent = await studentCall('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: before.chapters[1].id, toIndex: 0, expectedVersion: version });
    assert.equal(byStudent.status, 403);
    const byOutsider = await api(outsider)('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: before.chapters[1].id, toIndex: 0, expectedVersion: version });
    assert.equal(byOutsider.status, 404);
    const anonymous = await fetch(`${baseUrl}/courses/${courseId}/structure/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'container', id: before.chapters[1].id, toIndex: 0, expectedVersion: version }) });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(itemsOf((await outline()).chapters), itemsOf(before.chapters));
  });

  test('concurrent moves: exactly one of two simultaneous moves with the same version wins', async () => {
    const data = await outline();
    const [first, second] = await Promise.all([
      call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: data.chapters[3].id, toIndex: 0, expectedVersion: version }),
      call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: data.chapters[2].id, toIndex: 0, expectedVersion: version }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const winner = first.status === 200 ? first : second;
    version = winner.body.data.structureVersion;
    const after = await outline();
    assert.equal(after.chapters.length, 4);
    assert.equal(new Set(after.chapters.flatMap(chapter => chapter.lessons.map(lesson => lesson.id))).size, 5);
    // Restore the order expected by the following tests.
    const archive = after.chapters.find(chapter => chapter.title === 'Anciens Examens');
    const restore = await call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: archive.id, toIndex: 3, expectedVersion: version });
    version = restore.body.data.structureVersion;
    const components = restore.body.data.chapters.find(chapter => chapter.title === 'Chapitre 2 : Composants');
    const placed = await call('POST', `/courses/${courseId}/structure/move`, { type: 'container', id: components.id, toIndex: 2, expectedVersion: version });
    version = placed.body.data.structureVersion;
    assert.deepEqual(placed.body.data.chapters.map(chapter => chapter.title), ['Chapitre 3 : Routage', 'Chapitre 1 : Bases', 'Chapitre 2 : Composants', 'Anciens Examens']);
  });

  let lessonId, imageAssetId;
  test('blocks are validated, sanitized, reordered and persisted with revisions', async () => {
    const data = await outline();
    lessonId = data.chapters[1].lessons[0].id;
    const upload = new FormData();
    upload.append('file', new Blob([PNG], { type: 'image/png' }), 'schema.png');
    const image = await fetch(`${baseUrl}/courses/${courseId}/media?kind=image`, { method: 'POST', headers: { Cookie: teacher.cookie }, body: upload });
    assert.equal(image.status, 201);
    imageAssetId = (await image.json()).data.id;
    const spoofed = new FormData();
    spoofed.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
    assert.equal((await fetch(`${baseUrl}/courses/${courseId}/media?kind=image`, { method: 'POST', headers: { Cookie: teacher.cookie }, body: spoofed })).status, 415);

    const blocks = [
      { id: 'b-text', type: 'text', html: '<h2>Signals</h2><p onclick="steal()">Un <strong>signal</strong></p><script>alert(1)</script>' },
      { id: 'b-code', type: 'code', language: 'typescript', code: 'count = signal(0);\n@for (item of items(); track item.id) {}' },
      { id: 'b-image', type: 'image', assetId: imageAssetId, alt: 'Cycle de vie d’un signal' },
      { id: 'b-html', type: 'html', html: '<div style="color:red" onmouseover="x()"><img src="https://cdn.test/a.png" alt="a"></div><iframe src="https://evil.test"></iframe>' },
      { id: 'b-divider', type: 'divider' },
    ];
    let response = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { expectedRevision: 0, blocks, durationMinutes: 30 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    let item = response.body.data.item;
    assert.equal(item.revision, 1);
    assert.equal(item.blocks[0].html, '<h2>Signals</h2><p>Un <strong>signal</strong></p>');
    assert.doesNotMatch(item.blocks[3].html, /onmouseover|iframe/);
    assert.equal(item.blocks[2].asset.url, `/courses/${courseId}/assets/${imageAssetId}`);

    // Reorder blocks (code first, divider second) and persist.
    const reordered = [blocks[1], blocks[4], blocks[0], blocks[2], blocks[3]];
    response = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { expectedRevision: 1, blocks: reordered });
    assert.equal(response.status, 200);
    item = (await outline()).chapters[1].lessons.find(lesson => lesson.id === lessonId);
    assert.deepEqual(item.blocks.map(block => block.id), ['b-code', 'b-divider', 'b-text', 'b-image', 'b-html']);

    const stale = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { expectedRevision: 1, title: 'Écrasement' });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'ITEM_CONFLICT');
    const noRevision = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { title: 'Sans révision' });
    assert.equal(noRevision.status, 400);
    const foreignAsset = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { expectedRevision: 2, blocks: [{ id: 'x', type: 'image', assetId: '0123456789abcdef01234567', alt: 'x' }] });
    assert.equal(foreignAsset.status, 422);
    const large = await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { expectedRevision: 2, blocks: [...reordered, { id: 'big', type: 'text', html: `<p>${'a'.repeat(50000)}</p>` }] });
    assert.equal(large.status, 200, 'content routes accept bodies above the default 32 kB limit');
  });

  test('visibility is enforced server-side for students, including direct URLs and hidden parents (R09)', async () => {
    const data = await outline();
    const [routing, basics] = data.chapters;
    await Enrollment.create({ studentId: student.user._id, courseId, accessType: 'free' });
    let view = (await studentCall('GET', `/courses/${courseId}`)).body.data;
    assert.equal(view.chapters.length, 0, 'everything hidden');
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${lessonId}/complete`)).status, 404);
    assert.equal((await studentCall('GET', `/courses/${courseId}/assets/${imageAssetId}`)).status, 404);

    // Child visible inside a hidden parent stays unreachable.
    await call('PATCH', `/courses/${courseId}/structure/items/${lessonId}`, { visibility: 'visible' });
    view = (await studentCall('GET', `/courses/${courseId}`)).body.data;
    assert.equal(view.chapters.length, 0);
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${lessonId}/complete`)).status, 404);

    const batch = await call('POST', `/courses/${courseId}/structure/batch`, { containerIds: [basics.id], visibility: 'visible' });
    assert.equal(batch.status, 200);
    view = (await studentCall('GET', `/courses/${courseId}`)).body.data;
    assert.deepEqual(view.chapters.map(chapter => chapter.title), ['Chapitre 1 : Bases']);
    assert.deepEqual(view.chapters[0].lessons.map(lesson => lesson.id), [lessonId], 'hidden siblings are not listed');
    assert.equal(view.structureVersion, undefined);
    assert.equal((await studentCall('GET', `/courses/${courseId}/assets/${imageAssetId}`)).status, 200);
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${basics.lessons[1].id}/complete`)).status, 404, 'hidden sibling cannot be completed by id');
    assert.equal((await studentCall('GET', `/courses/${courseId}/lessons/${basics.lessons[1].id}/questions`)).status, 404, 'hidden lesson Q&A is unreachable');

    // Scheduled publication: visible flag but opening in the future.
    await call('PATCH', `/courses/${courseId}/structure/containers/${routing.id}`, { visibility: 'visible', availableFrom: new Date(Date.now() + 86_400_000).toISOString() });
    view = (await studentCall('GET', `/courses/${courseId}`)).body.data;
    assert.ok(!view.chapters.some(chapter => chapter.id === routing.id));
    await call('PATCH', `/courses/${courseId}/structure/containers/${routing.id}`, { availableFrom: null });
    view = (await studentCall('GET', `/courses/${courseId}`)).body.data;
    assert.ok(view.chapters.some(chapter => chapter.id === routing.id));
    const invalidWindow = await call('PATCH', `/courses/${courseId}/structure/containers/${routing.id}`, { availableFrom: '2026-12-01T00:00:00Z', availableUntil: '2026-11-01T00:00:00Z' });
    assert.equal(invalidWindow.status, 400);

    // Teacher preview matches the student view.
    const preview = await call('GET', `/courses/${courseId}/student-preview`);
    assert.deepEqual(preview.body.data.chapters.map(chapter => chapter.id), view.chapters.map(chapter => chapter.id));
  });

  test('sequential modules unlock items in order', async () => {
    const data = await outline();
    const basics = data.chapters[1];
    await call('POST', `/courses/${courseId}/structure/batch`, { itemIds: basics.lessons.map(lesson => lesson.id), visibility: 'visible' });
    await call('PATCH', `/courses/${courseId}/structure/containers/${basics.id}`, { sequential: true });
    let view = (await studentCall('GET', `/courses/${courseId}`)).body.data.chapters.find(chapter => chapter.id === basics.id);
    assert.deepEqual(view.lessons.map(lesson => !!lesson.locked), [false, true, true, true]);
    assert.equal(view.lessons[1].blocks, undefined);
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${basics.lessons[1].id}/complete`)).status, 404);
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${basics.lessons[0].id}/complete`)).status, 200);
    view = (await studentCall('GET', `/courses/${courseId}`)).body.data.chapters.find(chapter => chapter.id === basics.id);
    assert.deepEqual(view.lessons.map(lesson => !!lesson.locked), [false, false, true, true]);
    await call('PATCH', `/courses/${courseId}/structure/containers/${basics.id}`, { sequential: false });
  });

  test('moves do not affect progress, grades or submissions', async () => {
    const assignment = await Assignment.create({ courseId, teacherId: teacher.user._id, title: 'TP Angular', instructions: 'Rendre le dépôt GitHub', dueAt: new Date(Date.now() + 86_400_000), points: 20 });
    await AssignmentSubmission.create({ assignmentId: assignment._id, studentId: student.user._id, answerText: 'https://github.com/x', status: 'graded', score: 17 });
    const before = await Enrollment.findOne({ studentId: student.user._id, courseId }).lean();
    const data = await outline();
    const moved = await call('POST', `/courses/${courseId}/structure/move`, { type: 'item', id: lessonId, toContainerId: data.chapters[2].id, toIndex: 0, expectedVersion: data.structureVersion });
    assert.equal(moved.status, 200);
    version = moved.body.data.structureVersion;
    const afterEnrollment = await Enrollment.findOne({ studentId: student.user._id, courseId }).lean();
    assert.deepEqual(afterEnrollment.completedLessonIds, before.completedLessonIds);
    assert.equal((await AssignmentSubmission.findOne({ assignmentId: assignment._id }).lean()).score, 17);
    const movedItem = moved.body.data.chapters[2].lessons[0];
    assert.equal(movedItem.id, lessonId);
    assert.equal(movedItem.blocks.length, 6, 'blocks travel with the lesson');
  });

  test('legacy whole-curriculum save keeps blocks and visibility of existing items', async () => {
    const data = await outline();
    const legacyChapters = data.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, order: chapter.order, lessons: chapter.lessons.map(lesson => ({ id: lesson.id, title: lesson.title, chapterId: chapter.id, durationMinutes: lesson.durationMinutes || 0, type: lesson.type, resources: [], commentsCount: 0, ...(lesson.url ? { url: lesson.url } : {}) })) }));
    const saved = await call('PATCH', `/courses/${courseId}`, { chapters: legacyChapters });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const afterSave = await outline();
    const lesson = afterSave.chapters.flatMap(chapter => chapter.lessons).find(candidate => candidate.id === lessonId);
    assert.equal(lesson.blocks.length, 6);
    assert.equal(lesson.visibility, 'visible');
    assert.equal(afterSave.chapters[3].visibility, 'hidden');
    assert.equal(afterSave.structureVersion, data.structureVersion + 1);
    version = afterSave.structureVersion;
  });

  test('duplicate an item and a module: fresh ids, hidden, placed right after the source', async () => {
    const data = await outline();
    const module = data.chapters[1];
    let response = await call('POST', `/courses/${courseId}/structure/items/${module.lessons[0].id}/duplicate`, { expectedVersion: data.structureVersion });
    assert.equal(response.status, 201);
    const copy = response.body.data.chapters[1].lessons[1];
    assert.equal(copy.title, `${module.lessons[0].title} (copie)`);
    assert.equal(copy.visibility, 'hidden');
    assert.notEqual(copy.id, module.lessons[0].id);
    response = await call('POST', `/courses/${courseId}/structure/containers/${module.id}/duplicate`, { expectedVersion: response.body.data.structureVersion });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.chapters[2].title, `${module.title} (copie)`);
    assert.equal(response.body.data.chapters[2].visibility, 'hidden');
    const removed = await call('DELETE', `/courses/${courseId}/structure/containers/${response.body.data.createdId}?expectedVersion=${response.body.data.structureVersion}`);
    assert.equal(removed.status, 200);
    version = removed.body.data.structureVersion;
  });

  test('course copy and content import never carry student data; copies are hidden and keep order and media (R10)', async () => {
    await QuizAttempt.create({ studentId: student.user._id, courseId, lessonId, quizId: 'q', answers: [{ questionId: 'a', selectedOptionIndex: 0 }], score: 100, passed: true, correctCount: 1, totalQuestions: 1 }).catch(() => undefined);
    const source = await outline();
    const copy = await call('POST', `/courses/${courseId}/copy`, { title: 'ACC 2027' });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    const copyId = copy.body.data.id;
    const copied = (await call('GET', `/courses/mine/${copyId}`)).body.data;
    assert.equal(copied.status, 'draft'); assert.equal(copied.accessState, 'private'); assert.equal(copied.studentsCount, 0);
    assert.deepEqual(copied.chapters.map(chapter => chapter.title), source.chapters.map(chapter => chapter.title));
    assert.ok(copied.chapters.every(chapter => chapter.visibility === 'hidden' && chapter.lessons.every(lesson => lesson.visibility === 'hidden')));
    const copiedLesson = copied.chapters.flatMap(chapter => chapter.lessons).find(lesson => lesson.title === 'C1 - Signals');
    const image = copiedLesson.blocks.find(block => block.type === 'image');
    assert.ok(image.asset && image.assetId !== imageAssetId, 'media copied into the new course');
    assert.equal(await Enrollment.countDocuments({ courseId: copyId }), 0);
    assert.equal(await QuizAttempt.countDocuments({ courseId: copyId }), 0);
    assert.equal(await Assignment.countDocuments({ courseId: copyId }), 0);
    // Teacher of the copy downloads the copied image.
    assert.equal((await fetch(`${baseUrl}${image.asset.url}`, { headers: { Cookie: teacher.cookie } })).status, 200);

    // Selective import of one module into a third course.
    const target = (await call('POST', '/courses', { title: 'Cours cible', description: 'x', category: 'Web' })).body.data._id;
    const imported = await call('POST', `/courses/${target}/structure/import`, { expectedVersion: 0, sourceCourseId: courseId, containerIds: [source.chapters[1].id], itemIds: [source.chapters[0].lessons[0]?.id].filter(Boolean) });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.data.report.copiedContainers >= 1, true);
    assert.equal(imported.body.data.chapters[0].title, source.chapters[1].title);
    const outsiderImport = await api(outsider)('POST', `/courses/${target}/structure/import`, { expectedVersion: 0, sourceCourseId: courseId });
    assert.equal(outsiderImport.status, 404);
    const sources = await call('GET', `/courses/${target}/structure/sources`);
    assert.ok(sources.body.data.some(candidate => candidate.id === courseId));
  });

  test('export package has no student data; archive with student data is owner-only (R11)', async () => {
    const exported = await call('GET', `/courses/${courseId}/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /attachment/);
    assert.equal(exported.body.format, 'edumarket-course');
    assert.doesNotMatch(JSON.stringify(exported.body), /content-student@example\.test/);
    const coOwner = await account('teacher', 'content-coowner@example.test');
    await Course.updateOne({ _id: courseId }, { $set: { coOwnerIds: [coOwner.user._id] } });
    assert.equal((await api(coOwner)('GET', `/courses/${courseId}/archive?includeStudentData=true`)).status, 403);
    assert.equal((await api(coOwner)('GET', `/courses/${courseId}/archive`)).status, 200);
    const archive = await call('GET', `/courses/${courseId}/archive?includeStudentData=true`);
    assert.equal(archive.status, 200);
    assert.equal(archive.body.archive.students[0].email, 'content-student@example.test');
    assert.equal(archive.body.archive.students[0].assignments[0].score, 17);
    // Re-import of the package into an empty course.
    const empty = (await call('POST', '/courses', { title: 'Cours importé', description: 'x', category: 'Web' })).body.data._id;
    const reimported = await call('POST', `/courses/${empty}/structure/import-package`, { expectedVersion: 0, package: exported.body });
    assert.equal(reimported.status, 200, JSON.stringify(reimported.body));
    assert.deepEqual(reimported.body.data.chapters.map(chapter => chapter.title), exported.body.chapters.map(chapter => chapter.title));
    assert.ok(reimported.body.data.report.skipped.some(entry => entry.reason === 'FILES_NOT_IN_PACKAGE'));
  });

  test('course settings: code, private/completed states, programme in calendar', async () => {
    const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const updated = await call('PATCH', `/courses/${courseId}`, { courseCode: 'ACC-2026', settings: { language: 'fr', notifyStudents: true }, syllabus: [{ id: 's1', title: 'Séance 1 : Signals', startsAt, durationMinutes: 180 }] });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const events = (await studentCall('GET', '/calendar/events')).body.data;
    assert.ok(events.some(event => event.kind === 'course' && event.title === 'Séance 1 : Signals'));
    const data = await outline();
    const openLesson = data.chapters.flatMap(chapter => chapter.lessons.filter(lesson => lesson.visibility === 'visible').map(lesson => ({ lesson, chapter }))).find(entry => entry.chapter.visibility === 'visible' && !entry.chapter.sequential)?.lesson;
    await call('PATCH', `/courses/${courseId}`, { accessState: 'completed' });
    assert.equal((await studentCall('PUT', `/enrollments/${courseId}/lessons/${openLesson.id}/complete`)).body.error.code, 'COURSE_COMPLETED');
    assert.ok((await studentCall('GET', `/courses/${courseId}`)).body.data.chapters.length > 0, 'completed course stays readable');
    await call('PATCH', `/courses/${courseId}`, { accessState: 'private' });
    assert.equal((await studentCall('GET', `/courses/${courseId}`)).body.data.chapters.every(chapter => chapter.lessons.every(lesson => lesson.blocks === undefined)), true);
    assert.equal((await studentCall('GET', `/courses/${courseId}/assets/${imageAssetId}`)).status, 404);
    const coOwner = await User.findOne({ email: 'content-coowner@example.test' });
    const coOwnerLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: coOwner.email, password: 'teacher-password-2026' }) });
    const coOwnerCall = api({ cookie: coOwnerLogin.headers.get('set-cookie').split(';')[0] });
    assert.equal((await coOwnerCall('PATCH', `/courses/${courseId}`, { accessState: 'open' })).status, 403, 'status belongs to the primary owner');
    await call('PATCH', `/courses/${courseId}`, { accessState: 'open' });
  });
});
