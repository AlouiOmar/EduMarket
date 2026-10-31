import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';
const { contentHash, linkByPosition, diffTemplate } = await import('../dist/modules/courses/templates.js');
const { cloneContainer } = await import('../dist/modules/courses/structure.js');

const item = (id, title, html) => ({ id, chapterId: 'c', title, type: 'text', visibility: 'hidden', blocks: [{ id: `b-${id}`, type: 'text', html }] });

describe('template diff', () => {
  test('hash ignores block ids (copies get fresh ids) but sees content changes', () => {
    assert.equal(contentHash(item('a', 'T', '<p>x</p>')), contentHash({ ...item('a', 'T', '<p>x</p>'), blocks: [{ id: 'other', type: 'text', html: '<p>x</p>' }] }));
    assert.notEqual(contentHash(item('a', 'T', '<p>x</p>')), contentHash(item('a', 'T', '<p>y</p>')));
  });

  test('statuses: unchanged, template changed, locally modified, conflict, added, removed', () => {
    const template = [{ id: 'c1', title: 'M', lessons: [item('t1', 'A', '1'), item('t2', 'B', '1'), item('t3', 'C', '1'), item('t4', 'D', '1')] }];
    const instance = [cloneContainer(template[0])];
    const link = { templateId: 'tpl', syncedAt: new Date(), items: linkByPosition(template, instance) };
    template[0].lessons[1] = item('t2', 'B', 'template edit');
    instance[0].lessons[2] = { ...instance[0].lessons[2], blocks: [{ id: 'z', type: 'text', html: 'local edit' }] };
    template[0].lessons[3] = item('t4', 'D', 'template edit');
    instance[0].lessons[3] = { ...instance[0].lessons[3], blocks: [{ id: 'z', type: 'text', html: 'local edit' }] };
    template[0].lessons.push(item('t5', 'E', 'new'));
    const removed = instance[0].lessons.shift();
    const rows = Object.fromEntries(diffTemplate(template, instance, link).map(row => [row.title, row.status]));
    assert.deepEqual(rows, { A: 'removed_locally', B: 'template_changed', C: 'locally_modified', D: 'conflict', E: 'added_in_template' });
    assert.ok(removed);
  });
});
