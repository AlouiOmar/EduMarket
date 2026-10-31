import { expect, test, type Page } from '@playwright/test';
import { api, enroll, lesson, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : test avec tirage aléatoire depuis une série ; devoir remis puis corrigé avec une rubrique ; notes publiées.
const teacherEmail = unique('assess-teacher'), studentEmail = unique('assess-student');
let courseId = '';

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Assess Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'Yassine Trabelsi', studentEmail);
    const course = await seedCourse(db, teacher, 'Cours évaluations', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l1', 'c1', 'Signals')] }]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

async function addSingleQuestion(page: Page, prompt: string, correctIndex: number) {
  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Énoncé' }).fill(prompt);
  await dialog.getByLabel('Choix 1', { exact: true }).fill('computed()');
  await dialog.getByLabel('Choix 2', { exact: true }).fill('effect()');
  await dialog.getByLabel(`Choix ${correctIndex} correct`).check();
  await dialog.getByLabel('Chapitre').fill('signals');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe.serial('assessments', () => {
  test.setTimeout(120_000);
  test('teacher builds a bank, a random-draw test, publishes; the student takes it and gets the published grade', async ({ page, browser }) => {
    await login(page, teacherEmail);
    await page.goto(`/teacher/courses/${courseId}/assessments?tab=banks`);
    await page.getByLabel('Nouvelle série').fill('Signals');
    await page.getByRole('button', { name: 'Créer la série' }).click();
    for (const [index, prompt] of ['Dérive une valeur ?', 'Exécute un effet de bord ?', 'Mémorise un calcul ?'].entries()) await addSingleQuestion(page, prompt, index === 1 ? 2 : 1);
    await expect(page.getByRole('list', { name: 'Questions de « Signals »' }).getByRole('listitem')).toHaveCount(3);

    await page.getByRole('tab', { name: 'Tests' }).click();
    await page.getByRole('button', { name: 'Créer un test' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Titre du test/).fill('Quiz signals');
    await dialog.getByRole('button', { name: 'Ajouter un tirage aléatoire' }).click();
    await dialog.getByLabel('Nombre de questions tirées').fill('2');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Publier' }).click();
    await expect(page.getByText('« Quiz signals » est publié.')).toBeVisible();

    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    await login(student, studentEmail);
    await student.goto(`/student/courses/${courseId}/tests`);
    await student.getByRole('button', { name: 'Commencer' }).click();
    await expect(student.getByRole('heading', { name: 'Tentative 1' })).toBeVisible();
    const questions = student.locator('fieldset');
    await expect(questions).toHaveCount(2);
    await questions.nth(0).getByRole('radio').first().check();
    await expect(student.getByRole('status').filter({ hasText: 'Réponses enregistrées' })).toBeVisible({ timeout: 10_000 });
    // Secure resume: a reload keeps the same draw and the saved answer.
    const firstPrompt = await questions.nth(0).locator('.lesson-rich-text').first().textContent();
    await student.reload();
    await expect(questions.nth(0).locator('.lesson-rich-text').first()).toHaveText(firstPrompt || '');
    await expect(questions.nth(0).getByRole('radio').first()).toBeChecked();
    await questions.nth(1).getByRole('radio').first().check();
    await student.getByRole('button', { name: 'Remettre' }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Remettre' }).click();
    await expect(student.getByText("Remis. La note apparaîtra lorsque l'enseignant la publiera.")).toBeVisible();

    await page.goto(`/teacher/courses/${courseId}/gradebook`);
    await page.getByRole('button', { name: 'Publier les notes de « Quiz signals »' }).click();
    await expect(page.getByText('1 note publiée pour « Quiz signals ».')).toBeVisible();
    await student.reload();
    await expect(student.getByText(/^Note : \d+ \/ 2$/)).toBeVisible();
    await studentContext.close();
  });

  test('assignment submitted by the student, graded with a rubric, then published', async ({ page, browser }) => {
    await login(page, teacherEmail);
    const rubric = await page.request.post(`${api}/assessments/${courseId}/rubrics`, { data: { title: 'Grille TP', criteria: [
      { id: 'code', title: 'Qualité du code', levels: [{ id: 'weak', title: 'Insuffisant', points: 0 }, { id: 'good', title: 'Satisfaisant', points: 10 }] },
      { id: 'tests', title: 'Tests', levels: [{ id: 'none', title: 'Absents', points: 0 }, { id: 'full', title: 'Complets', points: 10 }] },
    ] } });
    expect(rubric.status()).toBe(201);
    await page.goto(`/teacher/courses/${courseId}/assessments?tab=assignments`);
    await page.getByRole('button', { name: 'Créer un devoir' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Titre du devoir/).fill('TP panier');
    await dialog.getByLabel(/Consignes/).fill('Implémenter un panier avec signals');
    await dialog.getByLabel('Rubrique').selectOption({ label: 'Grille TP' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: /TP panier/ })).toBeVisible();

    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    await login(student, studentEmail);
    await student.goto(`/student/courses/${courseId}/assignments`);
    await student.getByText('Rubrique de notation').click();
    await expect(student.getByRole('table')).toContainText('Qualité du code');
    await student.getByLabel('Réponse').fill('Mon panier est dans le dépôt');
    await student.getByLabel('Liens').fill('https://github.com/etudiant/panier');
    await student.getByRole('button', { name: 'Remettre le devoir' }).click();
    await expect(student.getByText(/^Remis le /)).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Corriger' }).click();
    const grading = page.getByRole('dialog');
    await expect(grading.getByRole('link', { name: 'https://github.com/etudiant/panier' })).toBeVisible();
    await grading.getByRole('button', { name: /Satisfaisant/ }).click();
    await grading.getByRole('button', { name: /Absents/ }).click();
    await grading.getByLabel('Commentaire').fill('Ajoutez des tests unitaires');
    await grading.getByRole('button', { name: 'Enregistrer la note' }).click();
    await expect(grading).toHaveCount(0);

    await student.reload();
    await expect(student.getByText("Remis. La note apparaîtra lorsque l'enseignant la publiera.")).toBeVisible();
    await page.goto(`/teacher/courses/${courseId}/gradebook`);
    await page.getByRole('button', { name: 'Publier les notes de « TP panier »' }).click();
    await student.reload();
    await expect(student.getByText('10 / 20', { exact: true })).toBeVisible();
    await expect(student.getByText('Ajoutez des tests unitaires')).toBeVisible();
    await studentContext.close();
  });
});
