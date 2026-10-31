import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Fixtures are seeded with the backend's own dependencies in the isolated `_test` database used by the API server.
const frontendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = process.env.EDUMARKET_BACKEND_DIR || [path.join(frontendRoot, 'backend'), path.join(frontendRoot, '..', 'edumarket-backend')].find(candidate => existsSync(path.join(candidate, 'package.json')))!;
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
const mongoose = backendRequire('mongoose') as typeof import('mongoose');
const bcrypt = backendRequire('bcryptjs') as { hash: (value: string, rounds: number) => Promise<string> };

const api = 'http://127.0.0.1:4400/api/v1';
const password = 'E2e-marketplace-password-2026';
const suffix = Date.now().toString(36);
const fixtures: { paidCourseId?: string; subscriptionCourseId?: string; pendingCourseTitle: string; teacherEmail: string; moderatorEmail: string; adminEmail: string; certificateCode: string; institutionEmail: string; restrictedTitle: string; offlineCourseId?: string } = {
  pendingCourseTitle: `Pending review ${suffix}`, teacherEmail: `teacher-${suffix}@example.test`, moderatorEmail: `moderator-${suffix}@example.test`,
  adminEmail: `admin-${suffix}@example.test`, certificateCode: `E2E${suffix.toUpperCase()}CERT`,
  institutionEmail: `institution-${suffix}@example.test`, restrictedTitle: `Third-year signals ${suffix}`,
};

test.beforeAll(async () => {
  const connection = await mongoose.createConnection(process.env.EDUMARKET_TEST_MONGO_URI!).asPromise();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const users = connection.collection('users');
    const now = new Date();
    const base = { passwordHash, status: 'active', emailVerified: true, headline: '', bio: '', phone: '', favoriteCourseIds: [], authVersion: 0, notificationPreferences: { sessions: true, messages: true, courseActivity: true }, createdAt: now, updatedAt: now };
    const teacher = await users.insertOne({ ...base, name: 'E2E Teacher', email: fixtures.teacherEmail, role: 'teacher', verified: true, teacherVerification: { specialty: 'Testing', registrationNumber: '', credentialsSummary: 'Fixture', status: 'approved', submittedAt: now, reviewNote: '', documents: [] } });
    await users.insertOne({ ...base, name: 'E2E Moderator', email: fixtures.moderatorEmail, role: 'moderator', verified: false });
    const lesson = { id: 'l1', title: 'Introduction', chapterId: 'c1', durationMinutes: 5, type: 'text', textContent: 'Hello', resources: [] };
    const course = { subtitle: '', description: 'Browser marketplace fixture.', category: 'testing', level: 'beginner', rating: 0, ratingCount: 0, studentsCount: 0, tags: [], chapters: [{ id: 'c1', title: 'Chapter', order: 0, lessons: [lesson] }], hasCertification: false, certificationPathway: 'learning_and_quiz', prerequisites: [], learningOutcomes: [], teacherId: teacher.insertedId, createdAt: now, updatedAt: now };
    const paid = await connection.collection('courses').insertOne({ ...course, title: `Paid course ${suffix}`, slug: `paid-course-${suffix}`, price: 30, status: 'published' });
    await connection.collection('courses').insertOne({ ...course, title: fixtures.pendingCourseTitle, slug: `pending-course-${suffix}`, price: 0, status: 'pending_review', review: { submittedAt: now, note: '' } });
    fixtures.paidCourseId = String(paid.insertedId);
    const subscribed = await connection.collection('courses').insertOne({ ...course, title: `Subscription course ${suffix}`, slug: `subscription-course-${suffix}`, price: 45, status: 'published' });
    fixtures.subscriptionCourseId = String(subscribed.insertedId);
    await users.insertOne({ ...base, name: 'E2E Admin', email: fixtures.adminEmail, role: 'admin', verified: false });
    const holder = await users.insertOne({ ...base, name: 'E2E Certified', email: `certified-${suffix}@example.test`, role: 'student', verified: false });
    const school = await users.insertOne({ ...base, name: 'E2E School', email: fixtures.institutionEmail, role: 'institution', verified: true });
    await connection.collection('courses').insertOne({ ...course, title: fixtures.restrictedTitle, slug: `third-year-${suffix}`, price: 0, status: 'published', visibility: 'restricted', teacherId: school.insertedId });
    const offline = await connection.collection('courses').insertOne({ ...course, title: `Offline course ${suffix}`, slug: `offline-course-${suffix}`, price: 70, status: 'published' });
    fixtures.offlineCourseId = String(offline.insertedId);
    await connection.collection('certificates').insertOne({ code: fixtures.certificateCode, studentId: holder.insertedId, courseId: paid.insertedId, issuedAt: now, revokedAt: null, revokedReason: '', revokedBy: null, createdAt: now, updatedAt: now });
    await connection.collection('platformsettings').updateOne({ _id: 'global' as never }, { $set: { commissionRate: 20, maintenanceMode: false, subscription: { enabled: true, monthlyPrice: 12, yearlyPrice: 120 } } }, { upsert: true });
  } finally { await connection.close(); }
});

async function registerStudent() {
  const email = `student-${suffix}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const registration = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'E2E Buyer', email, password }) });
  const previewUrl = (await registration.json()).data.previewUrl as string;
  const token = new URLSearchParams(new URL(previewUrl).hash.slice(1)).get('token');
  await fetch(`${api}/auth/email/verification/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  return email;
}

async function login(page: Page, email: string) {
  await page.goto('/auth/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

test('a student buys a paid course through the sandbox provider and gets access, order and invoice', async ({ page }) => {
  await login(page, await registerStudent());
  await page.goto(`/courses/${fixtures.paidCourseId}`);
  await page.getByRole('button', { name: 'Acheter ce cours' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText('Paiement de test')).toHaveCount(0);
  await page.getByRole('button', { name: /^Payer/ }).click();

  await expect(page).toHaveURL(/\/checkout\/sandbox\/sbx_cs_/);
  await expect(page.getByRole('heading', { name: 'Paiement de test (sandbox)' })).toBeVisible();
  await page.getByRole('button', { name: 'Simuler un paiement réussi' }).click();

  await expect(page).toHaveURL(/\/checkout\/complete\?order=/);
  await expect(page.getByRole('heading', { name: 'Paiement confirmé' })).toBeVisible();
  await page.getByRole('link', { name: 'Voir mes achats' }).click();
  await expect(page.getByText(`Paid course ${suffix}`)).toBeVisible();
  await expect(page.getByText('Payée')).toBeVisible();
  await page.getByRole('link', { name: 'Facture', exact: true }).click();
  await expect(page.getByText(/INV-\d{4}-\d{6}/)).toBeVisible();

  await page.goto('/student/courses');
  await expect(page.getByText(`Paid course ${suffix}`).first()).toBeVisible();

  await page.goto('/student/orders');
  await page.locator('select').first().selectOption('ar');
  await expect(page.getByRole('heading', { name: 'المشتريات والفواتير' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('select').first().selectOption('fr');
});

test('a moderator publishes a submitted course from the back office sidebar', async ({ page }) => {
  await login(page, fixtures.moderatorEmail);
  await page.goto('/moderator/dashboard');
  await expect(page.getByRole('link', { name: 'Modération des cours' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Transactions & Remboursements' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Modération des cours' }).click();
  const card = page.locator('article', { hasText: fixtures.pendingCourseTitle });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Publier' }).click();
  await expect(card).toHaveCount(0);
  await page.goto('/moderator/history');
  await expect(page.getByText('Cours publié').first()).toBeVisible();
});

test('a student subscribes from the pricing page and opens a paid course through the subscription', async ({ page }) => {
  await login(page, await registerStudent());
  await page.goto('/pricing');
  await expect(page.getByText('12,00')).toBeVisible();
  await page.getByRole('button', { name: "S'abonner" }).click();
  await expect(page).toHaveURL(/\/checkout\/sandbox\/sbx_cs_/);
  await page.getByRole('button', { name: 'Simuler un paiement réussi' }).click();
  await expect(page.getByRole('heading', { name: 'Paiement confirmé' })).toBeVisible();

  await page.goto('/student/subscription');
  await expect(page.getByRole('heading', { name: 'Abonnement actif' })).toBeVisible();
  await page.goto(`/courses/${fixtures.subscriptionCourseId}`);
  await page.getByRole('button', { name: 'Accéder avec mon abonnement' }).click();
  await expect(page).toHaveURL(new RegExp(`/learning/${fixtures.subscriptionCourseId}`));
  await page.goto('/student/courses');
  await expect(page.getByText(/Accès abonnement jusqu'au/)).toBeVisible();
});

test('a verified teacher authors a text lesson with a quiz and submits the course for review', async ({ page }) => {
  const title = `Authored course ${suffix}`;
  await login(page, fixtures.teacherEmail);
  await page.goto('/teacher/courses/create');
  await page.getByLabel('Titre de la formation').fill(title);
  await page.getByLabel("Sous-titre d'accroche").fill('Built from the browser test');
  await page.getByLabel('Catégorie').selectOption({ index: 1 });
  await page.getByLabel('Description complète du cours').fill('A course authored end to end in the editor.');
  await page.getByRole('button', { name: /2\. Structure/ }).click();
  await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
  await page.getByRole('button', { name: 'Ajouter une leçon à ce chapitre' }).click();
  await page.getByRole('button', { name: /Nouvelle leçon 1/ }).click();
  await page.getByLabel('Titre de la leçon').fill('Atoms and molecules');
  await page.getByLabel('Type de leçon').selectOption('text');
  await page.getByLabel('Contenu de la leçon').fill('Atoms are the smallest UI building blocks.');
  await page.getByRole('switch', { name: 'Quiz de validation (noté par le serveur)' }).click();
  await page.getByPlaceholder('Énoncé de la question').fill('What is the smallest building block?');
  await page.getByPlaceholder('Réponse 1').fill('Atom');
  await page.getByPlaceholder('Réponse 2').fill('Template');
  await page.getByRole('button', { name: 'Enregistrer en brouillon' }).click();
  await expect(page).toHaveURL(/\/teacher\/courses$/);

  const row = page.locator('div.p-4', { hasText: title }).first();
  await row.getByRole('button', { name: 'Soumettre à validation' }).click();
  await expect(row.getByText('En revue')).toBeVisible();

  const connection = await mongoose.createConnection(process.env.EDUMARKET_TEST_MONGO_URI!).asPromise();
  try {
    const saved = await connection.collection('courses').findOne({ title });
    const lesson = saved?.chapters[0].lessons[0];
    expect(saved?.status).toBe('pending_review');
    expect(lesson.type).toBe('text');
    expect(lesson.quiz.questions[0].options).toEqual(['Atom', 'Template']);
    expect(lesson.quiz.questions[0].correctOptionIndex).toBe(0);
  } finally { await connection.close(); }
});

test('an admin revokes a certificate from the back office and the public registry reports it', async ({ page }) => {
  await page.goto(`/certifications?code=${fixtures.certificateCode.toLowerCase()}`);
  await expect(page.getByText('Certificat authentique')).toBeVisible();
  await login(page, fixtures.adminEmail);
  await page.goto('/admin/dashboard');
  await page.getByRole('link', { name: 'Certificats' }).click();
  await page.getByPlaceholder('Code, nom ou e-mail').fill(fixtures.certificateCode);
  const row = page.locator('li', { hasText: fixtures.certificateCode });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Révoquer' }).click();
  await row.getByPlaceholder('Motif de révocation (5 caractères min.)').fill('Fraude constatée');
  await row.getByRole('button', { name: 'Confirmer la révocation' }).click();
  await expect(row.getByText('Révoqué le')).toBeVisible();
  await page.goto(`/certifications?code=${fixtures.certificateCode}`);
  await expect(page.getByText('Certificat révoqué le')).toBeVisible();
});

test('an institution opens a restricted course to a class and a student joins it with the class code', async ({ page, browser }) => {
  await login(page, fixtures.institutionEmail);
  await page.goto('/institution/classes');
  await page.getByRole('button', { name: 'Nouvelle classe' }).click();
  await page.getByLabel('Nom de la classe').fill(`Ingénieurs 3e année ${suffix}`);
  await page.getByLabel('Niveau').fill('3e année');
  await page.getByRole('button', { name: 'Créer la classe' }).click();
  await expect(page).toHaveURL(/\/institution\/classes\/[a-f0-9]{24}$/);
  await page.getByLabel(fixtures.restrictedTitle).check();
  await page.getByRole('button', { name: 'Enregistrer les cours' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer les cours' })).toBeDisabled();
  await expect(page.getByLabel(fixtures.restrictedTitle)).toBeChecked();
  const code = (await page.locator('code').first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);

  const studentPage = await (await browser.newContext()).newPage();
  await login(studentPage, await registerStudent());
  await studentPage.goto('/courses');
  await expect(studentPage.getByText(fixtures.restrictedTitle)).toHaveCount(0);
  await studentPage.goto('/student/classes');
  await studentPage.getByLabel("Code d'inscription").fill(code);
  await studentPage.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(studentPage.getByText(`Vous avez rejoint « Ingénieurs 3e année ${suffix} ».`)).toBeVisible();
  await expect(studentPage.getByText(fixtures.restrictedTitle).first()).toBeVisible();
  await studentPage.goto('/student/courses');
  await expect(studentPage.getByText(fixtures.restrictedTitle).first()).toBeVisible();
});

test('a student asks to pay by cheque and an admin records it with a scan, which opens the course', async ({ page, browser }) => {
  const email = await registerStudent();
  await login(page, email);
  await page.goto(`/courses/${fixtures.offlineCourseId}`);
  await page.getByRole('button', { name: 'Acheter ce cours' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByLabel('Mode de paiement').selectOption('cheque');
  await page.getByRole('button', { name: 'Demander à payer hors ligne' }).click();
  await expect(page.getByText('Demande de paiement (Chèque) enregistrée.')).toBeVisible();
  await page.goto('/student/orders');
  await expect(page.getByText('En attente').first()).toBeVisible();

  const adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, fixtures.adminEmail);
  await adminPage.goto('/admin/dashboard');
  await adminPage.getByRole('link', { name: 'Paiements hors ligne' }).click();
  const request = adminPage.locator('li', { hasText: email });
  await request.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await request.getByLabel('N° de chèque / virement').fill('0042117');
  await request.getByLabel('Banque').fill('BIAT');
  await request.locator('input[type="file"]').setInputFiles({ name: 'cheque.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]) });
  await request.getByRole('button', { name: 'Confirmer le paiement' }).click();
  await expect(adminPage.getByText("Paiement enregistré : la commande est payée et l'accès est ouvert.")).toBeVisible();

  await page.reload();
  await expect(page.getByText('Payée').first()).toBeVisible();
  await expect(page.getByText(/réf\. 0042117/)).toBeVisible();
  await page.goto('/student/courses');
  await expect(page.getByText(`Offline course ${suffix}`).first()).toBeVisible();
});
