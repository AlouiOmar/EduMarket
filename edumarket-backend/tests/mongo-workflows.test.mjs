import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI;
if (mongoUri) {
  const parsedMongoUri = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedMongoUri.hostname) || !/_test$/i.test(parsedMongoUri.pathname)) {
  throw new Error('Integration tests only run against a local database whose name ends in _test.');
  }
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.JITSI_BASE_URL = 'https://meet.example.test';

let server;
let baseUrl;
let User;
let Course;
let TutoringSession;
let PlatformSettings;
let AuditEvent;
let Assignment;
let AssignmentSubmission;
let Enrollment;
let CourseAsset;
let Conversation;
let Message;
let closeUserEventStreams;
let privateUploadDir;

describe('MongoDB persistence workflows', { skip: !mongoUri }, () => {
before(async () => {
  privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-private-it-'));
  process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
  await mongoose.connect(mongoUri);
  await mongoose.connection.dropDatabase();
  const [{ app }, users, courses, sessions, settings, audit, assignments, enrollments, courseAssets, messaging, userEvents] = await Promise.all([
    import('../dist/app.js'), import('../dist/modules/auth/model.js'),
    import('../dist/modules/courses/model.js'), import('../dist/modules/sessions/model.js'),
    import('../dist/modules/admin/settings.model.js'), import('../dist/modules/admin/audit.model.js'),
    import('../dist/modules/assignments/models.js'), import('../dist/modules/enrollments/model.js'), import('../dist/modules/courses/assets.model.js'),
    import('../dist/modules/messaging/models.js'),
    import('../dist/integrations/userEvents.js'),
  ]);
  User = users.User; Course = courses.Course; TutoringSession = sessions.TutoringSession;
  PlatformSettings = settings.PlatformSettings; AuditEvent = audit.AuditEvent;
  Assignment = assignments.Assignment; AssignmentSubmission = assignments.AssignmentSubmission; Enrollment = enrollments.Enrollment;
  CourseAsset = courseAssets.CourseAsset;
  Conversation = messaging.Conversation; Message = messaging.Message;
  closeUserEventStreams = userEvents.closeUserEventStreams;
  await Promise.all([User.init(), Course.init(), TutoringSession.init(), Assignment.init(), AssignmentSubmission.init(), Enrollment.init(), CourseAsset.init(), Conversation.init(), Message.init()]);
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration API did not bind a port.');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (privateUploadDir) await rm(privateUploadDir, { recursive: true, force: true });
});

async function registerAndLogin(name, email, password = 'correct-horse-battery-2026') {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }),
  });
  assert.equal(registration.status, 201);
  const verificationUrl = (await registration.json()).data.previewUrl;
  assert.ok(verificationUrl, 'test mode should provide a development-only verification link');
  const verificationToken = new URLSearchParams(new URL(verificationUrl).hash.slice(1)).get('token');
  assert.ok(verificationToken);
  const verification = await fetch(`${baseUrl}/auth/email/verification/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }),
  });
  assert.equal(verification.status, 200);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  return { user: (await login.json()).data.user, cookie: login.headers.get('set-cookie').split(';')[0] };
}

async function readSseUntil(reader, matches, maxFrames = 20) {
  const decoder = new TextDecoder();
  let text = '';
  for (let index = 0; index < maxFrames; index += 1) {
    let timer;
    const result = await Promise.race([
      reader.read(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 2_000); }),
    ]);
    clearTimeout(timer);
    if (!result) assert.fail(`Timed out waiting for SSE frame; collected: ${text}`);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
    if (matches.test(text)) return text;
  }
  assert.fail(`SSE frame not received; collected: ${text}`);
}

test('persisted course learning, favorites, review and notification preferences stay user-scoped', async () => {
  const student = await registerAndLogin('Integration Student', 'student-workflow@example.test');
  const teacher = await User.create({ name: 'Verified Teacher', email: 'teacher-workflow@example.test', passwordHash: await bcrypt.hash('teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active', teacherVerification: { specialty: 'Computer science', credentialsSummary: 'Verified integration teacher', status: 'approved', submittedAt: new Date() } });
  const course = await Course.create({
    title: 'Mongo Integration Course', slug: 'mongo-integration-course', description: 'A course used by isolated integration tests.', category: 'Testing', price: 0, rating: 0, ratingCount: 0, studentsCount: 0, teacherId: teacher._id, status: 'published',
    chapters: [{ id: 'chapter-1', title: 'Chapter 1', order: 0, lessons: [{ id: 'lesson-1', title: 'Persisted lesson', chapterId: 'chapter-1', durationMinutes: 8, type: 'text' }] }],
  });
  const headers = { Cookie: student.cookie, 'Content-Type': 'application/json' };

  const enrollment = await fetch(`${baseUrl}/enrollments`, { method: 'POST', headers, body: JSON.stringify({ courseId: String(course._id) }) });
  assert.equal(enrollment.status, 201);
  const completed = await fetch(`${baseUrl}/enrollments/${course.id}/lessons/lesson-1/complete`, { method: 'PUT', headers });
  assert.equal(completed.status, 200);
  const history = await fetch(`${baseUrl}/enrollments/history`, { headers: { Cookie: student.cookie } });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).data[0].lessonTitle, 'Persisted lesson');

  const addFavorite = await fetch(`${baseUrl}/favorites/${course.id}`, { method: 'PUT', headers: { Cookie: student.cookie } });
  assert.equal(addFavorite.status, 200);
  const favorites = await fetch(`${baseUrl}/favorites`, { headers: { Cookie: student.cookie } });
  assert.equal((await favorites.json()).data[0].title, course.title);
  const removeFavorite = await fetch(`${baseUrl}/favorites/${course.id}`, { method: 'DELETE', headers: { Cookie: student.cookie } });
  assert.equal(removeFavorite.status, 200);

  const reviewResponse = await fetch(`${baseUrl}/courses/${course.id}/reviews/mine`, { method: 'PUT', headers, body: JSON.stringify({ rating: 4, comment: 'The course was clear and useful.' }) });
  assert.equal(reviewResponse.status, 200);
  const publicReviews = await fetch(`${baseUrl}/courses/${course.id}/reviews`);
  const reviewData = (await publicReviews.json()).data;
  assert.equal(reviewData.rating, 4);
  assert.equal(reviewData.ratingCount, 1);

  const moderator = await User.create({ name: 'Review Moderator', email: 'moderator-workflow@example.test', passwordHash: await bcrypt.hash('moderator-password-2026', 10), role: 'moderator', status: 'active' });
  const moderatorLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: moderator.email, password: 'moderator-password-2026' }) });
  assert.equal(moderatorLogin.status, 200);
  const moderatorCookie = moderatorLogin.headers.get('set-cookie').split(';')[0];
  const studentQueueAccess = await fetch(`${baseUrl}/courses/moderation/reviews`, { headers: { Cookie: student.cookie } });
  assert.equal(studentQueueAccess.status, 403);
  const reviewQueue = await fetch(`${baseUrl}/courses/moderation/reviews`, { headers: { Cookie: moderatorCookie } });
  const queuedReview = (await reviewQueue.json()).data.find(item => item.courseTitle === course.title);
  assert.ok(queuedReview);
  const hideReview = await fetch(`${baseUrl}/courses/moderation/reviews/${queuedReview.id}`, { method: 'PATCH', headers: { Cookie: moderatorCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'hidden' }) });
  assert.equal(hideReview.status, 200);
  const hiddenPublicReviews = (await (await fetch(`${baseUrl}/courses/${course.id}/reviews`)).json()).data;
  assert.equal(hiddenPublicReviews.ratingCount, 0);
  assert.equal(hiddenPublicReviews.reviews.length, 0);
  const hiddenQueue = await fetch(`${baseUrl}/courses/moderation/reviews`, { headers: { Cookie: moderatorCookie } });
  assert.equal((await hiddenQueue.json()).data.find(item => item.id === queuedReview.id)?.status, 'hidden');
  const restoreReview = await fetch(`${baseUrl}/courses/moderation/reviews/${queuedReview.id}`, { method: 'PATCH', headers: { Cookie: moderatorCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' }) });
  assert.equal(restoreReview.status, 200);
  const restoredPublicReviews = (await (await fetch(`${baseUrl}/courses/${course.id}/reviews`)).json()).data;
  assert.equal(restoredPublicReviews.ratingCount, 1);
  assert.equal(restoredPublicReviews.rating, 4);

  const savePreferences = await fetch(`${baseUrl}/auth/me/preferences`, { method: 'PATCH', headers, body: JSON.stringify({ messages: false }) });
  assert.equal(savePreferences.status, 200);
  const preferences = await fetch(`${baseUrl}/auth/me/preferences`, { headers: { Cookie: student.cookie } });
  assert.deepEqual((await preferences.json()).data, { sessions: true, messages: false, courseActivity: true, email: false });
  const { createNotification } = await import('../dist/modules/notifications/service.js');
  const skippedNotification = await createNotification({ userId: student.user.id, type: 'message', title: 'Test', message: 'Should be suppressed.' });
  assert.equal(skippedNotification, null);
});

test('public certificate verification resolves issued codes case-insensitively and rejects unknown ones', async () => {
  const { issueCompletionCertificate } = await import('../dist/modules/certificates/service.js');
  const student = await User.create({ name: 'Certified Student', email: 'certified-student@example.test', passwordHash: await bcrypt.hash('student-password-2026', 10), role: 'student', verified: true, status: 'active' });
  const teacher = await User.create({ name: 'Certifying Teacher', email: 'certifying-teacher@example.test', passwordHash: await bcrypt.hash('teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active' });
  const course = await Course.create({ title: 'Certified Course', slug: 'certified-course', description: 'A course used to verify certificates.', category: 'Testing', price: 0, rating: 0, ratingCount: 0, studentsCount: 0, teacherId: teacher._id, status: 'published', chapters: [] });
  const certificate = await issueCompletionCertificate(String(student._id), String(course._id));
  const verified = await fetch(`${baseUrl}/certificates/verify/${certificate.code.toLowerCase()}`);
  assert.equal(verified.status, 200);
  const body = (await verified.json()).data;
  assert.deepEqual([body.code, body.studentName, body.courseTitle, body.instructorName], [certificate.code, 'Certified Student', 'Certified Course', 'Certifying Teacher']);
  assert.equal(body.email, undefined);
  const unknown = await fetch(`${baseUrl}/certificates/verify/NOT-A-REAL-CODE`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'CERTIFICATE_NOT_FOUND');
});

test('paid checkout fails closed without a provider and never grants enrollment', async () => {
  const student = await registerAndLogin('Checkout Student', 'checkout-student@example.test');
  const teacher = await User.create({ name: 'Checkout Teacher', email: 'checkout-teacher@example.test', passwordHash: await bcrypt.hash('checkout-teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active', teacherVerification: { specialty: 'Testing', credentialsSummary: 'Checkout fixture teacher', status: 'approved', submittedAt: new Date() } });
  const course = await Course.create({ title: 'Paid Checkout Fixture', slug: 'paid-checkout-fixture', description: 'Paid course used to verify fail-closed checkout.', category: 'Testing', price: 25, teacherId: teacher._id, status: 'published' });

  const checkout = await fetch(`${baseUrl}/payments/checkout`, {
    method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseIds: [String(course._id)], paymentMethod: 'card' }),
  });
  assert.equal(checkout.status, 503);
  assert.deepEqual(await checkout.json(), { success: false, error: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' } });
  assert.equal(await Enrollment.countDocuments({ studentId: student.user.id, courseId: course._id }), 0);

  const directEnrollment = await fetch(`${baseUrl}/enrollments`, {
    method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId: String(course._id) }),
  });
  assert.equal(directEnrollment.status, 402);
  assert.deepEqual(await directEnrollment.json(), { success: false, error: { code: 'PAYMENT_REQUIRED' } });
  assert.equal(await Enrollment.countDocuments({ studentId: student.user.id, courseId: course._id }), 0);
});

test('persisted notifications emit SSE events only to their owner', async t => {
  const owner = await registerAndLogin('Notification Owner', 'notification-owner@example.test');
  const outsider = await registerAndLogin('Notification Outsider', 'notification-outsider@example.test');
  const ownerResponse = await fetch(`${baseUrl}/notifications/events`, { headers: { Cookie: owner.cookie } });
  const outsiderResponse = await fetch(`${baseUrl}/notifications/events`, { headers: { Cookie: outsider.cookie } });
  assert.equal(ownerResponse.status, 200);
  assert.equal(outsiderResponse.status, 200);
  const ownerReader = ownerResponse.body.getReader();
  const outsiderReader = outsiderResponse.body.getReader();
  t.after(() => ownerReader.cancel());
  t.after(() => outsiderReader.cancel());
  await ownerReader.read();
  await outsiderReader.read();

  const { createNotification } = await import('../dist/modules/notifications/service.js');
  const created = await createNotification({ userId: owner.user.id, type: 'certificate', title: 'Certificate ready', message: 'Your certificate is available.' });
  const ownerFrame = await readSseUntil(ownerReader, /event: notification\.created/);
  assert.match(ownerFrame, /event: notification\.created/);
  assert.match(ownerFrame, new RegExp(`"id":"${created.id}"`));
  const storedNotifications = await fetch(`${baseUrl}/notifications`, { headers: { Cookie: owner.cookie } });
  assert.equal((await storedNotifications.json()).data[0].id, String(created._id));

  let outsiderTimer;
  const outsiderEvent = await Promise.race([
    outsiderReader.read(),
    new Promise(resolve => { outsiderTimer = setTimeout(() => resolve(null), 100); }),
  ]);
  clearTimeout(outsiderTimer);
  assert.equal(outsiderEvent, null, 'unrelated users must not receive another account notification events');
  closeUserEventStreams();
  await readSseUntil(ownerReader, /event: server\.shutdown/);
  assert.equal((await ownerReader.read()).done, true);
});

test('completed tutoring session reviews enforce ownership and persist for the student', async () => {
  const student = await registerAndLogin('Session Student', 'session-student@example.test');
  const otherStudent = await registerAndLogin('Other Student', 'session-other@example.test');
  const teacher = await User.create({ name: 'Session Teacher', email: 'session-teacher@example.test', passwordHash: await bcrypt.hash('teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active' });
  const session = await TutoringSession.create({ teacherId: teacher._id, studentId: student.user.id, startAt: new Date(Date.now() - 60 * 60 * 1000), endAt: new Date(Date.now() - 30 * 60 * 1000), type: 'online', price: 0, status: 'completed', subject: 'Review test' });

  const denied = await fetch(`${baseUrl}/sessions/${session.id}/review`, { method: 'PUT', headers: { Cookie: otherStudent.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5, comment: 'I did not attend this completed session.' }) });
  assert.equal(denied.status, 403);
  const saved = await fetch(`${baseUrl}/sessions/${session.id}/review`, { method: 'PUT', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5, comment: 'The session was helpful and clear.' }) });
  assert.equal(saved.status, 200);
  const sessions = await fetch(`${baseUrl}/sessions`, { headers: { Cookie: student.cookie } });
  const reviewedSession = (await sessions.json()).data.find(item => String(item._id) === String(session._id));
  assert.equal(reviewedSession.review.rating, 5);
});

test('confirmed online sessions expose an unpredictable Jitsi link only to their participants', async () => {
  const teacher = await User.create({ name: 'Meeting Teacher', email: 'meeting-teacher@example.test', passwordHash: await bcrypt.hash('meeting-teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active', teacherVerification: { specialty: 'Teaching', credentialsSummary: 'Verified', status: 'approved', submittedAt: new Date() } });
  const teacherLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: teacher.email, password: 'meeting-teacher-password-2026' }) });
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
  const scheduleStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const availabilityRequests = [0, 15].map(offset => fetch(`${baseUrl}/sessions/availability`, {
    method: 'POST', headers: { Cookie: teacherCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startAt: new Date(scheduleStart.getTime() + offset * 60_000).toISOString(), endAt: new Date(scheduleStart.getTime() + (60 + offset) * 60_000).toISOString(), type: 'online', price: 20 }),
  }));
  const availabilityResults = await Promise.all(availabilityRequests);
  assert.deepEqual(availabilityResults.map(response => response.status).sort(), [201, 409]);
  const availabilityErrors = await Promise.all(availabilityResults.map(async response => response.status === 409 ? response.json() : null));
  assert.equal(availabilityErrors.find(Boolean).error.code, 'SESSION_TIME_CONFLICT');
  const student = await registerAndLogin('Meeting Student', 'meeting-student@example.test');
  const otherStudent = await registerAndLogin('Meeting Outsider', 'meeting-outsider@example.test');
  const paidSlot = await TutoringSession.create({ teacherId: teacher._id, startAt: new Date(Date.now() + 3 * 60 * 60 * 1000), endAt: new Date(Date.now() + 200 * 60 * 1000), type: 'online', price: 20, status: 'available' });
  const unpaidBooking = await fetch(`${baseUrl}/sessions/${paidSlot.id}/book`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'Free ride' }) });
  assert.equal(unpaidBooking.status, 402);
  assert.equal((await unpaidBooking.json()).error.code, 'PAYMENT_REQUIRED');
  assert.equal((await TutoringSession.findById(paidSlot._id).lean()).status, 'available');
  const slot = await TutoringSession.create({ teacherId: teacher._id, startAt: new Date(Date.now() + 60 * 60 * 1000), endAt: new Date(Date.now() + 90 * 60 * 1000), type: 'online', price: 0, status: 'available' });
  const booking = await fetch(`${baseUrl}/sessions/${slot.id}/book`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'Code review' }) });
  assert.equal(booking.status, 201);
  const confirmed = await fetch(`${baseUrl}/sessions/${slot.id}/status`, { method: 'PATCH', headers: { Cookie: teacherCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) });
  assert.equal(confirmed.status, 200);
  const confirmedData = (await confirmed.json()).data;
  assert.match(confirmedData.meetingUrl, /^https:\/\/meet\.example\.test\//);
  assert.notEqual(confirmedData.jitsiRoomId, String(slot._id));
  const studentSessions = await fetch(`${baseUrl}/sessions`, { headers: { Cookie: student.cookie } });
  const studentSession = (await studentSessions.json()).data.find(item => String(item._id) === String(slot._id));
  assert.equal(studentSession.meetingUrl, confirmedData.meetingUrl);
  const outsiderSessions = await fetch(`${baseUrl}/sessions`, { headers: { Cookie: otherStudent.cookie } });
  assert.equal((await outsiderSessions.json()).data.some(item => String(item._id) === String(slot._id)), false);
  const teacherSessions = await fetch(`${baseUrl}/sessions`, { headers: { Cookie: teacherCookie } });
  assert.equal((await teacherSessions.json()).data.find(item => String(item._id) === String(slot._id)).meetingUrl, confirmedData.meetingUrl);

  const noProviderSlot = await TutoringSession.create({ teacherId: teacher._id, startAt: new Date(Date.now() + 2 * 60 * 60 * 1000), endAt: new Date(Date.now() + 150 * 60 * 1000), type: 'online', price: 0, status: 'available' });
  const noProviderBooking = await fetch(`${baseUrl}/sessions/${noProviderSlot.id}/book`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'No provider test' }) });
  assert.equal(noProviderBooking.status, 201);
  const { env } = await import('../dist/config/env.js');
  const configuredJitsiBase = env.JITSI_BASE_URL;
  try {
    env.JITSI_BASE_URL = undefined;
    const noProviderConfirmation = await fetch(`${baseUrl}/sessions/${noProviderSlot.id}/status`, { method: 'PATCH', headers: { Cookie: teacherCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) });
    assert.equal(noProviderConfirmation.status, 200);
    const noProviderData = (await noProviderConfirmation.json()).data;
    assert.equal(noProviderData.jitsiRoomId, '');
    assert.equal(noProviderData.meetingUrl, undefined);
  } finally { env.JITSI_BASE_URL = configuredJitsiBase; }
});

test('password changes revoke old JWTs and keep the current session active', async () => {
  const account = await registerAndLogin('Password Student', 'password-student@example.test');
  const changed = await fetch(`${baseUrl}/auth/me/password`, { method: 'POST', headers: { Cookie: account.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'correct-horse-battery-2026', newPassword: 'new-correct-horse-battery-2026' }) });
  assert.equal(changed.status, 200);
  const newCookie = changed.headers.get('set-cookie').split(';')[0];
  const oldToken = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: account.cookie } });
  assert.equal(oldToken.status, 401);
  const currentToken = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: newCookie } });
  assert.equal(currentToken.status, 200);
  const oldPasswordLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'password-student@example.test', password: 'correct-horse-battery-2026' }) });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'password-student@example.test', password: 'new-correct-horse-battery-2026' }) });
  assert.equal(newPasswordLogin.status, 200);
});

test('teacher verification approval updates live permissions and persists an admin audit event', async () => {
  const applicant = await registerAndLogin('Verification Applicant', 'verification-applicant@example.test');
  const submission = await fetch(`${baseUrl}/teacher-verifications`, {
    method: 'POST', headers: { Cookie: applicant.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialty: 'Computer Science', registrationNumber: 'EDU-2026-17', credentialsSummary: 'A sufficiently detailed summary of teaching experience and professional qualifications.' }),
  });
  assert.equal(submission.status, 201);
  const pending = (await submission.json()).data;
  assert.equal(pending.status, 'pending');

  const uploadBody = new FormData();
  uploadBody.append('file', new Blob([Buffer.from('%PDF-1.7\nprivate teacher evidence')], { type: 'application/pdf' }), 'credentials.pdf');
  const uploaded = await fetch(`${baseUrl}/teacher-verifications/documents`, { method: 'POST', headers: { Cookie: applicant.cookie }, body: uploadBody });
  assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.clone().json()));
  const evidence = (await uploaded.json()).data;
  assert.equal(evidence.type, 'application/pdf');
  assert.match(evidence.url, /[a-f\d]{24}$/i, `invalid evidence URL: ${evidence.url}`);
  const evidenceId = evidence.url.split('/').at(-1);
  const savedApplication = await User.findById(applicant.user.id).select('teacherVerification').lean();
  assert.equal(savedApplication.teacherVerification.documents.length, 1);
  assert.notEqual(savedApplication.teacherVerification.documents[0].storageKey, 'credentials.pdf');
  const ownDownload = await fetch(`${baseUrl}${evidence.url}`, { headers: { Cookie: applicant.cookie } });
  assert.equal(ownDownload.status, 200, await ownDownload.clone().text());
  assert.match(ownDownload.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await ownDownload.arrayBuffer()).toString(), '%PDF-1.7\nprivate teacher evidence');
  const otherApplicant = await registerAndLogin('Other Student', 'document-owner-check@example.test');
  const forbiddenDownload = await fetch(`${baseUrl}${evidence.url}`, { headers: { Cookie: otherApplicant.cookie } });
  assert.equal(forbiddenDownload.status, 404);

  const spoofedBody = new FormData();
  spoofedBody.append('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'spoof.pdf');
  const spoofedUpload = await fetch(`${baseUrl}/teacher-verifications/documents`, { method: 'POST', headers: { Cookie: applicant.cookie }, body: spoofedBody });
  assert.equal(spoofedUpload.status, 415);

  const admin = await User.create({ name: 'Verification Admin', email: 'verification-admin@example.test', passwordHash: await bcrypt.hash('admin-password-2026', 10), role: 'admin', status: 'active' });
  const adminLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'admin-password-2026' }) });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const queue = await fetch(`${baseUrl}/teacher-verifications/admin`, { headers: { Cookie: adminCookie } });
  const queuedApplication = (await queue.json()).data.find(item => item.id === applicant.user.id && item.status === 'pending');
  assert.equal(queuedApplication.documents.length, 1);
  const adminDownload = await fetch(`${baseUrl}${queuedApplication.documents[0].url}`, { headers: { Cookie: adminCookie } });
  assert.equal(adminDownload.status, 200);

  const decision = await fetch(`${baseUrl}/teacher-verifications/admin/${applicant.user.id}`, {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', reviewNote: 'Credentials verified.' }),
  });
  assert.equal(decision.status, 200);
  assert.deepEqual((await decision.json()).teacher, { id: applicant.user.id, role: 'teacher', verified: true });

  const course = await fetch(`${baseUrl}/courses`, {
    method: 'POST', headers: { Cookie: applicant.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Verified Teacher Course', description: 'A draft created after approval.', category: 'Testing' }),
  });
  assert.equal(course.status, 201);
  assert.equal((await course.json()).data.status, 'draft');

  const audit = await fetch(`${baseUrl}/admin/users/audit`, { headers: { Cookie: adminCookie } });
  const approvalEvent = (await audit.json()).data.find(event => event.action === 'teacher.verification.approved' && event.target.endsWith(applicant.user.id));
  assert.ok(approvalEvent);
});

test('email verification and password recovery use expiring one-time tokens and revoke sessions', async () => {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Recovery Student', email: 'recovery-student@example.test', password: 'old-correct-horse-2026' }),
  });
  assert.equal(registration.status, 201);
  const registrationData = (await registration.json()).data;
  assert.equal(registrationData.emailVerified, false);
  assert.ok(registrationData.previewUrl);
  const unverifiedLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test', password: 'old-correct-horse-2026' }),
  });
  assert.equal(unverifiedLogin.status, 403);
  assert.equal((await unverifiedLogin.json()).error.code, 'EMAIL_NOT_VERIFIED');

  const verificationToken = new URLSearchParams(new URL(registrationData.previewUrl).hash.slice(1)).get('token');
  const storedVerification = await User.findById(registrationData.id).select('+emailVerificationTokenHash +emailVerificationExpiresAt').lean();
  assert.notEqual(storedVerification.emailVerificationTokenHash, verificationToken);
  assert.ok(storedVerification.emailVerificationExpiresAt > new Date());
  const verified = await fetch(`${baseUrl}/auth/email/verification/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }),
  });
  assert.equal(verified.status, 200);
  const reusedVerification = await fetch(`${baseUrl}/auth/email/verification/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }),
  });
  assert.equal(reusedVerification.status, 400);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test', password: 'old-correct-horse-2026' }),
  });
  assert.equal(login.status, 200);
  const oldCookie = login.headers.get('set-cookie').split(';')[0];
  const requestReset = await fetch(`${baseUrl}/auth/password/forgot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test' }),
  });
  const resetData = (await requestReset.json()).data;
  assert.equal(resetData.accepted, true);
  const unknownReset = await fetch(`${baseUrl}/auth/password/forgot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'unknown-recovery@example.test' }),
  });
  assert.deepEqual((await unknownReset.json()).data, { accepted: true });
  const resetToken = new URLSearchParams(new URL(resetData.previewUrl).hash.slice(1)).get('token');
  const storedReset = await User.findOne({ email: 'recovery-student@example.test' }).select('+passwordResetTokenHash +passwordResetExpiresAt').lean();
  assert.notEqual(storedReset.passwordResetTokenHash, resetToken);
  assert.ok(storedReset.passwordResetExpiresAt > new Date());
  await User.updateOne({ _id: storedReset._id }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });
  const expiredReset = await fetch(`${baseUrl}/auth/password/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: resetToken, newPassword: 'new-correct-horse-2026' }),
  });
  assert.equal(expiredReset.status, 400);
  const freshReset = await fetch(`${baseUrl}/auth/password/forgot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test' }),
  });
  const freshResetToken = new URLSearchParams(new URL((await freshReset.json()).data.previewUrl).hash.slice(1)).get('token');
  const reset = await fetch(`${baseUrl}/auth/password/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: freshResetToken, newPassword: 'new-correct-horse-2026' }),
  });
  assert.equal(reset.status, 200);
  const revokedSession = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: oldCookie } });
  assert.equal(revokedSession.status, 401);
  const oldPassword = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test', password: 'old-correct-horse-2026' }),
  });
  assert.equal(oldPassword.status, 401);
  const newPassword = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recovery-student@example.test', password: 'new-correct-horse-2026' }),
  });
  assert.equal(newPassword.status, 200);
  const reusedReset = await fetch(`${baseUrl}/auth/password/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: freshResetToken, newPassword: 'another-correct-horse-2026' }),
  });
  assert.equal(reusedReset.status, 400);
});

test('assignment file submissions are validated, private to the student and course teacher, and removed from graded edits', async () => {
  const student = await registerAndLogin('Assignment Student', 'assignment-student@example.test');
  const teacher = await User.create({ name: 'Assignment Teacher', email: 'assignment-teacher@example.test', passwordHash: await bcrypt.hash('assignment-teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active' });
  const course = await Course.create({ title: 'Assignment Upload Course', slug: 'assignment-upload-course', description: 'A published course for testing private assignment submissions.', category: 'Testing', price: 0, teacherId: teacher._id, status: 'published' });
  await Enrollment.create({ studentId: student.user.id, courseId: course._id });
  const assignment = await Assignment.create({ courseId: course._id, teacherId: teacher._id, title: 'Upload a solution', instructions: 'Submit a PDF solution or written response.', dueAt: new Date(Date.now() + 60 * 60 * 1000), points: 20, status: 'published' });
  const teacherLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: teacher.email, password: 'assignment-teacher-password-2026' }) });
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];

  const submissionBody = new FormData();
  submissionBody.append('answerText', '');
  submissionBody.append('files', new Blob([Buffer.from('%PDF-1.7\nassignment evidence')], { type: 'application/pdf' }), 'solution.pdf');
  const submitted = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions`, { method: 'POST', headers: { Cookie: student.cookie }, body: submissionBody });
  assert.equal(submitted.status, 201);
  const submissionData = (await submitted.json()).data;
  assert.equal(submissionData.files.length, 1);
  const studentAssignments = await fetch(`${baseUrl}/assignments`, { headers: { Cookie: student.cookie } });
  const studentSubmission = (await studentAssignments.json()).data[0].submission;
  assert.equal(studentSubmission.files.length, 1);
  const fileUrl = studentSubmission.files[0].url;
  const studentDownload = await fetch(`${baseUrl}${fileUrl}`, { headers: { Cookie: student.cookie } });
  assert.equal(studentDownload.status, 200);
  assert.equal(Buffer.from(await studentDownload.arrayBuffer()).toString(), '%PDF-1.7\nassignment evidence');

  const teacherAssignments = await fetch(`${baseUrl}/assignments/teacher`, { headers: { Cookie: teacherCookie } });
  const teacherSubmission = (await teacherAssignments.json()).data[0].submissions[0];
  assert.equal(teacherSubmission.files.length, 1);
  const teacherDownload = await fetch(`${baseUrl}${fileUrl}`, { headers: { Cookie: teacherCookie } });
  assert.equal(teacherDownload.status, 200);
  await teacherDownload.arrayBuffer();
  const otherStudent = await registerAndLogin('Unrelated Student', 'assignment-outsider@example.test');
  const deniedDownload = await fetch(`${baseUrl}${fileUrl}`, { headers: { Cookie: otherStudent.cookie } });
  assert.equal(deniedDownload.status, 404);
  const unenrolledSubmission = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions`, { method: 'POST', headers: { Cookie: otherStudent.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ answerText: 'I am not enrolled.' }) });
  assert.equal(unenrolledSubmission.status, 403);

  const spoofedBody = new FormData();
  spoofedBody.append('files', new Blob(['not a PDF'], { type: 'application/pdf' }), 'fake.pdf');
  const spoofedUpload = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions`, { method: 'POST', headers: { Cookie: student.cookie }, body: spoofedBody });
  assert.equal(spoofedUpload.status, 415);
  assert.equal(await AssignmentSubmission.countDocuments({ assignmentId: assignment._id, studentId: student.user.id }), 1);

  const replacementBody = new FormData();
  replacementBody.append('answerText', 'Revised work');
  replacementBody.append('files', new Blob([Buffer.from('%PDF-1.7\nreplacement evidence')], { type: 'application/pdf' }), 'revised.pdf');
  const replaced = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions`, { method: 'POST', headers: { Cookie: student.cookie }, body: replacementBody });
  assert.equal(replaced.status, 200);
  const oldFileAfterReplace = await fetch(`${baseUrl}${fileUrl}`, { headers: { Cookie: student.cookie } });
  assert.equal(oldFileAfterReplace.status, 404);

  const grade = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions/${submissionData.id}/grade`, { method: 'PATCH', headers: { Cookie: teacherCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ score: 18, feedback: 'Good work.' }) });
  assert.equal(grade.status, 200);
  const reSubmit = await fetch(`${baseUrl}/assignments/${assignment.id}/submissions`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ answerText: 'Updated answer' }) });
  assert.equal(reSubmit.status, 409);
  assert.equal((await reSubmit.json()).error.code, 'SUBMISSION_ALREADY_GRADED');
});

test('admin platform settings persist, audit changes and enforce maintenance mode', async () => {
  const admin = await User.create({ name: 'Settings Admin', email: 'settings-admin@example.test', passwordHash: await bcrypt.hash('settings-admin-password-2026', 10), role: 'admin', status: 'active' });
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'settings-admin-password-2026' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  const defaults = await fetch(`${baseUrl}/admin/settings`, { headers });
  assert.deepEqual((await defaults.json()).data, { commissionRate: 20, maintenanceMode: false, subscription: { enabled: false, monthlyPrice: 29, yearlyPrice: 279 }, offlinePayments: { enabled: true, instructions: '' }, updatedAt: null });
  const changed = await fetch(`${baseUrl}/admin/settings`, { method: 'PATCH', headers, body: JSON.stringify({ commissionRate: 25, maintenanceMode: true }) });
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).data, { commissionRate: 25, maintenanceMode: true, subscription: { enabled: false, monthlyPrice: 29, yearlyPrice: 279 }, offlinePayments: { enabled: true, instructions: '' }, updatedAt: (await PlatformSettings.findById('global')).updatedAt.toISOString() });
  assert.deepEqual((await (await fetch(`${baseUrl}/platform/status`)).json()).data, { maintenanceMode: true });
  const blocked = await fetch(`${baseUrl}/courses`);
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error.code, 'MAINTENANCE_MODE');
  assert.equal((await fetch(`${baseUrl}/admin/settings`, { headers })).status, 200);
  assert.ok(await AuditEvent.findOne({ actorId: admin._id, action: 'platform.settings.updated' }));
  const restored = await fetch(`${baseUrl}/admin/settings`, { method: 'PATCH', headers, body: JSON.stringify({ commissionRate: 25, maintenanceMode: false }) });
  assert.equal(restored.status, 200);
});

test('course videos and resources stay private and are available to enrolled learners', async () => {
  const teacher = await User.create({ name: 'Media Teacher', email: 'media-teacher@example.test', passwordHash: await bcrypt.hash('media-teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active', teacherVerification: { specialty: 'Teaching', credentialsSummary: 'Verified', status: 'approved', submittedAt: new Date() } });
  const teacherLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: teacher.email, password: 'media-teacher-password-2026' }) });
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
  const student = await registerAndLogin('Media Student', 'media-student@example.test');
  const otherStudent = await registerAndLogin('Other Media Student', 'media-other@example.test');
  const course = await Course.create({ title: 'Private Media Course', slug: 'private-media-course', description: 'Private assets test.', category: 'Testing', price: 0, teacherId: teacher._id, status: 'published', chapters: [{ id: 'chapter-media', title: 'Media', order: 0, lessons: [{ id: 'lesson-media', title: 'Video lesson', chapterId: 'chapter-media', durationMinutes: 5, type: 'video', resources: [] }] }] });
  const enroll = await fetch(`${baseUrl}/enrollments`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: String(course._id) }) });
  assert.equal(enroll.status, 201);
  const videoBody = new FormData();
  videoBody.append('file', new Blob([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)])], { type: 'video/mp4' }), 'lesson.mp4');
  const videoUpload = await fetch(`${baseUrl}/courses/${course.id}/lessons/lesson-media/assets/video`, { method: 'POST', headers: { Cookie: teacherCookie }, body: videoBody });
  assert.equal(videoUpload.status, 201);
  const videoAsset = (await videoUpload.json()).data;
  const resourceBody = new FormData();
  resourceBody.append('file', new Blob([Buffer.from('%PDF-1.7\nlesson notes')], { type: 'application/pdf' }), 'notes.pdf');
  const resourceUpload = await fetch(`${baseUrl}/courses/${course.id}/lessons/lesson-media/assets/resources`, { method: 'POST', headers: { Cookie: teacherCookie }, body: resourceBody });
  assert.equal(resourceUpload.status, 201);
  const resourceAsset = (await resourceUpload.json()).data;
  const publicCourse = await fetch(`${baseUrl}/courses/${course.id}`);
  assert.equal(publicCourse.status, 200);
  const publicLesson = (await publicCourse.json()).data.chapters[0].lessons[0];
  assert.equal(publicLesson.videoUrl, undefined);
  assert.equal(publicLesson.resources, undefined);
  const enrolledCourse = await fetch(`${baseUrl}/courses/${course.id}`, { headers: { Cookie: student.cookie } });
  assert.equal(enrolledCourse.status, 200);
  const enrolledLesson = (await enrolledCourse.json()).data.chapters[0].lessons[0];
  assert.equal(enrolledLesson.videoUrl, videoAsset.url);
  assert.equal(enrolledLesson.resources[0].url, resourceAsset.url);
  assert.equal((await fetch(`${baseUrl}${videoAsset.url}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}${videoAsset.url}`, { headers: { Cookie: otherStudent.cookie } })).status, 404);
  const videoDownload = await fetch(`${baseUrl}${videoAsset.url}`, { headers: { Cookie: student.cookie, Range: 'bytes=0-7' } });
  assert.equal(videoDownload.status, 206);
  assert.equal((await videoDownload.arrayBuffer()).byteLength, 8);
  const resourceDownload = await fetch(`${baseUrl}${resourceAsset.url}`, { headers: { Cookie: student.cookie } });
  assert.equal(resourceDownload.status, 200);
  assert.match(resourceDownload.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await resourceDownload.arrayBuffer()).toString(), '%PDF-1.7\nlesson notes');
});

test('messaging attachments and voice notes are signature-checked and available only to conversation participants', async t => {
  const student = await registerAndLogin('Attachment Student', 'attachment-student@example.test');
  const outsider = await registerAndLogin('Attachment Outsider', 'attachment-outsider@example.test');
  const teacher = await User.create({ name: 'Attachment Teacher', email: 'attachment-teacher@example.test', passwordHash: await bcrypt.hash('attachment-teacher-password-2026', 10), role: 'teacher', verified: true, status: 'active', teacherVerification: { specialty: 'Teaching', credentialsSummary: 'Verified', status: 'approved', submittedAt: new Date() } });
  const teacherLogin = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: teacher.email, password: 'attachment-teacher-password-2026' }) });
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
  const participantIds = [student.user.id, String(teacher._id)].sort();
  const conversation = await Conversation.create({ participants: participantIds, participantKey: participantIds.join(':') });

  const body = new FormData();
  body.append('text', 'Please review these notes.');
  body.append('file', new Blob([Buffer.from('%PDF-1.7\nprivate message attachment')], { type: 'application/pdf' }), 'notes.pdf');
  const sent = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/messages`, { method: 'POST', headers: { Cookie: student.cookie }, body });
  assert.equal(sent.status, 201);
  const sentMessage = (await sent.json()).data;
  assert.equal(sentMessage.text, 'Please review these notes.');
  assert.deepEqual(Object.keys(sentMessage.attachment).sort(), ['name', 'size', 'url']);

  const teacherMessages = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/messages`, { headers: { Cookie: teacherCookie } });
  assert.equal(teacherMessages.status, 200);
  assert.equal((await teacherMessages.json()).data[0].attachment.url, sentMessage.attachment.url);
  const studentDownload = await fetch(`${baseUrl}${sentMessage.attachment.url}`, { headers: { Cookie: student.cookie } });
  assert.equal(studentDownload.status, 200);
  assert.match(studentDownload.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await studentDownload.arrayBuffer()).toString(), '%PDF-1.7\nprivate message attachment');
  const teacherDownload = await fetch(`${baseUrl}${sentMessage.attachment.url}`, { headers: { Cookie: teacherCookie } });
  assert.equal(teacherDownload.status, 200);
  await teacherDownload.arrayBuffer();
  assert.equal((await fetch(`${baseUrl}${sentMessage.attachment.url}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}${sentMessage.attachment.url}`, { headers: { Cookie: outsider.cookie } })).status, 404);

  const deniedBody = new FormData();
  deniedBody.append('file', new Blob([Buffer.from('%PDF-1.7\nshould not be uploaded')], { type: 'application/pdf' }), 'denied.pdf');
  const deniedUpload = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/messages`, { method: 'POST', headers: { Cookie: outsider.cookie }, body: deniedBody });
  assert.equal(deniedUpload.status, 404);
  const spoofedBody = new FormData();
  spoofedBody.append('file', new Blob(['not a PDF'], { type: 'application/pdf' }), 'fake.pdf');
  const spoofedUpload = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/messages`, { method: 'POST', headers: { Cookie: student.cookie }, body: spoofedBody });
  assert.equal(spoofedUpload.status, 415);
  const eventStream = await fetch(`${baseUrl}/messaging/events`, { headers: { Cookie: teacherCookie } });
  assert.equal(eventStream.status, 200);
  assert.match(eventStream.headers.get('content-type'), /text\/event-stream/);
  const eventReader = eventStream.body.getReader();
  t.after(() => eventReader.cancel());
  await eventReader.read();
  const outsiderEventStream = await fetch(`${baseUrl}/messaging/events`, { headers: { Cookie: outsider.cookie } });
  assert.equal(outsiderEventStream.status, 200);
  const outsiderEventReader = outsiderEventStream.body.getReader();
  t.after(() => outsiderEventReader.cancel());
  await outsiderEventReader.read();
  const textOnly = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/messages`, { method: 'POST', headers: { Cookie: student.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Text messages still work.' }) });
  assert.equal(textOnly.status, 201);
  const textMessage = (await textOnly.json()).data;
  const eventText = await readSseUntil(eventReader, /event: message\.created/);
  assert.match(eventText, /event: message\.created/);
  assert.match(eventText, new RegExp(`"id":"${textMessage.id}"`));
  assert.match(eventText, new RegExp(`"conversationId":"${conversation.id}"`));
  let outsiderTimer;
  const outsiderEvent = await Promise.race([
    outsiderEventReader.read(),
    new Promise(resolve => { outsiderTimer = setTimeout(() => resolve(null), 100); }),
  ]);
  clearTimeout(outsiderTimer);
  assert.equal(outsiderEvent, null, 'unrelated authenticated accounts must not receive conversation events');
  closeUserEventStreams();
  await readSseUntil(eventReader, /event: server\.shutdown/);
  assert.equal((await eventReader.read()).done, true);
  const voiceBytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('webm voice fixture')]);
  const voiceBody = new FormData();
  voiceBody.append('durationSeconds', '3');
  voiceBody.append('voice', new Blob([voiceBytes], { type: 'audio/webm' }), 'voice-note.webm');
  const voiceSent = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/voice-notes`, { method: 'POST', headers: { Cookie: student.cookie }, body: voiceBody });
  assert.equal(voiceSent.status, 201);
  const voiceMessage = (await voiceSent.json()).data;
  assert.equal(voiceMessage.voiceDurationSeconds, 3);
  assert.match(voiceMessage.voiceUrl, /^\/messaging\/voice-notes\/[a-f\d]{24}$/i);
  assert.equal(voiceMessage.attachment, undefined);
  const voicePlayback = await fetch(`${baseUrl}${voiceMessage.voiceUrl}`, { headers: { Cookie: teacherCookie } });
  assert.equal(voicePlayback.status, 200);
  assert.match(voicePlayback.headers.get('content-type'), /audio\/webm/);
  assert.deepEqual(Buffer.from(await voicePlayback.arrayBuffer()), voiceBytes);
  assert.equal((await fetch(`${baseUrl}${voiceMessage.voiceUrl}`, { headers: { Cookie: outsider.cookie } })).status, 404);
  const spoofedVoiceBody = new FormData();
  spoofedVoiceBody.append('durationSeconds', '2');
  spoofedVoiceBody.append('voice', new Blob(['not audio'], { type: 'audio/webm' }), 'fake.webm');
  const spoofedVoice = await fetch(`${baseUrl}/messaging/conversations/${conversation.id}/voice-notes`, { method: 'POST', headers: { Cookie: student.cookie }, body: spoofedVoiceBody });
  assert.equal(spoofedVoice.status, 415);
  assert.equal(await Message.countDocuments({ conversationId: conversation._id }), 3);
});
});
