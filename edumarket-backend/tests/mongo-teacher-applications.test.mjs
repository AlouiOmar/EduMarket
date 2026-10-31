import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_applications_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.TEACHER_DOCUMENT_MAX_MB = '1';
delete process.env.TEACHER_DOCUMENTS_STORAGE;

let server, baseUrl, User, TeacherApplication, AuditEvent, Notification, store, purgeExpiredApplications;

/** In-memory private store (the real local / S3 adapters are covered elsewhere); `persistent` can be switched off. */
function memoryStore() {
  const files = new Map();
  return { files, kind: 'local', persistent: true, async put(key, body) { files.set(key, Buffer.from(body)); }, async get(key) { if (!files.has(key)) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } return files.get(key); }, async remove(key) { files.delete(key); } };
}

// Fictitious documents only: no real identity document or diploma is ever used.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
const ACTIVE_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]);

describe('Independent teacher applications on MongoDB', { skip: !mongoUri }, () => {
  before(async () => {
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, applications, auditModule, notifications, storeModule, routes] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/teacher-applications/model.js'), import('../dist/modules/admin/audit.model.js'),
      import('../dist/modules/notifications/model.js'), import('../dist/integrations/documentStore.js'), import('../dist/modules/teacher-applications/routes.js'),
    ]);
    User = users.User; TeacherApplication = applications.TeacherApplication; AuditEvent = auditModule.AuditEvent; Notification = notifications.Notification; purgeExpiredApplications = routes.purgeExpiredApplications;
    store = memoryStore();
    storeModule.replaceDocumentStoreForTests(store);
    await Promise.all([User.init(), TeacherApplication.init()]);
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const call = cookie => async (method, url, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload, headers: response.headers };
  };
  const anonymous = call(null);
  async function login(email, password) {
    const response = await anonymous('POST', '/auth/login', { email, password });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return { cookie, api: call(cookie), user: response.body.data.user };
  }
  async function account(role, email, extra = {}) {
    const password = `${role}-password-2026`;
    await User.create({ name: `${role} ${email.split('@')[0]}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: true, status: 'active', ...extra });
    return login(email, password);
  }
  const candidateBody = (email, extra = {}) => ({ accountType: 'teacher_candidate', email, password: 'Candidate-password-2026', firstName: 'Nour', lastName: 'Fictive', phone: '+21620000000', country: 'TN', city: 'Sfax', preferredLanguage: 'fr', acceptTerms: true, ...extra });
  async function registerCandidate(email) {
    const registration = await anonymous('POST', '/auth/register', candidateBody(email));
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    const token = new URLSearchParams(new URL(registration.body.data.previewUrl).hash.slice(1)).get('token');
    assert.equal((await anonymous('POST', '/auth/email/verification/confirm', { token })).status, 200);
    return login(email, 'Candidate-password-2026');
  }
  const form = (bytes, name, mime, fields) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.append(key, value); data.append('file', new Blob([bytes], { type: mime }), name); return data; };
  const mine = async api => (await api('GET', '/teacher-applications/mine')).body.data;
  const sections = {
    personal: { birthDate: '1990-04-12', nationality: 'TN', address: '1 rue Fictive, Sfax' },
    identity: { documentType: 'national_id', documentNumber: '09 876 543', issuingCountry: 'TN', issuingAuthority: 'Ministère (fictif)', issuedAt: '2020-01-10', expiresAt: '2035-01-10' },
    academic: { degrees: [
      { level: 'master', title: 'Master informatique', specialty: 'Génie logiciel', institution: 'Université fictive', country: 'TN', year: 2014, highest: true },
      { level: 'bachelor', title: 'Licence mathématiques', specialty: 'Mathématiques', institution: 'Faculté fictive', country: 'FR', year: 2012, highest: false },
    ], certifications: [{ name: 'Certification fictive', issuer: 'Org fictive', year: 2019, kind: 'certification' }] },
    professional: {
      headline: 'Formatrice web et mathématiques', bio: 'Enseignante depuis dix ans en développement web et en mathématiques appliquées, j\'accompagne des étudiants de licence et des professionnels en reconversion.',
      specialties: ['Angular', 'Mathématiques'], expertise: ['Front-end'], subjects: ['Angular', 'Algèbre'], teachingLanguages: ['fr', 'ar'], yearsOfExperience: 10,
      experiences: [{ kind: 'teaching', title: 'Enseignante vacataire', organization: 'Institut fictif', startDate: '2015-09-01', endDate: null, current: true, description: 'Cours de TypeScript' }],
      skills: ['TypeScript'], portfolioUrl: 'https://portfolio.example.test', linkedinUrl: 'https://www.linkedin.com/in/fictive',
    },
  };
  /** Fills and documents a complete file, returning the application. */
  async function completeFile(api) {
    let application = await mine(api);
    application = (await api('PATCH', '/teacher-applications/mine', { revision: application.revision, ...sections })).body.data;
    for (const [type, extra] of [['identity', {}], ['cv', {}], ['diploma', { degreeId: application.academic.degrees[0].id }], ['diploma', { degreeId: application.academic.degrees[1].id }]]) {
      const uploaded = await api('POST', '/teacher-applications/mine/documents', form(PDF, `${type}.pdf`, 'application/pdf', { type, ...extra }));
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
      application = uploaded.body.data;
    }
    return application;
  }

  let admin, institution, student, candidate, application;
  test('setup: central administrator, institution administrator, student', async () => {
    admin = await account('admin', 'central-admin@example.test');
    institution = await account('institution', 'institute-admin@example.test');
    student = await account('student', 'plain-student@example.test');
  });

  test('registration: candidate account through the existing authentication, no teacher permission, duplicates refused', async () => {
    assert.equal((await anonymous('POST', '/auth/register', candidateBody('nour@example.test', { acceptTerms: false }))).status, 400);
    assert.equal((await anonymous('POST', '/auth/register', candidateBody('nour@example.test', { role: 'teacher' }))).status, 400, 'no role field is accepted');
    assert.equal((await anonymous('POST', '/auth/register', candidateBody('nour@example.test', { phone: '20000000' }))).status, 400, 'international format required');
    const registration = await anonymous('POST', '/auth/register', candidateBody('nour@example.test'));
    assert.equal(registration.status, 201);
    assert.equal(registration.body.data.role, 'unverified_teacher');
    assert.equal((await anonymous('POST', '/auth/login', { email: 'nour@example.test', password: 'Candidate-password-2026' })).body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await anonymous('POST', '/auth/register', candidateBody('NOUR@example.test'))).body.error.code, 'EMAIL_IN_USE');
    const plain = await anonymous('POST', '/auth/register', { name: 'Plain', email: 'plain@example.test', password: 'Plain-password-2026', role: 'admin' });
    assert.equal(plain.body.data.role, 'student', 'a role sent by the client is ignored');
    const token = new URLSearchParams(new URL(registration.body.data.previewUrl).hash.slice(1)).get('token');
    assert.equal((await anonymous('POST', '/auth/email/verification/confirm', { token })).status, 200);
    candidate = await login('nour@example.test', 'Candidate-password-2026');
    const user = await User.findOne({ email: 'nour@example.test' }).lean();
    assert.equal(user.verified, false); assert.equal(user.teacherVerification, undefined);
    application = await mine(candidate.api);
    assert.equal(application.status, 'draft');
    assert.equal(application.personal.firstName, 'Nour'); assert.equal(application.personal.country, 'TN'); assert.equal(application.termsAccepted, true);
    assert.ok(application.missing.includes('documents.identity') && application.missing.includes('academic.degrees'));
    assert.ok(await Notification.exists({ userId: user._id, 'template.key': 'teacherApplicationCreated' }));
  });

  test('a candidate has no teacher permission and cannot change their status', async () => {
    assert.equal((await candidate.api('POST', '/courses', { title: 'Cours non autorisé', description: 'x'.repeat(30), category: 'web', price: 0 })).status, 403);
    assert.equal((await candidate.api('POST', '/sessions/availability', { startAt: new Date(Date.now() + 86_400_000).toISOString(), endAt: new Date(Date.now() + 90_000_000).toISOString(), type: 'online', price: 0 })).status, 403);
    assert.equal((await candidate.api('PATCH', '/teacher-applications/mine', { revision: application.revision, status: 'approved' })).status, 400);
    assert.equal((await candidate.api('GET', '/teacher-applications/admin')).status, 403);
    assert.equal((await candidate.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: application.revision, confirm: true })).status, 403);
    assert.equal((await candidate.api('PATCH', `/admin/users/${candidate.user.id}/role`, { role: 'teacher' })).status, 403);
    assert.equal((await candidate.api('POST', '/teacher-verifications', { specialty: 'Angular', credentialsSummary: 'x'.repeat(40) })).body.error.code, 'USE_TEACHER_APPLICATION', 'no lighter path to the same permissions');
  });

  test('draft: saved section by section, resumed later, protected by the revision, identity number encrypted and masked', async () => {
    const saved = await candidate.api('PATCH', '/teacher-applications/mine', { revision: application.revision, personal: sections.personal, identity: sections.identity });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.identity.documentNumberMasked, '•••• 6543');
    assert.ok(!JSON.stringify(saved.body).includes('09876543'));
    const raw = await mongoose.connection.collection('teacherapplications').findOne({ _id: new mongoose.Types.ObjectId(application.id) });
    assert.ok(raw.identity.documentNumberEncrypted && !raw.identity.documentNumberEncrypted.includes('09876543'));
    assert.equal((await candidate.api('PATCH', '/teacher-applications/mine', { revision: application.revision, personal: { city: 'Tunis' } })).body.error.code, 'APPLICATION_REVISION_CONFLICT');
    assert.equal((await candidate.api('PATCH', '/teacher-applications/mine', { revision: saved.body.data.revision, professional: { linkedinUrl: 'http://evil.example' } })).status, 400);
    const resumed = await mine(candidate.api);
    assert.equal(resumed.personal.nationality, 'TN'); assert.equal(resumed.identity.issuingCountry, 'TN');
    application = (await candidate.api('PATCH', '/teacher-applications/mine', { revision: resumed.revision, academic: sections.academic, professional: sections.professional })).body.data;
    assert.equal(application.academic.degrees.length, 2);
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision })).body.error.code, 'APPLICATION_INCOMPLETE');
  });

  test('documents: real type checked, size limited, active content refused, a diploma belongs to a declared degree', async () => {
    const upload = (bytes, name, mime, fields) => candidate.api('POST', '/teacher-applications/mine/documents', form(bytes, name, mime, fields));
    assert.equal((await upload(Buffer.from('hello'), 'notes.txt', 'text/plain', { type: 'cv' })).body.error.code, 'UNSUPPORTED_DOCUMENT_TYPE');
    assert.equal((await upload(EXE, 'cv.pdf', 'application/pdf', { type: 'cv' })).body.error.code, 'INVALID_DOCUMENT_CONTENT');
    assert.equal((await upload(PDF, 'cv.png', 'image/png', { type: 'cv' })).body.error.code, 'DOCUMENT_TYPE_MISMATCH');
    assert.equal((await upload(ACTIVE_PDF, 'cv.pdf', 'application/pdf', { type: 'cv' })).body.error.code, 'DOCUMENT_ACTIVE_CONTENT');
    const big = await upload(Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024)]), 'big.pdf', 'application/pdf', { type: 'cv' });
    assert.equal(big.status, 413); assert.equal(big.body.error.code, 'DOCUMENT_TOO_LARGE');
    assert.equal((await upload(PDF, 'diploma.pdf', 'application/pdf', { type: 'diploma' })).body.error.code, 'DIPLOMA_DEGREE_REQUIRED');
    assert.equal(store.files.size, 0, 'nothing refused was stored');

    for (const [bytes, name, mime, fields] of [[PDF, '../../identité.pdf', 'application/pdf', { type: 'identity' }], [PDF, 'cv.pdf', 'application/pdf', { type: 'cv' }], [PNG, 'master.png', 'image/png', { type: 'diploma', degreeId: application.academic.degrees[0].id }]]) {
      const response = await upload(bytes, name, mime, fields);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      application = response.body.data;
    }
    const identity = application.documents.find(document => document.type === 'identity');
    assert.equal(identity.originalName, 'identité.pdf', 'path parts removed');
    const stored = (await TeacherApplication.findById(application.id).lean()).documents;
    assert.ok(stored.every(document => /^[a-f0-9]{32}\.(pdf|png)$/.test(document.storageKey) && store.files.has(document.storageKey)), 'server-generated keys, files outside MongoDB');
    assert.ok(!JSON.stringify(application).includes(stored[0].storageKey), 'storage keys never returned');
    const own = await candidate.api('GET', identity.url);
    assert.equal(own.status, 200); assert.equal(own.headers.get('cache-control'), 'private, no-store'); assert.ok(own.headers.get('content-security-policy').includes('sandbox'));
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision })).body.error.details.missing.join(), `documents.diploma:${application.academic.degrees[1].id}`);
    // A draft document not yet reviewed can be withdrawn.
    const extra = (await upload(PDF, 'portfolio.pdf', 'application/pdf', { type: 'portfolio' })).body.data;
    const portfolio = extra.documents.find(document => document.type === 'portfolio');
    application = (await candidate.api('DELETE', `/teacher-applications/mine/documents/${portfolio.id}`)).body.data;
    assert.ok(!application.documents.some(document => document.type === 'portfolio'));
    application = (await upload(PDF, 'licence.pdf', 'application/pdf', { type: 'diploma', degreeId: application.academic.degrees[1].id })).body.data;
    assert.deepEqual(application.missing, []);
  });

  test('another candidate, a student or an institution administrator cannot reach this file', async () => {
    const other = await registerCandidate('other-candidate@example.test');
    const documentId = application.documents[0].id;
    assert.equal((await other.api('GET', `/teacher-applications/mine/documents/${documentId}`)).status, 404);
    assert.equal((await student.api('GET', `/teacher-applications/admin/${application.id}/documents/${documentId}`)).status, 403);
    assert.equal((await institution.api('GET', '/teacher-applications/admin')).status, 403, 'institution administrators do not review independent teachers');
    assert.equal((await institution.api('POST', `/teacher-applications/admin/${application.id}/start-review`, { revision: 0 })).status, 403);
    assert.equal((await anonymous('GET', `/teacher-applications/mine/documents/${documentId}`)).status, 401);
  });

  test('submission needs a persistent private store, then locks the file and gives a reference', async () => {
    store.persistent = false;
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision })).body.error.code, 'DOCUMENT_STORAGE_NOT_PERSISTENT');
    store.persistent = true;
    const submitted = await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    application = submitted.body.data;
    assert.equal(application.status, 'submitted'); assert.match(application.reference, /^EMT-\d{4}-[0-9A-F]{8}$/); assert.ok(application.submittedAt);
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision })).status, 409, 'no double submission');
    assert.equal((await candidate.api('PATCH', '/teacher-applications/mine', { revision: application.revision, personal: { city: 'Tunis' } })).body.error.code, 'APPLICATION_LOCKED');
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/documents', form(PDF, 'x.pdf', 'application/pdf', { type: 'other' }))).body.error.code, 'APPLICATION_LOCKED');
    const user = await User.findOne({ email: 'nour@example.test' }).lean();
    assert.ok(await Notification.exists({ userId: user._id, 'template.key': 'teacherApplicationSubmitted' }));
    assert.ok(await Notification.exists({ userId: admin.user.id, 'template.key': 'teacherApplicationNew' }));
  });

  test('back office: list without sensitive data, filters, statistics, audited detail and identity disclosure', async () => {
    const listed = await admin.api('GET', '/teacher-applications/admin?status=to_review&country=TN&specialty=Angular&search=nour@example');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.pagination.total, 1);
    const row = listed.body.data[0];
    assert.equal(row.reference, application.reference); assert.equal(row.email, 'nour@example.test'); assert.deepEqual(row.specialties, ['Angular', 'Mathématiques']);
    assert.deepEqual(row.documents, { total: 4, verified: 0, pending: 4, refused: 0 });
    const text = JSON.stringify(listed.body);
    for (const secret of ['6543', '09876543', '1990-04-12', 'rue Fictive', 'documentNumber', 'birthDate']) assert.ok(!text.includes(secret), `list leaks ${secret}`);
    assert.equal((await admin.api('GET', '/teacher-applications/admin?status=to_review&country=FR')).body.pagination.total, 0);
    assert.ok(!(await admin.api('GET', '/teacher-applications/admin')).body.data.some(entry => entry.status === 'draft'), 'drafts stay private by default');
    const stats = (await admin.api('GET', '/teacher-applications/admin/stats')).body.data;
    assert.equal(stats.new, 1); assert.equal(stats.drafts, 1);
    const detail = (await admin.api('GET', `/teacher-applications/admin/${application.id}`)).body.data;
    assert.equal(detail.identity.documentNumberMasked, '•••• 6543'); assert.equal(detail.personal.address, '1 rue Fictive, Sfax');
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/identity-number`)).body.data.documentNumber, '09876543');
    assert.ok(await AuditEvent.exists({ action: 'teacher.application.viewed', targetId: application.id }));
    assert.ok(await AuditEvent.exists({ action: 'teacher.application.identity_revealed', targetId: application.id }));
    const viewed = await admin.api('GET', `${detail.documents[0].url}?download=1`);
    assert.equal(viewed.status, 200); assert.match(viewed.headers.get('content-disposition'), /^attachment/);
    assert.ok(await AuditEvent.exists({ action: 'teacher.application.document_downloaded' }));
  });

  let detail;
  test('review: started by an administrator; documents verified or refused with a reason; approval blocked until all mandatory documents are verified', async () => {
    detail = (await admin.api('GET', `/teacher-applications/admin/${application.id}`)).body.data;
    const [identity, cv, master] = ['identity', 'cv', 'diploma'].map(type => detail.documents.find(document => document.type === type));
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${identity.id}/review`, { revision: detail.revision, status: 'verified' })).body.error.code, 'INVALID_APPLICATION_TRANSITION');
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/start-review`, { revision: detail.revision })).body.data;
    assert.equal(detail.status, 'under_review'); assert.equal(detail.reviewerId, admin.user.id);
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${identity.id}/review`, { revision: detail.revision, status: 'verified' })).body.data;
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${cv.id}/review`, { revision: detail.revision, status: 'verified' })).body.data;
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${master.id}/review`, { revision: detail.revision, status: 'rejected' })).body.error.code, 'REVIEW_REASON_REQUIRED');
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${master.id}/review`, { revision: detail.revision, status: 'rejected', comment: 'Copie illisible : merci de fournir un scan lisible.' })).body.data;
    const rejected = detail.documents.find(document => document.id === master.id);
    assert.equal(rejected.status, 'rejected'); assert.equal(rejected.reviewedBy, admin.user.id);
    const blocked = await admin.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: detail.revision, confirm: true });
    assert.equal(blocked.status, 422); assert.equal(blocked.body.error.code, 'APPROVAL_BLOCKED');
    assert.equal(blocked.body.error.details.blockers.filter(code => code.startsWith('documents.diploma:')).length, 2);
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/notes`, { text: 'Note interne : vérifier auprès de l\'université.' })).body.data;
    assert.equal(detail.internalNotes.length, 1);
  });

  test('additional information: requested with a message, answered by replacing the document; internal notes never shown to the candidate', async () => {
    const master = detail.documents.find(document => document.type === 'diploma' && document.status === 'rejected');
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/request-information`, { revision: detail.revision, message: 'Merci de fournir une nouvelle copie de votre master.', items: [`document:${master.id}`, 'professional'] })).body.data;
    assert.equal(detail.status, 'additional_information_required');
    application = await mine(candidate.api);
    assert.equal(application.status, 'additional_information_required'); assert.equal(application.editable, true);
    assert.equal(application.requests[0].message, 'Merci de fournir une nouvelle copie de votre master.');
    const candidateText = JSON.stringify(application);
    assert.ok(!candidateText.includes('Note interne') && !candidateText.includes(admin.user.id), 'no internal note nor reviewer identity');
    const old = application.documents.find(document => document.id === master.id);
    assert.equal(old.status, 'replacement_requested'); assert.ok(application.missing.includes(`documents.diploma:${old.degreeId}`));
    const identity = application.documents.find(document => document.type === 'identity');
    assert.equal((await candidate.api('POST', '/teacher-applications/mine/documents', form(PDF, 'cin.pdf', 'application/pdf', { type: 'identity', replaces: identity.id }))).body.error.code, 'DOCUMENT_ALREADY_VERIFIED');
    const replacement = await candidate.api('POST', '/teacher-applications/mine/documents', form(PNG, 'master-v2.png', 'image/png', { type: 'diploma', replaces: master.id }));
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
    application = replacement.body.data;
    const replaced = application.documents.find(document => document.id === master.id);
    assert.ok(replaced.replacedBy); assert.equal(replaced.reviews.length, 2, 'verification history kept');
    assert.equal(application.documents.find(document => document.id === replaced.replacedBy).degreeId, old.degreeId);
    application = (await candidate.api('POST', '/teacher-applications/mine/submit', { revision: application.revision })).body.data;
    assert.equal(application.status, 'resubmitted'); assert.ok(application.requests[0].resolvedAt);
  });

  test('approval: confirmation and fresh revision required, permissions activated server-side, idempotent; suspension withdraws them', async () => {
    detail = (await admin.api('GET', `/teacher-applications/admin/${application.id}`)).body.data;
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/start-review`, { revision: detail.revision })).body.data;
    for (const document of detail.documents.filter(entry => !entry.replacedBy && entry.status === 'pending_review')) {
      detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/documents/${document.id}/review`, { revision: detail.revision, status: 'verified' })).body.data;
    }
    assert.deepEqual(detail.approvalBlockers, []);
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: detail.revision })).status, 400, 'explicit confirmation');
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: detail.revision - 1, confirm: true })).body.error.code, 'APPLICATION_REVISION_CONFLICT');
    const both = await Promise.all([1, 2].map(() => admin.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: detail.revision, confirm: true })));
    assert.ok(both.some(response => response.status === 200) && both.every(response => [200, 409].includes(response.status)));
    const again = await admin.api('POST', `/teacher-applications/admin/${application.id}/approve`, { revision: detail.revision, confirm: true });
    assert.equal(again.status, 200); assert.equal(again.body.data.status, 'approved');
    const user = await User.findOne({ email: 'nour@example.test' }).lean();
    assert.equal(user.role, 'teacher'); assert.equal(user.verified, true); assert.equal(user.teacherType, 'independent');
    assert.equal(user.teacherVerification.status, 'approved'); assert.equal(user.teacherVerification.reviewedBy.toString(), admin.user.id);
    assert.ok(await Notification.exists({ userId: user._id, 'template.key': 'teacherApplicationApproved' }));
    const slot = await candidate.api('POST', '/sessions/availability', { startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), endAt: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(), type: 'online', price: 0 });
    assert.equal(slot.status, 201, 'an approved independent teacher can teach');
    assert.equal((await candidate.api('GET', '/teacher-applications/mine')).body.data.status, 'approved');

    detail = (await admin.api('GET', `/teacher-applications/admin/${application.id}`)).body.data;
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${application.id}/suspend`, { revision: detail.revision, reason: 'court' })).status, 400, 'reason required');
    detail = (await admin.api('POST', `/teacher-applications/admin/${application.id}/suspend`, { revision: detail.revision, reason: 'Signalements répétés en cours d\'examen.' })).body.data;
    assert.equal(detail.status, 'suspended');
    const suspended = await User.findOne({ email: 'nour@example.test' }).lean();
    assert.equal(suspended.role, 'unverified_teacher'); assert.equal(suspended.verified, false); assert.equal(suspended.teacherVerification.status, 'suspended');
    assert.equal((await candidate.api('POST', '/sessions/availability', { startAt: new Date(Date.now() + 4 * 86_400_000).toISOString(), endAt: new Date(Date.now() + 4 * 86_400_000 + 3_600_000).toISOString(), type: 'online', price: 0 })).status, 403);
    assert.equal((await mine(candidate.api)).decisionReason, 'Signalements répétés en cours d\'examen.');
    assert.ok(await AuditEvent.exists({ action: 'teacher.application.suspended', severity: 'critical' }));
  });

  test('refusal: reason required, not bypassed by restarting at once; a new file is possible after the waiting period, without documents', async () => {
    const second = await registerCandidate('second-candidate@example.test');
    let file = await completeFile(second.api);
    file = (await second.api('POST', '/teacher-applications/mine/submit', { revision: file.revision })).body.data;
    let view = (await admin.api('GET', `/teacher-applications/admin/${file.id}`)).body.data;
    view = (await admin.api('POST', `/teacher-applications/admin/${file.id}/start-review`, { revision: view.revision })).body.data;
    assert.equal((await admin.api('POST', `/teacher-applications/admin/${file.id}/reject`, { revision: view.revision, reason: 'non', category: 'other' })).status, 400);
    view = (await admin.api('POST', `/teacher-applications/admin/${file.id}/reject`, { revision: view.revision, reason: 'Les diplômes fournis ne correspondent pas aux matières proposées.', category: 'insufficient_qualification' })).body.data;
    assert.equal(view.status, 'rejected');
    const refused = await mine(second.api);
    assert.equal(refused.decisionReason, 'Les diplômes fournis ne correspondent pas aux matières proposées.'); assert.ok(refused.canReapplyAt);
    assert.equal((await second.api('POST', '/teacher-applications/mine/submit', { revision: refused.revision })).status, 404, 'a refused file cannot be resubmitted');
    assert.equal((await second.api('POST', '/teacher-applications', {})).body.error.code, 'REAPPLY_TOO_EARLY');
    assert.equal((await User.findOne({ email: 'second-candidate@example.test' }).lean()).role, 'unverified_teacher');
    await TeacherApplication.updateOne({ _id: file.id }, { $set: { decisionAt: new Date(Date.now() - 91 * 86_400_000) } });
    const restarted = await second.api('POST', '/teacher-applications', {});
    assert.equal(restarted.status, 201);
    assert.equal(restarted.body.data.status, 'draft'); assert.equal(restarted.body.data.documents.length, 0); assert.equal(restarted.body.data.identity.documentNumberMasked, '');
    assert.equal(restarted.body.data.professional.headline, sections.professional.headline);
    assert.equal(await TeacherApplication.countDocuments({ userId: second.user.id }), 2, 'the refused file is kept');

    // Retention: once the period is over, the refused file loses its files and identity data, the record stays.
    const filesBefore = store.files.size;
    assert.ok(await purgeExpiredApplications(new Date(Date.now() + 400 * 86_400_000)) >= 1);
    const purged = await TeacherApplication.findById(file.id).select('+identity.documentNumberEncrypted').lean();
    assert.ok(purged.purgedAt); assert.equal(purged.identity.documentNumberEncrypted, ''); assert.equal(purged.personal.birthDate, null);
    assert.ok(purged.documents.every(document => document.purgedAt)); assert.ok(store.files.size <= filesBefore - 4);
    assert.equal((await admin.api('GET', `/teacher-applications/admin/${file.id}/documents/${purged.documents[0]._id}`)).body.error.code, 'DOCUMENT_PURGED');
  });

  test('institutional teachers keep their process: no independent application, no legacy shortcut', async () => {
    const affiliated = await account('teacher', 'institute-teacher@example.test', { institutionId: new mongoose.Types.ObjectId(institution.user.id), teacherVerification: { specialty: 'Physique', credentialsSummary: 'Fixture', status: 'approved', submittedAt: new Date() } });
    assert.equal((await affiliated.api('POST', '/teacher-applications', {})).status, 403);
    assert.equal((await affiliated.api('GET', '/teacher-applications/mine')).body.eligibility.institutional, true);
    const managed = await account('student', 'managed-student@example.test', { teacherType: 'institutional' });
    assert.equal((await managed.api('POST', '/teacher-applications', {})).body.error.code, 'INSTITUTIONAL_TEACHER');
    assert.equal((await managed.api('POST', '/teacher-verifications', { specialty: 'Physique', credentialsSummary: 'x'.repeat(40) })).body.error.code, 'INSTITUTIONAL_TEACHER');
    // A plain student may start a file; it is idempotent.
    const first = await student.api('POST', '/teacher-applications', {});
    assert.equal(first.status, 201);
    const repeat = await student.api('POST', '/teacher-applications', {});
    assert.equal(repeat.status, 200); assert.equal(repeat.body.data.id, first.body.data.id);
    assert.equal((await User.findById(student.user.id).lean()).role, 'student', 'a student keeps their student access while applying');
  });
});
