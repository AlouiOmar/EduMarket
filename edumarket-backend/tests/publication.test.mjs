import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';

const { workingCopy, isLive, publicationStatus, quizChanged, contentSnapshot, applyDrafts, sameContent } = await import('../dist/modules/courses/publication.js');
const { zonedLocalToUtc, courseDate, isValidTimeZone } = await import('../dist/common/timezone.js');
const { cloneItem, studentOutline } = await import('../dist/modules/courses/structure.js');
const { toStudentCourse } = await import('../dist/modules/courses/dto.js');

const quiz = (correct = 0) => ({ id: 'quiz_1', title: 'Q', durationMinutes: 5, passPercentage: 50, questions: [{ id: 'q1', question: 'Signal ?', options: ['a', 'b'], correctOptionIndex: correct, explanation: '' }] });
const published = {
  id: 'l1', chapterId: 'c1', title: 'Signals v1', type: 'text', visibility: 'visible', publishedVersion: 1, revision: 3,
  blocks: [{ id: 'b1', type: 'text', html: '<p>v1</p>' }], quiz: quiz(),
};

describe('draft / published lifecycle', () => {
  test('liveness: never-published hidden items are drafts, visible or once-published items are live', () => {
    assert.equal(isLive({ id: 'x', visibility: 'hidden' }), false);
    assert.equal(isLive({ id: 'x', visibility: 'hidden', publishedVersion: 2 }), true);
    assert.equal(isLive({ id: 'x' }), true, 'legacy item without visibility is live');
  });

  test('working copy overlays the draft and can drop the quiz', () => {
    const item = { ...published, draft: { title: 'Signals v2', type: 'text', blocks: [{ id: 'b1', type: 'text', html: '<p>v2</p>' }] } };
    const working = workingCopy(item);
    assert.equal(working.title, 'Signals v2');
    assert.equal(working.blocks[0].html, '<p>v2</p>');
    assert.equal(working.quiz, undefined, 'draft without quiz removes it');
    assert.equal(item.title, 'Signals v1', 'source untouched');
  });

  test('statuses: draft, published, pending changes, scheduled', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    assert.equal(publicationStatus({ id: 'a', visibility: 'hidden' }, now), 'draft');
    assert.equal(publicationStatus(published, now), 'published');
    assert.equal(publicationStatus({ ...published, draft: { title: 'x' } }, now), 'pending_changes');
    assert.equal(publicationStatus({ ...published, draft: { title: 'x' }, scheduledPublishAt: '2026-11-02T08:00:00Z' }, now), 'scheduled');
    assert.equal(publicationStatus({ ...published, availableFrom: '2026-11-03T00:00:00Z' }, now), 'scheduled');
  });

  test('quiz change detection ignores titles, catches answers and pass mark', () => {
    assert.equal(quizChanged(quiz(0), { ...quiz(0), title: 'Renamed' }), false);
    assert.equal(quizChanged(quiz(0), quiz(1)), true);
    assert.equal(quizChanged(quiz(0), { ...quiz(0), passPercentage: 80 }), true);
  });

  test('students never receive drafts or planned publications, even in the learner DTO', () => {
    const item = { ...published, draft: { title: 'Secret v2', blocks: [] }, scheduledPublishAt: new Date(Date.now() + 86_400_000) };
    const course = { _id: 'c', chapters: [{ id: 'c1', title: 'M', visibility: 'visible', lessons: [item] }] };
    const view = toStudentCourse(course, []);
    const lesson = view.chapters[0].lessons[0];
    assert.equal(lesson.title, 'Signals v1');
    assert.equal(lesson.draft, undefined);
    assert.equal(lesson.scheduledPublishAt, undefined);
    assert.doesNotMatch(JSON.stringify(view), /Secret v2/);
    assert.equal(studentOutline(course.chapters)[0].lessons[0].title, 'Signals v1');
  });

  test('draft preview applies drafts; copies start from the working copy without publication history', () => {
    const item = { ...published, draft: { ...contentSnapshot(published), title: 'Signals v2' } };
    assert.equal(applyDrafts([{ id: 'c1', title: 'M', lessons: [item] }])[0].lessons[0].title, 'Signals v2');
    const copy = cloneItem(item, 'c9');
    assert.equal(copy.title, 'Signals v2');
    assert.equal(copy.draft, undefined);
    assert.equal(copy.publishedVersion, undefined);
    assert.equal(copy.visibility, 'hidden');
    assert.equal(item.draft.title, 'Signals v2', 'source keeps its draft');
    assert.ok(sameContent(contentSnapshot(published), contentSnapshot({ ...published, revision: 99 })));
  });
});

describe('course time zone', () => {
  test('local wall-clock times are read in the course zone, DST included', () => {
    assert.equal(zonedLocalToUtc('2026-11-02T08:30', 'Africa/Tunis').toISOString(), '2026-11-02T07:30:00.000Z');
    assert.equal(zonedLocalToUtc('2026-07-01T08:30', 'Europe/Paris').toISOString(), '2026-07-01T06:30:00.000Z');
    assert.equal(zonedLocalToUtc('2026-01-15T08:30', 'Europe/Paris').toISOString(), '2026-01-15T07:30:00.000Z');
    assert.equal(zonedLocalToUtc('2026-03-29T02:30', 'Europe/Paris').toISOString(), '2026-03-29T01:30:00.000Z', 'DST gap shifted forward');
  });

  test('courseDate accepts null, ISO instants and local values; rejects garbage', () => {
    assert.equal(courseDate(undefined, 'Africa/Tunis'), undefined);
    assert.equal(courseDate(null, 'Africa/Tunis'), null);
    assert.equal(courseDate('2026-11-02T08:30:00Z', 'Africa/Tunis').toISOString(), '2026-11-02T08:30:00.000Z');
    assert.equal(courseDate('2026-11-02T08:30', null).toISOString(), '2026-11-02T08:30:00.000Z', 'no zone: UTC, never the server zone');
    assert.throws(() => courseDate('not a date', 'UTC'));
    assert.equal(isValidTimeZone('Africa/Tunis'), true);
    assert.equal(isValidTimeZone('Mars/Base'), false);
  });
});
