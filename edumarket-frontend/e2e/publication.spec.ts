import { expect, test } from '@playwright/test';
import { enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : modifier un brouillon sans changer le contenu publié, puis publier et vérifier la visibilité côté étudiant.
const teacherEmail = unique('pub-teacher'), studentEmail = unique('pub-student');
let courseId = '';

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Publication Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'Publication Student', studentEmail);
    const course = await seedCourse(db, teacher, 'Cours publication', [
      { id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [
        lesson('l1', 'c1', 'Signals - version publiée', { publishedVersion: 1, blocks: [{ id: 'b1', type: 'text', html: '<p>Texte publié</p>' }] }),
      ] },
    ]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

test('editing a published lesson stays in the draft until it is published', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/content/items/l1`);
  await expect(page.getByText('Publié', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Titre *' }).fill('Signals - nouvelle version');
  await expect(page.getByRole('status').filter({ hasText: /^Enregistré [(]/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Modifications non publiées', { exact: true })).toBeVisible();

  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await login(student, studentEmail);
  await student.goto(`/learning/${courseId}`);
  await expect(student.getByText('Signals - version publiée').first()).toBeVisible();
  await expect(student.getByText('Signals - nouvelle version')).toHaveCount(0);

  // Teacher: published preview vs draft preview.
  await page.goto(`/teacher/courses/${courseId}/content`);
  await page.getByRole('button', { name: 'Aperçu étudiant' }).click();
  const outline = page.getByRole('navigation', { name: 'Plan vu par les étudiants' });
  await expect(outline).toContainText('Signals - version publiée');
  await page.getByRole('button', { name: 'Brouillon', exact: true }).click();
  await expect(outline).toContainText('Signals - nouvelle version');

  await page.goto(`/teacher/courses/${courseId}/content/items/l1`);
  const publish = page.waitForResponse(response => response.url().endsWith('/structure/items/l1/publish') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publier les modifications' }).click();
  expect((await publish).status()).toBe(200);
  await expect(page.getByText('Publication effectuée.')).toBeVisible();
  await page.getByText('Historique des versions').click();
  await expect(page.getByRole('list', { name: 'Historique des versions' })).toContainText('Version 2 · Signals - nouvelle version');

  await student.reload();
  await expect(student.getByText('Signals - nouvelle version').first()).toBeVisible();
  await studentContext.close();
});
