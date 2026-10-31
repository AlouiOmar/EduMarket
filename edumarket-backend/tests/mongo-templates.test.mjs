import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_tpl_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir, User, Course, Enrollment, GradeEntry, QuestionBank, Test;

describe('Course templates and independent class instances on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-tpl-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, grades, assessments] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/gradebook/models.js'), import('../dist/modules/assessments/models.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; GradeEntry = grades.GradeEntry; QuestionBank = assessments.QuestionBank; Test = assessments.Test;
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
    const user = await User.create({ name: `${role} ${email.split('@')[0]}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active' });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { user, id: String(user._id), cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = who => async (method, url, body) => {
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };

  let T, S1, S2, O, s1, s2, templateId, classA, classB, templateItems;
  const outline = async id => (await T('GET', `/courses/mine/${id}`)).body.data;

  test('a template with content, a question bank, a test and a gradebook column', async () => {
    const teacher = await account('teacher', 'tpl-teacher@example.test');
    s1 = await account('student', 'tpl-s1@example.test'); s2 = await account('student', 'tpl-s2@example.test');
    const outsider = await account('teacher', 'tpl-outsider@example.test');
    [T, S1, S2, O] = [teacher, s1, s2, outsider].map(api);
    const created = await T('POST', '/courses', { title: 'Angular — modèle', description: 'Angular 21', category: 'Web', price: 0 });
    templateId = created.body.data._id;
    let response = await T('POST', `/courses/${templateId}/structure/containers`, { expectedVersion: 0, kind: 'module', title: 'Chapitre 1 : Signals' });
    const containerId = response.body.data.createdId;
    let version = response.body.data.structureVersion;
    for (const title of ['Signals', 'Computed']) {
      response = await T('POST', `/courses/${templateId}/structure/items`, { expectedVersion: version, containerId, type: 'text', title });
      version = response.body.data.structureVersion;
    }
    templateItems = (await outline(templateId)).chapters[0].lessons;
    await T('PATCH', `/courses/${templateId}/structure/items/${templateItems[0].id}`, { expectedRevision: 0, blocks: [{ id: 'b1', type: 'text', html: '<p>Version modèle 1</p>' }] });
    const bank = await T('POST', `/assessments/${templateId}/banks`, { title: 'Signals' });
    await T('POST', `/assessments/${templateId}/banks/${bank.body.data.id}/questions`, { type: 'true_false', prompt: 'signal() est réactif ?', correct: ['true'] });
    await T('POST', `/assessments/${templateId}/tests`, { title: 'Quiz signals', sections: [{ kind: 'random', bankId: bank.body.data.id, count: 1 }] });
    const book = (await T('GET', `/gradebook/${templateId}`)).body.data;
    await T('POST', `/gradebook/${templateId}/columns`, { categoryId: book.categories[0].id, title: 'Participation orale', maxPoints: 10 });
    assert.equal((await T('POST', `/courses/${templateId}/instances`, { title: 'Classe A' })).status, 409, 'not a template yet');
    assert.equal((await T('PATCH', `/courses/${templateId}/template`, { isTemplate: true })).status, 200);
  });

  test('instances are independent copies without any student data', async () => {
    const a = await T('POST', `/courses/${templateId}/instances`, { title: 'Angular — Classe A', courseCode: 'ANG-A', startsAt: '2026-11-02T08:00:00Z', endsAt: '2027-01-31T17:00:00Z' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    classA = a.body.data.id;
    classB = (await T('POST', `/courses/${templateId}/instances`, { title: 'Angular — Classe B', courseCode: 'ANG-B' })).body.data.id;
    const instanceA = await Course.findById(classA).lean();
    assert.equal(instanceA.status, 'draft'); assert.equal(instanceA.accessState, 'private'); assert.equal(instanceA.courseCode, 'ANG-A');
    assert.equal(new Date(instanceA.settings.startsAt).toISOString(), '2026-11-02T08:00:00.000Z');
    assert.equal(instanceA.templateLink.items.length, 2);
    assert.equal(String(instanceA.templateLink.templateId), templateId);
    assert.ok(instanceA.chapters.every(chapter => chapter.visibility === 'hidden'));
    assert.equal(await QuestionBank.countDocuments({ courseId: classA }), 1, 'question bank copied');
    assert.equal((await Test.findOne({ courseId: classA }).lean()).status, 'draft');
    const bookA = (await T('GET', `/gradebook/${classA}`)).body.data;
    assert.ok(bookA.columns.some(column => column.title === 'Participation orale'), 'manual gradebook column copied');
    assert.equal(bookA.entries.length, 0);
    const instances = (await T('GET', `/courses/${templateId}/instances`)).body.data;
    assert.deepEqual(instances.map(row => row.title), ['Angular — Classe A', 'Angular — Classe B']);
    assert.equal((await T('PATCH', `/courses/${classA}/template`, { isTemplate: true })).status, 409, 'an instance cannot become a template');
  });

  test('two classes from the same template keep their data separate', async () => {
    for (const id of [classA, classB]) await Course.updateOne({ _id: id }, { $set: { status: 'published', accessState: 'open' } });
    await Enrollment.create([{ studentId: s1.user._id, courseId: classA, accessType: 'free' }, { studentId: s2.user._id, courseId: classB, accessType: 'free' }]);
    const bookA = (await T('GET', `/gradebook/${classA}`)).body.data;
    const column = bookA.columns.find(row => row.title === 'Participation orale');
    assert.equal((await T('PUT', `/gradebook/${classA}/entries/${column.id}/${s1.id}`, { score: 8 })).status, 200);
    assert.equal((await T('PUT', `/gradebook/${classA}/entries/${column.id}/${s2.id}`, { score: 8 })).status, 404, 'student of class B is not in class A');
    const bookB = (await T('GET', `/gradebook/${classB}`)).body.data;
    assert.equal(bookB.entries.length, 0);
    assert.deepEqual(bookB.students.map(student => student.id), [s2.id]);
    assert.equal((await S2('GET', `/courses/${classA}`)).body.data.chapters?.length ?? 0, 0);
    assert.equal((await S2('GET', `/gradebook/me/${classA}`)).status, 404);
    const compare = (await T('GET', `/analytics/templates/${templateId}/compare`)).body.data.classes;
    assert.deepEqual(compare.map(row => [row.title, row.students]), [['Angular — Classe A', 1], ['Angular — Classe B', 1]]);
    assert.equal(compare[0].grades.average, 16, '8/10 → 16/20, computed from class A records only');
    assert.equal(compare[1].grades.average, null, 'class B has no grade: null, not 0');
  });

  test('template changes are compared item by item; local adaptations are protected', async () => {
    const itemA = (await outline(classA)).chapters[0].lessons[0];
    await T('PATCH', `/courses/${classA}/structure/items/${itemA.id}`, { expectedRevision: itemA.revision, blocks: [{ id: 'x', type: 'text', html: '<p>Adapté pour la classe A</p>' }] });
    const templateItem = (await outline(templateId)).chapters[0].lessons[0];
    await T('PATCH', `/courses/${templateId}/structure/items/${templateItem.id}`, { expectedRevision: templateItem.revision, blocks: [{ id: 'b1', type: 'text', html: '<p>Version modèle 2</p>' }] });
    const templateContainer = (await outline(templateId)).chapters[0];
    const added = await T('POST', `/courses/${templateId}/structure/items`, { expectedVersion: (await outline(templateId)).structureVersion, containerId: templateContainer.id, type: 'text', title: 'Effects' });
    assert.equal(added.status, 201);

    const diffResponse = await T('GET', `/courses/${classA}/template-diff`);
    assert.equal(diffResponse.status, 200, JSON.stringify(diffResponse.body));
    const diffA = diffResponse.body.data;
    const status = title => diffA.rows.find(row => row.title === title)?.status;
    assert.equal(status('Signals'), 'conflict');
    assert.equal(status('Computed'), 'unchanged');
    assert.equal(status('Effects'), 'added_in_template');
    const refused = await T('POST', `/courses/${classA}/template-sync`, { expectedVersion: diffA.structureVersion, items: [{ templateItemId: templateItem.id, action: 'update' }] });
    assert.equal(refused.body.error.code, 'LOCAL_CHANGES_PROTECTED');
    assert.match(JSON.stringify((await outline(classA)).chapters[0].lessons[0].blocks), /Adapté pour la classe A/);
    const forced = await T('POST', `/courses/${classA}/template-sync`, { expectedVersion: diffA.structureVersion, items: [{ templateItemId: templateItem.id, action: 'update', overwriteLocal: true }] });
    assert.equal(forced.status, 200, JSON.stringify(forced.body));
    assert.match(JSON.stringify((await outline(classA)).chapters[0].lessons[0].blocks), /Version modèle 2/);
    assert.equal((await T('GET', `/courses/${classA}/template-diff`)).body.data.rows.find(row => row.title === 'Signals').status, 'unchanged');
  });

  test('a published class item receives template changes as a draft; new template items arrive hidden', async () => {
    let itemB = (await outline(classB)).chapters[0];
    await T('PATCH', `/courses/${classB}/structure/containers/${itemB.id}`, { visibility: 'visible' });
    await T('PATCH', `/courses/${classB}/structure/items/${itemB.lessons[0].id}`, { visibility: 'visible' });
    assert.match(JSON.stringify((await S2('GET', `/courses/${classB}`)).body.data.chapters[0].lessons[0].blocks), /Version modèle 1/);
    const diffB = (await T('GET', `/courses/${classB}/template-diff`)).body.data;
    const signals = diffB.rows.find(row => row.title === 'Signals'), effects = diffB.rows.find(row => row.title === 'Effects');
    assert.equal(signals.status, 'template_changed');
    const synced = await T('POST', `/courses/${classB}/template-sync`, { expectedVersion: diffB.structureVersion, items: [{ templateItemId: signals.templateItemId, action: 'update' }, { templateItemId: effects.templateItemId, action: 'add' }] });
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    const lessons = (await outline(classB)).chapters[0].lessons;
    assert.equal(lessons[0].publicationStatus, 'pending_changes');
    assert.match(JSON.stringify(lessons[0].draft.blocks), /Version modèle 2/);
    assert.match(JSON.stringify((await S2('GET', `/courses/${classB}`)).body.data.chapters[0].lessons[0].blocks), /Version modèle 1/, 'students keep the published version');
    assert.equal(lessons.at(-1).title, 'Effects');
    assert.equal(lessons.at(-1).visibility, 'hidden');
    assert.equal((await T('POST', `/courses/${classB}/template-sync`, { expectedVersion: diffB.structureVersion, items: [{ templateItemId: effects.templateItemId, action: 'add' }] })).status, 409, 'stale version / nothing to add');
    assert.equal(await Enrollment.countDocuments({ courseId: classB }), 1, 'student data untouched');
    assert.equal(await GradeEntry.countDocuments({ courseId: classA }), 1);
  });

  test('permissions: outsiders and students cannot create, compare or synchronize', async () => {
    assert.equal((await O('POST', `/courses/${templateId}/instances`, { title: 'Classe pirate' })).status, 404);
    assert.equal((await O('GET', `/analytics/templates/${templateId}/compare`)).status, 404);
    assert.equal((await O('GET', `/courses/${classA}/template-diff`)).status, 404);
    assert.equal((await S1('POST', `/courses/${templateId}/instances`, { title: 'Classe pirate' })).status, 403);
    assert.equal((await S1('POST', `/courses/${classA}/template-sync`, { expectedVersion: 0, items: [{ templateItemId: 'x', action: 'add' }] })).status, 403);
  });
});
