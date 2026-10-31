import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';
const { randomGroups } = await import('../dist/modules/participation/service.js');

describe('random groups', () => {
  test('every student is placed exactly once, sizes differ by one at most', () => {
    const students = Array.from({ length: 11 }, (_, index) => `s${index}`);
    const groups = randomGroups(students, 4);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.flat().sort(), [...students].sort());
    const sizes = groups.map(group => group.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.ok(Math.max(...sizes) <= 4);
  });
  test('no students: one empty group; size larger than the class: one group', () => {
    assert.deepEqual(randomGroups([], 3), [[]]);
    assert.equal(randomGroups(['a', 'b'], 10).length, 1);
  });
});
