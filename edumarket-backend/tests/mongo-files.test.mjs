import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_files_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let remote, remoteUrl, server, baseUrl, privateUploadDir, User, Course, CourseAsset, purgeQuarantinedFiles, readZip, createZip;

describe('Course files, link checks and archives on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    remote = http.createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); return res.end('ok'); }
      if (req.url === '/moved') { res.writeHead(301, { location: '/ok' }); return res.end(); }
      if (req.url === '/head-not-allowed') { if (req.method === 'HEAD') { res.writeHead(405); return res.end(); } res.writeHead(200); return res.end(); }
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
    remoteUrl = `http://127.0.0.1:${remote.address().port}`;
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-files-it-'));
    Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongoUri, JWT_SECRET: 'test-secret-must-contain-more-than-32-characters', CORS_ORIGIN: 'http://localhost:3000', PRIVATE_UPLOAD_DIR: privateUploadDir, LINK_CHECK_ALLOW_PRIVATE: 'true' });
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, assets, files, zip] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/courses/assets.model.js'),
      import('../dist/modules/courses/files.routes.js'), import('../dist/common/zip.js'),
    ]);
    User = users.User; Course = courses.Course; CourseAsset = assets.CourseAsset; purgeQuarantinedFiles = files.purgeQuarantinedFiles; readZip = zip.readZip; createZip = zip.createZip;
    await Promise.all([User.init(), Course.init(), CourseAsset.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (remote) await new Promise(resolve => remote.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (privateUploadDir) await rm(privateUploadDir, { recursive: true, force: true });
  });

  async function account(role, email) {
    const password = `${role}-password-2026`;
    const user = await User.create({ name: `${role} ${email}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active' });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return { user, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = who => async (method, url, body, raw = false) => {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };

  let T, S, O, courseId, itemId, imageId, version;
  const item = async () => (await T('GET', `/courses/mine/${courseId}`)).body.data.chapters[0].lessons.find(lesson => lesson.id === itemId);
  const files = async () => (await T('GET', `/courses/${courseId}/files`)).body.data;
  const storagePath = key => path.join(privateUploadDir, 'course-assets', key);

  test('setup: a course with links and an image block', async () => {
    const teacher = await account('teacher', 'files-teacher@example.test'); const student = await account('student', 'files-student@example.test'); const outsider = await account('teacher', 'files-outsider@example.test');
    [T, S, O] = [teacher, student, outsider].map(api);
    const course = await Course.create({ title: 'Cours fichiers', slug: 'files-course', description: 'x', category: 'Web', teacherId: teacher.user._id, status: 'published', chapters: [{ id: 'c1', title: 'Chapitre 1', order: 0, visibility: 'visible', lessons: [] }] });
    courseId = String(course._id); version = 0;
    let response;
    // Rich text keeps https links only (sanitizer rule), so the local http test server is reached through link items.
    for (const [title, suffix] of [['Documentation', '/ok'], ['Cours', '/missing'], ['Ancienne page', '/moved'], ['Page GET', '/head-not-allowed']]) {
      response = await T('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: 'c1', type: 'link', title, url: `${remoteUrl}${suffix}` });
      version = response.body.data.structureVersion;
    }
    response = await T('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: 'c1', type: 'text', title: 'Leçon illustrée' });
    version = response.body.data.structureVersion; itemId = response.body.data.createdId;
    const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'schema.png');
    imageId = (await T('POST', `/courses/${courseId}/media?kind=image`, form)).body.data.id;
    const patched = await T('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: 0, blocks: [
      { id: 'b1', type: 'text', html: '<p>Introduction</p>' },
      { id: 'b2', type: 'image', assetId: imageId, alt: 'Schéma' },
      { id: 'b3', type: 'math', latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', description: 'somme des entiers' },
    ] });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
  });

  test('link check report: broken, redirected and valid links with their locations', async () => {
    const report = (await T('POST', `/courses/${courseId}/link-check`)).body.data;
    const status = suffix => report.results.find(result => result.url.endsWith(suffix));
    assert.equal(status('/ok').status, 'ok');
    assert.equal(status('/missing').status, 'broken'); assert.equal(status('/missing').httpStatus, 404);
    assert.equal(status('/moved').status, 'redirect'); assert.match(status('/moved').finalUrl, /\/ok$/);
    assert.equal(status('/head-not-allowed').status, 'ok', 'GET fallback when HEAD is refused');
    assert.equal(report.broken, 1);
    assert.equal(status('/missing').locations[0].title, 'Cours');
    assert.equal((await T('GET', `/courses/${courseId}/link-check`)).body.data.results.length, 4);
    assert.equal((await S('POST', `/courses/${courseId}/link-check`)).status, 403);
    assert.equal((await O('GET', `/courses/${courseId}/link-check`)).status, 404);
  });

  test('files: inventory with name, size, type and where each file is used; used files cannot be quarantined', async () => {
    const list = await files();
    const image = list.find(file => file.id === imageId);
    assert.equal(image.name, 'schema.png'); assert.equal(image.mimeType, 'image/png'); assert.equal(image.size, PNG.length);
    assert.equal(image.status, 'used');
    assert.equal(image.references[0].kind, 'published');
    assert.equal((await T('POST', `/courses/${courseId}/files/${imageId}/quarantine`)).body.error.code, 'FILE_IN_USE');
  });

  test('a file still referenced by an archived version is kept (history)', async () => {
    let current = await item();
    await T('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { visibility: 'visible' });
    current = await item();
    await T('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: current.revision, blocks: [{ id: 'b1', type: 'text', html: '<p>Sans image</p>' }] });
    current = await item();
    await T('POST', `/courses/${courseId}/structure/items/${itemId}/publish`, { expectedRevision: current.revision });
    const image = (await files()).find(file => file.id === imageId);
    assert.deepEqual(image.references.map(reference => reference.kind), ['version']);
    assert.equal((await T('POST', `/courses/${courseId}/files/${imageId}/quarantine`)).body.error.code, 'FILE_IN_USE');
  });

  test('unused file: quarantine, restore, deferred deletion; shared storage is kept for copies', async () => {
    const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'brouillon.png');
    const unusedId = (await T('POST', `/courses/${courseId}/media?kind=image`, form)).body.data.id;
    assert.equal((await files()).find(file => file.id === unusedId).status, 'unused');
    assert.equal((await T('DELETE', `/courses/${courseId}/files/${unusedId}`)).body.error.code, 'FILE_NOT_QUARANTINED', 'deletion only from quarantine');
    assert.equal((await T('POST', `/courses/${courseId}/files/${unusedId}/quarantine`)).status, 200);
    assert.equal((await T('POST', `/courses/${courseId}/files/${unusedId}/restore`)).status, 200);
    assert.equal((await files()).find(file => file.id === unusedId).status, 'unused');
    await T('POST', `/courses/${courseId}/files/${unusedId}/quarantine`);
    const asset = await CourseAsset.findById(unusedId).lean();
    // Another asset shares the stored file (as course copies do): the record goes, the file stays.
    const twin = await CourseAsset.create({ ...asset, _id: new mongoose.Types.ObjectId(), quarantinedAt: null });
    assert.equal((await T('DELETE', `/courses/${courseId}/files/${unusedId}`)).status, 200);
    assert.equal(await CourseAsset.exists({ _id: unusedId }), null);
    assert.equal(existsSync(storagePath(asset.storageKey)), true, 'shared file kept');
    // Purge job: quarantined 31 days ago and unused → deleted with its file (no other reference).
    await CourseAsset.updateOne({ _id: twin._id }, { $set: { quarantinedAt: new Date(Date.now() - 31 * 86_400_000) } });
    assert.equal(await purgeQuarantinedFiles(), 1);
    assert.equal(existsSync(storagePath(asset.storageKey)), false);
    assert.equal((await O('GET', `/courses/${courseId}/files`)).status, 404);
  });

  test('a quarantined file used again meanwhile is released by the purge job, never deleted', async () => {
    const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'reprise.png');
    const id = (await T('POST', `/courses/${courseId}/media?kind=image`, form)).body.data.id;
    await T('POST', `/courses/${courseId}/files/${id}/quarantine`);
    await CourseAsset.updateOne({ _id: id }, { $set: { quarantinedAt: new Date(Date.now() - 40 * 86_400_000) } });
    const current = await item();
    await T('PATCH', `/courses/${courseId}/structure/items/${itemId}`, { expectedRevision: current.revision, blocks: [{ id: 'b9', type: 'image', assetId: id, alt: 'Reprise' }, { id: 'b10', type: 'math', latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', description: 'somme des entiers' }] });
    assert.equal(await purgeQuarantinedFiles(), 0);
    assert.equal((await CourseAsset.findById(id).lean()).quarantinedAt, null);
  });

  test('archive v2: files included with a SHA-256 manifest; import remaps files; tampering is refused', async () => {
    const archive = await T('GET', `/courses/${courseId}/export-archive`, undefined, true);
    assert.equal(archive.status, 200);
    const entries = readZip(archive.buffer);
    const manifest = JSON.parse(entries.find(entry => entry.path === 'manifest.json').data.toString());
    assert.equal(manifest.format, 'edumarket-course-archive');
    assert.ok(manifest.files.some(file => file.path.startsWith('files/') && file.sha256.length === 64));
    const courseJson = entries.find(entry => entry.path === 'course.json').data.toString();
    assert.doesNotMatch(courseJson, /files-student|enroll/i, 'no student data');
    const target = await Course.create({ title: 'Cible', slug: 'files-target', description: 'x', category: 'Web', teacherId: (await User.findOne({ email: 'files-teacher@example.test' }))._id, status: 'draft', chapters: [] });
    const upload = async buffer => { const form = new FormData(); form.append('expectedVersion', '0'); form.append('archive', new Blob([buffer], { type: 'application/zip' }), 'course.zip'); return T('POST', `/courses/${target._id}/structure/import-archive`, form); };
    const tampered = entries.map(entry => entry.path.startsWith('files/') ? { name: entry.path, data: Buffer.concat([entry.data, Buffer.from('x')]) } : { name: entry.path, data: entry.data });
    assert.equal((await upload(createZip(tampered))).body.error.code, 'ARCHIVE_INTEGRITY_FAILED');
    const extra = [...entries.map(entry => ({ name: entry.path, data: entry.data })), { name: 'files/unlisted.js', data: 'alert(1)' }];
    assert.equal((await upload(createZip(extra))).body.error.code, 'ARCHIVE_INTEGRITY_FAILED');
    const imported = await upload(archive.buffer);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.ok(imported.body.data.report.copiedAssets >= 1);
    const lesson = imported.body.data.chapters[0].lessons.find(row => row.title === 'Leçon illustrée');
    const image = lesson.blocks.find(block => block.type === 'image');
    assert.ok(image.asset?.url.includes(String(target._id)), 'block points to the new course file');
    assert.equal(lesson.visibility, 'hidden');
    assert.equal(lesson.blocks.find(block => block.type === 'math').latex, '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}');
  });
});
