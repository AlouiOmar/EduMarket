import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/edumarket_test';
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server;
let baseUrl;

before(async () => {
  const { app } = await import('../dist/app.js');
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('health endpoint returns stable success envelope', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { status: 'ok' } });
});

test('checkout requires authentication', async () => {
  const response = await fetch(`${baseUrl}/payments/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseIds: ['0123456789abcdef01234567'], paymentMethod: 'card' }) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('unknown API route returns stable not found error', async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'NOT_FOUND' } });
});

test('invalid registration input is rejected before database access', async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'VALIDATION_ERROR' } });
});

test('email verification and password recovery validate inputs before database access', async () => {
  const invalidEmail = await fetch(`${baseUrl}/auth/password/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid' }) });
  assert.equal(invalidEmail.status, 400);
  const missingVerificationToken = await fetch(`${baseUrl}/auth/email/verification/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: '' }) });
  assert.equal(missingVerificationToken.status, 400);
  const missingResetToken = await fetch(`${baseUrl}/auth/password/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: '', newPassword: 'a-valid-password-123' }) });
  assert.equal(missingResetToken.status, 400);
});

test('profile endpoint requires authentication', async () => {
  const response = await fetch(`${baseUrl}/auth/me`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('password change requires an authenticated session', async () => {
  const response = await fetch(`${baseUrl}/auth/me/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'current-password', newPassword: 'new-password-123' }) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('notification preference reads and writes require authentication', async () => {
  const read = await fetch(`${baseUrl}/auth/me/preferences`);
  assert.equal(read.status, 401);
  const write = await fetch(`${baseUrl}/auth/me/preferences`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessions: false }) });
  assert.equal(write.status, 401);
});

test('private course collection requires authentication', async () => {
  const response = await fetch(`${baseUrl}/courses/mine`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
  const asset = await fetch(`${baseUrl}/courses/000000000000000000000000/assets/000000000000000000000000`);
  assert.equal(asset.status, 401);
});

test('enrollment collection requires authentication', async () => {
  const response = await fetch(`${baseUrl}/enrollments`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('learning history requires authentication', async () => {
  const response = await fetch(`${baseUrl}/enrollments/history`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('session list and booking require authentication', async () => {
  const list = await fetch(`${baseUrl}/sessions`);
  assert.equal(list.status, 401);
  assert.deepEqual(await list.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
  const booking = await fetch(`${baseUrl}/sessions/000000000000000000000000/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'Tutoring' }) });
  assert.equal(booking.status, 401);
  const review = await fetch(`${baseUrl}/sessions/000000000000000000000000/review`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5, comment: 'A helpful tutoring session.' }) });
  assert.equal(review.status, 401);
});

test('session availability rejects malformed filters before database access', async () => {
  const response = await fetch(`${baseUrl}/sessions/availability?teacherId=not-an-object-id`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'VALIDATION_ERROR' } });
});

test('private certificate collection requires authentication', async () => {
  const response = await fetch(`${baseUrl}/certificates/mine`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('notification collection and read changes require authentication', async () => {
  const list = await fetch(`${baseUrl}/notifications`);
  assert.equal(list.status, 401);
  const events = await fetch(`${baseUrl}/notifications/events`);
  assert.equal(events.status, 401);
  const mark = await fetch(`${baseUrl}/notifications/000000000000000000000000/read`, { method: 'PATCH' });
  assert.equal(mark.status, 401);
});

test('exam creation, enrollment, and attempt submission require authentication', async () => {
  const create = await fetch(`${baseUrl}/exams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(create.status, 401);
  const enroll = await fetch(`${baseUrl}/exams/000000000000000000000000/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(enroll.status, 401);
  const submit = await fetch(`${baseUrl}/exams/000000000000000000000000/attempts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [] }) });
  assert.equal(submit.status, 401);
});

test('in-person exam management and grading require authentication', async () => {
  const manage = await fetch(`${baseUrl}/exams/manage`);
  assert.equal(manage.status, 401);
  const registrations = await fetch(`${baseUrl}/exams/000000000000000000000000/registrations`);
  assert.equal(registrations.status, 401);
  const grade = await fetch(`${baseUrl}/exams/000000000000000000000000/registrations/000000000000000000000000/result`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: 100 }) });
  assert.equal(grade.status, 401);
});

test('messaging contacts and conversations require authentication', async () => {
  const contacts = await fetch(`${baseUrl}/messaging/contacts?email=teacher%40example.com`);
  assert.equal(contacts.status, 401);
  const create = await fetch(`${baseUrl}/messaging/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teacher@example.com' }) });
  assert.equal(create.status, 401);
  const send = await fetch(`${baseUrl}/messaging/conversations/000000000000000000000000/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) });
  assert.equal(send.status, 401);
  const download = await fetch(`${baseUrl}/messaging/attachments/000000000000000000000000`);
  assert.equal(download.status, 401);
  const voice = await fetch(`${baseUrl}/messaging/voice-notes/000000000000000000000000`);
  assert.equal(voice.status, 401);
  const events = await fetch(`${baseUrl}/messaging/events`);
  assert.equal(events.status, 401);
});

test('forum writes and report moderation require authentication', async () => {
  const create = await fetch(`${baseUrl}/forum/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'A useful question', content: 'This is a sufficiently long question.', category: 'General' }) });
  assert.equal(create.status, 401);
  const reportQueue = await fetch(`${baseUrl}/forum/reports`);
  assert.equal(reportQueue.status, 401);
});

test('forum list validates pagination before querying MongoDB', async () => {
  const response = await fetch(`${baseUrl}/forum/posts?limit=1000`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'VALIDATION_ERROR' } });
});

test('assignment student and teacher endpoints require authentication', async () => {
  const studentList = await fetch(`${baseUrl}/assignments`);
  assert.equal(studentList.status, 401);
  const teacherList = await fetch(`${baseUrl}/assignments/teacher`);
  assert.equal(teacherList.status, 401);
  const create = await fetch(`${baseUrl}/assignments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(create.status, 401);
  const upload = await fetch(`${baseUrl}/assignments/000000000000000000000000/submissions`, { method: 'POST', body: new FormData() });
  assert.equal(upload.status, 401);
  const download = await fetch(`${baseUrl}/assignments/submission-files/000000000000000000000000`);
  assert.equal(download.status, 401);
});

test('creating an enrollment requires authentication', async () => {
  const response = await fetch(`${baseUrl}/enrollments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: '000000000000000000000000' }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('submitting a quiz attempt requires authentication', async () => {
  const response = await fetch(`${baseUrl}/enrollments/000000000000000000000000/lessons/lesson-1/quiz-attempts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ questionId: 'q1', selectedOptionIndex: 0 }] }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('teacher verification submission requires authentication', async () => {
  const response = await fetch(`${baseUrl}/teacher-verifications`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ specialty: 'Software engineering', credentialsSummary: 'More than ten years teaching software engineering.' }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('teacher verification administration requires authentication', async () => {
  const response = await fetch(`${baseUrl}/teacher-verifications/admin`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('teacher evidence upload and private document download require authentication', async () => {
  const upload = await fetch(`${baseUrl}/teacher-verifications/documents`, { method: 'POST', body: new FormData() });
  assert.equal(upload.status, 401);
  assert.equal((await upload.json()).error.code, 'AUTH_REQUIRED');
  const download = await fetch(`${baseUrl}/teacher-verifications/documents/0123456789abcdef01234567`);
  assert.equal(download.status, 401);
});

test('admin user collection requires authentication', async () => {
  const response = await fetch(`${baseUrl}/admin/users`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('admin audit log requires authentication', async () => {
  const response = await fetch(`${baseUrl}/admin/users/audit`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('institution affiliation reads and writes require authentication', async () => {
  const reads = await Promise.all([
    fetch(`${baseUrl}/institutions/teachers`),
    fetch(`${baseUrl}/institutions/invitations`),
    fetch(`${baseUrl}/institutions/invitations/mine`),
  ]);
  assert.deepEqual(reads.map(response => response.status), [401, 401, 401]);
  const invite = await fetch(`${baseUrl}/institutions/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teacher@example.com' }) });
  assert.equal(invite.status, 401);
  const decision = await fetch(`${baseUrl}/institutions/invitations/000000000000000000000000`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'accepted' }) });
  assert.equal(decision.status, 401);
});

test('institution application collection and review require authentication', async () => {
  const mine = await fetch(`${baseUrl}/institution-verifications/mine`);
  assert.equal(mine.status, 401);
  const submit = await fetch(`${baseUrl}/institution-verifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Example Institute', description: 'This is a sufficiently long institutional description for our review.', country: 'France', city: 'Paris', contactEmail: 'contact@example.com' }) });
  assert.equal(submit.status, 401);
  const admin = await fetch(`${baseUrl}/institution-verifications/admin`);
  assert.equal(admin.status, 401);
});

test('admin role changes require authentication', async () => {
  const response = await fetch(`${baseUrl}/admin/users/000000000000000000000000/role`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('CORS preflight allows browser lesson progress PUT requests', async () => {
  const response = await fetch(`${baseUrl}/enrollments/course/lessons/lesson/complete`, {
    method: 'OPTIONS', headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-methods') || '', /PUT/);
});

test('CORS preflight allows browser favorite DELETE requests', async () => {
  const response = await fetch(`${baseUrl}/favorites/0123456789abcdef01234567`, {
    method: 'OPTIONS', headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'DELETE',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-methods') || '', /DELETE/);
});

test('course catalogue rejects unsupported sort filters before database access', async () => {
  const response = await fetch(`${baseUrl}/courses?sort=untrusted`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'INVALID_COURSE_FILTER' } });
});

test('public teacher profile rejects malformed identifiers without database access', async () => {
  const response = await fetch(`${baseUrl}/teachers/not-an-object-id`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'TEACHER_NOT_FOUND' } });
});

test('course review writes require an authenticated student', async () => {
  const response = await fetch(`${baseUrl}/courses/0123456789abcdef01234567/reviews/mine`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5, comment: 'A useful course review.' }) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
});

test('course review moderation routes require an authorized backoffice session', async () => {
  const queue = await fetch(`${baseUrl}/courses/moderation/reviews`);
  assert.equal(queue.status, 401);
  const decision = await fetch(`${baseUrl}/courses/moderation/reviews/000000000000000000000000`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'hidden' }) });
  assert.equal(decision.status, 401);
});

test('favorite list and mutations require an authenticated student', async () => {
  const list = await fetch(`${baseUrl}/favorites`);
  assert.equal(list.status, 401);
  const add = await fetch(`${baseUrl}/favorites/0123456789abcdef01234567`, { method: 'PUT' });
  assert.equal(add.status, 401);
  const remove = await fetch(`${baseUrl}/favorites/0123456789abcdef01234567`, { method: 'DELETE' });
  assert.equal(remove.status, 401);
});

test('logout clears the HttpOnly session cookie', async () => {
  const response = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /edumarket_access=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/i);
});

test('payment configuration is public and reports a disabled provider without exposing secrets', async () => {
  const response = await fetch(`${baseUrl}/payments/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { enabled: false, provider: null, sandbox: false, currency: 'eur', commissionRate: 20, offline: { enabled: true, instructions: '' } } });
});

test('payment webhooks fail closed when no provider is configured', async () => {
  const response = await fetch(`${baseUrl}/payments/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"evt_1"}' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' } });
});

for (const [method, path] of [
  ['GET', '/support/tickets'], ['POST', '/support/tickets'], ['GET', '/admin/support/tickets'],
  ['GET', '/moderation/courses'], ['GET', '/moderation/history'], ['GET', '/admin/payments/summary'],
  ['POST', '/admin/payments/orders/0123456789abcdef01234567/refund'], ['GET', '/admin/audit-logs'], ['GET', '/admin/categories'],
  ['GET', '/analytics/admin/overview'], ['GET', '/analytics/institution'], ['GET', '/payments/earnings'], ['POST', '/payments/payouts'],
  ['POST', '/payments/checkout/sessions/0123456789abcdef01234567'], ['POST', '/courses/0123456789abcdef01234567/submit-review'],
  ['GET', '/subscriptions/me'], ['POST', '/subscriptions/checkout'], ['POST', '/subscriptions/me/cancel'], ['POST', '/reports'],
  ['GET', '/moderation/reports'], ['PATCH', '/moderation/reports/0123456789abcdef01234567'], ['DELETE', '/institutions/affiliation/mine'],
  ['DELETE', '/institutions/teachers/0123456789abcdef01234567'],
]) {
  test(`${method} ${path} requires authentication`, async () => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, error: { code: 'AUTH_REQUIRED' } });
  });
}

test('malformed JSON bodies return a stable validation error', async () => {
  const response = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: 'MALFORMED_JSON' } });
});

test('subscription offer is public and disabled by default without a database', async () => {
  const response = await fetch(`${baseUrl}/subscriptions/offer`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { enabled: false, monthlyPrice: 29, yearlyPrice: 279 } });
});
