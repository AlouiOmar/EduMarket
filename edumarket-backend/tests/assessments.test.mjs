import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { shuffle, drawQuestions, autoScore, attemptTotal, rubricScore, rubricMax, keptScore } = await import('../dist/modules/assessments/grading.js');

const bank = [
  { _id: 'q1', type: 'single', chapter: 'signals', difficulty: 'easy', points: 1 },
  { _id: 'q2', type: 'single', chapter: 'signals', difficulty: 'hard', points: 1 },
  { _id: 'q3', type: 'single', chapter: 'routing', difficulty: 'easy', points: 1 },
  { _id: 'q4', type: 'single', chapter: 'signals', difficulty: 'easy', points: 1 },
];

describe('question draws', () => {
  test('draws distinct questions honoring chapter and difficulty filters', () => {
    for (let run = 0; run < 20; run += 1) {
      const drawn = drawQuestions(bank, 2, { chapter: 'signals', difficulty: 'easy' });
      assert.deepEqual(drawn.map(question => question._id).sort(), ['q1', 'q4']);
    }
    const any = drawQuestions(bank, 3);
    assert.equal(new Set(any.map(question => question._id)).size, 3);
  });

  test('refuses when the bank has not enough matching questions', () => {
    assert.throws(() => drawQuestions(bank, 2, { chapter: 'routing' }), error => error.code === 'NOT_ENOUGH_QUESTIONS' && error.available === 1);
  });

  test('shuffle keeps every element and does not mutate the source', () => {
    const source = [1, 2, 3, 4, 5];
    const result = shuffle(source, max => max - 1);
    assert.deepEqual([...result].sort(), source);
    assert.deepEqual(source, [1, 2, 3, 4, 5]);
  });
});

describe('automatic grading', () => {
  test('single, true/false and multiple are all-or-nothing', () => {
    assert.equal(autoScore({ type: 'single', correct: ['b'], points: 2 }, { questionId: 'x', optionIds: ['b'] }), 2);
    assert.equal(autoScore({ type: 'single', correct: ['b'], points: 2 }, { questionId: 'x', optionIds: ['a'] }), 0);
    assert.equal(autoScore({ type: 'true_false', correct: ['false'], points: 1 }, { questionId: 'x', optionIds: ['false'] }), 1);
    assert.equal(autoScore({ type: 'multiple', correct: ['a', 'c'], points: 3 }, { questionId: 'x', optionIds: ['c', 'a'] }), 3);
    assert.equal(autoScore({ type: 'multiple', correct: ['a', 'c'], points: 3 }, { questionId: 'x', optionIds: ['a', 'b', 'c'] }), 0, 'selecting everything earns nothing');
    assert.equal(autoScore({ type: 'single', correct: ['b'], points: 2 }, undefined), 0, 'unanswered');
  });

  test('short answers: trimmed, spaces normalized, case-insensitive unless configured', () => {
    const question = { type: 'short', correct: ['signal()', 'computed'], points: 1 };
    assert.equal(autoScore(question, { questionId: 'x', text: '  Signal() ' }), 1);
    assert.equal(autoScore({ ...question, caseSensitive: true }, { questionId: 'x', text: 'Signal()' }), 0);
    assert.equal(autoScore(question, { questionId: 'x', text: '' }), 0);
  });

  test('essays need a manual score before the attempt has a total', () => {
    const questions = [{ questionId: 'a', type: 'single', points: 2 }, { questionId: 'e', type: 'essay', points: 5 }];
    assert.equal(autoScore({ type: 'essay', points: 5 }, { questionId: 'e', text: 'x' }), null);
    assert.equal(attemptTotal(questions, [{ questionId: 'a', score: 2 }], []), null);
    assert.equal(attemptTotal(questions, [{ questionId: 'a', score: 2 }], [{ questionId: 'e', score: 3.5 }]), 5.5);
  });

  test('kept grade: best or last graded attempt, ignoring ungraded ones', () => {
    const attempts = [
      { score: 12, status: 'graded', submittedAt: '2026-11-01' }, { score: 8, status: 'graded', submittedAt: '2026-11-03' }, { score: null, status: 'needs_grading', submittedAt: '2026-11-04' },
    ];
    assert.equal(keptScore(attempts, 'best'), 12);
    assert.equal(keptScore(attempts, 'last'), 8);
    assert.equal(keptScore([{ score: null, status: 'needs_grading' }], 'best'), null);
  });
});

describe('rubrics', () => {
  const rubric = { criteria: [
    { id: 'code', levels: [{ id: 'weak', points: 0 }, { id: 'ok', points: 5 }, { id: 'great', points: 10 }] },
    { id: 'tests', levels: [{ id: 'none', points: 0 }, { id: 'some', points: 5 }] },
  ] };
  test('score scaled to the assignment points', () => {
    assert.equal(rubricMax(rubric), 15);
    assert.deepEqual(rubricScore(rubric, [{ criterionId: 'code', levelId: 'great' }, { criterionId: 'tests', levelId: 'some' }], 20), { raw: 15, max: 15, score: 20 });
    assert.equal(rubricScore(rubric, [{ criterionId: 'code', levelId: 'ok' }, { criterionId: 'tests', levelId: 'none' }], 20).score, 6.67);
  });
  test('every criterion rated exactly once with a known level', () => {
    assert.throws(() => rubricScore(rubric, [{ criterionId: 'code', levelId: 'ok' }], 20), error => error.code === 'RUBRIC_INCOMPLETE');
    assert.throws(() => rubricScore(rubric, [{ criterionId: 'code', levelId: 'ok' }, { criterionId: 'tests', levelId: 'bogus' }], 20), error => error.code === 'RUBRIC_INCOMPLETE');
    assert.throws(() => rubricScore(rubric, [{ criterionId: 'code', levelId: 'ok' }, { criterionId: 'code', levelId: 'great' }, { criterionId: 'tests', levelId: 'some' }], 20), error => error.code === 'RUBRIC_INCOMPLETE');
  });
});
