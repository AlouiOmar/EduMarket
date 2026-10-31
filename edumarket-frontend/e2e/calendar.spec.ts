import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, enroll, login, seedCourse, seedUser, unique, withDb } from './support/lms';

/**
 * Interactive calendar: views, slot selection → prefilled popup, create / overlap / move / resize / delete, rollback on a server
 * error, colours and filters, permissions, chat date detection (nothing created before the user validates), unconfigured providers.
 * The browser runs in Africa/Tunis so wall-clock times are deterministic.
 */
test.use({ timezoneId: 'Africa/Tunis', locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });

const teacherEmail = unique('cal-teacher'), studentEmail = unique('cal-student');
let teacherId = '', studentId = '';
const tunisDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
/** Wednesday of next week (always in the future, fully inside the week view after one "next"). */
function nextWeekWednesday() {
  const today = new Date(`${tunisDate(0)}T12:00:00Z`);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  return tunisDate(7 - mondayOffset + 2);
}

test.beforeAll(async () => {
  await withDb(async db => {
    const teacher = await seedUser(db, 'teacher', 'Prof Calendrier', teacherEmail);
    const student = await seedUser(db, 'student', 'Amira Calendrier', studentEmail);
    teacherId = String(teacher); studentId = String(student);
    const course = await seedCourse(db, teacher, 'Angular avancé', []);
    await enroll(db, student, course);
    const now = new Date();
    const conversation = await db.collection('conversations').insertOne({ participants: [teacher, student], participantKey: [teacherId, studentId].sort().join(':'), lastMessageText: 'On peut faire une réunion', lastMessageAt: now, lastSenderId: student, createdAt: now, updatedAt: now });
    for (const [offset, text] of [[2, 'Je termine à 14h.'], [1, 'On peut faire une réunion demain entre 14h et 15h pour avancer sur le projet ?']] as const) {
      const at = new Date(now.getTime() - offset * 60_000);
      await db.collection('messages').insertOne({ conversationId: conversation.insertedId, senderId: student, text, readBy: [student], hiddenAt: null, createdAt: at, updatedAt: at });
    }
  });
});

async function lane(page: Page, date: string, time: string) {
  const row = page.locator(`td.fc-timegrid-slot-lane[data-time="${time}"]`);
  await row.scrollIntoViewIfNeeded();
  const rowBox = (await row.boundingBox())!, colBox = (await page.locator(`td.fc-timegrid-col[data-date="${date}"]`).boundingBox())!;
  return { x: colBox.x + colBox.width / 2, top: rowBox.y, bottom: rowBox.y + rowBox.height, height: rowBox.height };
}
const feed = async (page: Page) => (await (await page.request.get(`${api}/calendar/feed?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86_400_000).toISOString())}`)).json()).data as Array<Record<string, any>>;
const tunisTime = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

test.describe.serial('interactive calendar', () => {
  test.setTimeout(180_000);

  test('views, navigation, slot selection → prefilled popup, create, overlap, move, resize, rollback, edit, delete', async ({ page }) => {
    await login(page, teacherEmail);
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
    const views = page.getByRole('group', { name: 'Vue' });
    const title = page.locator('[role="toolbar"] h2');

    await views.getByRole('button', { name: 'Mois' }).click();
    await expect(views.getByRole('button', { name: 'Mois' })).toHaveAttribute('aria-pressed', 'true');
    const monthTitle = await title.textContent();
    await page.getByRole('button', { name: 'Période suivante' }).click();
    await expect(title).not.toHaveText(monthTitle || '');
    await page.getByRole('button', { name: 'Aujourd\'hui' }).click();
    await expect(title).toHaveText(monthTitle || '');
    await views.getByRole('button', { name: 'Semaine' }).click();
    await page.getByRole('button', { name: 'Période suivante' }).click();

    // Select 10:00 → 11:00 on next week's Wednesday by dragging over the grid.
    const day = nextWeekWednesday();
    const ten = await lane(page, day, '10:00:00'), halfPast = await lane(page, day, '10:30:00');
    await page.mouse.move(ten.x, ten.top + 4);
    await page.mouse.down();
    await page.mouse.move(halfPast.x, halfPast.bottom - 4, { steps: 8 });
    await page.mouse.up();
    const dialog = page.getByRole('dialog', { name: 'Nouvel événement' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Début')).toHaveValue(`${day}T10:00`);
    await expect(dialog.getByLabel('Fin')).toHaveValue(`${day}T11:00`);
    await expect(dialog.getByLabel('Fuseau horaire')).toHaveValue('Africa/Tunis');
    await dialog.getByLabel('Type', { exact: true }).selectOption('meeting');
    await dialog.getByLabel('Titre').fill('Point d\'avancement');
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Événement enregistré.' })).toBeVisible();
    await expect(page.locator('.fc-event', { hasText: 'Point d\'avancement' })).toBeVisible();

    // Overlap: explained, then saved only once confirmed; both events are shown side by side.
    await page.getByRole('button', { name: 'Créer une session' }).click();
    const second = page.getByRole('dialog', { name: 'Nouvel événement' });
    await second.getByLabel('Type', { exact: true }).selectOption('personal');
    await second.getByLabel('Titre').fill('Révision');
    await second.getByLabel('Début').fill(`${day}T10:30`);
    await second.getByLabel('Fin').fill(`${day}T11:30`);
    await expect(second.getByRole('alert').filter({ hasText: 'Point d\'avancement' })).toBeVisible();
    await second.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(second.getByText('Ce créneau chevauche d\'autres événements : confirmez ou changez l\'horaire.')).toBeVisible();
    await second.getByLabel('Enregistrer malgré le chevauchement').check();
    await second.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.locator('.fc-event', { hasText: 'Révision' })).toBeVisible();
    await expect(page.locator('.fc-event', { hasText: 'Point d\'avancement' })).toBeVisible();

    // Move "Révision" to 15:00 by drag and drop (no overlap there).
    const revision = page.locator('.fc-event', { hasText: 'Révision' });
    // Target first: locating it may scroll the page, so the source position is read afterwards.
    const three = await lane(page, day, '15:00:00');
    const revisionBox = (await revision.boundingBox())!;
    await page.mouse.move(revisionBox.x + revisionBox.width / 2, revisionBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(three.x, three.top + 4, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: 'Déplacé' })).toBeVisible();
    await expect.poll(async () => tunisTime((await feed(page)).find(item => item.title === 'Révision')!.start)).toBe('15:00');

    // Resize it by one hour from its bottom edge.
    const moved = page.locator('.fc-event', { hasText: 'Révision' });
    await moved.hover();
    const handle = moved.locator('.fc-event-resizer-end');
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + three.height * 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => tunisTime((await feed(page)).find(item => item.title === 'Révision')!.end)).toBe('17:00');

    // A server error while moving puts the event back and explains it.
    await page.route('**/api/v1/calendar/events/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR' } }) }) : route.continue());
    const beforeFailure = (await feed(page)).find(item => item.title === 'Révision')!.start;
    const toMove = page.locator('.fc-event', { hasText: 'Révision' });
    const eight = await lane(page, day, '08:00:00');
    const box = (await toMove.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(eight.x, eight.top + 4, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.unroute('**/api/v1/calendar/events/*');
    expect((await feed(page)).find(item => item.title === 'Révision')!.start).toBe(beforeFailure);
    // Back at 15:00 in the grid (measured against the slot, since the error banner shifts the page).
    await expect.poll(async () => { const slot = await lane(page, day, '15:00:00'); return Math.abs((await page.locator('.fc-event', { hasText: 'Révision' }).boundingBox())!.y - slot.top) < 4; }).toBe(true);

    // Edit through the popup, then delete.
    await page.locator('.fc-event', { hasText: 'Point d\'avancement' }).click();
    const edit = page.getByRole('dialog', { name: 'Modifier' });
    await edit.getByLabel('Titre').fill('Point d\'avancement (salle B)');
    await edit.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.locator('.fc-event', { hasText: 'salle B' })).toBeVisible();
    await page.locator('.fc-event', { hasText: 'Révision' }).click();
    await page.getByRole('dialog', { name: 'Modifier' }).getByRole('button', { name: 'Supprimer' }).click();
    await page.getByRole('dialog', { name: 'Supprimer cet événement ?' }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.locator('.fc-event', { hasText: 'Révision' })).toHaveCount(0);
  });

  test('colours and filters are per user, persisted, and the agenda lists details', async ({ page }) => {
    await login(page, teacherEmail);
    await page.goto('/calendar');
    await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Semaine' }).click();
    await page.getByRole('button', { name: 'Période suivante' }).click();
    const event = page.locator('.fc-event', { hasText: 'salle B' });
    await expect(event).toBeVisible();
    await page.getByLabel('Couleur de « Mes événements EduMarket »').fill('#7f1d1d');
    await expect(event).toHaveCSS('background-color', 'rgb(127, 29, 29)');
    await page.getByRole('button', { name: 'Masquer « Mes événements EduMarket »' }).click();
    await expect(event).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Période suivante' }).click();
    await expect(page.locator('.fc-event', { hasText: 'salle B' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Afficher « Mes événements EduMarket »' }).click();
    await expect(page.locator('.fc-event', { hasText: 'salle B' })).toHaveCSS('background-color', 'rgb(127, 29, 29)');

    await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Agenda' }).click();
    await page.getByRole('combobox', { name: 'Période' }).selectOption('30');
    await page.getByRole('combobox', { name: 'Type' }).selectOption('event');
    const entry = page.getByRole('button', { name: /salle B/ });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('1 h 00');
    await expect(entry).toContainText('Mes événements EduMarket');
  });

  test('student: sees only what concerns them, answers an invitation, cannot move it', async ({ page, browser }) => {
    await login(page, teacherEmail);
    const day = nextWeekWednesday();
    const invite = await page.request.post(`${api}/calendar/events`, { data: { title: 'Bilan de mi-parcours', type: 'meeting', start: `${day}T16:00`, end: `${day}T16:30`, timeZone: 'Africa/Tunis', participantIds: [studentId], notifyParticipants: true } });
    expect(invite.status()).toBe(201);
    const context = await browser.newContext({ timezoneId: 'Africa/Tunis', locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });
    const student = await context.newPage();
    await login(student, studentEmail);
    await student.goto('/calendar');
    await student.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Semaine' }).click();
    await student.getByRole('button', { name: 'Période suivante' }).click();
    const invitation = student.locator('.fc-event', { hasText: 'Bilan de mi-parcours' });
    await expect(invitation).toBeVisible();
    await expect(student.locator('.fc-event', { hasText: 'salle B' })).toHaveCount(0);
    await expect(invitation).not.toHaveClass(/fc-event-draggable/);
    await invitation.click();
    const details = student.getByRole('dialog', { name: 'Bilan de mi-parcours' });
    await expect(details.getByRole('textbox')).toHaveCount(0);
    await details.getByRole('button', { name: 'Accepter' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'accepté' })).toBeVisible();
    await context.close();
  });

  test('chat: a proposal is detected, nothing is created until the user saves the prefilled popup', async ({ page }) => {
    await login(page, studentEmail);
    await page.goto('/messages');
    const suggestion = page.getByRole('group', { name: 'Suggestion de rendez-vous' });
    await expect(suggestion).toHaveCount(1); // "Je termine à 14h." gives none
    await expect(suggestion).toContainText('14:00');
    await expect(suggestion).toContainText('15:00');
    expect((await feed(page)).some(item => item.title.includes('avancer sur le projet'))).toBe(false);

    await suggestion.getByRole('button', { name: 'Créer un événement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvel événement' });
    await expect(dialog.getByLabel('Début')).toHaveValue(`${tunisDate(1)}T14:00`);
    await expect(dialog.getByLabel('Fin')).toHaveValue(`${tunisDate(1)}T15:00`);
    await expect(dialog.getByLabel('Titre')).toHaveValue('Réunion — avancer sur le projet');
    // The other person is proposed, not added.
    await expect(dialog.getByRole('checkbox', { name: /Prof Calendrier/ })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Ajouter Prof Calendrier' }).click();
    await expect(dialog.getByRole('checkbox', { name: /Prof Calendrier/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Enregistrer et envoyer les invitations' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Événement enregistré.' })).toBeVisible();
    const created = (await feed(page)).find(item => item.title === 'Réunion — avancer sur le projet')!;
    expect(tunisTime(created.start)).toBe('14:00');
    expect(created.participants.map((person: { name: string }) => person.name)).toEqual(['Prof Calendrier']);

    await page.getByRole('group', { name: 'Suggestion de rendez-vous' }).getByRole('button', { name: 'Ignorer' }).click();
    await expect(page.getByRole('group', { name: 'Suggestion de rendez-vous' })).toHaveCount(0);
  });

  test('teacher: propose a tutoring session from the chat; the student answers it in the calendar', async ({ page, browser }) => {
    await login(page, teacherEmail);
    await page.goto('/messages');
    await page.getByRole('group', { name: 'Suggestion de rendez-vous' }).getByRole('button', { name: 'Proposer une session' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvel événement' });
    await expect(dialog.getByLabel('Type de session')).toHaveValue('proposal');
    await dialog.getByRole('button', { name: 'Choisir Amira Calendrier' }).click();
    await expect(dialog.getByLabel('Étudiant')).toHaveValue(studentId);
    // The student has a meeting at that time (previous test): the overlap is shown without revealing what it is.
    const busy = dialog.getByRole('alert').filter({ hasText: 'Amira Calendrier est occupé sur ce créneau' });
    await expect(busy).toBeVisible();
    await expect(busy).not.toContainText('avancer sur le projet');
    await dialog.getByLabel('Enregistrer malgré le chevauchement').check();
    await dialog.getByRole('button', { name: 'Envoyer la proposition' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Proposition envoyée' })).toBeVisible();

    const context = await browser.newContext({ timezoneId: 'Africa/Tunis', locale: 'fr-FR', viewport: { width: 1400, height: 1000 } });
    const student = await context.newPage();
    await login(student, studentEmail);
    await student.goto('/calendar');
    await student.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Agenda' }).click();
    await student.getByRole('combobox', { name: 'Type' }).selectOption('session');
    const proposal = student.getByRole('button', { name: /Réunion — avancer sur le projet/ });
    await expect(proposal).toContainText('En attente');
    await proposal.click();
    await student.getByRole('dialog', { name: 'Réunion — avancer sur le projet' }).getByRole('button', { name: 'Accepter' }).click();
    await expect(student.getByRole('status').filter({ hasText: 'accepté' })).toBeVisible();
    await expect(student.getByRole('button', { name: /Réunion — avancer sur le projet/ })).toContainText('Confirmé');
    await context.close();
  });

  test('providers not configured: explicit state, no button that does nothing', async ({ page }) => {
    await login(page, teacherEmail);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Synchronisation' }).click();
    const google = page.getByRole('article', { name: 'Google Agenda' }), microsoft = page.getByRole('article', { name: 'Microsoft Outlook' });
    await expect(google).toContainText('Non configuré');
    await expect(google).toContainText('GOOGLE_CLIENT_ID');
    await expect(microsoft).toContainText('MICROSOFT_CALENDAR_REDIRECT_URI');
    await expect(page.getByRole('button', { name: /Connecter/ })).toHaveCount(0);
  });

  test('Arabic (RTL) calendar and accessibility audit of the calendar and its popup', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('app_language', 'ar'));
    await login(page, studentEmail);
    await page.goto('/calendar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الأجندة' })).toBeVisible();
    // The last view is remembered per user (Agenda from the previous test): back to the week grid.
    await page.getByRole('group', { name: 'العرض' }).getByRole('button', { name: 'أسبوع' }).click();
    await expect(page.locator('.fc')).toHaveClass(/fc-direction-rtl/);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''));
    await page.getByRole('button', { name: 'إنشاء حدث' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialogResults = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    serious.push(...dialogResults.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || '')));
    expect(serious.map(violation => ({ id: violation.id, nodes: violation.nodes.slice(0, 3).map(node => node.target.join(' ')) }))).toEqual([]);
  });
});
