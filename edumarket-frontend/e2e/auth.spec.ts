import { expect, test } from '@playwright/test';

test('a student can register, verify email, and log in through the API', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = 'E2e-test-password-2026';
  const apiCalls: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith('http://127.0.0.1:4400/api/v1/')) apiCalls.push(request.url());
  });

  await page.goto('/auth/register');
  const registrationForm = page.locator('form');
  await registrationForm.locator('input').nth(0).fill('E2E Student');
  await registrationForm.locator('input[type="email"]').fill(email);
  await registrationForm.locator('input[type="password"]').nth(0).fill(password);
  await registrationForm.locator('input[type="password"]').nth(1).fill(password);
  await registrationForm.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/auth\/verify-email\?/);
  const previewLink = page.locator('a[href*="/auth/verify-email"]');
  await expect(previewLink).toBeVisible();
  const verificationUrl = await previewLink.getAttribute('href');
  expect(verificationUrl).toBeTruthy();
  await page.goto(verificationUrl!);

  await expect(page).toHaveURL(/\/auth\/verify-email\?verified=1/);
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto('/auth/login');
  const loginForm = page.locator('form');
  await loginForm.locator('input[type="email"]').fill(email);
  await loginForm.locator('input[type="password"]').fill(password);
  await loginForm.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/student\/dashboard/);
  expect(apiCalls.some(url => url.endsWith('/auth/register'))).toBe(true);
  expect(apiCalls.some(url => url.endsWith('/auth/email/verification/confirm'))).toBe(true);
  expect(apiCalls.some(url => url.endsWith('/auth/login'))).toBe(true);
});

test('the login route translates and applies RTL in French, English, and Arabic', async ({ page }) => {
  await page.goto('/auth/login');
  const language = page.locator('select').first();

  await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: 'Log in to your account' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await language.selectOption('ar');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول إلى حسابك' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await language.selectOption('fr');
  await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
