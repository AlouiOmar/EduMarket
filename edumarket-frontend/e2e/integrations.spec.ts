import { expect, test } from '@playwright/test';
import { api, backendModule, enroll, login, seedCourse, seedUser, unique, withDb } from './support/lms';

// Recette : package SCORM exécuté dans un environnement isolé ; lancement LTI invalide refusé ;
// conversation d'IA inaccessible à un utilisateur non autorisé (et aucune IA simulée sans fournisseur).
const adminEmail = unique('integ-admin'), teacherEmail = unique('integ-teacher'), studentEmail = unique('integ-student'), strangerEmail = unique('integ-stranger');
let courseId = '';

test.beforeAll(async () => {
  await withDb(async db => {
    await seedUser(db, 'admin', 'Integ Admin', adminEmail);
    const teacher = await seedUser(db, 'teacher', 'Integ Teacher', teacherEmail);
    const student = await seedUser(db, 'student', 'Lina Haddad', studentEmail);
    await seedUser(db, 'student', 'Stranger', strangerEmail);
    const course = await seedCourse(db, teacher, 'Cours intégrations', [{ id: 'c1', title: 'Chapitre 1', order: 0, kind: 'module', description: '', visibility: 'visible', lessons: [] }]);
    courseId = String(course);
    await enroll(db, student, course);
  });
});

const SCO = `<!doctype html><html><head><meta charset="utf-8"><title>SCO</title></head><body><p id="out">loading</p><script>
var api = window.parent && window.parent.API;
var out = document.getElementById('out');
if (!api) { out.textContent = 'NO API'; } else {
  api.LMSInitialize('');
  api.LMSSetValue('cmi.core.lesson_status', 'passed');
  api.LMSSetValue('cmi.core.score.raw', '80');
  api.LMSSetValue('cmi.core.score.max', '100');
  var leaked = 'unknown';
  try { leaked = String(document.cookie.indexOf('edumarket_access') >= 0); } catch (e) { leaked = 'blocked'; }
  var entry = api.LMSGetValue('cmi.core.entry');
  api.LMSCommit('');
  api.LMSFinish('');
  out.textContent = 'SCO OK entry=' + entry + ' cookie=' + leaked;
}
</script></body></html>`;
const MANIFEST = `<?xml version="1.0"?><manifest identifier="e2e" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schemaversion>1.2</schemaversion></metadata>
<organizations default="o"><organization identifier="o"><title>Module signals</title><item identifier="i" identifierref="r"><title>SCO</title></item></organization></organizations>
<resources><resource identifier="r" type="webcontent" adlcp:scormtype="sco" href="index.html"/></resources></manifest>`;

test('a SCORM package runs in the isolated player and records completion and score', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { createZip } = await backendModule<{ createZip: (entries: { name: string; data: string }[]) => Buffer }>('common/zip.js');
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/integrations`);
  await expect(page.getByText('Lecteur isolé opérationnel')).toBeVisible();
  await page.getByLabel('Importer un package (.zip)').setInputFiles({ name: 'signals.zip', mimeType: 'application/zip', buffer: createZip([{ name: 'imsmanifest.xml', data: MANIFEST }, { name: 'index.html', data: SCO }]) });
  await expect(page.getByText('« Module signals » importé et validé.')).toBeVisible();
  const bad = createZip([{ name: 'imsmanifest.xml', data: MANIFEST }, { name: 'index.html', data: SCO }, { name: 'payload.exe', data: 'MZ' }]);
  await page.getByLabel('Importer un package (.zip)').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: bad });
  await expect(page.getByRole('alert')).toContainText('type de fichier interdit');

  // The item is created through the outline API, then made visible.
  const packages = await (await page.request.get(`${api}/scorm/${courseId}/packages`)).json() as { data: { packages: { id: string }[] } };
  const outline = await (await page.request.get(`${api}/courses/mine/${courseId}`)).json() as { data: { structureVersion: number } };
  const created = await (await page.request.post(`${api}/courses/${courseId}/structure/items`, { data: { expectedVersion: outline.data.structureVersion, containerId: 'c1', type: 'scorm', title: 'Module interactif', scormPackageId: packages.data.packages[0].id } })).json() as { data: { createdId: string } };
  expect((await page.request.patch(`${api}/courses/${courseId}/structure/items/${created.data.createdId}`, { data: { visibility: 'visible' } })).status()).toBe(200);

  const context = await browser.newContext();
  const student = await context.newPage();
  await login(student, studentEmail);
  await student.goto(`/learning/${courseId}`);
  await student.getByRole('button', { name: 'Démarrer « Module interactif »' }).click();
  const player = student.frameLocator('iframe[title="Module interactif"]');
  const sco = player.frameLocator('iframe');
  await expect(sco.locator('#out')).toHaveText(/^SCO OK entry=ab-initio cookie=false$/, { timeout: 20_000 });
  // The player is served from the isolated origin (different host from the app and from the API cookie).
  expect(await student.locator('iframe[title="Module interactif"]').getAttribute('src')).toMatch(/^http:\/\/localhost:4400\/scorm-content\//);
  await expect.poll(async () => (await (await student.request.get(`${api}/enrollments/${courseId}`)).json() as { data: { completedLessonIds: string[] } }).data.completedLessonIds, { timeout: 15_000 }).toContain(created.data.createdId);
  const book = await (await page.request.get(`${api}/gradebook/${courseId}`)).json() as { data: { columns: { id: string; source: { kind: string } }[]; entries: { columnId: string; score: number }[] } };
  const column = book.data.columns.find(row => row.source.kind === 'scorm')!;
  expect(book.data.entries.find(entry => entry.columnId === column.id)?.score).toBe(80);
  // The content host never serves the API, and the API host never serves package content.
  expect((await student.request.get(`http://localhost:4400/scorm-content/forged-token/`)).status()).toBe(404);
  await context.close();
});

test('invalid LTI launches are refused', async ({ page, browser }) => {
  await login(page, adminEmail);
  const tool = await (await page.request.post(`${api}/lti/tools`, { data: { name: 'Outil e2e', oidcLoginUrl: 'https://tool.example.test/login', targetLinkUri: 'https://tool.example.test/launch', redirectUris: ['https://tool.example.test/launch'], jwksUrl: 'https://tool.example.test/jwks' } })).json() as { data: { id: string; clientId: string } };
  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  await login(teacher, teacherEmail);
  const outline = await (await teacher.request.get(`${api}/courses/mine/${courseId}`)).json() as { data: { structureVersion: number } };
  const created = await (await teacher.request.post(`${api}/courses/${courseId}/structure/items`, { data: { expectedVersion: outline.data.structureVersion, containerId: 'c1', type: 'lti', title: 'Exercice externe', ltiToolId: tool.data.id } })).json() as { data: { createdId: string } };
  await teacher.request.patch(`${api}/courses/${courseId}/structure/items/${created.data.createdId}`, { data: { visibility: 'visible' } });
  await teacherContext.close();

  const context = await browser.newContext();
  const student = await context.newPage();
  await login(student, studentEmail);
  await student.goto(`/learning/${courseId}`);
  await student.getByRole('button', { name: /Exercice externe/ }).first().click();
  const launchLink = student.getByRole('link', { name: 'Lancer « Exercice externe »' });
  await expect(launchLink).toBeVisible();
  const launch = await student.request.get((await launchLink.getAttribute('href'))!, { maxRedirects: 0 });
  expect(launch.status()).toBe(302);
  const loginHint = new URL(launch.headers().location).searchParams.get('login_hint')!;
  const query = (overrides: Record<string, string>) => new URLSearchParams({ scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none', client_id: tool.data.clientId, redirect_uri: 'https://tool.example.test/launch', state: 's', nonce: 'n', login_hint: loginHint, ...overrides }).toString();
  await student.goto(`${api}/lti/authorize?${query({ redirect_uri: 'https://attacker.example.test/steal' })}`);
  await expect(student.locator('body')).toContainText('LTI_INVALID_REDIRECT_URI');
  await student.goto(`${api}/lti/authorize?${query({ client_id: 'unknown' })}`);
  await expect(student.locator('body')).toContainText('LTI_INVALID_CLIENT');
  await expect(student.locator('form#lti')).toHaveCount(0);
  await context.close();

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await login(stranger, strangerEmail);
  expect((await stranger.request.get(`${api}/lti/launch/${courseId}/${created.data.createdId}`, { maxRedirects: 0 })).status()).toBe(404);
  await strangerContext.close();
});

test('AI conversations: not simulated without a provider, unreachable for unauthorized users', async ({ page, browser }) => {
  await login(page, teacherEmail);
  await page.goto(`/teacher/courses/${courseId}/integrations`);
  await expect(page.getByText(/Aucun fournisseur d'IA n'est configuré sur le serveur/)).toBeVisible();
  const created = await (await page.request.post(`${api}/ai/${courseId}/activities`, { data: { title: 'Tuteur', systemPrompt: 'Tu es un tuteur socratique, ne donne pas la solution.' } })).json() as { data: { id: string } };
  expect((await page.request.patch(`${api}/ai/${courseId}/activities/${created.data.id}`, { data: { status: 'published' } })).status()).toBe(503);

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await login(stranger, strangerEmail);
  expect((await stranger.request.get(`${api}/ai/${courseId}/student/activities`)).status()).toBe(404);
  expect((await stranger.request.get(`${api}/ai/${courseId}/activities/${created.data.id}/conversations`)).status()).toBe(403);
  await strangerContext.close();
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await login(student, studentEmail);
  await student.goto(`/student/courses/${courseId}/activities`);
  await expect(student.getByText("Les conversations d'IA ne sont pas disponibles pour le moment.")).toBeVisible();
  expect((await student.request.get(`${api}/ai/${courseId}/activities/${created.data.id}/conversations`)).status()).toBe(403);
  await studentContext.close();
});
