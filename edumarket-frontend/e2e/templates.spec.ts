import { expect, test } from '@playwright/test';
import { api, enroll, lesson, login, objectId, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : séparer les données de deux classes issues d'un même modèle.
const teacherEmail = unique('tpl-teacher'), studentEmail = unique('tpl-student');
let templateId = '', studentId: unknown;

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Template Teacher', teacherEmail);
    studentId = await seedUser(db, 'student', 'Sami Gharbi', studentEmail);
    templateId = String(await seedCourse(db, teacher, 'Angular modèle', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l1', 'c1', 'Signals')] }], { status: 'draft', accessState: 'private' }));
  });
});

test('a template produces two independent classes whose data stay separate', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${templateId}/template`);
  await page.getByRole('button', { name: 'Faire de ce cours un modèle' }).click();
  for (const name of ['Angular — Classe A', 'Angular — Classe B']) {
    await page.getByLabel(/Nom de la classe/).fill(name);
    await page.getByRole('button', { name: 'Créer la classe' }).click();
    await expect(page.getByText(`« ${name} » a été créée`)).toBeVisible();
  }
  const table = page.getByRole('table', { name: 'Indicateurs réels par classe issue du modèle' });
  await expect(table.getByRole('row')).toHaveCount(3);

  // Class A opens to one student who gets a grade; class B stays empty.
  const instances = await (await page.request.get(`${api}/courses/${templateId}/instances`)).json() as { data: { id: string; title: string }[] };
  const classA = instances.data.find(row => row.title.endsWith('Classe A'))!.id, classB = instances.data.find(row => row.title.endsWith('Classe B'))!.id;
  await withDb(async db => {
    await db.collection('courses').updateOne({ _id: objectId(classA) as never }, { $set: { status: 'published', accessState: 'open' } });
    await enroll(db, studentId, objectId(classA));
  });
  const book = await (await page.request.get(`${api}/gradebook/${classA}`)).json() as { data: { categories: { id: string }[] } };
  const column = await (await page.request.post(`${api}/gradebook/${classA}/columns`, { data: { categoryId: book.data.categories[0].id, title: 'Oral', maxPoints: 20 } })).json() as { data: { id: string } };
  expect((await page.request.put(`${api}/gradebook/${classA}/entries/${column.data.id}/${String(studentId)}`, { data: { score: 15 } })).status()).toBe(200);
  expect((await page.request.put(`${api}/gradebook/${classB}/entries/${column.data.id}/${String(studentId)}`, { data: { score: 15 } })).status()).toBe(404);

  await page.reload();
  const rowA = table.getByRole('row', { name: /Classe A/ }), rowB = table.getByRole('row', { name: /Classe B/ });
  await expect(rowA).toContainText('15 / 20');
  await expect(rowA.getByRole('cell').nth(1)).toHaveText('1');
  await expect(rowB.getByRole('cell').nth(1)).toHaveText('0');
  await expect(rowB).toContainText('—');

  const context = await browser.newContext();
  const student = await context.newPage();
  await login(student, studentEmail);
  expect((await student.request.get(`${api}/gradebook/me/${classA}`)).status()).toBe(200);
  expect((await student.request.get(`${api}/gradebook/me/${classB}`)).status()).toBe(404);
  await context.close();
});
