import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// "Contenu du cours": reordering (pointer, keyboard, accessible commands), persistence, failures, permissions and blocks.
const frontendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = process.env.EDUMARKET_BACKEND_DIR || [path.join(frontendRoot, 'backend'), path.join(frontendRoot, '..', 'edumarket-backend')].find(candidate => existsSync(path.join(candidate, 'package.json')))!;
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
type Collection = { insertOne: (doc: Record<string, unknown>) => Promise<{ insertedId: unknown }>; updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> };
const mongoose = backendRequire('mongoose') as { createConnection: (uri: string) => { asPromise: () => Promise<{ collection: (name: string) => Collection; close: () => Promise<void> }> } };
const bcrypt = backendRequire('bcryptjs') as { hash: (value: string, rounds: number) => Promise<string> };

const api = 'http://127.0.0.1:4400/api/v1';
const password = 'E2e-content-password-2026';
const suffix = Date.now().toString(36);
const teacherEmail = `content-teacher-${suffix}@example.test`;
const studentEmail = `content-student-${suffix}@example.test`;
let courseId = '';

const lesson = (id: string, chapterId: string, title: string, extra: Record<string, unknown> = {}) => ({ id, chapterId, title, type: 'text', durationMinutes: 10, resources: [], commentsCount: 0, visibility: 'visible', revision: 0, ...extra });

test.beforeAll(async () => {
  const connection = await mongoose.createConnection(process.env.EDUMARKET_TEST_MONGO_URI!).asPromise();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const base = { passwordHash, status: 'active', emailVerified: true, headline: '', bio: '', phone: '', favoriteCourseIds: [], authVersion: 0, notificationPreferences: { sessions: true, messages: true, courseActivity: true }, createdAt: now, updatedAt: now };
    const users = connection.collection('users');
    const teacher = await users.insertOne({ ...base, name: 'Content Teacher', email: teacherEmail, role: 'teacher', verified: true, teacherVerification: { specialty: 'Angular', registrationNumber: '', credentialsSummary: 'Fixture', status: 'approved', submittedAt: now, reviewNote: '', documents: [] } });
    const student = await users.insertOne({ ...base, name: 'Content Student', email: studentEmail, role: 'student', verified: false });
    const course = await connection.collection('courses').insertOne({
      title: `Application Côté Client ${suffix}`, slug: `acc-${suffix}`, subtitle: '', description: 'Angular 21', category: 'testing', level: 'beginner', price: 0,
      rating: 0, ratingCount: 0, studentsCount: 1, tags: [], hasCertification: false, certificationPathway: 'learning_and_quiz', prerequisites: [], learningOutcomes: [],
      teacherId: teacher.insertedId, coOwnerIds: [], visibility: 'public', status: 'published', accessState: 'open', structureVersion: 0, createdAt: now, updatedAt: now,
      chapters: [
        { id: 'c1', title: 'Chapitre 1 : Bases', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [
          lesson('l1', 'c1', 'C1 - Signals', { blocks: [{ id: 'b-text', type: 'text', html: '<p>Introduction aux signals</p>' }, { id: 'b-code', type: 'code', language: 'typescript', code: 'count = signal(0);', filename: '', caption: '' }] }),
          lesson('l2', 'c1', 'C1 - Contrôle de flux'),
        ] },
        { id: 'c2', title: 'Chapitre 2 : Composants', order: 1, kind: 'module', description: '', visibility: 'visible', lessons: [lesson('l3', 'c2', 'C2 - Inputs')] },
        { id: 'c3', title: 'Chapitre 3 : Routage', order: 2, kind: 'module', description: '', visibility: 'hidden', lessons: [lesson('l4', 'c3', 'C3 - Router')] },
      ],
    });
    courseId = String(course.insertedId);
    await connection.collection('enrollments').insertOne({ studentId: student.insertedId, courseId: course.insertedId, completedLessonIds: [], enrolledAt: now, lastAccessedAt: now, completedAt: null, accessType: 'free', accessExpiresAt: null, createdAt: now, updatedAt: now });
    await connection.collection('platformsettings').updateOne({ _id: 'global' as never }, { $set: { maintenanceMode: false } }, { upsert: true });
  } finally { await connection.close(); }
});

async function login(page: Page, email: string) {
  await page.goto('/auth/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

const containerTitles = (page: Page) => page.locator('section[aria-labelledby^="container-title-"] h2').allTextContents();
const itemTitles = (page: Page, container: string) => page.getByRole('list', { name: `Éléments de « ${container} »` }).getByRole('link').allTextContents();
const openContent = async (page: Page) => {
  await page.goto(`/teacher/courses/${courseId}/content`);
  await expect(page.getByRole('heading', { name: /Application Côté Client/ })).toBeVisible();
};
const moved = (page: Page) => page.waitForResponse(response => response.url().includes('/structure/move') && response.request().method() === 'POST');

async function dragHandle(page: Page, handleName: string, target: { x: number; y: number }) {
  const handle = page.getByRole('button', { name: handleName });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 20 });
  await page.mouse.move(target.x, target.y + 2, { steps: 2 });
  await page.mouse.up();
}

test.describe.serial('course content outline', () => {
  test('accessible commands: chapter 3 moved before chapter 1, persisted after refresh', async ({ page }) => {
    await login(page, teacherEmail);
    await openContent(page);
    expect(await containerTitles(page)).toEqual(['Chapitre 1 : Bases', 'Chapitre 2 : Composants', 'Chapitre 3 : Routage']);
    for (let step = 0; step < 2; step += 1) {
      const response = moved(page);
      await page.getByRole('button', { name: 'Monter « Chapitre 3 : Routage »' }).click();
      expect((await response).status()).toBe(200);
    }
    expect(await containerTitles(page)).toEqual(['Chapitre 3 : Routage', 'Chapitre 1 : Bases', 'Chapitre 2 : Composants']);
    await page.reload();
    await expect.poll(() => containerTitles(page)).toEqual(['Chapitre 3 : Routage', 'Chapitre 1 : Bases', 'Chapitre 2 : Composants']);
  });

  test('keyboard drag and drop through the handle reorders containers', async ({ page }) => {
    await login(page, teacherEmail);
    await openContent(page);
    const handle = page.getByRole('button', { name: /^Réorganiser « Chapitre 3 : Routage », position 1 sur 3/ });
    await handle.focus();
    const response = moved(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    expect((await response).status()).toBe(200);
    await page.reload();
    await expect.poll(() => containerTitles(page)).toEqual(['Chapitre 1 : Bases', 'Chapitre 3 : Routage', 'Chapitre 2 : Composants']);
  });

  test('pointer drag and drop: a lesson to the last position, then into another module', async ({ page }) => {
    // Source and target must both sit away from the viewport edges: near an edge dnd-kit auto-scrolls and the pointer lands on
    // another row (with the default 720 px height, the outline after the previous reorderings no longer fits).
    await page.setViewportSize({ width: 1280, height: 1100 });
    await login(page, teacherEmail);
    await openContent(page);
    // Within the module: "C1 - Signals" below "C1 - Contrôle de flux".
    const target = (await page.getByRole('link', { name: 'C1 - Contrôle de flux' }).boundingBox())!;
    let response = moved(page);
    await dragHandle(page, 'Réorganiser « C1 - Signals », position 1 dans « Chapitre 1 : Bases »', { x: target.x + target.width / 2, y: target.y + target.height * 0.9 });
    expect((await response).status()).toBe(200);
    await expect.poll(() => itemTitles(page, 'Chapitre 1 : Bases')).toEqual(['C1 - Contrôle de flux', 'C1 - Signals']);
    // Across modules: drop "C1 - Signals" on "C2 - Inputs".
    // Centre the source/target pair in the viewport (dnd-kit auto-scrolls when the pointer nears an edge).
    const sourceBox = (await page.getByRole('button', { name: 'Réorganiser « C1 - Signals », position 2 dans « Chapitre 1 : Bases »' }).boundingBox())!;
    const targetBox = (await page.getByRole('link', { name: 'C2 - Inputs' }).boundingBox())!;
    await page.evaluate(offset => window.scrollBy(0, offset), (sourceBox.y + targetBox.y) / 2 - 550);
    const other = (await page.getByRole('link', { name: 'C2 - Inputs' }).boundingBox())!;
    response = moved(page);
    await dragHandle(page, 'Réorganiser « C1 - Signals », position 2 dans « Chapitre 1 : Bases »', { x: other.x + other.width / 2, y: other.y + other.height / 2 });
    expect((await response).status()).toBe(200);
    await page.reload();
    await expect.poll(() => itemTitles(page, 'Chapitre 2 : Composants')).toEqual(['C1 - Signals', 'C2 - Inputs']);
    expect(await itemTitles(page, 'Chapitre 1 : Bases')).toEqual(['C1 - Contrôle de flux']);
  });

  test('"Déplacer vers…" dialog moves an item without a pointer', async ({ page }) => {
    await login(page, teacherEmail);
    await openContent(page);
    await page.getByRole('button', { name: 'Plus d\'options pour « C1 - Contrôle de flux »' }).click();
    await page.getByRole('menuitem', { name: 'Déplacer vers…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Module ou dossier de destination').selectOption({ label: 'Chapitre 2 : Composants' });
    await dialog.getByLabel('Position').selectOption({ label: 'Après « C2 - Inputs »' });
    const response = moved(page);
    await dialog.getByRole('button', { name: 'Déplacer' }).click();
    expect((await response).status()).toBe(200);
    await page.reload();
    await expect.poll(() => itemTitles(page, 'Chapitre 2 : Composants')).toEqual(['C1 - Signals', 'C2 - Inputs', 'C1 - Contrôle de flux']);
  });

  test('a backend failure restores the previous order and reports the error', async ({ page }) => {
    await login(page, teacherEmail);
    await openContent(page);
    const before = await containerTitles(page);
    await page.route('**/structure/move', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR' } }) }));
    await page.getByRole('button', { name: 'Monter « Chapitre 2 : Composants »' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await containerTitles(page)).toEqual(before);
    await page.unroute('**/structure/move');
    await page.reload();
    await expect.poll(() => containerTitles(page)).toEqual(before);
  });

  test('blocks: reorder with the keyboard and the move buttons, autosave, persisted after refresh', async ({ page }) => {
    await login(page, teacherEmail);
    await page.goto(`/teacher/courses/${courseId}/content/items/l1`);
    const blocks = page.locator('section[aria-label^="Bloc "]');
    await expect(blocks).toHaveCount(2);
    await page.getByRole('button', { name: 'Descendre le bloc Texte (position 1)' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Enregistré [(]/ })).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(blocks.first()).toHaveAttribute('aria-label', 'Bloc Code, 1 sur 2');
    // Keyboard sensor on the handle.
    await page.getByRole('button', { name: 'Réorganiser le bloc Texte (position 2)' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await expect(page.getByRole('status').filter({ hasText: /^Enregistré [(]/ })).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(blocks.first()).toHaveAttribute('aria-label', 'Bloc Texte, 1 sur 2');
  });

  test('visibility from the outline drives the student preview; students cannot reorganize', async ({ page, browser }) => {
    await login(page, teacherEmail);
    await openContent(page);
    await page.getByRole('button', { name: 'Aperçu étudiant' }).click();
    await expect(page.getByRole('navigation', { name: 'Plan vu par les étudiants' })).not.toContainText('Chapitre 3 : Routage');
    await page.getByRole('button', { name: 'Modifier' }).first().click();
    const response = page.waitForResponse(candidate => candidate.url().includes('/structure/containers/c3') && candidate.request().method() === 'PATCH');
    await page.getByLabel('Visibilité de « Chapitre 3 : Routage »').selectOption('visible');
    expect((await response).status()).toBe(200);
    await page.getByRole('button', { name: 'Aperçu étudiant' }).click();
    await expect(page.getByRole('navigation', { name: 'Plan vu par les étudiants' })).toContainText('Chapitre 3 : Routage');

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await login(studentPage, studentEmail);
    const forbidden = await studentPage.request.post(`${api}/courses/${courseId}/structure/move`, { data: { type: 'container', id: 'c1', toIndex: 2, expectedVersion: 0 } });
    expect(forbidden.status()).toBe(403);
    await studentPage.goto(`/teacher/courses/${courseId}/content`);
    await expect(studentPage.getByRole('heading', { name: /Application Côté Client/ })).toHaveCount(0);
    await studentContext.close();
  });
});
