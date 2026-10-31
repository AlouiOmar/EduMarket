import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { password, seedUser, unique, withDb } from './support/lms';

/**
 * Independent teacher onboarding, end to end: account → file → documents → submission → central review → correction
 * request → replaced document → approval → teacher dashboard. Fictitious documents only (generated in memory).
 */
test.use({ locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });

const candidateEmail = unique('applicant'), adminEmail = unique('central-admin');
const pdf = (label: string) => ({ name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Title (${label} fictif) >>\nendobj\ntrailer\n<< >>\n%%EOF\n`) });
const png = (label: string) => ({ name: `${label}.png`, mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(128, 7)]) });

async function signIn(page: Page, email: string) {
  await page.goto('/auth/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}
const seriousViolations = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const results = await (include ? builder.include(include) : builder).analyze();
  return results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || '')).map(violation => ({ id: violation.id, nodes: violation.nodes.slice(0, 3).map(node => node.target.join(' ')) }));
};

test.beforeAll(async () => { await withDb(db => seedUser(db, 'admin', 'Admin Centrale', adminEmail)); });

test.describe.serial('independent teacher application', () => {
  test.setTimeout(180_000);

  test('a candidate creates an account, completes the file, uploads the documents and submits', async ({ page }) => {
    await page.goto('/auth/register');
    await page.getByRole('link', { name: 'Déposer une candidature' }).click();
    await expect(page).toHaveURL(/\/auth\/register\/teacher$/);
    await page.getByLabel(/^Prénom/).fill('Salma');
    await page.getByLabel(/^Nom/).fill('Fictive');
    await page.getByLabel(/^Adresse e-mail|^E-mail/).fill(candidateEmail);
    await page.getByLabel(/^Mot de passe/).fill(password);
    await page.getByLabel(/^Confirm/).fill(password);
    await page.getByLabel(/^Pays de résidence/).selectOption('TN');
    await expect(page.getByLabel(/^Téléphone/)).toHaveValue('+216');
    await page.getByLabel(/^Téléphone/).fill('+21620000001');
    await page.getByLabel(/^Ville/).fill('Sousse');
    await page.getByRole('button', { name: 'Créer mon compte candidat' }).click();
    await expect(page.getByText('Vous devez accepter les conditions pour continuer.')).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Créer mon compte candidat' }).click();
    await expect(page).toHaveURL(/\/auth\/verify-email/);
    await page.getByRole('link', { name: 'Ouvrir le lien réservé au développement' }).click();
    await expect(page.getByText(/vérifiée|confirmée/i).first()).toBeVisible();

    await signIn(page, candidateEmail);
    await expect(page).toHaveURL(/\/teacher\/application$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ma candidature d\'enseignant' })).toBeVisible();
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();

    // Identity: resumed values from the sign-up, then the identity document.
    await expect(page.getByLabel(/^Prénom/)).toHaveValue('Salma');
    await page.getByLabel(/^Date de naissance/).fill('1991-03-02');
    await page.getByLabel(/^Nationalité/).selectOption('TN');
    await page.getByLabel(/^Type de pièce/).selectOption('passport');
    await page.getByLabel(/^Numéro de la pièce/).fill('X1234567');
    await page.getByLabel(/^Pays de délivrance/).selectOption('TN');
    await page.getByLabel(/^Date de délivrance/).fill('2021-06-01');
    await page.getByRole('button', { name: 'Suivant' }).click();

    await page.getByRole('button', { name: 'Ajouter un diplôme' }).click();
    const degree = page.getByRole('group', { name: 'Diplôme 1' });
    await degree.getByLabel(/^Niveau d'études/).selectOption('master');
    await degree.getByLabel(/^Intitulé du diplôme/).fill('Master didactique des sciences');
    await degree.getByLabel(/^Spécialité/).fill('Didactique');
    await degree.getByLabel(/^Établissement/).fill('Université fictive de Sousse');
    await degree.getByLabel(/^Pays de l'établissement/).selectOption('TN');
    await degree.getByLabel(/^Année d'obtention/).fill('2016');
    await page.getByRole('button', { name: 'Suivant' }).click();

    await page.getByLabel(/^Présentation professionnelle/).fill('Professeure de physique et formatrice');
    await page.getByLabel(/^Biographie/).fill('Professeure de physique-chimie depuis huit ans, j\'accompagne des lycéens et des étudiants en classes préparatoires vers la réussite aux examens.');
    for (const [label, value] of [[/^Spécialités d'enseignement/, 'Physique'], [/^Matières enseignées/, 'Mécanique'], [/^Langues d'enseignement/, 'Français']] as const) {
      await page.getByLabel(label).fill(value);
      await page.getByLabel(label).press('Enter');
    }
    await page.getByLabel(/^Années d'expérience/).fill('8');
    await page.getByRole('button', { name: 'Ajouter une expérience' }).click();
    await page.getByRole('group', { name: 'Expérience 1' }).getByLabel(/^Intitulé du poste/).fill('Professeure de lycée');
    await page.getByRole('button', { name: 'Suivant' }).click();

    // Documents: real upload through the private store, one per mandatory slot.
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await page.getByTestId('file-identity').setInputFiles(pdf('passeport'));
    await expect(page.getByText('« passeport.pdf » a été déposé.')).toBeVisible();
    await page.getByTestId('file-cv').setInputFiles(pdf('cv'));
    await expect(page.getByText('« cv.pdf » a été déposé.')).toBeVisible();
    await page.locator('[data-testid^="file-diploma-"]').setInputFiles(png('master'));
    await expect(page.getByText('« master.png » a été déposé.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Suivant' }).click();

    await expect(page.getByText('Votre dossier est complet.')).toBeVisible();
    const submit = page.getByRole('button', { name: 'Soumettre ma candidature' });
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox', { name: /Je certifie/ }).check();
    await submit.click();
    await expect(page.getByText('Soumis', { exact: true })).toBeVisible();
    await expect(page.getByText(/Référence EMT-\d{4}-[0-9A-F]{8}/)).toBeVisible();

    // Still a candidate: no teacher workspace.
    await page.goto('/teacher/dashboard');
    await expect(page.getByRole('heading', { name: 'Compte en attente d\'approbation' })).toBeVisible();
    await page.goto('/teacher/courses/create');
    await expect(page.getByRole('heading', { name: 'Compte en attente d\'approbation' })).toBeVisible();
  });

  test('the central administration reviews the file and asks for a new copy of the diploma', async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto('/admin/teacher-applications');
    await expect(page.getByRole('heading', { name: 'Candidatures des enseignants indépendants' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: candidateEmail });
    await expect(row).toContainText('Physique');
    await expect(row).not.toContainText('X1234567');
    await row.getByRole('link', { name: 'Salma Fictive' }).click();

    await expect(page.getByText('•••• 4567')).toBeVisible();
    await page.getByRole('button', { name: 'Commencer la vérification' }).click();
    await expect(page.getByText('Vérification commencée.')).toBeVisible();
    await page.getByRole('button', { name: 'Marquer vérifié — Pièce d\'identité' }).click();
    await expect(page.getByText('Document vérifié.')).toBeVisible();
    await page.getByRole('button', { name: 'Marquer vérifié — CV' }).click();
    await expect(page.getByRole('button', { name: 'Marquer vérifié — CV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approuver la candidature' })).toBeDisabled();

    await page.getByRole('button', { name: 'Demander des compléments' }).click();
    const dialog = page.getByRole('dialog', { name: 'Demander des compléments' });
    await dialog.getByRole('checkbox', { name: /Diplôme : Master didactique des sciences/ }).check();
    await dialog.getByLabel(/^Message au candidat/).fill('Merci de déposer une copie complète du master, recto et verso.');
    await dialog.getByRole('button', { name: 'Envoyer la demande' }).click();
    await expect(page.getByText('Demande envoyée au candidat.')).toBeVisible();
    await expect(page.getByText('Compléments demandés', { exact: true }).first()).toBeVisible();
    await page.getByLabel(/^Nouvelle note interne/).fill('Note interne : diplôme à recouper avec l\'université.');
    await page.getByRole('button', { name: 'Ajouter la note' }).click();
    await expect(page.getByText('Note interne ajoutée.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the candidate replaces the diploma and resubmits; internal notes stay hidden', async ({ page }) => {
    await signIn(page, candidateEmail);
    await page.goto('/teacher/application');
    await expect(page.getByText('Merci de déposer une copie complète du master, recto et verso.').first()).toBeVisible();
    await expect(page.getByText(/Note interne/)).toHaveCount(0);
    await page.getByRole('button', { name: /^5\. Documents/ }).click();
    await expect(page.getByText('Remplacement demandé', { exact: true })).toBeVisible();
    await page.locator('[data-testid^="file-diploma-"]').setInputFiles(png('master-recto-verso'));
    await expect(page.getByText('« master-recto-verso.png » a été déposé.')).toBeVisible();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByRole('checkbox', { name: /Je certifie/ }).check();
    await page.getByRole('button', { name: 'Soumettre à nouveau mon dossier' }).click();
    await expect(page.getByText('Soumis à nouveau', { exact: true })).toBeVisible();
  });

  test('approval activates the teacher workspace for the new independent teacher', async ({ page, browser }) => {
    await signIn(page, adminEmail);
    await page.goto('/admin/teacher-applications');
    await page.getByRole('row').filter({ hasText: candidateEmail }).getByRole('link').click();
    await page.getByRole('button', { name: 'Commencer la vérification' }).click();
    await page.getByRole('button', { name: /^Marquer vérifié — Diplôme/ }).click();
    await expect(page.getByText('Document vérifié.')).toBeVisible();
    await page.getByRole('button', { name: 'Approuver la candidature' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approuver la candidature' }).click();
    await expect(page.getByText('Candidature approuvée : les fonctions d\'enseignant sont activées.')).toBeVisible();
    await expect(page.getByText('Approuvé', { exact: true })).toBeVisible();

    const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });
    const teacher = await context.newPage();
    await signIn(teacher, candidateEmail);
    await teacher.goto('/teacher/application');
    await expect(teacher.getByText('Votre candidature a été approuvée. Bienvenue sur EduMarket !')).toBeVisible();
    await teacher.getByRole('link', { name: 'Accéder au tableau de bord enseignant' }).first().click();
    await expect(teacher).toHaveURL(/\/teacher\/dashboard/);
    await expect(teacher.getByRole('heading', { name: 'Compte en attente d\'approbation' })).toHaveCount(0);
    await context.close();
  });

  test('Arabic (RTL) application space and sign-up form', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('app_language', 'ar'));
    await page.goto('/auth/register/teacher');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'كن مدرّسًا مستقلًا' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
