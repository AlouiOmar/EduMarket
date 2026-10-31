import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

/**
 * Automated WCAG 2.1 A/AA audit (axe-core) of the LMS screens, teacher and student side, in French and in Arabic (RTL).
 * Automated rules cover part of WCAG only: keyboard paths are tested in the other specs; screen-reader use is not automated.
 */
const teacherEmail = unique('a11y-teacher'), studentEmail = unique('a11y-student');
let courseId = '';
const report: Array<{ page: string; rule: string; impact: string; nodes: number; help: string }> = [];

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'A11y Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'A11y Student', studentEmail);
    const course = await seedCourse(db, teacher, 'Cours accessibilité', [
      { id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [
        lesson('l1', 'c1', 'Signals', { publishedVersion: 1, blocks: [{ id: 'b1', type: 'text', html: '<h2>Signals</h2><p>Texte de la leçon</p>' }, { id: 'b2', type: 'math', latex: '\\frac{a}{b}', display: 'block', description: 'a sur b' }] }),
      ] },
    ]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

async function audit(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const violation of results.violations) report.push({ page: name, rule: violation.id, impact: violation.impact || 'unknown', nodes: violation.nodes.length, help: violation.help, targets: violation.nodes.slice(0, 4).map(node => `${node.target.join(' ')} :: ${(node.failureSummary || '').split('\n').slice(1, 2).join('')}`) } as never);
  return results.violations;
}

test.describe.serial('accessibility audit', () => {
  test.setTimeout(240_000);

  test('teacher screens', async ({ page }) => {
    await login(page, teacherEmail);
    const book = await (await page.request.get(`${api}/gradebook/${courseId}`)).json() as { data: { categories: { id: string }[] } };
    await page.request.post(`${api}/gradebook/${courseId}/columns`, { data: { categoryId: book.data.categories[0].id, title: 'Oral', maxPoints: 20 } });
    await page.request.post(`${api}/participation/${courseId}/discussions`, { data: { title: 'Questions' } });
    const violations: unknown[] = [];
    for (const section of ['content', 'content/items/l1', 'gradebook', 'assessments', 'discussions', 'journals', 'announcements', 'attendance', 'groups', 'analytics', 'template', 'files', 'integrations']) {
      await page.goto(`/teacher/courses/${courseId}/${section}`);
      await expect(page.locator('main h1').first()).toBeVisible();
      violations.push(...(await audit(page, `teacher/${section}`)).filter(violation => ['serious', 'critical'].includes(violation.impact || '')));
    }
    expect(violations, JSON.stringify(report, null, 1)).toEqual([]);
  });

  test('student screens', async ({ page }) => {
    await login(page, studentEmail);
    const violations: unknown[] = [];
    for (const path of [`/learning/${courseId}`, ...['grades', 'tests', 'assignments', 'discussions', 'journal', 'announcements', 'groups', 'attendance', 'forms', 'activities'].map(section => `/student/courses/${courseId}/${section}`)]) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      violations.push(...(await audit(page, path.replace(courseId, ':id'))).filter(violation => ['serious', 'critical'].includes(violation.impact || '')));
    }
    expect(violations, JSON.stringify(report, null, 1)).toEqual([]);
  });

  test('Arabic (RTL) rendering of the gradebook and the student grades', async ({ page, browser }) => {
    await page.addInitScript(() => localStorage.setItem('app_language', 'ar'));
    await login(page, teacherEmail);
    await page.goto(`/teacher/courses/${courseId}/gradebook`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'سجل الدرجات' })).toBeVisible();
    const violations = (await audit(page, 'ar/teacher/gradebook')).filter(violation => ['serious', 'critical'].includes(violation.impact || ''));
    const context = await browser.newContext();
    const student = await context.newPage();
    await student.addInitScript(() => localStorage.setItem('app_language', 'ar'));
    await login(student, studentEmail);
    await student.goto(`/student/courses/${courseId}/grades`);
    await expect(student.locator('html')).toHaveAttribute('dir', 'rtl');
    violations.push(...(await audit(student, 'ar/student/grades')).filter(violation => ['serious', 'critical'].includes(violation.impact || '')));
    await context.close();
    expect(violations, JSON.stringify(report, null, 1)).toEqual([]);
  });

  test.afterAll(() => {
    // Every finding (including moderate/minor ones) is printed for the audit report.
    console.log(`AXE REPORT ${JSON.stringify(report)}`);
  });
});
