import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// AI (against a local stub of an OpenAI-compatible endpoint: this checks EduMarket's handling, not a real provider),
// LTI 1.3 (platform keys and tool keys generated here) and SCORM (packages built here).
const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_integ_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}

let stub, stubMode = 'ok', stubRequests = [];
const platformKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const toolKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ISSUER = 'http://lti.platform.test', CONTENT_HOST = 'scorm.content.test';
let server, baseUrl, port, privateUploadDir, User, Course, Enrollment, GradeEntry, GradeColumn, AiConversation, purgeExpiredTranscripts, createZip, ScormAttempt;

describe('Integrations on MongoDB (AI conversation, LTI 1.3, SCORM)', { skip: !mongoUri }, () => {
  before(async () => {
    stub = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        stubRequests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
        if (stubMode === 'error') { res.writeHead(500); return res.end('{}'); }
        if (stubMode === 'rate') { res.writeHead(429); return res.end('{}'); }
        if (stubMode === 'slow') return setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] })); }, 1500);
        const last = JSON.parse(body).messages.at(-1).content;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: `Réponse guidée à : ${last}` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      });
    });
    await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, {
      NODE_ENV: 'test', MONGODB_URI: mongoUri, JWT_SECRET: 'test-secret-must-contain-more-than-32-characters', CORS_ORIGIN: 'http://localhost:3000', APP_ORIGIN: 'http://localhost:3000',
      AI_PROVIDER: 'openai-compatible', AI_BASE_URL: `http://127.0.0.1:${stub.address().port}/v1`, AI_MODEL: 'stub-model', AI_API_KEY: 'stub-key-not-a-secret', AI_TIMEOUT_MS: '1000',
      LTI_PRIVATE_KEY: platformKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }), LTI_KEY_ID: 'platform-key-1', LTI_ISSUER: ISSUER,
      SCORM_CONTENT_ORIGIN: `http://${CONTENT_HOST}`,
    });
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-integ-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, grades, ai, aiRoutes, zip, scorm] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/gradebook/models.js'), import('../dist/modules/ai/models.js'), import('../dist/modules/ai/routes.js'), import('../dist/common/zip.js'), import('../dist/modules/scorm/models.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; GradeEntry = grades.GradeEntry; GradeColumn = grades.GradeColumn;
    AiConversation = ai.AiConversation; purgeExpiredTranscripts = aiRoutes.purgeExpiredTranscripts; createZip = zip.createZip; ScormAttempt = scorm.ScormAttempt;
    await Promise.all([User.init(), Course.init(), Enrollment.init(), AiConversation.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (stub) await new Promise(resolve => stub.close(resolve));
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
  const api = who => async (method, url, body, options = {}) => {
    const isForm = body instanceof FormData || body instanceof URLSearchParams;
    const response = await fetch(`${baseUrl}${url}`, { method, redirect: 'manual', headers: { ...(who ? { Cookie: who.cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json, headers: response.headers };
  };
  /** Request with an explicit Host header (fetch forbids it). */
  const raw = (method, pathname, host, body) => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { host, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });

  let admin, teacher, student, other, outsider, A, T, S, X, O, courseId, version;
  const addItem = async (input) => {
    const response = await T('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: 'c1', ...input });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    version = response.body.data.structureVersion;
    const id = response.body.data.createdId;
    await T('PATCH', `/courses/${courseId}/structure/items/${id}`, { visibility: 'visible' });
    return id;
  };

  test('setup', async () => {
    admin = await account('admin', 'integ-admin@example.test'); teacher = await account('teacher', 'integ-teacher@example.test');
    student = await account('student', 'integ-student@example.test'); other = await account('student', 'integ-other@example.test'); outsider = await account('teacher', 'integ-outsider@example.test');
    [A, T, S, X, O] = [admin, teacher, student, other, outsider].map(api);
    const course = await Course.create({ title: 'Application Côté Client', slug: 'acc-integ', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published', chapters: [{ id: 'c1', title: 'Chapitre 1', order: 0, visibility: 'visible', lessons: [] }] });
    courseId = String(course._id); version = 0;
    await Enrollment.create({ studentId: student.user._id, courseId, accessType: 'free' });
  });

  // --- AI ----------------------------------------------------------------------------------------------------------------
  let activityId;
  test('AI: configured server-side; consent required; the system prompt never reaches students', async () => {
    assert.deepEqual((await S('GET', '/ai/status')).body.data, { configured: true, provider: 'openai-compatible', model: 'stub-model' });
    const created = await T('POST', `/ai/${courseId}/activities`, { title: 'Tuteur signals', instructions: 'Expliquez computed()', systemPrompt: 'Tu es un tuteur socratique : ne donne jamais la solution complète.', maxTurns: 2, graded: true, points: 10 });
    assert.equal(created.status, 201);
    activityId = created.body.data.id;
    assert.equal((await S('GET', `/ai/${courseId}/student/activities`)).body.data.activities.length, 0, 'draft not visible');
    await T('PATCH', `/ai/${courseId}/activities/${activityId}`, { status: 'published' });
    const listed = (await S('GET', `/ai/${courseId}/student/activities`)).body.data.activities[0];
    assert.equal(listed.systemPrompt, undefined);
    assert.deepEqual(listed.dataNotice, { collected: ['messages', 'timestamps', 'token_counts'], visibleTo: 'course_teachers', retentionDays: 180, provider: 'openai-compatible' });
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Bonjour' })).body.error.code, 'AI_CONSENT_REQUIRED');
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/consent`, { accepted: true })).status, 200);
    const reply = await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Que fait computed() ?' });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.data.conversation.messages[1].content, 'Réponse guidée à : Que fait computed() ?');
    const sent = stubRequests.at(-1);
    assert.equal(sent.auth, 'Bearer stub-key-not-a-secret', 'the key is used server-side only');
    assert.match(sent.body.messages[0].content, /socratique/);
    assert.doesNotMatch(JSON.stringify(reply.body), /socratique|stub-key/);
  });

  test('AI: provider errors store no half turn; turn limit; timeouts', async () => {
    const before = (await AiConversation.findOne({ activityId }).lean()).messages.length;
    stubMode = 'error';
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Encore ?' })).body.error.code, 'AI_PROVIDER_ERROR');
    stubMode = 'rate';
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Encore ?' })).status, 503);
    stubMode = 'slow';
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Encore ?' })).body.error.code, 'AI_PROVIDER_TIMEOUT');
    assert.equal((await AiConversation.findOne({ activityId }).lean()).messages.length, before, 'nothing stored on failure');
    stubMode = 'ok';
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Dernière question' })).status, 200);
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'Une de plus' })).body.error.code, 'AI_TURN_LIMIT_REACHED');
    assert.equal((await S('POST', `/ai/${courseId}/student/activities/${activityId}/messages`, { content: 'x'.repeat(2001) })).status, 400);
  });

  test('AI: transcripts readable by authorized teachers only; grading unpublished; retention purge', async () => {
    const conversations = (await T('GET', `/ai/${courseId}/activities/${activityId}/conversations`)).body.data;
    assert.equal(conversations[0].turns, 2);
    assert.equal((await T('GET', `/ai/${courseId}/conversations/${conversations[0].id}`)).body.data.messages.length, 4);
    assert.equal((await S('GET', `/ai/${courseId}/conversations/${conversations[0].id}`)).status, 403, 'students use their own endpoint');
    assert.equal((await O('GET', `/ai/${courseId}/conversations/${conversations[0].id}`)).status, 404, 'unauthorized teacher');
    assert.equal((await X('GET', `/ai/${courseId}/student/activities`)).status, 404, 'student of another course');
    assert.equal((await X('POST', `/ai/${courseId}/student/activities/${activityId}/consent`, { accepted: true })).status, 404);
    await S('POST', `/ai/${courseId}/student/activities/${activityId}/submit`, {});
    assert.equal((await T('POST', `/ai/${courseId}/activities/${activityId}/grades`, { studentId: student.id, score: 8 })).status, 200);
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'ai_conversation' }).lean();
    const entry = await GradeEntry.findOne({ columnId: column._id, studentId: student.user._id }).lean();
    assert.equal(entry.status, 'graded'); assert.equal(entry.published, null, 'never published automatically');
    await AiConversation.updateOne({ activityId }, { $set: { deleteAfter: new Date(Date.now() - 1000) } });
    assert.equal(await purgeExpiredTranscripts(), 1);
    assert.equal(await AiConversation.countDocuments({ activityId }), 0);
  });

  // --- LTI ---------------------------------------------------------------------------------------------------------------
  let tool, ltiItemId;
  const toolPem = toolKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const authorizeQuery = (overrides = {}) => new URLSearchParams({ scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none', client_id: tool.clientId, redirect_uri: 'https://tool.test/launch', state: 'state-1', nonce: crypto.randomUUID(), ...overrides }).toString();
  const startLaunch = async (who = S) => {
    const response = await who('GET', `/lti/launch/${courseId}/${ltiItemId}`);
    assert.equal(response.status, 302, JSON.stringify(response.body));
    return new URL(response.headers.get('location')).searchParams.get('login_hint');
  };

  test('LTI: tools registered by an administrator only; JWKS published', async () => {
    const input = { name: 'Outil de code', oidcLoginUrl: 'https://tool.test/login', targetLinkUri: 'https://tool.test/launch', redirectUris: ['https://tool.test/launch'], publicKeyPem: toolPem };
    assert.equal((await T('POST', '/lti/tools', input)).status, 403);
    assert.equal((await A('POST', '/lti/tools', { ...input, publicKeyPem: 'not a key' })).status, 400);
    const created = await A('POST', '/lti/tools', input);
    assert.equal(created.status, 201);
    tool = created.body.data;
    assert.equal(tool.privacy.sendEmail, false, 'minimization by default');
    const jwks = (await api(null)('GET', '/lti/jwks')).body;
    assert.equal(jwks.keys[0].kid, 'platform-key-1');
    assert.equal(jwks.keys[0].d, undefined, 'no private part');
    assert.equal((await T('POST', `/courses/${courseId}/structure/items`, { expectedVersion: version, containerId: 'c1', type: 'lti', title: 'Sans outil' })).status, 400);
    ltiItemId = await addItem({ type: 'lti', title: 'Exercice en ligne', ltiToolId: tool.id });
  });

  test('LTI: a valid launch yields a signed id_token with the right issuer, audience, nonce and lifetime', async () => {
    const loginHint = await startLaunch();
    const nonce = 'nonce-ok-123';
    const response = await S('GET', `/lti/authorize?${authorizeQuery({ login_hint: loginHint, nonce })}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(response.headers.get('content-security-policy'), /form-action https:\/\/tool\.test/);
    const token = /name="id_token" value="([^"]+)"/.exec(response.body)[1];
    const publicKey = crypto.createPublicKey({ key: (await api(null)('GET', '/lti/jwks')).body.keys[0], format: 'jwk' });
    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: ISSUER, audience: tool.clientId });
    assert.equal(claims.nonce, nonce);
    assert.equal(claims.exp - claims.iat, 300);
    assert.equal(claims['https://purl.imsglobal.org/spec/lti/claim/deployment_id'], tool.deploymentId);
    assert.deepEqual(claims['https://purl.imsglobal.org/spec/lti/claim/roles'], ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner']);
    assert.equal(claims.email, undefined); assert.equal(claims.name, undefined);
    assert.notEqual(claims.sub, student.id, 'pseudonymous subject');
    assert.equal((await S('GET', `/lti/authorize?${authorizeQuery({ login_hint: loginHint })}`)).body.error.code, 'LTI_LOGIN_EXPIRED', 'single use');
  });

  test('LTI: invalid launches are refused', async () => {
    const cases = [
      [{ client_id: 'unknown-client' }, 'LTI_INVALID_CLIENT'], [{ redirect_uri: 'https://evil.test/steal' }, 'LTI_INVALID_REDIRECT_URI'],
      [{ redirect_uri: 'https://tool.test/launch/extra' }, 'LTI_INVALID_REDIRECT_URI'], [{ response_type: 'code' }, 'LTI_INVALID_REQUEST'],
      [{ scope: 'profile' }, 'LTI_INVALID_REQUEST'], [{ response_mode: 'query' }, 'LTI_INVALID_REQUEST'], [{ nonce: '' }, 'LTI_INVALID_REQUEST'],
    ];
    for (const [override, code] of cases) {
      const loginHint = await startLaunch();
      const response = await S('GET', `/lti/authorize?${authorizeQuery({ login_hint: loginHint, ...override })}`);
      assert.equal(response.body.error?.code, code, JSON.stringify(override));
      assert.doesNotMatch(JSON.stringify(response.body), /id_token/);
    }
    const stolen = await startLaunch();
    assert.equal((await X('GET', `/lti/authorize?${authorizeQuery({ login_hint: stolen })}`)).body.error.code, 'LTI_USER_MISMATCH', 'another user cannot use the hint');
    const expired = await startLaunch();
    await mongoose.connection.collection('ltilaunches').updateOne({ loginHint: expired }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await S('GET', `/lti/authorize?${authorizeQuery({ login_hint: expired })}`)).body.error.code, 'LTI_LOGIN_EXPIRED');
    assert.equal((await api(null)('GET', `/lti/authorize?${authorizeQuery({ login_hint: 'x' })}`)).status, 401, 'no session');
    assert.equal((await X('GET', `/lti/launch/${courseId}/${ltiItemId}`)).status, 404, 'not enrolled');
  });

  test('LTI: service tokens require a valid signed client assertion (issuer, audience, signature, lifetime, replay)', async () => {
    const assertion = (overrides = {}, key = toolKeys.privateKey, algorithm = 'RS256') => jwt.sign({ iss: tool.clientId, sub: tool.clientId, aud: `${ISSUER}/api/v1/lti/token`, jti: crypto.randomUUID(), ...overrides }, key, { algorithm, expiresIn: 120 });
    const request = token => new URLSearchParams({ grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: token, scope: 'https://purl.imsglobal.org/spec/lti-ags/scope/score' });
    const valid = assertion();
    const granted = await api(null)('POST', '/lti/token', request(valid));
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal((await api(null)('POST', '/lti/token', request(valid))).body.error.code, 'LTI_ASSERTION_REPLAYED');
    assert.equal((await api(null)('POST', '/lti/token', request(assertion({ aud: 'https://other.test/token' })))).status, 401, 'wrong audience');
    assert.equal((await api(null)('POST', '/lti/token', request(assertion({ sub: 'someone-else' })))).status, 401, 'iss != sub');
    assert.equal((await api(null)('POST', '/lti/token', request(assertion({}, otherKeys.privateKey)))).status, 401, 'bad signature');
    assert.equal((await api(null)('POST', '/lti/token', request(assertion({}, 'shared-secret-pretending', 'HS256')))).status, 401, 'algorithm confusion');
    assert.equal((await api(null)('POST', '/lti/token', request(jwt.sign({ iss: tool.clientId, sub: tool.clientId, aud: `${ISSUER}/api/v1/lti/token`, jti: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) - 60, iat: Math.floor(Date.now() / 1000) - 120 }, toolKeys.privateKey, { algorithm: 'RS256' })))).status, 401, 'expired');
    // Score passback (AGS) with the granted token: recorded in the gradebook, unpublished.
    const subject = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`lti:${tool.id}:${student.id}`).digest('hex').slice(0, 32);
    const score = await api(null)('POST', `/lti/ags/${courseId}/${ltiItemId}/scores`, { userId: subject, scoreGiven: 7, scoreMaximum: 10, activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: new Date().toISOString() }, { headers: { authorization: `Bearer ${granted.body.access_token}` } });
    assert.equal(score.status, 204, JSON.stringify(score.body));
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'lti' }).lean();
    assert.equal((await GradeEntry.findOne({ columnId: column._id }).lean()).score, 7);
    assert.equal((await api(null)('POST', `/lti/ags/${courseId}/${ltiItemId}/scores`, { userId: subject, scoreGiven: 7, scoreMaximum: 10, activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: new Date().toISOString() }, { headers: { authorization: 'Bearer forged' } })).status, 401);
  });

  // --- SCORM ---------------------------------------------------------------------------------------------------------------
  const manifest = (href = 'index.html') => `<?xml version="1.0"?><manifest identifier="pkg" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schemaversion>1.2</schemaversion></metadata>
    <organizations default="o"><organization identifier="o"><title>Signals SCORM</title><item identifier="i" identifierref="r"><title>SCO</title></item></organization></organizations>
    <resources><resource identifier="r" type="webcontent" adlcp:scormtype="sco" href="${href}"/></resources></manifest>`;
  const upload = async (files, name = 'package.zip') => {
    const form = new FormData(); form.append('package', new Blob([files instanceof Buffer ? files : createZip(files)], { type: 'application/zip' }), name);
    return T('POST', `/scorm/${courseId}/packages`, form);
  };
  let scormItemId, playerPath;

  test('SCORM: invalid or dangerous packages are refused', async () => {
    assert.equal((await upload([{ name: 'index.html', data: '<p>x</p>' }])).body.error.code, 'SCORM_MANIFEST_MISSING');
    assert.equal((await upload([{ name: 'imsmanifest.xml', data: manifest('missing.html') }])).body.error.code, 'SCORM_LAUNCH_MISSING');
    assert.equal((await upload([{ name: 'imsmanifest.xml', data: manifest() }, { name: 'index.html', data: 'x' }, { name: 'server/run.php', data: '<?php ?>' }])).body.error.code, 'SCORM_FORBIDDEN_FILE');
    assert.equal((await upload([{ name: 'imsmanifest.xml', data: manifest() }, { name: '../index.html', data: 'x' }])).body.error.code, 'SCORM_ZIP_UNSAFE_PATH');
    assert.equal((await upload(Buffer.from('not a zip at all'))).body.error.code, 'SCORM_ZIP_INVALID');
    const form = new FormData(); form.append('package', new Blob([createZip([{ name: 'imsmanifest.xml', data: manifest() }, { name: 'index.html', data: 'x' }])]), 'p.zip');
    assert.equal((await S('POST', `/scorm/${courseId}/packages`, form)).status, 403, 'students cannot import');
  });

  test('SCORM: valid package imported, launched, served only on the isolated content host', async () => {
    const sco = '<!doctype html><html><body><script>var api=parent.API;api.LMSInitialize("");</script></body></html>';
    const imported = await upload([{ name: 'imsmanifest.xml', data: manifest() }, { name: 'index.html', data: sco }, { name: 'img/logo.svg', data: '<svg xmlns="http://www.w3.org/2000/svg"/>' }]);
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    assert.equal(imported.body.data.version, '1.2');
    scormItemId = await addItem({ type: 'scorm', title: 'Module interactif', scormPackageId: imported.body.data.id });
    const launch = await S('POST', `/scorm/${courseId}/items/${scormItemId}/launch`, {});
    assert.equal(launch.status, 200, JSON.stringify(launch.body));
    const playerUrl = new URL(launch.body.data.playerUrl);
    assert.equal(playerUrl.host, CONTENT_HOST);
    playerPath = playerUrl.pathname;
    assert.equal((await raw('GET', playerPath, `127.0.0.1:${port}`)).status, 404, 'never served on the API host (session cookie)');
    const player = await raw('GET', playerPath, CONTENT_HOST);
    assert.equal(player.status, 200);
    assert.match(player.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(player.headers['content-security-policy'], /frame-ancestors 'self' http:\/\/localhost:3000/);
    assert.equal(player.headers['x-frame-options'], undefined);
    assert.match(player.body, /window\.API=/);
    assert.match(player.body, /src="content\/index\.html"/);
    const file = await raw('GET', `${playerPath}content/index.html`, CONTENT_HOST);
    assert.equal(file.status, 200); assert.equal(file.headers['x-content-type-options'], 'nosniff');
    assert.equal((await raw('GET', `${playerPath}content/..%2F..%2F..%2Fpackage.json`, CONTENT_HOST)).status, 404, 'path confined to the package');
    assert.equal((await raw('GET', `${playerPath.replace(/\/scorm-content\/[^/]+/, '/scorm-content/forged')}`, CONTENT_HOST)).status, 404, 'forged token');
    assert.equal((await X('POST', `/scorm/${courseId}/items/${scormItemId}/launch`, {})).status, 404, 'not enrolled');
  });

  test('SCORM: runtime data persisted, session resumed, completion and score recorded', async () => {
    let commit = await raw('POST', `${playerPath}commit`, CONTENT_HOST, JSON.stringify({ values: { 'cmi.core.lesson_status': 'incomplete', 'cmi.suspend_data': 'page=3', 'cmi.core.exit': 'suspend', 'cmi.core.student_id': 'forged' } }));
    assert.equal(commit.status, 200, commit.body);
    assert.deepEqual(JSON.parse(commit.body).data.rejected, ['cmi.core.student_id']);
    const relaunch = await S('POST', `/scorm/${courseId}/items/${scormItemId}/launch`, {});
    const resumed = await raw('GET', new URL(relaunch.body.data.playerUrl).pathname, CONTENT_HOST);
    const config = JSON.parse(/<script type="application\/json" id="scorm-data">([\s\S]*?)<\/script>/.exec(resumed.body)[1]);
    assert.equal(config.readOnly['cmi.core.entry'], 'resume');
    assert.equal(config.cmi['cmi.suspend_data'], 'page=3');
    commit = await raw('POST', `${new URL(relaunch.body.data.playerUrl).pathname}commit`, CONTENT_HOST, JSON.stringify({ values: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '18', 'cmi.core.score.max': '20', 'cmi.core.exit': '' }, final: true }));
    assert.equal(JSON.parse(commit.body).data.completed, true);
    const attempt = await ScormAttempt.findOne({ studentId: student.user._id }).lean();
    assert.equal(attempt.sessions, 2); assert.equal(attempt.scorePercent, 90); assert.equal(attempt.passed, true);
    assert.ok((await Enrollment.findOne({ studentId: student.user._id, courseId }).lean()).completedLessonIds.includes(scormItemId));
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'scorm' }).lean();
    assert.equal((await GradeEntry.findOne({ columnId: column._id }).lean()).score, 90);
    const teacherPreview = await T('POST', `/scorm/${courseId}/items/${scormItemId}/launch`, {});
    assert.equal(teacherPreview.body.data.preview, true);
    assert.equal(await ScormAttempt.countDocuments({ studentId: teacher.user._id }), 0, 'previews are not recorded');
  });
});
