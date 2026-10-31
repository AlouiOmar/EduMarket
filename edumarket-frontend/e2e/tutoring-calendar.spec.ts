import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, login, objectId, seedUser, unique, withDb } from './support/lms';

/**
 * Tutoring ↔ calendar bridges: a slot published from the calendar is the same record the Tutoring page manages; each page
 * links to the other's view of it; payment and status rules stay those of the tutoring workflow.
 */
test.use({ timezoneId: 'Africa/Tunis', locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });

const teacherEmail = unique('tc-teacher'), studentEmail = unique('tc-student');
let teacherId = '', studentId = '';
const tunisDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
const slotDay = tunisDate(10);
const slotStart = new Date(`${slotDay}T15:00:00.000Z`); // 16:00 in Tunis (UTC+1)
const slotQuery = () => ({ teacherId: objectId(teacherId), startAt: slotStart });

test.beforeAll(async () => {
  await withDb(async db => {
    teacherId = String(await seedUser(db, 'teacher', 'Prof Passerelle', teacherEmail));
    studentId = String(await seedUser(db, 'student', 'Lina Passerelle', studentEmail));
  });
});

const tutoringRow = (page: Page, text: string) => page.locator('[id^="tutoring-"]').filter({ hasText: text });

test.describe.serial('tutoring ↔ calendar', () => {
  test.setTimeout(120_000);

  test('a teacher publishes a tutoring slot from the calendar, finds it in Tutoring and comes back to it', async ({ page }) => {
    await login(page, teacherEmail);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Créer une session' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvel événement' });
    await dialog.getByLabel('Type', { exact: true }).selectOption('slot');
    await expect(dialog.getByLabel('Type de session')).toHaveCount(0);
    await dialog.getByLabel('Sujet du créneau (facultatif)').fill('Bac maths');
    await dialog.getByLabel('Début').fill(`${slotDay}T16:00`);
    await dialog.getByLabel('Fin').fill(`${slotDay}T17:00`);
    await dialog.getByLabel('Modalité').selectOption('online');
    await dialog.getByLabel('Prix (€)').fill('25');
    // Double click: one slot only.
    await dialog.getByRole('button', { name: 'Publier le créneau' }).dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'Créneau publié.' })).toBeVisible();
    expect(await withDb(db => db.collection('tutoringsessions').countDocuments(slotQuery()))).toBe(1);

    // Same record on the Tutoring page.
    await page.goto('/teacher/tutoring');
    const row = tutoringRow(page, 'Bac maths');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('16:00');
    await expect(row).toContainText('Créneau libre · Tarif');

    // "See in calendar" → the right date, the slot highlighted and opened.
    await row.getByRole('link', { name: /Voir dans l'agenda le créneau/ }).click();
    await expect(page).toHaveURL(/\/calendar/);
    const opened = page.getByRole('dialog', { name: 'Modifier' });
    await expect(opened).toBeVisible();
    await expect(opened.getByLabel('Début')).toHaveValue(`${slotDay}T16:00`);
    await expect(opened.getByRole('link', { name: 'Ouvrir dans Tutorat' })).toBeVisible();
    await opened.getByRole('button', { name: 'Annuler' }).click();
    const event = page.locator('.fc-event', { hasText: 'Bac maths' });
    await expect(event).toBeVisible();
    await expect(event).toHaveClass(/fc-event-draggable/); // an open slot can still be moved
    await expect(page).not.toHaveURL(/event=/);
  });

  test('requests are managed on the Tutoring page, with the payment rule, and both pages show the same status', async ({ page, browser }) => {
    // A paid checkout started by the student (simulated at the database level: no payment provider in the e2e stack).
    await withDb(db => db.collection('tutoringsessions').updateOne(slotQuery(), { $set: { status: 'pending', studentId: objectId(studentId), subject: 'Dérivées', paymentStatus: 'awaiting_payment', reservationExpiresAt: new Date(Date.now() + 15 * 60_000) } }));
    const slotId = String((await withDb(db => db.collection('tutoringsessions').findOne(slotQuery())))!._id);

    await login(page, teacherEmail);
    await page.goto(`/calendar?date=${encodeURIComponent(slotStart.toISOString())}&event=session-${slotId}`);
    const details = page.getByRole('dialog', { name: 'Dérivées' });
    await expect(details).toContainText('Paiement en attente');
    await expect(details).toContainText('Lina Passerelle');
    await details.getByRole('link', { name: 'Gérer les demandes' }).click();

    await expect(page).toHaveURL(/\/teacher\/tutoring/);
    const row = page.locator(`#tutoring-${slotId}`);
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeFocused();
    await expect(row).toContainText('Paiement en attente');
    await expect(row.getByRole('button', { name: 'Accepter' })).toBeDisabled();
    // Accessibility of the Tutoring page with a highlighted row (the highlight is not conveyed by colour alone: focus + aria-current).
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || '')).map(violation => ({ id: violation.id, nodes: violation.nodes.slice(0, 3).map(node => node.target.join(' ')) }))).toEqual([]);

    // Paid: the teacher can accept; the calendar then shows the confirmed session (same record, not draggable).
    await withDb(db => db.collection('tutoringsessions').updateOne(slotQuery(), { $set: { paymentStatus: 'paid', reservationExpiresAt: null } }));
    await page.reload();
    await page.locator(`#tutoring-${slotId}`).getByRole('button', { name: 'Accepter' }).click();
    await expect(page.locator(`#tutoring-${slotId}`)).toContainText('Confirmé');
    await page.locator(`#tutoring-${slotId}`).getByRole('link', { name: /Voir dans l'agenda/ }).click();
    const confirmed = page.getByRole('dialog', { name: 'Dérivées' });
    await expect(confirmed).toContainText('Confirmé');
    await expect(confirmed.getByRole('link', { name: 'Ouvrir dans Tutorat' })).toBeVisible();
    await confirmed.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page.locator('.fc-event', { hasText: 'Dérivées' })).not.toHaveClass(/fc-event-draggable/);
    expect(await withDb(db => db.collection('tutoringsessions').countDocuments(slotQuery()))).toBe(1);

    // The student sees the same confirmed session, without the teacher's management actions or slot publishing.
    const context = await browser.newContext({ timezoneId: 'Africa/Tunis', locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });
    const student = await context.newPage();
    await login(student, studentEmail);
    await student.goto(`/calendar?date=${encodeURIComponent(slotStart.toISOString())}&event=session-${slotId}`);
    const studentView = student.getByRole('dialog', { name: 'Dérivées' });
    await expect(studentView).toContainText('Confirmé');
    await expect(studentView.getByRole('link', { name: /Gérer les demandes|Ouvrir dans Tutorat/ })).toHaveCount(0);
    await studentView.getByRole('button', { name: 'Fermer' }).last().click();
    await student.getByRole('button', { name: 'Créer un événement' }).click();
    await expect(student.getByRole('dialog', { name: 'Nouvel événement' }).getByLabel('Type', { exact: true }).locator('option[value="slot"]')).toHaveCount(0);
    await student.goto('/teacher/tutoring');
    await expect(student.getByRole('heading', { name: 'Accès refusé (403)' })).toBeVisible();
    await expect(student.locator('[id^="tutoring-"]')).toHaveCount(0);
    await context.close();
  });

  test('the Tutoring filter hides and shows tutoring items only', async ({ page }) => {
    await login(page, teacherEmail);
    const created = await page.request.post(`${api}/calendar/events`, { data: { title: 'Réunion équipe', type: 'meeting', start: `${slotDay}T18:00`, end: `${slotDay}T19:00`, timeZone: 'Africa/Tunis' } });
    expect(created.status()).toBe(201);
    await page.goto(`/calendar?date=${slotDay}`);
    await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Semaine' }).click();
    await expect(page.locator('.fc-event', { hasText: 'Dérivées' })).toBeVisible();
    await expect(page.locator('.fc-event', { hasText: 'Réunion équipe' })).toBeVisible();
    const filter = page.getByRole('button', { name: /Tutorat \(créneaux et séances\)/ });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.fc-event', { hasText: 'Dérivées' })).toHaveCount(0);
    await expect(page.locator('.fc-event', { hasText: 'Réunion équipe' })).toBeVisible();
    await filter.click();
    await expect(page.locator('.fc-event', { hasText: 'Dérivées' })).toBeVisible();
  });
});
