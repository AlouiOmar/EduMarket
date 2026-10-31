import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const baseMongoUri = process.env.EDUMARKET_TEST_MONGO_URI;
let mongoUri;
if (baseMongoUri) {
  const parsed = new URL(baseMongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) {
    throw new Error('Integration tests only run against a local database whose name ends in _test.');
  }
  // Separate database so this file can run in parallel with the other workflow suite.
  parsed.pathname = parsed.pathname.replace(/_test$/i, '_marketplace_test');
  mongoUri = parsed.toString();
}

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.PAYMENT_PROVIDER = 'sandbox';
process.env.SANDBOX_WEBHOOK_SECRET = 'sandbox-webhook-secret-for-tests';
process.env.PAYOUT_HOLD_DAYS = '0';
process.env.PAYOUT_MINIMUM_CENTS = '1000';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/v1/calendar/google/callback';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.GOOGLE_DRIVE_REDIRECT_URI = 'http://localhost:4000/api/v1/storage/oauth/google_drive/callback';
process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client';
process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-secret';
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:4000/api/v1/storage/oauth/onedrive/callback';

let server, baseUrl, models, signSandboxPayload, expireAbandonedCheckouts, subscriptionJobs;
const password = 'marketplace-password-2026';

describe('Marketplace, moderation and support workflows', { skip: !mongoUri }, () => {
  before(async () => {
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, sessions, payments, integration, service, subscriptions, subscriptionService] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'),
      import('../dist/modules/enrollments/model.js'), import('../dist/modules/sessions/model.js'), import('../dist/modules/payments/models.js'),
      import('../dist/integrations/payments.js'), import('../dist/modules/payments/service.js'),
      import('../dist/modules/subscriptions/models.js'), import('../dist/modules/subscriptions/service.js'),
    ]);
    models = { User: users.User, Course: courses.Course, Enrollment: enrollments.Enrollment, TutoringSession: sessions.TutoringSession, ...payments, ...subscriptions };
    subscriptionJobs = subscriptionService;
    signSandboxPayload = integration.signSandboxPayload;
    expireAbandonedCheckouts = service.expireAbandonedCheckouts;
    await Promise.all(Object.values(models).filter(model => typeof model?.init === 'function').map(model => model.init()));
    await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  async function createUser(name, email, role, extra = {}) {
    const verifiedTeacher = role === 'teacher' ? { verified: true, teacherVerification: { specialty: 'Testing', credentialsSummary: 'Fixture', status: 'approved', submittedAt: new Date() } } : {};
    const user = await models.User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role, status: 'active', emailVerified: true, ...verifiedTeacher, ...extra });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { id: String(user._id), cookie: login.headers.get('set-cookie').split(';')[0] };
  }

  const api = async (actor, method, path, body, headers = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(actor ? { Cookie: actor.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const payload = response.status === 204 ? null : await response.json();
    return { status: response.status, body: payload };
  };

  const lesson = { id: 'l1', title: 'Intro', chapterId: 'c1', durationMinutes: 5, type: 'text', textContent: 'Hello', resources: [] };
  const publishedCourse = (teacherId, slug, price) => models.Course.create({ title: `Course ${slug}`, slug, description: 'Fixture course description.', category: 'testing', price, teacherId, status: 'published', chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }] });

  let admin, moderator, teacher, student, otherStudent;
  test('fixtures', async () => {
    admin = await createUser('Admin', 'admin@market.test', 'admin');
    moderator = await createUser('Moderator', 'moderator@market.test', 'moderator');
    teacher = await createUser('Teacher', 'teacher@market.test', 'teacher');
    student = await createUser('Student', 'student@market.test', 'student');
    otherStudent = await createUser('Other', 'other@market.test', 'student');
  });

  test('course publication goes through submission, moderation review, suspension and audited history', async () => {
    const created = await api(teacher, 'POST', '/courses', { title: 'Reviewed course', description: 'A course that needs review.', category: 'testing', price: 0, chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }] });
    assert.equal(created.status, 201);
    const courseId = created.body.data._id;
    assert.equal(created.body.data.status, 'draft');
    assert.equal((await api(teacher, 'PATCH', `/courses/${courseId}`, { status: 'published' })).status, 403);
    assert.equal((await api(otherStudent, 'POST', `/courses/${courseId}/submit-review`)).status, 403);
    const submitted = await api(teacher, 'POST', `/courses/${courseId}/submit-review`);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.status, 'pending_review');
    assert.equal((await api(teacher, 'POST', `/courses/${courseId}/submit-review`)).body.error.code, 'COURSE_STATUS_CONFLICT');
    assert.equal((await api(student, 'GET', '/moderation/courses')).status, 403);
    const queue = await api(moderator, 'GET', '/moderation/courses?status=pending_review');
    assert.ok(queue.body.data.some(course => course.id === courseId));
    assert.equal((await api(moderator, 'PATCH', `/moderation/courses/${courseId}/review`, { decision: 'reject' })).body.error.code, 'REVIEW_NOTE_REQUIRED');
    const approved = await api(moderator, 'PATCH', `/moderation/courses/${courseId}/review`, { decision: 'approve' });
    assert.equal(approved.body.data.status, 'published');
    assert.equal((await api(null, 'GET', `/courses/${courseId}`)).status, 200);
    assert.equal((await api(moderator, 'PATCH', `/moderation/courses/${courseId}/suspension`, { suspended: true })).status, 422);
    assert.equal((await api(moderator, 'PATCH', `/moderation/courses/${courseId}/suspension`, { suspended: true, note: 'Copyright complaint' })).body.data.status, 'suspended');
    assert.equal((await api(null, 'GET', `/courses/${courseId}`)).status, 404);
    assert.equal((await api(teacher, 'PATCH', `/courses/${courseId}`, { status: 'draft' })).status, 404, 'owners cannot lift a suspension');
    assert.equal((await api(admin, 'PATCH', `/moderation/courses/${courseId}/suspension`, { suspended: false })).body.data.status, 'published');
    const history = await api(moderator, 'GET', '/moderation/history');
    assert.deepEqual(history.body.data.filter(event => event.targetId === courseId).map(event => event.action).sort(),
      ['moderation.course.approved', 'moderation.course.restored', 'moderation.course.suspended']);
    assert.equal((await api(teacher, 'GET', '/notifications')).body.data.filter(item => item.type === 'course').length, 3);
  });

  let paidOrder, paidCourse;
  test('sandbox checkout prices from the server, is idempotent and grants access only after confirmation', async () => {
    paidCourse = await publishedCourse(teacher.id, 'paid-sandbox', 25);
    assert.equal((await api(null, 'GET', '/payments/config')).body.data.provider, 'sandbox');
    const key = { 'Idempotency-Key': 'cart-attempt-0001' };
    const checkout = await api(student, 'POST', '/payments/checkout', { courseIds: [String(paidCourse._id)] }, key);
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.data.totalAmount, 2500);
    assert.match(checkout.body.data.checkoutUrl, /\/checkout\/sandbox\/sbx_cs_/);
    const repeated = await api(student, 'POST', '/payments/checkout', { courseIds: [String(paidCourse._id)] }, key);
    assert.equal(repeated.body.data.orderId, checkout.body.data.orderId);
    assert.equal(await models.Enrollment.countDocuments({ courseId: paidCourse._id }), 0);
    const sessionId = new URL(checkout.body.data.checkoutUrl).pathname.split('/').at(-1);
    assert.equal((await api(otherStudent, 'POST', `/payments/sandbox/sessions/${sessionId}/complete`)).status, 404);
    const completed = await api(student, 'POST', `/payments/sandbox/sessions/${sessionId}/complete`);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.data.status, 'paid');
    assert.match(completed.body.data.invoiceNumber, /^INV-\d{4}-\d{6}$/);
    assert.equal(await models.Enrollment.countDocuments({ studentId: student.id, courseId: paidCourse._id }), 1);
    assert.equal((await models.Course.findById(paidCourse._id).lean()).studentsCount, 1);
    const ledger = await models.LedgerEntry.find({ orderId: checkout.body.data.orderId }).lean();
    assert.deepEqual(ledger.map(entry => [entry.type, entry.grossAmount, entry.platformFee, entry.amount]), [['sale', 2500, 500, 2000]]);
    assert.equal((await api(student, 'POST', '/payments/checkout', { courseIds: [String(paidCourse._id)] })).body.error.code, 'ALREADY_ENROLLED');
    assert.equal((await api(student, 'GET', `/payments/orders/${checkout.body.data.orderId}/invoice`)).status, 200);
    assert.equal((await api(otherStudent, 'GET', `/payments/orders/${checkout.body.data.orderId}/invoice`)).status, 404);
    assert.equal((await api(otherStudent, 'GET', '/payments/orders/mine')).body.data.length, 0);
    paidOrder = checkout.body.data.orderId;
  });

  const signedWebhook = async (event, secret = process.env.SANDBOX_WEBHOOK_SECRET) => {
    const payload = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
    const response = await fetch(`${baseUrl}/payments/webhooks/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sandbox-Signature': `t=${timestamp},v1=${signSandboxPayload(payload, timestamp, secret)}` }, body: payload });
    return { status: response.status, body: await response.json() };
  };

  test('signed webhooks are verified, deduplicated and reject tampered amounts', async () => {
    const course = await publishedCourse(teacher.id, 'paid-webhook', 40);
    const checkout = await api(otherStudent, 'POST', '/payments/checkout', { courseIds: [String(course._id)] });
    const order = await models.Order.findById(checkout.body.data.orderId).lean();
    const event = { id: 'evt_test_0001', type: 'payment.succeeded', sessionId: order.providerSessionId, paymentId: 'pi_test_1', amountTotal: 4000, currency: 'eur' };
    assert.equal((await signedWebhook(event, 'wrong-secret-wrong-secret')).status, 400);
    assert.equal((await models.Order.findById(order._id).lean()).status, 'pending');
    const first = await signedWebhook(event);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.duplicate, false);
    const redelivered = await signedWebhook(event);
    assert.equal(redelivered.body.data.duplicate, true);
    assert.equal(await models.LedgerEntry.countDocuments({ orderId: order._id }), 1);
    assert.equal(await models.Enrollment.countDocuments({ studentId: otherStudent.id, courseId: course._id }), 1);

    const tamperedCourse = await publishedCourse(teacher.id, 'paid-tampered', 60);
    const tamperedCheckout = await api(otherStudent, 'POST', '/payments/checkout', { courseIds: [String(tamperedCourse._id)] });
    const tamperedOrder = await models.Order.findById(tamperedCheckout.body.data.orderId).lean();
    await signedWebhook({ id: 'evt_test_0002', type: 'payment.succeeded', sessionId: tamperedOrder.providerSessionId, paymentId: 'pi_test_2', amountTotal: 100, currency: 'eur' });
    const failed = await models.Order.findById(tamperedOrder._id).lean();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureReason, 'AMOUNT_MISMATCH');
    assert.equal(await models.Enrollment.countDocuments({ studentId: otherStudent.id, courseId: tamperedCourse._id }), 0);
  });

  test('admin refunds revoke access, debit the seller ledger and are not repeatable', async () => {
    assert.equal((await api(moderator, 'POST', `/admin/payments/orders/${paidOrder}/refund`, { reason: 'Customer request' })).status, 403);
    const refunded = await api(admin, 'POST', `/admin/payments/orders/${paidOrder}/refund`, { reason: 'Customer request' });
    assert.equal(refunded.status, 200);
    assert.equal(refunded.body.data.status, 'refunded');
    assert.equal(await models.Enrollment.countDocuments({ studentId: student.id, courseId: paidCourse._id }), 0);
    assert.equal((await models.LedgerEntry.findOne({ orderId: paidOrder, type: 'refund' }).lean()).amount, -2000);
    assert.equal((await api(admin, 'POST', `/admin/payments/orders/${paidOrder}/refund`, { reason: 'Again' })).body.error.code, 'ORDER_NOT_REFUNDABLE');
    const summary = await api(admin, 'GET', '/admin/payments/summary');
    assert.equal(summary.body.data.refundedOrders, 1);
  });

  test('sellers request payouts from their available balance once at a time and admins settle them', async () => {
    const earnings = await api(teacher, 'GET', '/payments/earnings');
    assert.equal(earnings.body.data.balance.available, 3200, 'webhook sale 4000 - 20% fee; refunded sale fully debited');
    assert.equal((await api(student, 'GET', '/payments/earnings')).status, 403);
    const concurrent = await Promise.all([api(teacher, 'POST', '/payments/payouts', {}), api(teacher, 'POST', '/payments/payouts', {})]);
    const statuses = concurrent.map(result => result.status).sort();
    assert.equal(statuses[0], 201);
    assert.ok([409, 422].includes(statuses[1]));
    const payout = concurrent.find(result => result.status === 201).body.data;
    assert.equal(payout.amount, 3200);
    assert.equal((await api(teacher, 'GET', '/payments/earnings')).body.data.balance.available, 0);
    assert.equal((await api(admin, 'PATCH', `/admin/payments/payouts/${payout.id}`, { status: 'paid' })).body.error.code, 'PAYOUT_REFERENCE_REQUIRED');
    const settled = await api(admin, 'PATCH', `/admin/payments/payouts/${payout.id}`, { status: 'paid', reference: 'SEPA-2026-001' });
    assert.equal(settled.body.data.status, 'paid');
    assert.equal((await api(admin, 'PATCH', `/admin/payments/payouts/${payout.id}`, { status: 'rejected' })).body.error.code, 'PAYOUT_ALREADY_PROCESSED');
  });

  test('paid tutoring slots are reserved during checkout, confirmed after payment and refunded on cancellation', async () => {
    const start = Date.now() + 5 * 3600_000;
    const slot = await models.TutoringSession.create({ teacherId: teacher.id, startAt: new Date(start), endAt: new Date(start + 3600_000), type: 'online', price: 30, status: 'available' });
    const checkout = await api(student, 'POST', `/payments/checkout/sessions/${slot._id}`, { subject: 'Exam prep' });
    assert.equal(checkout.status, 201);
    assert.equal((await api(otherStudent, 'POST', `/payments/checkout/sessions/${slot._id}`, { subject: 'Too late' })).body.error.code, 'SESSION_UNAVAILABLE');
    assert.equal((await api(teacher, 'PATCH', `/sessions/${slot._id}/status`, { status: 'confirmed' })).body.error.code, 'SESSION_PAYMENT_PENDING');
    const sessionId = new URL(checkout.body.data.checkoutUrl).pathname.split('/').at(-1);
    await api(student, 'POST', `/payments/sandbox/sessions/${sessionId}/complete`);
    assert.equal((await models.TutoringSession.findById(slot._id).lean()).paymentStatus, 'paid');
    assert.equal((await api(teacher, 'PATCH', `/sessions/${slot._id}/status`, { status: 'confirmed' })).status, 200);
    assert.equal((await api(student, 'PATCH', `/sessions/${slot._id}/status`, { status: 'cancelled' })).status, 200);
    const cancelled = await models.TutoringSession.findById(slot._id).lean();
    assert.equal(cancelled.paymentStatus, 'refunded');
    assert.equal((await models.Order.findById(checkout.body.data.orderId).lean()).status, 'refunded');

    const abandonedSlot = await models.TutoringSession.create({ teacherId: teacher.id, startAt: new Date(start + 2 * 3600_000), endAt: new Date(start + 3 * 3600_000), type: 'online', price: 30, status: 'available' });
    const abandoned = await api(student, 'POST', `/payments/checkout/sessions/${abandonedSlot._id}`, { subject: 'Later' });
    await models.TutoringSession.updateOne({ _id: abandonedSlot._id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await expireAbandonedCheckouts();
    const released = await models.TutoringSession.findById(abandonedSlot._id).lean();
    assert.equal(released.status, 'available');
    assert.equal(released.studentId, null);
    assert.equal((await models.Order.findById(abandoned.body.data.orderId).lean()).status, 'failed');
  });

  test('support tickets stay private to the requester while admins answer from the staff queue', async () => {
    const created = await api(student, 'POST', '/support/tickets', { subject: 'Invoice question', category: 'billing', message: 'Please explain my latest invoice.' });
    assert.equal(created.status, 201);
    const ticketId = created.body.data.id;
    assert.equal((await api(otherStudent, 'POST', `/support/tickets/${ticketId}/messages`, { body: 'Hijack' })).status, 404);
    assert.equal((await api(otherStudent, 'GET', '/support/tickets')).body.data.length, 0);
    assert.equal((await api(moderator, 'GET', '/admin/support/tickets')).status, 403);
    const queue = await api(admin, 'GET', '/admin/support/tickets?status=open');
    assert.equal(queue.body.data[0].requester.email, 'student@market.test');
    const replied = await api(admin, 'POST', `/admin/support/tickets/${ticketId}/messages`, { body: 'Here is the detail.' });
    assert.equal(replied.body.data.status, 'pending_user');
    const mine = await api(student, 'GET', '/support/tickets');
    assert.equal(mine.body.data[0].messages.at(-1).authorName, 'Support');
    assert.equal((await api(student, 'PATCH', `/support/tickets/${ticketId}/close`)).body.data.status, 'closed');
    assert.equal((await api(student, 'POST', `/support/tickets/${ticketId}/messages`, { body: 'Reopen?' })).body.error.code, 'TICKET_CLOSED');
  });

  test('managed categories validate new courses and analytics stay role-scoped', async () => {
    assert.equal((await api(moderator, 'POST', '/admin/categories', { slug: 'data', names: { fr: 'Données', en: 'Data', ar: 'بيانات' } })).status, 403);
    const category = await api(admin, 'POST', '/admin/categories', { slug: 'data-science', names: { fr: 'Science des données', en: 'Data science', ar: 'علم البيانات' } });
    assert.equal(category.status, 201);
    assert.equal((await api(teacher, 'POST', '/courses', { title: 'Uncategorised', description: 'Invalid category.', category: 'unknown' })).body.error.code, 'INVALID_COURSE_CATEGORY');
    const course = await api(teacher, 'POST', '/courses', { title: 'Categorised', description: 'Valid category.', category: 'data-science' });
    assert.equal(course.status, 201);
    assert.equal((await api(admin, 'DELETE', `/admin/categories/${category.body.data.id}`)).body.error.code, 'CATEGORY_IN_USE');
    const publicCategories = await api(null, 'GET', '/courses/categories');
    assert.equal(publicCategories.body.data[0].names.ar, 'علم البيانات');
    assert.ok(publicCategories.body.data.some(item => item.id === 'testing' && item.names === null), 'legacy values remain filterable');

    const overview = await api(admin, 'GET', '/analytics/admin/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.dailySignups.length, 14);
    assert.ok(overview.body.data.users.total >= 5);
    assert.equal((await api(moderator, 'GET', '/analytics/admin/overview')).status, 403);
    const institution = await createUser('Institution', 'institution@market.test', 'institution');
    const institutionCourse = await publishedCourse(institution.id, 'institution-course', 0);
    await models.Enrollment.create({ studentId: student.id, courseId: institutionCourse._id, completedLessonIds: ['l1'], completedAt: new Date() });
    const analytics = await api(institution, 'GET', '/analytics/institution');
    assert.equal(analytics.body.data.totals.enrollments, 1);
    assert.equal(analytics.body.data.totals.completionRate, 100);
    assert.equal(analytics.body.data.students[0].progress, 100);
    assert.equal((await api(teacher, 'GET', '/analytics/institution')).status, 403);
  });

  test('Google Calendar links are stored encrypted and confirmed sessions sync to both participants', async t => {
    const googleCalls = [];
    const realFetch = globalThis.fetch;
    let eventCounter = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/') || url.startsWith('https://www.googleapis.com/')) {
        googleCalls.push(`${init.method || 'GET'} ${url.split('?')[0]}`);
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          const body = new URLSearchParams(String(init.body));
          return Response.json({ access_token: 'access-token', expires_in: 3600, ...(body.get('code') ? { refresh_token: `refresh-${body.get('code')}` } : {}) });
        }
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 });
        // Calendar list and incremental listing, as the multi-calendar sync reads them.
        if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'primary-calendar@example.test', summary: 'Agenda', primary: true, accessRole: 'owner' }] });
        if (init.method !== 'POST' && url.includes('/events')) return Response.json({ items: [], nextSyncToken: 'sync-token-1' });
        eventCounter += 1;
        return Response.json({ id: `gevt_${eventCounter}`, etag: `"${eventCounter}"`, start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 3600_000).toISOString() } });
      }
      return realFetch(input, init);
    };
    t.after(() => { globalThis.fetch = realFetch; });

    const connect = async (actor, code) => {
      const started = await api(actor, 'POST', '/calendar/google/connect');
      const authorizationUrl = new URL(started.body.data.authorizationUrl);
      assert.equal(authorizationUrl.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
      const callback = await realFetch(`${baseUrl}/calendar/google/callback?code=${code}&state=${encodeURIComponent(authorizationUrl.searchParams.get('state'))}`, { redirect: 'manual' });
      assert.equal(callback.status, 303);
      assert.equal(new URL(callback.headers.get('location')).searchParams.get('google'), 'connected');
    };
    await connect(teacher, 'teacher-code');
    await connect(student, 'student-code');
    const forged = await realFetch(`${baseUrl}/calendar/google/callback?code=x&state=forged`, { redirect: 'manual' });
    assert.equal(new URL(forged.headers.get('location')).searchParams.get('google'), 'error');
    // Tokens now live in a per-provider connection (multi-calendar sync); still encrypted at rest.
    const { CalendarConnection, SessionCalendarLink } = await import('../dist/modules/calendar/models.js');
    const stored = await CalendarConnection.findOne({ userId: student.id, provider: 'google' }).select('+refreshToken').lean();
    assert.ok(stored.refreshToken && !stored.refreshToken.includes('refresh-student-code'));
    assert.equal((await api(student, 'GET', '/calendar/google/status')).body.data.connected, true);
    assert.equal(JSON.stringify((await api(student, 'GET', '/auth/me')).body).includes('googleCalendar'), false);

    const start = Date.now() + 30 * 3600_000;
    const slot = await models.TutoringSession.create({ teacherId: teacher.id, startAt: new Date(start), endAt: new Date(start + 3600_000), type: 'in_person', venue: 'Room 4', price: 0, status: 'available' });
    assert.equal((await api(student, 'POST', `/sessions/${slot._id}/book`, { subject: 'Calendar sync' })).status, 201);
    assert.equal((await api(teacher, 'PATCH', `/sessions/${slot._id}/status`, { status: 'confirmed' })).status, 200);
    let synced;
    for (let attempt = 0; attempt < 40 && (synced?.length || 0) < 2; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      synced = await SessionCalendarLink.find({ sessionId: slot._id }).lean();
    }
    assert.deepEqual(synced.map(link => String(link.userId)).sort(), [student.id, teacher.id].sort());
    const ics = await realFetch(`${baseUrl}/calendar/events.ics`, { headers: { Cookie: student.cookie } });
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    const icsText = await ics.text();
    assert.match(icsText, /BEGIN:VEVENT/);
    assert.match(icsText, /SUMMARY:EduMarket · Calendar sync/);
    assert.match(icsText, /LOCATION:Room 4/);

    assert.equal((await api(student, 'PATCH', `/sessions/${slot._id}/status`, { status: 'cancelled' })).status, 200);
    for (let attempt = 0; attempt < 40 && synced.length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      synced = await SessionCalendarLink.find({ sessionId: slot._id }).lean();
    }
    assert.deepEqual(synced, []);
    assert.equal(googleCalls.filter(call => call.startsWith('DELETE')).length, 2);
    assert.equal((await api(student, 'DELETE', '/calendar/google')).status, 204);
    assert.equal((await api(student, 'GET', '/calendar/google/status')).body.data.connected, false);
  });

  const payWithSandbox = async (actor, checkout) => {
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    const sessionId = new URL(checkout.body.data.checkoutUrl).pathname.split('/').at(-1);
    const completed = await api(actor, 'POST', `/payments/sandbox/sessions/${sessionId}/complete`);
    assert.equal(completed.body.data.status, 'paid');
    return checkout.body.data.orderId;
  };

  test('affiliated teacher sales credit the institution share agreed in the invitation until disaffiliation', async () => {
    const institution = await createUser('Share Institution', 'share-institution@market.test', 'institution');
    const affiliated = await createUser('Affiliated Teacher', 'affiliated-teacher@market.test', 'teacher');
    assert.equal((await api(institution, 'POST', '/institutions/invitations', { email: 'affiliated-teacher@market.test', revenueSharePercent: 60 })).status, 400);
    const invitation = await api(institution, 'POST', '/institutions/invitations', { email: 'affiliated-teacher@market.test', revenueSharePercent: 25 });
    assert.equal(invitation.status, 201);
    assert.equal((await api(affiliated, 'GET', '/institutions/invitations/mine')).body.data[0].revenueSharePercent, 25);
    assert.equal((await api(affiliated, 'PATCH', `/institutions/invitations/${invitation.body.data.id}`, { decision: 'accepted' })).status, 200);
    assert.equal((await api(institution, 'GET', '/institutions/teachers')).body.data[0].revenueSharePercent, 25);

    const course = await publishedCourse(affiliated.id, 'affiliated-sale', 40);
    const buyer = await createUser('Share Buyer', 'share-buyer@market.test', 'student');
    const orderId = await payWithSandbox(buyer, await api(buyer, 'POST', '/payments/checkout', { courseIds: [String(course._id)] }));
    const entries = await models.LedgerEntry.find({ orderId }).lean();
    assert.equal(entries.find(entry => entry.type === 'sale').amount, 2400, '4000 - 20% fee = 3200; teacher keeps 75%');
    const share = entries.find(entry => entry.type === 'affiliation_share');
    assert.equal(share.amount, 800);
    assert.equal(String(share.sellerId), institution.id);
    assert.equal((await api(institution, 'GET', '/payments/earnings')).body.data.balance.earned, 800);

    assert.equal((await api(institution, 'DELETE', `/institutions/teachers/${affiliated.id}`)).status, 204);
    assert.equal((await models.User.findById(affiliated.id).lean()).institutionId, undefined);
    const laterBuyer = await createUser('Later Buyer', 'later-buyer@market.test', 'student');
    const laterOrder = await payWithSandbox(laterBuyer, await api(laterBuyer, 'POST', '/payments/checkout', { courseIds: [String(course._id)] }));
    assert.deepEqual((await models.LedgerEntry.find({ orderId: laterOrder }).lean()).map(entry => [entry.type, entry.amount]), [['sale', 3200]]);
    assert.equal((await api(affiliated, 'DELETE', '/institutions/affiliation/mine')).status, 404);
  });

  test('prepaid subscriptions grant expiring catalogue access, chain renewals and share revenue by completed lessons', async () => {
    assert.equal((await api(null, 'GET', '/subscriptions/offer')).body.data.enabled, false);
    const learner = await createUser('Subscriber', 'subscriber@market.test', 'student');
    assert.equal((await api(learner, 'POST', '/subscriptions/checkout', { plan: 'monthly' })).body.error.code, 'SUBSCRIPTIONS_DISABLED');
    assert.equal((await api(admin, 'PATCH', '/admin/settings', { subscription: { enabled: true, monthlyPrice: 10 } })).status, 200);

    const institution = await createUser('Sub Institution', 'sub-institution@market.test', 'institution');
    const affiliated = await createUser('Sub Teacher', 'sub-teacher@market.test', 'teacher');
    const invite = await api(institution, 'POST', '/institutions/invitations', { email: 'sub-teacher@market.test', revenueSharePercent: 25 });
    await api(affiliated, 'PATCH', `/institutions/invitations/${invite.body.data.id}`, { decision: 'accepted' });
    const lessons = ['a1', 'a2', 'a3'].map(id => ({ ...lesson, id }));
    const courseA = await models.Course.create({ title: 'Subscription A', slug: 'subscription-a', description: 'A', category: 'testing', price: 50, teacherId: affiliated.id, status: 'published', chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons }] });
    const courseB = await publishedCourse(teacher.id, 'subscription-b', 20);

    assert.equal((await api(learner, 'POST', '/enrollments', { courseId: String(courseA._id) })).body.error.code, 'PAYMENT_REQUIRED');
    const firstOrder = await payWithSandbox(learner, await api(learner, 'POST', '/subscriptions/checkout', { plan: 'monthly' }));
    const status = (await api(learner, 'GET', '/subscriptions/me')).body.data;
    assert.equal(status.active, true);
    assert.equal(status.periods[0].amount, 1000);

    for (const course of [courseA, courseB]) {
      const enrollment = await api(learner, 'POST', '/enrollments', { courseId: String(course._id) });
      assert.equal(enrollment.status, 201);
      assert.equal(enrollment.body.data.accessType, 'subscription');
    }
    for (const lessonId of ['a1', 'a2', 'a3']) assert.equal((await api(learner, 'PUT', `/enrollments/${courseA._id}/lessons/${lessonId}/complete`)).status, 200);
    assert.equal((await api(learner, 'PUT', `/enrollments/${courseB._id}/lessons/l1/complete`)).status, 200);

    // Renewal is chained after the current period; refunding it restores the previous end date.
    const renewalOrder = await payWithSandbox(learner, await api(learner, 'POST', '/subscriptions/checkout', { plan: 'monthly' }));
    const periods = await models.SubscriptionPeriod.find({ studentId: learner.id }).sort({ startsAt: 1 }).lean();
    assert.equal(periods.length, 2);
    assert.equal(periods[1].startsAt.getTime(), periods[0].endsAt.getTime());
    assert.equal((await models.Subscription.findOne({ studentId: learner.id }).lean()).currentPeriodEnd.getTime(), periods[1].endsAt.getTime());
    assert.equal((await api(admin, 'POST', `/admin/payments/orders/${renewalOrder}/refund`, { reason: 'Renewal by mistake' })).status, 200);
    assert.equal((await models.Subscription.findOne({ studentId: learner.id }).lean()).currentPeriodEnd.getTime(), periods[0].endsAt.getTime());
    assert.equal((await models.Enrollment.findOne({ studentId: learner.id, courseId: courseA._id }).lean()).accessExpiresAt.getTime(), periods[0].endsAt.getTime());

    // Settlement: pool = 1000 - 20% = 800, split 3:1 by completed lessons; course A's teacher shares 25% with the institution.
    assert.equal(await subscriptionJobs.settleEndedSubscriptionPeriods(new Date(periods[0].endsAt.getTime() + 1)), 1);
    const credits = await models.LedgerEntry.find({ orderId: firstOrder }).lean();
    const amountFor = (type, sellerId) => credits.find(entry => entry.type === type && String(entry.sellerId) === sellerId)?.amount;
    assert.equal(amountFor('subscription_share', affiliated.id), 450);
    assert.equal(amountFor('affiliation_share', institution.id), 150);
    assert.equal(amountFor('subscription_share', teacher.id), 200);
    assert.equal(await subscriptionJobs.settleEndedSubscriptionPeriods(new Date(periods[0].endsAt.getTime() + 2)), 0, 'periods settle once');

    // Expired access closes course content but no longer blocks a permanent purchase.
    await models.Enrollment.updateMany({ studentId: learner.id }, { $set: { accessExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await api(learner, 'GET', `/enrollments/${courseA._id}`)).status, 404);
    assert.equal((await api(learner, 'POST', '/payments/checkout', { courseIds: [String(courseA._id)] })).status, 201);

    assert.notEqual((await api(learner, 'POST', '/subscriptions/me/cancel')).body.data.cancelledAt, null);
    assert.equal((await api(learner, 'POST', '/subscriptions/me/cancel')).body.error.code, 'SUBSCRIPTION_ALREADY_CANCELLED');
  });

  test('renewal reminders are sent once per period end and never after cancellation', async () => {
    const learner = await createUser('Reminded', 'reminded@market.test', 'student');
    await models.Subscription.create({ studentId: learner.id, plan: 'monthly', currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    await subscriptionJobs.sendRenewalReminders();
    await subscriptionJobs.sendRenewalReminders();
    assert.equal((await api(learner, 'GET', '/notifications')).body.data.filter(item => item.type === 'subscription').length, 1);
    const cancelled = await createUser('Cancelled', 'cancelled-sub@market.test', 'student');
    await models.Subscription.create({ studentId: cancelled.id, plan: 'monthly', currentPeriodEnd: new Date(Date.now() + 86_400_000), cancelledAt: new Date() });
    await subscriptionJobs.sendRenewalReminders();
    assert.equal((await api(cancelled, 'GET', '/notifications')).body.data.length, 0);
  });

  test('content reports are participant-scoped, deduplicated and applied through module rules by moderators', async () => {
    const { Conversation, Message } = await import('../dist/modules/messaging/models.js');
    const reporter = await createUser('Reporter', 'reporter@market.test', 'student');
    const outsider = await createUser('Outsider', 'report-outsider@market.test', 'student');
    const course = await publishedCourse(teacher.id, 'reported-course', 15);

    assert.equal((await api(reporter, 'POST', '/reports', { targetType: 'course', targetId: String(course._id), reason: 'copyright', details: 'Copied slides' })).status, 201);
    assert.equal((await api(reporter, 'POST', '/reports', { targetType: 'course', targetId: String(course._id), reason: 'copyright' })).body.error.code, 'REPORT_ALREADY_OPEN');
    assert.equal((await api(outsider, 'POST', '/reports', { targetType: 'course', targetId: String(course._id), reason: 'spam' })).status, 201);
    assert.equal((await api(reporter, 'GET', '/moderation/reports')).status, 403);
    const queue = await api(moderator, 'GET', '/moderation/reports?targetType=course');
    const courseReport = queue.body.data.find(item => item.targetId === String(course._id));
    assert.equal(courseReport.snapshot.title, `Course reported-course`);
    assert.equal((await api(moderator, 'PATCH', `/moderation/reports/${courseReport.id}`, { decision: 'actioned', note: 'Confirmed copyright issue' })).body.data.status, 'actioned');
    assert.equal((await models.Course.findById(course._id).lean()).status, 'suspended');
    assert.equal((await api(moderator, 'GET', '/moderation/reports?targetType=course')).body.data.filter(item => item.targetId === String(course._id)).length, 0, 'duplicate reports closed together');

    const conversation = await Conversation.create({ participants: [reporter.id, teacher.id], participantKey: [reporter.id, teacher.id].sort().join(':') });
    const message = await Message.create({ conversationId: conversation._id, senderId: teacher.id, text: 'Offensive content', readBy: [teacher.id] });
    assert.equal((await api(outsider, 'POST', '/reports', { targetType: 'message', targetId: String(message._id), reason: 'harassment' })).status, 404);
    assert.equal((await api(teacher, 'POST', '/reports', { targetType: 'message', targetId: String(message._id), reason: 'harassment' })).status, 404, 'senders cannot report their own message');
    assert.equal((await api(reporter, 'POST', '/reports', { targetType: 'message', targetId: String(message._id), reason: 'harassment' })).status, 201);
    const messageReport = (await api(moderator, 'GET', '/moderation/reports?targetType=message')).body.data[0];
    assert.equal(messageReport.snapshot.excerpt, 'Offensive content');
    await api(moderator, 'PATCH', `/moderation/reports/${messageReport.id}`, { decision: 'actioned' });
    const thread = await api(reporter, 'GET', `/messaging/conversations/${conversation._id}/messages`);
    const hidden = thread.body.data.find(item => item.id === String(message._id));
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.text, '');

    assert.equal((await api(reporter, 'POST', '/reports', { targetType: 'user', targetId: reporter.id, reason: 'spam' })).status, 404);
    assert.equal((await api(reporter, 'POST', '/reports', { targetType: 'user', targetId: teacher.id, reason: 'harassment' })).status, 201);
    const userReport = (await api(moderator, 'GET', '/moderation/reports?targetType=user')).body.data[0];
    assert.equal((await api(moderator, 'PATCH', `/moderation/reports/${userReport.id}`, { decision: 'actioned' })).body.data.status, 'escalated');
    assert.equal((await models.User.findById(teacher.id).lean()).status, 'active', 'moderators never suspend accounts');
    assert.equal((await api(admin, 'PATCH', `/moderation/reports/${userReport.id}`, { decision: 'dismissed', note: 'No violation' })).body.data.status, 'dismissed');
    assert.equal((await api(moderator, 'GET', '/moderation/summary')).body.data.openContentReports, 0);
  });

  test('notification e-mails are opt-in, escaped and sent through Resend only when configured', async t => {
    const { env } = await import('../dist/config/env.js');
    const { createNotification } = await import('../dist/modules/notifications/service.js');
    const realFetch = globalThis.fetch;
    const sent = [];
    const previous = { NODE_ENV: env.NODE_ENV, RESEND_API_KEY: env.RESEND_API_KEY };
    globalThis.fetch = async (input, init = {}) => {
      if (String(input) === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return Response.json({ id: 'email_1' }); }
      return realFetch(input, init);
    };
    t.after(() => { globalThis.fetch = realFetch; Object.assign(env, previous); });
    const recipient = await createUser('Mail Opt In', 'mail-opt-in@market.test', 'student');
    await createNotification({ userId: recipient.id, type: 'system', title: 'Hidden', message: 'Not mailed while e-mail is off' });
    Object.assign(env, { NODE_ENV: 'development', RESEND_API_KEY: 're_test_key' });
    await createNotification({ userId: recipient.id, type: 'system', title: 'Still off', message: 'Preference disabled' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(sent.length, 0);
    Object.assign(env, previous);
    assert.equal((await api(recipient, 'PATCH', '/auth/me/preferences', { email: true })).body.data.email, true);
    Object.assign(env, { NODE_ENV: 'development', RESEND_API_KEY: 're_test_key' });
    await createNotification({ userId: recipient.id, type: 'system', title: '<b>Alert</b>', message: 'Check & review', link: '/support' });
    for (let attempt = 0; attempt < 20 && sent.length === 0; attempt += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['mail-opt-in@market.test']);
    assert.match(sent[0].html, /&lt;b&gt;Alert&lt;\/b&gt;/);
    assert.match(sent[0].html, /Check &amp; review/);
    assert.match(sent[0].html, /\/support/);
  });

  test('lesson Q&A is limited to enrolled learners and course staff, with staff answers flagged', async () => {
    const course = await publishedCourse(teacher.id, 'qna-course', 0);
    const learner = await createUser('Asker', 'asker@market.test', 'student');
    const peer = await createUser('Peer', 'peer@market.test', 'student');
    const outsider = await createUser('Qna Outsider', 'qna-outsider@market.test', 'student');
    for (const actor of [learner, peer]) assert.equal((await api(actor, 'POST', '/enrollments', { courseId: String(course._id) })).status, 201);
    const path = `/courses/${course._id}/lessons/l1/questions`;
    assert.equal((await api(outsider, 'GET', path)).status, 403);
    assert.equal((await api(learner, 'GET', `/courses/${course._id}/lessons/unknown/questions`)).status, 404);
    assert.equal((await api(teacher, 'POST', path, { body: 'Teachers do not ask here' })).status, 403);
    const asked = await api(learner, 'POST', path, { body: 'How should atoms handle state?' });
    assert.equal(asked.status, 201);
    assert.equal(asked.body.data.mine, true);
    const staffAnswer = await api(teacher, 'POST', `${path}/${asked.body.data.id}/answers`, { body: 'Keep them stateless.' });
    assert.equal(staffAnswer.body.data.answers[0].staff, true);
    const peerAnswer = await api(peer, 'POST', `${path}/${asked.body.data.id}/answers`, { body: 'Hooks live in organisms.' });
    assert.equal(peerAnswer.body.data.answers[1].staff, false);
    const listed = await api(peer, 'GET', path);
    assert.equal(listed.body.data[0].author.name, 'Asker');
    assert.equal(listed.body.data[0].mine, false);
    const notifications = (await api(learner, 'GET', '/notifications')).body.data.filter(item => item.title === 'Your question was answered');
    assert.equal(notifications.length, 2);
  });

  test('visitors reach support through the public contact form as guest tickets', async () => {
    assert.equal((await api(null, 'POST', '/support/contact', { name: 'Visitor', email: 'not-an-email', message: 'Hello there team' })).status, 400);
    const created = await api(null, 'POST', '/support/contact', { name: 'Curious Visitor', email: 'visitor@market.test', subject: 'Partnership question', message: 'We would like to list our school.' });
    assert.equal(created.status, 201);
    const queue = await api(admin, 'GET', '/admin/support/tickets?status=open');
    const ticket = queue.body.data.find(item => item.id === created.body.data.id);
    assert.deepEqual(ticket.requester, { id: '', name: 'Curious Visitor', email: 'visitor@market.test', role: 'visitor' });
    assert.equal(ticket.messages[0].authorName, 'Curious Visitor');
    assert.equal((await api(admin, 'POST', `/admin/support/tickets/${ticket.id}/messages`, { body: 'Thanks, we will call you.', status: 'resolved' })).body.data.status, 'resolved');
  });

  test('learning paths list published courses in order with duration and per-student progress', async () => {
    const first = await publishedCourse(teacher.id, 'path-first', 0);
    const second = await publishedCourse(teacher.id, 'path-second', 0);
    const draft = await models.Course.create({ title: 'Draft', slug: 'path-draft', description: 'Draft', category: 'testing', teacherId: teacher.id, status: 'draft' });
    const body = { slug: 'frontend-path', title: { fr: 'Parcours front', en: 'Frontend path', ar: 'مسار الواجهة' }, description: { fr: 'Description', en: 'Description', ar: 'وصف' }, skills: ['React'], courseIds: [String(second._id), String(first._id)] };
    assert.equal((await api(moderator, 'POST', '/admin/learning-paths', body)).status, 403);
    assert.equal((await api(admin, 'POST', '/admin/learning-paths', { ...body, courseIds: [String(draft._id)] })).body.error.code, 'PATH_COURSE_NOT_PUBLISHED');
    assert.equal((await api(admin, 'POST', '/admin/learning-paths', body)).status, 201);
    const learner = await createUser('Path Learner', 'path-learner@market.test', 'student');
    await api(learner, 'POST', '/enrollments', { courseId: String(second._id) });
    await api(learner, 'PUT', `/enrollments/${second._id}/lessons/l1/complete`);
    const list = await api(learner, 'GET', '/learning-paths');
    const path = list.body.data.find(item => item.slug === 'frontend-path');
    assert.deepEqual(path.courseIds, [String(second._id), String(first._id)]);
    assert.equal(path.durationMinutes, 10);
    assert.deepEqual(path.progress, { enrolled: 1, completed: 1 });
    const anonymous = await api(null, 'GET', '/learning-paths/frontend-path');
    assert.equal(anonymous.body.data.courses.length, 2);
    assert.equal(anonymous.body.data.progress, undefined);
    assert.equal(anonymous.body.data.courses[0].chapters[0].lessons[0].textContent, undefined, 'public DTO hides lesson content');
  });

  test('institution internal roles and course co-owners share content management but not pricing', async () => {
    const institution = await createUser('Roles Institution', 'roles-institution@market.test', 'institution');
    const owner = await createUser('Course Owner', 'course-owner@market.test', 'teacher');
    const coordinator = await createUser('Coordinator', 'coordinator@market.test', 'teacher');
    const guest = await createUser('Guest Author', 'guest-author@market.test', 'teacher');
    for (const [member, email] of [[owner, 'course-owner@market.test'], [coordinator, 'coordinator@market.test']]) {
      const invite = await api(institution, 'POST', '/institutions/invitations', { email });
      assert.equal((await api(member, 'PATCH', `/institutions/invitations/${invite.body.data.id}`, { decision: 'accepted' })).status, 200);
    }
    const course = await models.Course.create({ title: 'Owned draft', slug: 'owned-draft', description: 'Draft owned by an affiliated teacher.', category: 'testing', price: 10, teacherId: owner.id, status: 'draft', chapters: [] });
    const path = `/courses/${course._id}`;

    assert.equal((await api(coordinator, 'PATCH', path, { subtitle: 'Edited before role' })).status, 404, 'plain members cannot edit colleagues courses');
    assert.equal((await api(owner, 'PATCH', `/institutions/teachers/${coordinator.id}`, { internalRole: 'coordinator' })).status, 403);
    const promoted = await api(institution, 'PATCH', `/institutions/teachers/${coordinator.id}`, { internalRole: 'coordinator', revenueSharePercent: 10 });
    assert.deepEqual([promoted.status, promoted.body.data.internalRole, promoted.body.data.revenueSharePercent], [200, 'coordinator', 10]);
    assert.equal((await api(coordinator, 'GET', '/institutions/affiliation/mine')).body.data.internalRole, 'coordinator');
    assert.equal((await api(coordinator, 'PATCH', path, { subtitle: 'Edited by coordinator' })).status, 200);
    assert.equal((await api(coordinator, 'PATCH', path, { price: 1 })).body.error.code, 'COURSE_OWNER_REQUIRED');
    assert.ok((await api(coordinator, 'GET', '/courses/mine')).body.data.some(item => String(item._id) === String(course._id)));

    assert.equal((await api(guest, 'PATCH', path, { subtitle: 'Outsider' })).status, 404);
    assert.equal((await api(owner, 'PUT', `${path}/co-owners`, { emails: ['unknown@market.test'] })).body.error.code, 'VERIFIED_TEACHER_NOT_FOUND');
    const coOwners = await api(owner, 'PUT', `${path}/co-owners`, { emails: ['guest-author@market.test'] });
    assert.deepEqual(coOwners.body.data.map(item => item.email), ['guest-author@market.test']);
    assert.equal((await api(guest, 'PATCH', path, { subtitle: 'Edited by co-owner', tags: ['React', 'react', 'Testing'] })).status, 200);
    assert.deepEqual((await models.Course.findById(course._id).lean()).tags, ['react', 'testing']);
    assert.equal((await api(guest, 'PUT', `${path}/co-owners`, { emails: [] })).body.error.code, 'COURSE_OWNER_REQUIRED');
    assert.equal((await api(guest, 'GET', `/courses/mine/${course._id}`)).body.data.coOwners[0].email, 'guest-author@market.test');
    const notification = (await api(guest, 'GET', '/notifications')).body.data.find(item => item.template?.key === 'courseCoOwner');
    assert.equal(notification.template.params.course, 'Owned draft');

    assert.equal((await api(institution, 'DELETE', `/institutions/teachers/${coordinator.id}`)).status, 204);
    assert.equal((await models.User.findById(coordinator.id).lean()).institutionRole, 'teacher');
    assert.equal((await api(coordinator, 'PATCH', path, { subtitle: 'After leaving' })).status, 404);
  });

  test('booked tutoring sessions move to another open slot of the same teacher', async () => {
    const tutor = await createUser('Rescheduling Tutor', 'rescheduling-tutor@market.test', 'teacher');
    const learner = await createUser('Rescheduling Learner', 'rescheduling-learner@market.test', 'student');
    const outsider = await createUser('Rescheduling Outsider', 'rescheduling-outsider@market.test', 'student');
    const slot = async (days, price = 0) => {
      const start = new Date(Date.now() + days * 86_400_000);
      const created = await api(tutor, 'POST', '/sessions/availability', { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), type: 'online', price });
      assert.equal(created.status, 201);
      return String(created.body.data._id || created.body.data.id);
    };
    const first = await slot(3), second = await slot(4), paid = await slot(5, 30);
    assert.equal((await api(learner, 'POST', `/sessions/${first}/book`, { subject: 'Algebra' })).status, 201);
    assert.equal((await api(tutor, 'PATCH', `/sessions/${first}/status`, { status: 'confirmed' })).status, 200);
    assert.equal((await api(outsider, 'POST', `/sessions/${first}/reschedule`, { targetSessionId: second })).status, 404);
    assert.equal((await api(learner, 'POST', `/sessions/${first}/reschedule`, { targetSessionId: paid })).body.error.code, 'RESCHEDULE_SLOT_UNAVAILABLE', 'price must match');
    const moved = await api(learner, 'POST', `/sessions/${first}/reschedule`, { targetSessionId: second });
    assert.deepEqual([moved.status, moved.body.data.status, moved.body.data.subject], [200, 'pending', 'Algebra']);
    const released = await models.TutoringSession.findById(first).lean();
    assert.deepEqual([released.status, released.studentId], ['available', null]);
    const tutorNotice = (await api(tutor, 'GET', '/notifications')).body.data.find(item => item.template?.key === 'sessionRescheduled');
    assert.ok(tutorNotice);
    assert.equal((await api(tutor, 'POST', `/sessions/${second}/reschedule`, { targetSessionId: first })).body.data.status, 'pending');
  });

  test('teachers follow their learners and answer reviews of the courses they manage', async () => {
    const author = await createUser('Review Author', 'review-author@market.test', 'teacher');
    const stranger = await createUser('Review Stranger', 'review-stranger@market.test', 'teacher');
    const learner = await createUser('Reviewer', 'reviewer@market.test', 'student');
    const course = await publishedCourse(author.id, 'reviewed-course', 0);
    assert.equal((await api(learner, 'POST', '/enrollments', { courseId: String(course._id) })).status, 201);
    assert.equal((await api(learner, 'PUT', `/enrollments/${course._id}/lessons/l1/complete`)).status, 200);
    const report = await api(author, 'GET', '/analytics/teacher');
    assert.equal(report.status, 200);
    assert.deepEqual([report.body.data.students[0].email, report.body.data.students[0].progress], ['reviewer@market.test', 100]);
    assert.equal((await api(stranger, 'GET', '/analytics/teacher')).body.data.students.length, 0);
    assert.equal((await api(learner, 'GET', '/analytics/teacher')).status, 403);

    const review = await api(learner, 'PUT', `/courses/${course._id}/reviews/mine`, { rating: 5, comment: 'Clear and practical course.' });
    const managed = await api(author, 'GET', '/courses/reviews/managed');
    assert.equal(managed.body.data[0].id, review.body.data.id);
    const replyPath = `/courses/${course._id}/reviews/${review.body.data.id}/reply`;
    assert.equal((await api(stranger, 'PUT', replyPath, { body: 'Not mine' })).status, 404);
    assert.equal((await api(author, 'PUT', replyPath, { body: 'Thank you for the feedback!' })).status, 200);
    const publicReviews = await api(null, 'GET', `/courses/${course._id}/reviews`);
    assert.equal(publicReviews.body.data.reviews[0].reply.body, 'Thank you for the feedback!');
    assert.ok((await api(learner, 'GET', '/notifications')).body.data.some(item => item.template?.key === 'reviewReplied'));
    assert.equal((await api(author, 'PUT', replyPath, { body: '' })).body.data.reply, null);
  });

  test('admins manage exams, revoke certificates publicly and open a user detail', async () => {
    const { issueCompletionCertificate } = await import('../dist/modules/certificates/service.js');
    const { Exam } = await import('../dist/modules/exams/models.js');
    const holder = await createUser('Certificate Holder', 'certificate-holder@market.test', 'student');
    const course = await publishedCourse(teacher.id, 'certified-admin-course', 0);
    const certificate = await issueCompletionCertificate(holder.id, String(course._id));
    const exam = await Exam.create({ courseId: course._id, creatorId: teacher.id, title: 'Admin managed exam', description: 'Exam fixture', type: 'online', durationMinutes: 30, passPercentage: 50, questions: [{ id: 'q1', question: 'One?', options: ['a', 'b'], correctOptionIndex: 0 }], status: 'published' });

    assert.equal((await api(moderator, 'GET', '/admin/certificates')).status, 403);
    const listed = await api(admin, 'GET', '/admin/certificates?search=certificate-holder');
    assert.deepEqual(listed.body.data.map(item => item.code), [certificate.code]);
    assert.equal((await api(admin, 'PATCH', `/admin/certificates/${certificate._id}`, { status: 'revoked', reason: 'no' })).status, 400);
    const revoked = await api(admin, 'PATCH', `/admin/certificates/${certificate._id}`, { status: 'revoked', reason: 'Exam fraud confirmed' });
    assert.equal(revoked.body.data.status, 'revoked');
    assert.equal((await api(admin, 'PATCH', `/admin/certificates/${certificate._id}`, { status: 'revoked', reason: 'Exam fraud confirmed' })).status, 409);
    assert.equal((await api(null, 'GET', `/certificates/verify/${certificate.code}`)).body.data.status, 'revoked');
    assert.equal((await api(holder, 'GET', '/certificates/mine')).body.data[0].status, 'revoked');
    assert.equal((await api(admin, 'PATCH', `/admin/certificates/${certificate._id}`, { status: 'valid' })).body.data.status, 'valid');

    const exams = await api(admin, 'GET', '/admin/exams?search=Admin managed');
    assert.equal(exams.body.data[0].id, String(exam._id));
    assert.equal((await api(admin, 'PATCH', `/admin/exams/${exam._id}`, { status: 'draft' })).body.data.status, 'draft');
    assert.equal((await api(teacher, 'PATCH', `/admin/exams/${exam._id}`, { status: 'published' })).status, 403);

    assert.equal((await api(admin, 'PATCH', `/admin/users/${holder.id}/status`, { status: 'suspended' })).status, 200);
    const detail = await api(admin, 'GET', `/admin/users/${holder.id}`);
    assert.deepEqual([detail.body.data.email, detail.body.data.status, detail.body.data.stats.certificates], ['certificate-holder@market.test', 'suspended', 1]);
    assert.ok(detail.body.data.audit.some(event => event.action === 'user.status.updated'));
    assert.equal((await api(admin, 'GET', '/admin/users/000000000000000000000000')).status, 404);
  });

  test('classes open assigned courses to their members only, and restricted courses stay hidden from everyone else', async () => {
    const school = await createUser('Class School', 'class-school@market.test', 'institution');
    const outsiderTeacher = await createUser('Class Outsider Teacher', 'class-outsider-teacher@market.test', 'teacher');
    const third = await createUser('Third Year', 'third-year@market.test', 'student');
    const second = await createUser('Second Year', 'second-year@market.test', 'student');
    const restricted3 = await models.Course.create({ title: 'Signal processing (3rd year)', slug: 'signal-processing-3', description: 'Restricted 3rd-year material.', category: 'testing', price: 0, teacherId: school.id, status: 'published', visibility: 'restricted', chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }] });
    const restricted2 = await models.Course.create({ title: 'Analysis (2nd year)', slug: 'analysis-2', description: 'Restricted 2nd-year material.', category: 'testing', price: 0, teacherId: school.id, status: 'published', visibility: 'restricted', chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }] });
    const publicPaid = await models.Course.create({ title: 'School public paid course', slug: 'school-public-paid', description: 'Public course of the school.', category: 'testing', price: 80, teacherId: school.id, status: 'published', chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }] });

    // Hidden before membership: catalogue, detail, enrollment and checkout.
    const catalogue = (await api(null, 'GET', '/courses?limit=50')).body.data.map(course => course.id || course._id);
    assert.ok(!catalogue.includes(String(restricted3._id)));
    assert.equal((await api(null, 'GET', `/courses/${restricted3._id}`)).status, 404);
    assert.equal((await api(third, 'GET', `/courses/${restricted3._id}`)).status, 404);
    assert.equal((await api(third, 'POST', '/enrollments', { courseId: String(restricted3._id) })).body.error.code, 'COURSE_RESTRICTED');
    assert.equal((await api(third, 'POST', '/payments/checkout', { courseIds: [String(restricted3._id)] })).status, 404);

    const year3 = await api(school, 'POST', '/classes', { name: 'Ingénieur 3ème année', level: '3ème année', academicYear: '2026-2027' });
    assert.equal(year3.status, 201);
    const year2 = await api(school, 'POST', '/classes', { name: 'Ingénieur 2ème année', level: '2ème année' });
    const classPath = `/classes/${year3.body.data.id}`;
    assert.equal((await api(outsiderTeacher, 'GET', classPath)).status, 404);
    assert.equal((await api(student, 'GET', classPath)).status, 403);
    const foreign = await publishedCourse(outsiderTeacher.id, 'foreign-class-course', 0);
    assert.equal((await api(school, 'PUT', `${classPath}/courses`, { courseIds: [String(foreign._id)] })).body.error.code, 'CLASS_COURSE_NOT_ASSIGNABLE');
    assert.equal((await api(school, 'PUT', `${classPath}/courses`, { courseIds: [String(restricted3._id), String(publicPaid._id)] })).status, 200);
    assert.equal((await api(school, 'PUT', `/classes/${year2.body.data.id}/courses`, { courseIds: [String(restricted2._id)] })).status, 200);

    const added = await api(school, 'POST', `${classPath}/students`, { emails: ['third-year@market.test', 'nobody@market.test', 'class-outsider-teacher@market.test'] });
    assert.deepEqual([added.body.data.added, added.body.data.notFound.sort()], [1, ['class-outsider-teacher@market.test', 'nobody@market.test']]);
    const access = await models.Enrollment.find({ studentId: third.id }).lean();
    assert.deepEqual(access.map(row => [String(row.courseId), row.accessType]).sort(), [[String(publicPaid._id), 'class'], [String(restricted3._id), 'class']].sort());
    const detail = await api(third, 'GET', `/courses/${restricted3._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.chapters[0].lessons[0].textContent, 'Hello', 'class members get the learning view');
    const mine = (await api(third, 'GET', '/classes/mine')).body.data;
    assert.deepEqual([mine.length, mine[0].courses.length], [1, 2]);
    assert.ok((await api(third, 'GET', '/notifications')).body.data.some(item => item.template?.key === 'classJoined'));

    // Join by code: the 2nd-year student only sees 2nd-year material.
    assert.equal((await api(second, 'POST', '/classes/join', { code: 'WRONGCODE' })).body.error.code, 'CLASS_CODE_INVALID');
    assert.equal((await api(second, 'POST', '/classes/join', { code: year2.body.data.joinCode })).status, 200);
    assert.equal((await api(second, 'GET', `/courses/${restricted2._id}`)).status, 200);
    assert.equal((await api(second, 'GET', `/courses/${restricted3._id}`)).status, 404);
    assert.equal((await api(second, 'GET', `/enrollments/${restricted3._id}`)).status, 404);

    // Manager view: per-student progress per assigned course.
    assert.equal((await api(third, 'PUT', `/enrollments/${restricted3._id}/lessons/l1/complete`)).status, 200);
    const managed = (await api(school, 'GET', classPath)).body.data;
    assert.equal(managed.students[0].progress.find(row => row.courseId === String(restricted3._id)).percent, 100);
    assert.equal((await api(school, 'DELETE', classPath)).body.error.code, 'CLASS_NOT_EMPTY');

    // Leaving the class expires access but keeps progress; joining again restores it.
    assert.equal((await api(school, 'DELETE', `${classPath}/students/${third.id}`)).status, 200);
    assert.equal((await api(third, 'GET', `/enrollments/${restricted3._id}`)).status, 404);
    assert.equal((await api(third, 'GET', `/courses/${restricted3._id}`)).status, 404);
    assert.equal((await api(third, 'POST', '/classes/join', { code: year3.body.data.joinCode })).status, 200);
    const restored = await api(third, 'GET', `/enrollments/${restricted3._id}`);
    assert.deepEqual(restored.body.data.completedLessonIds, ['l1']);
    assert.equal((await api(school, 'PATCH', classPath, { archived: true })).body.data.archived, true);
    assert.equal((await api(third, 'GET', `/courses/${restricted3._id}`)).status, 404);
    assert.equal((await api(school, 'PATCH', `/courses/${publicPaid._id}`, { visibility: 'restricted' })).status, 200);
  });

  test('offline payments: student requests, admin records cash or cheque with a scan, and desk registrations', async () => {
    const buyer = await createUser('Cheque Buyer', 'cheque-buyer@market.test', 'student');
    const deskBuyer = await createUser('Desk Buyer', 'desk-buyer@market.test', 'student');
    const course = await publishedCourse(teacher.id, 'offline-course', 60);
    const other = await publishedCourse(teacher.id, 'offline-other-course', 30);
    const config = (await api(null, 'GET', '/payments/config')).body.data;
    assert.equal(config.offline.enabled, true);

    const request = await api(buyer, 'POST', '/payments/offline-requests', { courseIds: [String(course._id)], method: 'cheque' });
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const orderId = request.body.data.order.id;
    assert.deepEqual([request.body.data.order.status, request.body.data.order.provider, request.body.data.order.paymentMethod, request.body.data.order.totalAmount], ['pending', 'offline', 'cheque', 6000]);
    assert.equal(await models.Enrollment.exists({ studentId: buyer.id, courseId: course._id }), null);
    const cancelled = await api(buyer, 'POST', '/payments/offline-requests', { courseIds: [String(other._id)] });
    assert.equal((await api(otherStudent, 'POST', `/payments/orders/${cancelled.body.data.order.id}/cancel`)).status, 404);
    assert.equal((await api(buyer, 'POST', `/payments/orders/${cancelled.body.data.order.id}/cancel`)).body.data.status, 'failed');

    const multipart = (payload, proof) => {
      const form = new FormData();
      form.set('payload', JSON.stringify(payload));
      if (proof) form.set('proof', new Blob([proof.bytes], { type: proof.type }), proof.name);
      return form;
    };
    const send = (actor, path, form) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { Cookie: actor.cookie }, body: form }).then(async response => ({ status: response.status, body: await response.json() }));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    assert.equal((await send(moderator, `/admin/payments/orders/${orderId}/offline-payment`, multipart({ method: 'cash' }))).status, 403);
    assert.equal((await send(admin, `/admin/payments/orders/${orderId}/offline-payment`, multipart({ method: 'cheque' }))).status, 400, 'a cheque needs its number');
    assert.equal((await send(admin, `/admin/payments/orders/${orderId}/offline-payment`, multipart({ method: 'cheque', reference: 'CHQ-1' }, { bytes: Buffer.from('not an image'), type: 'image/png', name: 'fake.png' }))).body.error.code, 'INVALID_PAYMENT_PROOF_CONTENT');
    const recorded = await send(admin, `/admin/payments/orders/${orderId}/offline-payment`, multipart({ method: 'cheque', reference: 'CHQ-0042117', bankName: 'BIAT', payerName: 'Cheque Buyer', receivedAt: new Date().toISOString() }, { bytes: png, type: 'image/png', name: 'cheque.png' }));
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
    assert.deepEqual([recorded.body.data.status, recorded.body.data.paymentMethod, recorded.body.data.offlinePayment.reference, recorded.body.data.offlinePayment.hasProof, recorded.body.data.offlinePayment.recordedBy], ['paid', 'cheque', 'CHQ-0042117', true, 'Admin']);
    assert.match(recorded.body.data.invoiceNumber, /^INV-\d{4}-\d{6}$/);
    assert.equal((await models.Enrollment.findOne({ studentId: buyer.id, courseId: course._id }).lean()).accessType, 'purchase');
    assert.equal((await models.LedgerEntry.findOne({ orderId, type: 'sale' }).lean()).amount, 4800);
    assert.equal((await send(admin, `/admin/payments/orders/${orderId}/offline-payment`, multipart({ method: 'cash' }))).body.error.code, 'ORDER_NOT_PAYABLE_OFFLINE');
    const proof = await fetch(`${baseUrl}/payments/orders/${orderId}/offline-proof`, { headers: { Cookie: buyer.cookie } });
    assert.deepEqual([proof.status, proof.headers.get('content-type')], [200, 'image/png']);
    assert.equal(Buffer.from(await proof.arrayBuffer()).length, png.length);
    assert.equal((await fetch(`${baseUrl}/payments/orders/${orderId}/offline-proof`, { headers: { Cookie: otherStudent.cookie } })).status, 404);
    assert.equal((await api(buyer, 'GET', `/payments/orders/${orderId}/invoice`)).body.data.paymentMethod, 'cheque');

    // Desk registration: created and paid in one step, cash without a scan.
    const desk = await send(admin, '/admin/payments/offline', multipart({ target: { studentEmail: 'desk-buyer@market.test', courseIds: [String(other._id)] }, payment: { method: 'cash', note: 'Paid at the front desk' } }));
    assert.equal(desk.status, 201, JSON.stringify(desk.body));
    assert.deepEqual([desk.body.data.status, desk.body.data.paymentMethod, desk.body.data.offlinePayment.hasProof], ['paid', 'cash', false]);
    assert.equal((await send(admin, '/admin/payments/offline', multipart({ target: { studentEmail: 'desk-buyer@market.test', courseIds: [String(other._id)] }, payment: { method: 'cash' } }))).body.error.code, 'ALREADY_ENROLLED');
    const listed = await api(admin, 'GET', '/admin/payments/orders?provider=offline&status=paid');
    assert.ok(listed.body.data.every(order => order.provider === 'offline') && listed.body.data.length >= 2);

    // Offline refunds need no provider; access is revoked.
    assert.equal((await api(admin, 'POST', `/admin/payments/orders/${desk.body.data.id}/refund`, { reason: 'Cash returned at the desk' })).body.data.status, 'refunded');
    assert.equal(await models.Enrollment.exists({ studentId: deskBuyer.id, courseId: other._id }), null);

    assert.equal((await api(admin, 'PATCH', '/admin/settings', { offlinePayments: { enabled: false } })).status, 200);
    assert.equal((await api(buyer, 'POST', '/payments/offline-requests', { courseIds: [String(other._id)] })).body.error.code, 'OFFLINE_PAYMENTS_DISABLED');
    assert.equal((await api(admin, 'PATCH', '/admin/settings', { offlinePayments: { enabled: true, instructions: 'Accueil, bureau 2' } })).body.data.offlinePayments.instructions, 'Accueil, bureau 2');
  });

  test('teachers pair several Google Drive / OneDrive accounts, uploads move to the next account when one is full', async t => {
    const realFetch = globalThis.fetch;
    const calls = [];
    const driveFiles = new Map();
    let msItem = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input), method = init.method || 'GET';
      if (url.startsWith(baseUrl)) return realFetch(input, init);
      calls.push(`${method} ${url.split('?')[0]}`);
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init.body));
        return Response.json({ access_token: 'g-access', expires_in: 3600, ...(body.get('code') ? { refresh_token: `g-refresh-${body.get('code')}` } : {}) });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
        return Response.json(url.includes('storageQuota') ? { storageQuota: { limit: '16106127360', usage: '16104030208' } } : { user: { emailAddress: 'Teacher.Drive@gmail.com', displayName: 'Teacher Drive' } });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files') && method === 'POST') return Response.json({ id: 'g-folder' });
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) throw new Error('A full Google Drive must not receive uploads');
      if (url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/token')) {
        const body = new URLSearchParams(String(init.body));
        return Response.json({ access_token: 'ms-access', refresh_token: `ms-refresh-${body.get('code') || 'rotated'}` });
      }
      if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return Response.json({ mail: 'teacher@outlook.com', displayName: 'Teacher OneDrive' });
      if (url === 'https://graph.microsoft.com/v1.0/me/drive/root:/EduMarket') return new Response('{}', { status: 404 });
      if (url === 'https://graph.microsoft.com/v1.0/me/drive/root/children') return Response.json({ id: 'ms-folder' });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me/drive?')) return Response.json({ quota: { total: 1099511627776, used: 1024 } });
      if (url.includes(':/createUploadSession')) return Response.json({ uploadUrl: 'https://upload.onedrive.test/session-1' });
      if (url === 'https://upload.onedrive.test/session-1') {
        msItem += 1;
        driveFiles.set(`ms-item-${msItem}`, Buffer.from(init.body));
        return Response.json({ id: `ms-item-${msItem}`, webUrl: `https://onedrive.test/ms-item-${msItem}` }, { status: 201 });
      }
      const content = url.match(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/drive\/items\/([^/]+)\/content$/);
      if (content) return new Response(driveFiles.get(decodeURIComponent(content[1])), { status: 200, headers: { 'content-length': String(driveFiles.get(decodeURIComponent(content[1])).length) } });
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 });
      return new Response('unexpected', { status: 500 });
    };
    t.after(() => { globalThis.fetch = realFetch; });

    const owner = await createUser('Drive Teacher', 'drive-teacher@market.test', 'teacher');
    const learner = await createUser('Drive Learner', 'drive-learner@market.test', 'student');
    assert.deepEqual((await api(owner, 'GET', '/storage/providers')).body.data.map(item => item.configured), [true, true]);
    assert.equal((await api(learner, 'GET', '/storage/accounts')).status, 403);
    const connect = async (provider, code) => {
      const started = await api(owner, 'POST', '/storage/accounts/connect', { provider });
      const state = new URL(started.body.data.authorizationUrl).searchParams.get('state');
      const callback = await realFetch(`${baseUrl}/storage/oauth/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
      return new URL(callback.headers.get('location')).searchParams.get('storage');
    };
    assert.equal(await connect('google_drive', 'g-code'), 'connected');
    assert.equal(await connect('onedrive', 'ms-code'), 'connected');
    const forged = await realFetch(`${baseUrl}/storage/oauth/onedrive/callback?code=x&state=forged`, { redirect: 'manual' });
    assert.equal(new URL(forged.headers.get('location')).searchParams.get('storage'), 'error');
    let accounts = (await api(owner, 'GET', '/storage/accounts')).body.data;
    assert.deepEqual(accounts.map(account => [account.provider, account.accountEmail, account.isDefault]), [['google_drive', 'teacher.drive@gmail.com', true], ['onedrive', 'teacher@outlook.com', false]]);
    assert.equal(JSON.stringify(accounts).includes('refresh'), false);
    assert.ok(accounts[0].quota.free < 5 * 1024 * 1024, 'the Google Drive is almost full');

    // Upload: the default (full) Google Drive is skipped automatically and OneDrive receives the file.
    const course = await publishedCourse(owner.id, 'drive-course', 0);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 65)]);
    const form = new FormData();
    form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'syllabus.pdf');
    const uploaded = await realFetch(`${baseUrl}/courses/${course._id}/lessons/l1/assets/resources`, { method: 'POST', headers: { Cookie: owner.cookie }, body: form });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const asset = await (await import('../dist/modules/courses/assets.model.js')).CourseAsset.findById((await uploaded.json()).data.id).lean();
    assert.deepEqual([asset.storage.provider, asset.storage.fileId, asset.storageKey], ['onedrive', 'ms-item-1', undefined]);
    assert.equal(calls.some(call => call.startsWith('POST https://www.googleapis.com/upload')), false);

    // Learners download through the API (access check first); the drive is never exposed.
    assert.equal((await realFetch(`${baseUrl}/courses/${course._id}/assets/${asset._id}`, { headers: { Cookie: learner.cookie } })).status, 404);
    assert.equal((await api(learner, 'POST', '/enrollments', { courseId: String(course._id) })).status, 201);
    const download = await realFetch(`${baseUrl}/courses/${course._id}/assets/${asset._id}`, { headers: { Cookie: learner.cookie } });
    assert.equal(download.status, 200);
    assert.ok(Buffer.from(await download.arrayBuffer()).equals(pdf));

    // Switch the default account, then disconnecting rules.
    const onedrive = accounts.find(account => account.provider === 'onedrive');
    assert.equal((await api(owner, 'PATCH', `/storage/accounts/${onedrive.id}`, { isDefault: true })).body.data.isDefault, true);
    accounts = (await api(owner, 'GET', '/storage/accounts')).body.data;
    assert.deepEqual(accounts.map(account => [account.provider, account.isDefault, account.platformFiles]), [['onedrive', true, 1], ['google_drive', false, 0]]);
    assert.equal((await api(owner, 'DELETE', `/storage/accounts/${onedrive.id}`)).body.error.code, 'STORAGE_ACCOUNT_IN_USE');
    assert.equal((await api(owner, 'DELETE', `/storage/accounts/${accounts[1].id}`)).status, 204);

    // Grade sheet: CSV download, or saved on the default drive.
    assert.equal((await api(owner, 'PUT', `/enrollments/${course._id}/lessons/l1/complete`)).status, 403, 'teachers do not learn their own course');
    const csv = await realFetch(`${baseUrl}/storage/exports/grades`, { method: 'POST', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: String(course._id) }) });
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="grades-/);
    assert.match(await csv.text(), /Drive Learner,drive-learner@market\.test,0/);
    const exported = await api(owner, 'POST', '/storage/exports/grades', { courseId: String(course._id), destination: 'default' });
    assert.deepEqual([exported.status, exported.body.data.provider, exported.body.data.webUrl], [201, 'onedrive', 'https://onedrive.test/ms-item-2']);
    assert.equal((await api(teacher, 'POST', '/storage/exports/grades', { courseId: String(course._id) })).status, 404);
  });
});
