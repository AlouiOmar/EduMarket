/**
 * Grade calculation (pure).
 *
 * Rules (documented in docs/gradebook.md):
 * - A missing grade (`null`) is never a zero: it is excluded, unless the column counts missing work as 0 once its due date
 *   (or the student's extended due date) has passed. Excused entries are always excluded.
 * - Category percentage = sum of points / sum of maximum points of its counted entries (points-weighted).
 * - Overall percentage = weighted mean of the category percentages, weights normalized over the categories that have at least
 *   one counted grade. No counted grade at all → null ("—"), never 0.
 * - Out of 20 = overall / 5. Rounding: half away from zero, 2 decimals, applied to displayed values only.
 * - The student view uses published grades only.
 */
export interface CategoryInput { id: string; name: string; weight: number }
export interface ColumnInput { id: string; categoryId: string; maxPoints: number; countsInFinal: boolean; missingAsZero: boolean; dueAt?: Date | string | null }
export interface EntryInput { columnId: string; score?: number | null; excused?: boolean; dueAt?: Date | string | null }

export const round2 = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export function countedScore(column: ColumnInput, entry: EntryInput | undefined, now: Date) {
  if (entry?.excused) return null;
  if (entry && entry.score !== null && entry.score !== undefined) return entry.score;
  const due = entry?.dueAt ?? column.dueAt;
  if (column.missingAsZero && due && new Date(due).getTime() < now.getTime()) return 0;
  return null;
}

export function computeGrades(categories: CategoryInput[], columns: ColumnInput[], entries: EntryInput[], now = new Date()) {
  const byColumn = new Map(entries.map(entry => [entry.columnId, entry]));
  const perCategory = categories.map(category => {
    let points = 0, max = 0, counted = 0;
    for (const column of columns.filter(candidate => candidate.categoryId === category.id && candidate.countsInFinal)) {
      const score = countedScore(column, byColumn.get(column.id), now);
      if (score === null) continue;
      points += score; max += column.maxPoints; counted += 1;
    }
    return { categoryId: category.id, name: category.name, weight: category.weight, counted, percent: max > 0 ? points / max * 100 : null };
  });
  const weighted = perCategory.filter(category => category.percent !== null && category.weight > 0);
  const totalWeight = weighted.reduce((sum, category) => sum + category.weight, 0);
  const percent = totalWeight > 0 ? weighted.reduce((sum, category) => sum + category.weight * category.percent!, 0) / totalWeight : null;
  return {
    categories: perCategory.map(category => ({ ...category, percent: category.percent === null ? null : round2(category.percent) })),
    percent: percent === null ? null : round2(percent),
    outOf20: percent === null ? null : round2(percent / 5),
  };
}
