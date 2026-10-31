import { expect, test } from '@playwright/test';
import { api, enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Formules mathématiques accessibles (MathML) et gestion des fichiers inutilisés (quarantaine, jamais un fichier utilisé).
const teacherEmail = unique('math-teacher'), studentEmail = unique('math-student');
let courseId = '';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Math Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'Math Student', studentEmail);
    const course = await seedCourse(db, teacher, 'Cours formules', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l1', 'c1', 'Suites', { publishedVersion: 1, blocks: [] })] }]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

test('a math block is authored with a live preview and read as MathML by the student', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/content/items/l1`);
  await page.getByRole('button', { name: /Ajouter un bloc/ }).first().click();
  await page.getByRole('menuitem', { name: 'Formule mathématique' }).click();
  await page.getByLabel('Formule (LaTeX)').fill('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}');
  await page.getByLabel('Alternative textuelle').fill('somme des entiers de 1 à n égale n fois n plus 1 sur 2');
  await expect(page.getByLabel('Aperçu de la formule').locator('math')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: /^Enregistré [(]/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Publier les modifications' }).click();
  await expect(page.getByText('Publication effectuée.')).toBeVisible();

  const context = await browser.newContext();
  const student = await context.newPage();
  await login(student, studentEmail);
  await student.goto(`/learning/${courseId}`);
  const formula = student.locator('.katex-host math');
  await expect(formula).toHaveCount(1);
  // MathML structure (what screen readers read); DOMPurify drops the raw LaTeX annotation element.
  await expect(student.locator('.katex-host math mfrac')).toHaveCount(1);
  await expect(student.locator('.katex-host math munderover, .katex-host math msubsup').first()).toBeAttached();
  await expect(student.locator('figcaption').filter({ hasText: 'somme des entiers' })).toHaveCount(1);
  await context.close();
});

test('files: an unused file can be quarantined, a used one cannot', async ({ page }) => {
  await login(page, teacherEmail);
  const upload = async (name: string) => (await (await page.request.post(`${api}/courses/${courseId}/media?kind=image`, { multipart: { file: { name, mimeType: 'image/png', buffer: PNG } } })).json() as { data: { id: string } }).data.id;
  const used = await upload('utilisee.png');
  await upload('oubliee.png');
  const outline = await (await page.request.get(`${api}/courses/mine/${courseId}`)).json() as { data: { chapters: { lessons: { id: string; revision: number }[] }[] } };
  const item = outline.data.chapters[0].lessons[0];
  expect((await page.request.patch(`${api}/courses/${courseId}/structure/items/l1`, { data: { expectedRevision: item.revision, blocks: [{ id: 'img', type: 'image', assetId: used, alt: 'Schéma' }] } })).status()).toBe(200);
  await page.goto(`/teacher/courses/${courseId}/files`);
  const table = page.getByRole('table', { name: 'Fichiers du cours avec leur utilisation' });
  const usedRow = table.getByRole('row', { name: /utilisee\.png/ }), unusedRow = table.getByRole('row', { name: /oubliee\.png/ });
  await expect(usedRow).toContainText('Brouillon');
  await expect(usedRow.getByRole('button', { name: 'Mettre en quarantaine' })).toHaveCount(0);
  await unusedRow.getByRole('button', { name: 'Mettre en quarantaine' }).click();
  await expect(page.getByText('« oubliee.png » est en quarantaine.')).toBeVisible();
  await expect(unusedRow).toContainText('En quarantaine');
  await expect(unusedRow).toContainText(/suppression le/);
});
