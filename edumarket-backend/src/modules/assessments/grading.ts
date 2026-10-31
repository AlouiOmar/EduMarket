import crypto from 'node:crypto';

/** Pure assessment logic: question draws, shuffling, automatic grading, rubric scores. */
export type QuestionType = 'single' | 'multiple' | 'true_false' | 'short' | 'essay';
export interface QuestionLike { _id?: unknown; questionId?: string; type: QuestionType; options?: { id: string; text: string }[]; correct?: string[]; caseSensitive?: boolean; points?: number; chapter?: string; difficulty?: string }
export interface AnswerLike { questionId: string; optionIds?: string[]; text?: string }

/** Fisher–Yates with a cryptographic source (draws must not be predictable by students). */
export function shuffle<T>(items: T[], random: (max: number) => number = max => crypto.randomInt(max)): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** Draws `count` distinct questions matching the filters; refuses when the bank does not have enough. */
export function drawQuestions<T extends QuestionLike>(pool: T[], count: number, filters: { chapter?: string; difficulty?: string } = {}, random?: (max: number) => number) {
  const eligible = pool.filter(question => (!filters.chapter || question.chapter === filters.chapter) && (!filters.difficulty || question.difficulty === filters.difficulty));
  if (eligible.length < count) throw Object.assign(new Error('NOT_ENOUGH_QUESTIONS'), { code: 'NOT_ENOUGH_QUESTIONS', available: eligible.length });
  return shuffle(eligible, random).slice(0, count);
}

const normalize = (value: string, caseSensitive: boolean) => {
  const trimmed = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  return caseSensitive ? trimmed : trimmed.toLocaleLowerCase();
};

/**
 * Automatic score of one answer, or null when the question needs manual grading (essay).
 * single / true_false: all or nothing. multiple: all or nothing (exact set) — partial credit is not given, so guessing every
 * option never earns points. short: exact match after trimming/space normalization (case-insensitive unless configured).
 */
export function autoScore(question: QuestionLike, answer: AnswerLike | undefined): number | null {
  const points = question.points ?? 1;
  if (question.type === 'essay') return null;
  if (!answer) return 0;
  const correct = question.correct || [];
  if (question.type === 'short') {
    const given = normalize(answer.text || '', !!question.caseSensitive);
    return given && correct.some(candidate => normalize(candidate, !!question.caseSensitive) === given) ? points : 0;
  }
  const selected = [...new Set(answer.optionIds || [])].sort();
  const expected = [...new Set(correct)].sort();
  return selected.length === expected.length && selected.every((value, index) => value === expected[index]) ? points : 0;
}

/** Total of an attempt once every essay has a manual score; null while grading is incomplete. */
export function attemptTotal(questions: QuestionLike[], autoScores: { questionId: string; score: number | null }[], manual: { questionId: string; score?: number | null }[]) {
  let total = 0;
  for (const question of questions) {
    const id = question.questionId!;
    if (question.type === 'essay') {
      const graded = manual.find(entry => entry.questionId === id);
      if (graded?.score === undefined || graded.score === null) return null;
      total += graded.score;
    } else total += autoScores.find(entry => entry.questionId === id)?.score ?? 0;
  }
  return Math.round(total * 100) / 100;
}

export interface RubricLike { criteria: { id: string; levels: { id: string; points: number }[] }[] }
export const rubricMax = (rubric: RubricLike) => rubric.criteria.reduce((sum, criterion) => sum + Math.max(0, ...criterion.levels.map(level => level.points)), 0);

/** Rubric score scaled to the assignment's points (2 decimals). Every criterion must be rated exactly once. */
export function rubricScore(rubric: RubricLike, ratings: { criterionId: string; levelId: string }[], points: number) {
  const max = rubricMax(rubric);
  if (max <= 0) throw Object.assign(new Error('INVALID_RUBRIC'), { code: 'INVALID_RUBRIC' });
  let total = 0;
  for (const criterion of rubric.criteria) {
    const rating = ratings.filter(entry => entry.criterionId === criterion.id);
    if (rating.length !== 1) throw Object.assign(new Error('RUBRIC_INCOMPLETE'), { code: 'RUBRIC_INCOMPLETE' });
    const level = criterion.levels.find(candidate => candidate.id === rating[0].levelId);
    if (!level) throw Object.assign(new Error('RUBRIC_INCOMPLETE'), { code: 'RUBRIC_INCOMPLETE' });
    total += level.points;
  }
  if (ratings.some(entry => !rubric.criteria.some(criterion => criterion.id === entry.criterionId))) throw Object.assign(new Error('RUBRIC_INCOMPLETE'), { code: 'RUBRIC_INCOMPLETE' });
  return { raw: total, max, score: Math.round(total / max * points * 100) / 100 };
}

/** Grade kept for the gradebook among graded attempts. */
export function keptScore(attempts: { score: number | null; status: string; submittedAt?: Date | string | null }[], policy: 'best' | 'last') {
  const graded = attempts.filter(attempt => attempt.status === 'graded' && attempt.score !== null);
  if (!graded.length) return null;
  if (policy === 'last') return graded.sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime())[0].score;
  return Math.max(...graded.map(attempt => attempt.score as number));
}
