import { expect, test } from '@playwright/test';
import { enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : calculer et publier une note (le carnet ne montre jamais 0 pour une note absente).
const teacherEmail = unique('grade-teacher'), studentEmail = unique('grade-student');
let courseId = '';

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Grade Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'Amira Ben Salah', studentEmail);
    const course = await seedCourse(db, teacher, 'Cours notes', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l1', 'c1', 'Signals')] }]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

test('teacher grades and publishes; the student sees only the published grade and average', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/gradebook`);
  await expect(page.getByRole('heading', { name: 'Carnet de notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une colonne' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Titre de la colonne/).fill('Examen oral');
  await dialog.getByLabel('Barème (points)').fill('20');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  const cell = page.getByRole('button', { name: /^Note de Amira Ben Salah pour « Examen oral » : —/ });
  await expect(cell).toBeVisible();

  await cell.click();
  await page.getByRole('dialog').getByLabel('Note (sur 20)').fill('15,5');
  await page.getByRole('dialog').getByLabel('Commentaire').fill('Très bonne présentation');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Note de Amira Ben Salah pour « Examen oral » : 15,5, corrigé, non publié/ })).toBeVisible();

  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await login(student, studentEmail);
  await student.goto(`/student/courses/${courseId}/grades`);
  await expect(student.getByRole('heading', { name: 'Mes notes' })).toBeVisible();
  await expect(student.getByText('Examen oral')).toBeVisible();
  await expect(student.getByText('En attente')).toBeVisible();
  await expect(student.getByText('15,5')).toHaveCount(0);

  await page.getByRole('button', { name: 'Publier les notes de « Examen oral »' }).click();
  await expect(page.getByText('1 note publiée pour « Examen oral ».')).toBeVisible();
  await expect(page.getByRole('button', { name: /15,5, publié/ })).toBeVisible();

  await student.reload();
  await expect(student.getByText('15,5 / 20')).toBeVisible();
  await expect(student.getByText('Très bonne présentation')).toBeVisible();
  await expect(student.locator('section[aria-labelledby="grades-total"]')).toContainText('15,5');
  await studentContext.close();
});
