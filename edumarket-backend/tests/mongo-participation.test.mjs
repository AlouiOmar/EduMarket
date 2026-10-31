import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI?.replace(/_test(\?|$)/i, '_part_test$1');
if (mongoUri) {
  const parsed = new URL(mongoUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !/_test$/i.test(parsed.pathname)) throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongoUri;
process.env.JWT_SECRET = 'test-secret-must-contain-more-than-32-characters';
process.env.CORS_ORIGIN = 'http://localhost:3000';

let server, baseUrl, privateUploadDir, User, Course, Enrollment, Notification, ClassGroup, GradeColumn, GradeEntry, AnnouncementDelivery, CourseAnnouncement, LessonActivity, service;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('Participation on MongoDB (groups, discussions, journals, announcements, attendance, analytics)', { skip: !mongoUri }, () => {
  before(async () => {
    privateUploadDir = await mkdtemp(path.join(os.tmpdir(), 'edumarket-part-it-'));
    process.env.PRIVATE_UPLOAD_DIR = privateUploadDir;
    await mongoose.connect(mongoUri);
    await mongoose.connection.dropDatabase();
    const [{ app }, users, courses, enrollments, notifications, classes, grades, participation, activity, participationService] = await Promise.all([
      import('../dist/app.js'), import('../dist/modules/auth/model.js'), import('../dist/modules/courses/model.js'), import('../dist/modules/enrollments/model.js'),
      import('../dist/modules/notifications/model.js'), import('../dist/modules/classes/model.js'), import('../dist/modules/gradebook/models.js'),
      import('../dist/modules/participation/models.js'), import('../dist/modules/enrollments/lesson-activity.model.js'), import('../dist/modules/participation/service.js'),
    ]);
    User = users.User; Course = courses.Course; Enrollment = enrollments.Enrollment; Notification = notifications.Notification; ClassGroup = classes.ClassGroup;
    GradeColumn = grades.GradeColumn; GradeEntry = grades.GradeEntry; AnnouncementDelivery = participation.AnnouncementDelivery; CourseAnnouncement = participation.CourseAnnouncement;
    LessonActivity = activity.LessonActivity; service = participationService;
    await Promise.all([User.init(), Course.init(), Enrollment.init(), AnnouncementDelivery.init(), participation.AttendanceRecord.init()]);
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
    const user = await User.create({ name: `${role} ${email.split('@')[0]}`, email, passwordHash: await bcrypt.hash(password, 10), role, verified: role !== 'student', status: 'active', ...extra });
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    return { user, id: String(user._id), cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const api = who => async (method, url, body, raw = false) => {
    const isForm = body instanceof FormData;
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: who.cookie, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), headers: response.headers };
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  };

  let teacher, a, b, c, stranger, outsider, T, A, B, C, S, O, courseId;
  const base = () => `/participation/${courseId}`;

  test('setup', async () => {
    teacher = await account('teacher', 'part-teacher@example.test');
    a = await account('student', 'amira@example.test', { notificationPreferences: { sessions: true, messages: true, courseActivity: true, email: true } });
    b = await account('student', 'badr@example.test'); c = await account('student', 'chaima@example.test');
    stranger = await account('student', 'stranger@example.test'); outsider = await account('teacher', 'part-outsider@example.test');
    [T, A, B, C, S, O] = [teacher, a, b, c, stranger, outsider].map(api);
    const course = await Course.create({ title: 'Application Côté Client', slug: 'acc-part', description: 'Angular', category: 'Web', teacherId: teacher.user._id, status: 'published',
      chapters: [{ id: 'c1', title: 'Chapitre 1', order: 0, visibility: 'visible', lessons: [{ id: 'l1', chapterId: 'c1', title: 'Signals', type: 'text', durationMinutes: 5, resources: [], commentsCount: 0 }, { id: 'l2', chapterId: 'c1', title: 'Router', type: 'text', durationMinutes: 5, resources: [], commentsCount: 0 }] }] });
    courseId = String(course._id);
    await Enrollment.create([a, b, c].map(student => ({ studentId: student.user._id, courseId, accessType: 'free' })));
  });

  let selfGroups, groupOfA;
  test('groups: random split, self sign-up with capacity, manual assignment checks', async () => {
    const random = await T('POST', `${base()}/group-sets`, { name: 'Binômes', mode: 'random', maxMembers: 2 });
    assert.equal(random.status, 201);
    let data = (await T('GET', `${base()}/groups`)).body.data;
    const randomGroups = data.groups.filter(group => group.setId === random.body.data.id);
    assert.equal(randomGroups.length, 2);
    assert.equal(randomGroups.reduce((sum, group) => sum + group.memberCount, 0), 3, 'every student placed once');

    const self = await T('POST', `${base()}/group-sets`, { name: 'Projets', mode: 'self', maxMembers: 1, groupCount: 2 });
    data = (await A('GET', `${base()}/groups`)).body.data;
    selfGroups = data.groups.filter(group => group.setId === self.body.data.id);
    assert.equal(selfGroups.length, 2);
    assert.equal((await A('POST', `${base()}/groups/${selfGroups[0].id}/join`)).status, 200);
    assert.equal((await B('POST', `${base()}/groups/${selfGroups[0].id}/join`)).body.error.code, 'GROUP_FULL');
    assert.equal((await A('POST', `${base()}/groups/${selfGroups[1].id}/join`)).body.error.code, 'ALREADY_IN_GROUP_SET');
    assert.equal((await S('POST', `${base()}/groups/${selfGroups[1].id}/join`)).status, 404, 'not enrolled');
    groupOfA = selfGroups[0].id;

    const manual = await T('POST', `${base()}/group-sets`, { name: 'Ateliers', mode: 'manual', maxMembers: 5, groupCount: 1 });
    const manualGroup = (await T('GET', `${base()}/groups`)).body.data.groups.find(group => group.setId === manual.body.data.id);
    assert.equal((await T('PUT', `${base()}/groups/${manualGroup.id}/members`, { memberIds: [stranger.id] })).status, 422);
    assert.equal((await T('PUT', `${base()}/groups/${manualGroup.id}/members`, { memberIds: [b.id, c.id] })).status, 200);
    const viewB = (await B('GET', `${base()}/groups`)).body.data;
    assert.ok(viewB.groups.filter(group => !group.mine).every(group => group.members.length === 0), 'other groups do not expose member names');
    assert.equal(viewB.students, undefined);
  });

  test('group space: files shared with members only, type checked', async () => {
    const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'schema.png');
    const uploaded = await A('POST', `${base()}/groups/${groupOfA}/files`, form);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const bad = new FormData(); bad.append('file', new Blob([Buffer.from('MZ fake exe')], { type: 'application/octet-stream' }), 'virus.exe');
    assert.equal((await A('POST', `${base()}/groups/${groupOfA}/files`, bad)).status, 415);
    assert.equal((await B('GET', `${base()}/groups/${groupOfA}/files`)).status, 404, 'not a member');
    assert.equal((await B('GET', `${base()}/groups/${groupOfA}/files/${uploaded.body.data.id}`, undefined, true)).status, 404);
    const list = (await T('GET', `${base()}/groups/${groupOfA}/files`)).body.data;
    assert.equal(list.length, 1);
    const download = await A('GET', `${base()}/groups/${groupOfA}/files/${uploaded.body.data.id}`, undefined, true);
    assert.equal(download.status, 200);
    assert.ok(download.buffer.equals(PNG));
  });

  test('discussions: group visibility, moderation, closing and grading', async () => {
    const courseWide = await T('POST', `${base()}/discussions`, { title: 'Questions sur les signals', prompt: '<p>Posez vos questions</p><script>x</script>', graded: true, points: 5 });
    assert.equal(courseWide.status, 201);
    assert.doesNotMatch(courseWide.body.data.prompt, /script/);
    const groupOnly = await T('POST', `${base()}/discussions`, { title: 'Projet groupe 1', groupId: groupOfA });
    assert.equal((await B('GET', `${base()}/discussions`)).body.data.some(discussion => discussion.id === groupOnly.body.data.id), false);
    assert.equal((await B('GET', `${base()}/discussions/${groupOnly.body.data.id}/posts`)).status, 404, 'direct URL refused');
    assert.equal((await A('GET', `${base()}/discussions/${groupOnly.body.data.id}/posts`)).status, 200);

    const discussionId = courseWide.body.data.id;
    const post = await B('POST', `${base()}/discussions/${discussionId}/posts`, { body: 'Pourquoi computed() ?' });
    assert.equal(post.status, 201);
    const reply = await A('POST', `${base()}/discussions/${discussionId}/posts`, { body: 'Pour dériver une valeur', parentId: post.body.data.id });
    assert.equal(reply.status, 201);
    assert.equal((await A('PATCH', `${base()}/discussions/${discussionId}/posts/${post.body.data.id}`, { status: 'hidden' })).status, 403, 'students cannot moderate');
    assert.equal((await A('PATCH', `${base()}/discussions/${discussionId}/posts/${post.body.data.id}`, { body: 'piraté' })).status, 403, 'cannot edit others');
    assert.equal((await T('PATCH', `${base()}/discussions/${discussionId}/posts/${reply.body.data.id}`, { status: 'hidden', moderationNote: 'Hors sujet' })).status, 200);
    const seenByB = (await B('GET', `${base()}/discussions/${discussionId}/posts`)).body.data.posts;
    assert.deepEqual(seenByB.map(row => row.id), [post.body.data.id], 'hidden post invisible to students');
    assert.equal(seenByB[0].status, undefined);
    assert.equal((await T('GET', `${base()}/discussions/${discussionId}/posts`)).body.data.posts.find(row => row.id === reply.body.data.id).moderationNote, 'Hors sujet');
    await T('PATCH', `${base()}/discussions/${discussionId}`, { status: 'closed', pinned: true });
    assert.equal((await C('POST', `${base()}/discussions/${discussionId}/posts`, { body: 'Trop tard' })).status, 409);

    const participants = (await T('GET', `${base()}/discussions/${discussionId}/participants`)).body.data;
    assert.equal(participants.find(row => row.studentId === b.id).posts, 1);
    assert.equal((await T('POST', `${base()}/discussions/${discussionId}/grades`, { studentId: b.id, score: 6 })).status, 400);
    assert.equal((await T('POST', `${base()}/discussions/${discussionId}/grades`, { studentId: b.id, score: 4, feedback: 'Bonne question' })).status, 200);
    const column = await GradeColumn.findOne({ courseId, 'source.kind': 'discussion' }).lean();
    const entry = await GradeEntry.findOne({ columnId: column._id, studentId: b.user._id }).lean();
    assert.equal(entry.score, 4); assert.equal(entry.status, 'graded');
  });

  test('journals: entries are private to their author and the teachers', async () => {
    const journal = await T('POST', `${base()}/journals`, { title: 'Journal de bord', instructions: 'Une entrée par séance', graded: true, points: 10 });
    const journalId = journal.body.data.id;
    assert.equal((await A('POST', `${base()}/journals/${journalId}/entries`, { body: 'Séance 1 : signals compris' })).status, 201);
    const entryB = await B('POST', `${base()}/journals/${journalId}/entries`, { body: 'Séance 1 : difficultés avec effect()' });
    assert.equal(entryB.status, 201);
    const asA = (await A('GET', `${base()}/journals/${journalId}/entries`)).body.data.entries;
    assert.deepEqual(asA.map(entry => entry.body), ['Séance 1 : signals compris']);
    const sneaky = (await A('GET', `${base()}/journals/${journalId}/entries?studentId=${b.id}`)).body.data.entries;
    assert.ok(sneaky.every(entry => entry.authorId === a.id), 'the studentId filter is ignored for students');
    assert.equal((await S('GET', `${base()}/journals/${journalId}/entries`)).status, 404);
    assert.equal((await O('GET', `${base()}/journals/${journalId}/entries`)).status, 404);
    const asTeacher = (await T('GET', `${base()}/journals/${journalId}/entries`)).body.data.entries;
    assert.equal(asTeacher.length, 2);
    assert.equal((await A('POST', `${base()}/journal-entries/${entryB.body.data.id}/comments`, { body: 'Je regarde ton journal' })).status, 404);
    assert.equal((await T('POST', `${base()}/journal-entries/${entryB.body.data.id}/comments`, { body: 'Revoyez la section 3' })).status, 201);
    assert.equal((await B('GET', `${base()}/journals/${journalId}/entries`)).body.data.entries[0].comments[0].body, 'Revoyez la section 3');
    assert.equal((await T('POST', `${base()}/journals/${journalId}/grades`, { studentId: b.id, score: 8 })).status, 200);
  });

  test('announcements: immediate, scheduled, targeted; each student notified exactly once', async () => {
    const notifications = async user => Notification.countDocuments({ userId: user.user._id, 'template.key': 'courseAnnouncement' });
    const now = await T('POST', `${base()}/announcements`, { title: 'Bienvenue', body: '<p>Début du cours lundi</p>', sendEmail: true });
    assert.equal(now.status, 201);
    assert.equal(now.body.data.status, 'sent');
    assert.equal(now.body.data.stats.recipients, 3);
    assert.equal(now.body.data.stats.emailsSkipped, 3, 'opt-out or no provider configured: recorded as skipped, never silently lost');
    assert.deepEqual(await Promise.all([a, b, c].map(notifications)), [1, 1, 1]);
    const emailRow = await AnnouncementDelivery.findOne({ announcementId: now.body.data.id, userId: a.user._id, channel: 'email' }).lean();
    assert.equal(emailRow.error, 'EMAIL_PROVIDER_NOT_CONFIGURED');

    const later = await T('POST', `${base()}/announcements`, { title: 'Examen', body: 'Examen le 15', publishAt: new Date(Date.now() + 86_400_000).toISOString() });
    assert.equal(later.body.data.status, 'scheduled');
    assert.equal((await B('GET', `${base()}/announcements`)).body.data.some(row => row.id === later.body.data.id), false, 'not visible before its time');
    assert.equal(await service.deliverDueAnnouncements(new Date()), 0);
    const future = new Date(Date.now() + 2 * 86_400_000);
    const [first, second] = await Promise.all([service.deliverDueAnnouncements(future), service.deliverDueAnnouncements(future)]);
    assert.equal(first + second, 1, 'claimed by a single delivery');
    assert.equal(await service.deliverDueAnnouncements(future), 0, 'idempotent');
    assert.deepEqual(await Promise.all([a, b, c].map(notifications)), [2, 2, 2]);
    assert.equal((await T('PATCH', `${base()}/announcements/${later.body.data.id}`, { title: 'Modifié' })).status, 409, 'sent announcements are history');

    const targeted = await T('POST', `${base()}/announcements`, { title: 'Groupe projet 1', body: 'Rendez-vous', groupIds: [groupOfA] });
    assert.equal(targeted.body.data.stats.recipients, 1);
    assert.deepEqual(await Promise.all([a, b, c].map(notifications)), [3, 2, 2]);
    assert.equal((await B('GET', `${base()}/announcements`)).body.data.some(row => row.id === targeted.body.data.id), false);
    assert.equal((await A('GET', `${base()}/announcements`)).body.data.some(row => row.id === targeted.body.data.id), true);
    assert.equal((await A('POST', `${base()}/announcements`, { title: 'x', body: 'y' })).status, 403);
  });

  test('attendance: per-session records, history and export', async () => {
    const session = await T('POST', `${base()}/attendance/sessions`, { title: 'Séance 1', date: '2026-11-02T08:30:00Z' });
    assert.equal(session.status, 201);
    assert.equal((await T('PUT', `${base()}/attendance/sessions/${session.body.data.id}/records`, { records: [{ studentId: stranger.id, status: 'present' }] })).status, 422);
    assert.equal((await T('PUT', `${base()}/attendance/sessions/${session.body.data.id}/records`, { records: [{ studentId: a.id, status: 'present' }, { studentId: b.id, status: 'late', note: '10 min' }, { studentId: c.id, status: 'absent' }] })).status, 200);
    await T('PUT', `${base()}/attendance/sessions/${session.body.data.id}/records`, { records: [{ studentId: c.id, status: 'excused', note: 'Certificat' }] });
    const own = (await B('GET', `${base()}/attendance`)).body.data;
    assert.deepEqual(own.records.map(record => record.status), ['late']);
    assert.equal(own.students, undefined);
    const book = (await T('GET', `${base()}/attendance`)).body.data;
    assert.equal(book.students.find(student => student.id === c.id).stats.excused, 1);
    const csv = await T('GET', `${base()}/attendance/export?format=csv`, undefined, true);
    assert.match(csv.buffer.toString('utf8'), /Séance 1 \(2026-11-02\)/);
    assert.match(csv.buffer.toString('utf8'), /late/);
    assert.equal((await T('GET', `${base()}/attendance/export?format=xlsx`, undefined, true)).status, 200);
    assert.equal((await A('GET', `${base()}/attendance/export?format=csv`)).status, 403);
  });

  test('analytics: real activity, inactive students, class and period filters, permissions', async () => {
    await Enrollment.updateOne({ studentId: a.user._id, courseId }, { $set: { completedLessonIds: ['l1'], lastAccessedAt: new Date() } });
    await LessonActivity.create({ studentId: a.user._id, courseId, lessonId: 'l1', completedAt: new Date() });
    await Enrollment.updateOne({ studentId: c.user._id, courseId }, { $set: { lastAccessedAt: new Date(Date.now() - 60 * 86_400_000) } });
    const report = (await T('GET', `/analytics/courses/${courseId}?inactiveDays=14`)).body.data;
    assert.equal(report.totals.students, 3);
    const rowA = report.students.find(student => student.studentId === a.id), rowC = report.students.find(student => student.studentId === c.id);
    assert.equal(rowA.progress, 50);
    assert.equal(rowA.activity.lessons, 1);
    assert.equal(rowC.inactive, true);
    assert.equal(rowA.inactive, false);
    assert.equal(report.authoring.items, 2);
    assert.ok(report.assessments.some(column => column.kind === 'discussion' && column.graded === 1 && column.averagePercent === 80));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString(), longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const old = (await T('GET', `/analytics/courses/${courseId}?from=${longAgo}&to=${new Date(Date.now() - 300 * 86_400_000).toISOString()}`)).body.data;
    assert.equal(old.totals.activeInPeriod, 0, 'period filter');
    const recent = (await T('GET', `/analytics/courses/${courseId}?from=${yesterday}`)).body.data;
    assert.ok(recent.totals.activeInPeriod >= 1);
    const group = await ClassGroup.create({ ownerId: teacher.user._id, ownerRole: 'teacher', name: 'Classe A', studentIds: [a.user._id], courseIds: [courseId], joinCode: 'CLASSA01' });
    const filtered = (await T('GET', `/analytics/courses/${courseId}?classId=${group._id}`)).body.data;
    assert.deepEqual(filtered.students.map(student => student.studentId), [a.id]);
    assert.equal((await A('GET', `/analytics/courses/${courseId}`)).status, 403);
    assert.equal((await O('GET', `/analytics/courses/${courseId}`)).status, 404);
  });

  test('outsiders and strangers are refused everywhere', async () => {
    for (const path of ['/groups', '/discussions', '/journals', '/announcements', '/attendance']) {
      assert.equal((await S('GET', `${base()}${path}`)).status, 404, `stranger ${path}`);
      assert.equal((await O('GET', `${base()}${path}`)).status, 404, `outsider ${path}`);
    }
    assert.equal((await O('POST', `${base()}/announcements`, { title: 'spam', body: 'spam' })).status, 404);
  });
});
