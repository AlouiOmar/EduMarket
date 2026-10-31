import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
// The API lives either in ./backend (single checkout) or in the sibling ../edumarket-backend folder.
const backendDir = process.env.EDUMARKET_BACKEND_DIR || [path.join(root, 'backend'), path.join(root, '..', 'edumarket-backend')].find(candidate => existsSync(path.join(candidate, 'package.json'))) || path.join(root, 'backend');
const mongoUri = process.env.EDUMARKET_TEST_MONGO_URI;
if (!mongoUri) {
  throw new Error('Set EDUMARKET_TEST_MONGO_URI to a local MongoDB database whose name ends in _test.');
}

let parsedMongoUri: URL;
try {
  parsedMongoUri = new URL(mongoUri);
} catch {
  throw new Error('EDUMARKET_TEST_MONGO_URI must be a valid local mongodb:// URL.');
}
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const databaseName = decodeURIComponent(parsedMongoUri.pathname.slice(1));
if (parsedMongoUri.protocol !== 'mongodb:' || !allowedHosts.has(parsedMongoUri.hostname) || !databaseName.endsWith('_test')) {
  throw new Error('Browser E2E tests only run against a local mongodb:// database whose name ends in _test.');
}

const appOrigin = 'http://127.0.0.1:3300';
const apiOrigin = 'http://127.0.0.1:4400';
// SCORM content is served from a different host name than the app and the API cookie (localhost vs 127.0.0.1): isolation.
const scormContentOrigin = 'http://localhost:4400';
// LTI platform key for this test run only, generated at startup (never stored in the repository).
const ltiKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    baseURL: appOrigin,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: backendDir,
      url: `${apiOrigin}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '4400',
        MONGODB_URI: mongoUri,
        JWT_SECRET: 'edumarket-playwright-isolated-test-secret-32',
        CORS_ORIGIN: appOrigin,
        APP_ORIGIN: appOrigin,
        PRIVATE_UPLOAD_DIR: path.join(root, '.tmp', 'playwright-private-uploads'),
        PAYMENT_PROVIDER: 'sandbox',
        SANDBOX_WEBHOOK_SECRET: 'playwright-sandbox-webhook-secret',
        SCORM_CONTENT_ORIGIN: scormContentOrigin,
        LTI_PRIVATE_KEY: ltiKey,
        LTI_KEY_ID: 'playwright-run',
        LTI_ISSUER: apiOrigin,
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 3300 --strictPort',
      cwd: root,
      url: appOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_DATA_MODE: 'api',
        VITE_API_BASE_URL: `${apiOrigin}/api/v1`,
      },
    },
  ],
});
