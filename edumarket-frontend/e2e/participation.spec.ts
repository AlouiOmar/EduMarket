import { expect, test } from '@playwright/test';
import { enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : confidentialité d'un journal ; annonce programmée traitée par la tâche de fond (sans raccourci).
const teacherEmail = unique('part-teacher'), aliceEmail = unique('part-alice'), bobEmail = unique('part-bob');
let courseId = '';

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Part Teacher', teacherEmail);
    const alice = await seedUser(db, 'student', 'Alice Mansour', aliceEmail);
    const bob = await seedUser(db, 'student', 'Bob Karoui', bobEmail);
    const course = await seedCourse(db, teacher, 'Cours participation', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l1', 'c1', 'Signals')] }]);
    courseId = String(course);
    await enroll(db, alice, course);
    await enroll(db, bob, course);
  });
});

test('journal entries are visible to their author and the teacher only', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/journals`);
  await page.getByRole('button', { name: 'Créer un journal' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Titre du journal/).fill('Journal de bord');
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('button', { name: 'Journal de bord' })).toBeVisible();

  for (const [email, text] of [[aliceEmail, 'Alice : les signals sont clairs'], [bobEmail, 'Bob : effect() reste flou']] as const) {
    const context = await browser.newContext();
    const student = await context.newPage();
    await login(student, email);
    await student.goto(`/student/courses/${courseId}/journal`);
    await student.getByLabel('Nouvelle entrée').fill(text);
    await student.getByRole('button', { name: "Ajouter l'entrée" }).click();
    await expect(student.getByText(text)).toBeVisible();
    await context.close();
  }
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await login(bob, bobEmail);
  await bob.goto(`/student/courses/${courseId}/journal`);
  await expect(bob.getByText('Bob : effect() reste flou')).toBeVisible();
  await expect(bob.getByText('Alice : les signals sont clairs')).toHaveCount(0);
  await bobContext.close();

  await page.getByRole('button', { name: 'Journal de bord' }).click();
  await expect(page.getByText('Alice : les signals sont clairs')).toBeVisible();
  await expect(page.getByText('Bob : effect() reste flou')).toBeVisible();
});

test('a scheduled announcement is delivered by the background job, not before', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/announcements`);
  // Next full minute + 1: datetime-local has minute precision; the job runs every minute.
  const publishAt = await page.evaluate(() => {
    const date = new Date(Date.now() + 120_000); date.setSeconds(0, 0);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await page.getByLabel(/^Titre/).fill('Examen de mi-parcours');
  await page.getByLabel(/^Message/).fill('Examen la semaine prochaine, salle B12.');
  await page.getByLabel('Publier le').fill(publishAt);
  await page.getByRole('button', { name: 'Programmer' }).click();
  await expect(page.getByText('Annonce programmée.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Examen de mi-parcours' }).getByText('Programmée')).toBeVisible();

  const context = await browser.newContext();
  const alice = await context.newPage();
  await login(alice, aliceEmail);
  await alice.goto(`/student/courses/${courseId}/announcements`);
  await expect(alice.getByRole('heading', { name: 'Annonces' })).toBeVisible();
  await expect(alice.getByText('Examen de mi-parcours')).toHaveCount(0);

  await expect.poll(async () => {
    await alice.reload();
    // Data loads after the page: wait briefly for the heading instead of counting immediately.
    return alice.getByRole('heading', { name: 'Examen de mi-parcours' }).waitFor({ timeout: 5_000 }).then(() => 1, () => 0);
  }, { timeout: 240_000, intervals: [10_000] }).toBe(1);
  await alice.goto('/notifications');
  await expect(alice.getByText('Examen de mi-parcours').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Examen de mi-parcours' }).getByText('Envoyée', { exact: true })).toBeVisible();
  await context.close();
});
