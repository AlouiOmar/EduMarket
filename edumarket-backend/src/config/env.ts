import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default('EduMarket <onboarding@resend.dev>'),
  JITSI_BASE_URL: z.string().url().optional(),
  PRIVATE_UPLOAD_DIR: z.string().min(1).default('./private-uploads'),
  PAYMENT_PROVIDER: z.enum(['none', 'sandbox', 'stripe']).default('none'),
  PAYMENT_CURRENCY: z.string().regex(/^[a-z]{3}$/).default('eur'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  SANDBOX_WEBHOOK_SECRET: z.string().min(16).optional(),
  PAYOUT_HOLD_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  PAYOUT_MINIMUM_CENTS: z.coerce.number().int().min(0).default(2000),
  // Days a student's offline payment request (cash, cheque, transfer) stays open before it expires.
  OFFLINE_PAYMENT_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  // Cloud storage: Google Drive reuses the Google OAuth client with its own redirect URI; OneDrive uses a Microsoft Entra app.
  GOOGLE_DRIVE_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT: z.string().regex(/^[\w.-]+$/).default('common'),
  // Calendar sync (Outlook / Teams) reuses the Microsoft Entra app with its own redirect URI.
  MICROSOFT_CALENDAR_REDIRECT_URI: z.string().url().optional(),
  // Public HTTPS base URL of this API (…/api/v1) for provider push notifications. Absent = periodic/manual sync only.
  CALENDAR_WEBHOOK_BASE_URL: z.string().url().optional(),
  // Shared secret of POST /calendar/sync/cron, for an external scheduler when the host may sleep (Render free tier).
  CALENDAR_CRON_SECRET: z.string().min(32).optional(),
  // Dedicated key (32+ characters) encrypting provider tokens at rest; tokens encrypted before it existed stay readable.
  CALENDAR_TOKEN_KEY: z.string().min(32).optional(),
  // AI conversation activities: server-side provider only (keys never reach the browser). `none` = feature not operational.
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai-compatible']).default('none'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).max(100).optional(),
  // openai-compatible only (OpenAI, Mistral, a local Ollama…): base URL of the /chat/completions API.
  AI_BASE_URL: z.string().url().optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(4000).default(800),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  // LTI 1.3 platform: RSA private key (PEM, escaped newlines allowed), key id and issuer (this platform's public URL). Absent = not operational.
  LTI_PRIVATE_KEY: z.string().min(100).optional(),
  LTI_KEY_ID: z.string().min(1).max(100).optional(),
  LTI_ISSUER: z.string().url().optional(),
  // SCORM content is served only from this separate origin (no session cookie there). Absent = SCORM launches not operational.
  SCORM_CONTENT_ORIGIN: z.string().url().optional(),
  // Independent teacher applications: identity documents, diplomas and CVs. `local` = PRIVATE_UPLOAD_DIR/teacher-applications
  // (a development store unless PRIVATE_UPLOAD_PERSISTENT=true declares a persistent disk); `s3` = any S3-compatible private bucket.
  TEACHER_DOCUMENTS_STORAGE: z.enum(['local', 's3']).default('local'),
  PRIVATE_UPLOAD_PERSISTENT: z.enum(['true', 'false']).default('false'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().regex(/^[a-z0-9-]{2,40}$/).default('us-east-1'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Key prefix separating environments sharing a bucket (e.g. `prod/`, `staging/`).
  S3_PREFIX: z.string().regex(/^[\w./-]{0,100}$/).default('teacher-applications/'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  // Key (32+ characters) encrypting identity document numbers at rest; derived from JWT_SECRET when absent.
  TEACHER_DATA_KEY: z.string().min(32).optional(),
  TEACHER_DOCUMENT_MAX_MB: z.coerce.number().int().min(1).max(25).default(10),
  // Rejected or abandoned applications: files and identity data are purged after this many days (minimal record kept).
  TEACHER_APPLICATION_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  // Days after a rejection before the same account may start a new application.
  TEACHER_APPLICATION_REAPPLY_DAYS: z.coerce.number().int().min(0).max(730).default(90),
  // Test/local only: lets the link checker reach private addresses (refused in production).
  LINK_CHECK_ALLOW_PRIVATE: z.enum(['true', 'false']).default('false'),
});

// Empty values (e.g. `KEY=` in docker-compose) mean "not configured" for optional settings.
const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ')}`);
if (parsed.data.JITSI_BASE_URL) {
  const meetingBase = new URL(parsed.data.JITSI_BASE_URL);
  if (!['http:', 'https:'].includes(meetingBase.protocol) || meetingBase.username || meetingBase.password || meetingBase.search || meetingBase.hash || !['', '/'].includes(meetingBase.pathname) || (parsed.data.NODE_ENV === 'production' && meetingBase.protocol !== 'https:')) {
    throw new Error('Invalid environment: JITSI_BASE_URL must be a credential-free HTTP(S) origin without path, query or hash, and HTTPS in production.');
  }
}
if (parsed.data.PAYMENT_PROVIDER === 'sandbox' && parsed.data.NODE_ENV === 'production') {
  throw new Error('Invalid environment: PAYMENT_PROVIDER=sandbox is a development provider and cannot run in production.');
}
if (parsed.data.PAYMENT_PROVIDER === 'stripe' && (!parsed.data.STRIPE_SECRET_KEY || !parsed.data.STRIPE_WEBHOOK_SECRET)) {
  throw new Error('Invalid environment: PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
}
// Each Google feature (Calendar: GOOGLE_REDIRECT_URI, Drive: GOOGLE_DRIVE_REDIRECT_URI) needs the shared client id and secret.
const googleClient = [parsed.data.GOOGLE_CLIENT_ID, parsed.data.GOOGLE_CLIENT_SECRET];
const googleFeatures = [parsed.data.GOOGLE_REDIRECT_URI, parsed.data.GOOGLE_DRIVE_REDIRECT_URI];
if ((googleClient.some(Boolean) || googleFeatures.some(Boolean)) && !(googleClient.every(Boolean) && googleFeatures.some(Boolean))) {
  throw new Error('Invalid environment: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together with GOOGLE_REDIRECT_URI and/or GOOGLE_DRIVE_REDIRECT_URI.');
}
// Each Microsoft feature (OneDrive: MICROSOFT_REDIRECT_URI, calendar: MICROSOFT_CALENDAR_REDIRECT_URI) needs the shared client id and secret.
const microsoftClient = [parsed.data.MICROSOFT_CLIENT_ID, parsed.data.MICROSOFT_CLIENT_SECRET];
const microsoftFeatures = [parsed.data.MICROSOFT_REDIRECT_URI, parsed.data.MICROSOFT_CALENDAR_REDIRECT_URI];
if ((microsoftClient.some(Boolean) || microsoftFeatures.some(Boolean)) && !(microsoftClient.every(Boolean) && microsoftFeatures.some(Boolean))) {
  throw new Error('Invalid environment: MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured together with MICROSOFT_REDIRECT_URI and/or MICROSOFT_CALENDAR_REDIRECT_URI.');
}
if (parsed.data.CALENDAR_WEBHOOK_BASE_URL && new URL(parsed.data.CALENDAR_WEBHOOK_BASE_URL).protocol !== 'https:' && parsed.data.NODE_ENV === 'production') {
  throw new Error('Invalid environment: CALENDAR_WEBHOOK_BASE_URL must be HTTPS (providers only notify HTTPS endpoints).');
}
if (parsed.data.AI_PROVIDER === 'anthropic' && !parsed.data.AI_API_KEY) {
  throw new Error('Invalid environment: AI_PROVIDER=anthropic requires AI_API_KEY.');
}
if (parsed.data.AI_PROVIDER === 'openai-compatible' && !parsed.data.AI_BASE_URL) {
  throw new Error('Invalid environment: AI_PROVIDER=openai-compatible requires AI_BASE_URL (and AI_API_KEY unless the endpoint is local).');
}
const ltiKeys = [parsed.data.LTI_PRIVATE_KEY, parsed.data.LTI_KEY_ID, parsed.data.LTI_ISSUER];
if (ltiKeys.some(Boolean) && !ltiKeys.every(Boolean)) {
  throw new Error('Invalid environment: LTI_PRIVATE_KEY, LTI_KEY_ID and LTI_ISSUER must be configured together.');
}
if (parsed.data.SCORM_CONTENT_ORIGIN) {
  const content = new URL(parsed.data.SCORM_CONTENT_ORIGIN);
  if ([parsed.data.APP_ORIGIN, parsed.data.CORS_ORIGIN].some(origin => new URL(origin).hostname === content.hostname)) {
    throw new Error('Invalid environment: SCORM_CONTENT_ORIGIN must use a host name different from the application (isolation of imported content).');
  }
}
if (parsed.data.LINK_CHECK_ALLOW_PRIVATE === 'true' && parsed.data.NODE_ENV === 'production') {
  throw new Error('Invalid environment: LINK_CHECK_ALLOW_PRIVATE cannot be enabled in production (SSRF protection).');
}
if (parsed.data.TEACHER_DOCUMENTS_STORAGE === 's3' && !(parsed.data.S3_BUCKET && parsed.data.S3_ACCESS_KEY_ID && parsed.data.S3_SECRET_ACCESS_KEY)) {
  throw new Error('Invalid environment: TEACHER_DOCUMENTS_STORAGE=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
}
if (parsed.data.S3_ENDPOINT && new URL(parsed.data.S3_ENDPOINT).protocol !== 'https:' && parsed.data.NODE_ENV === 'production') {
  throw new Error('Invalid environment: S3_ENDPOINT must be HTTPS in production.');
}
export const env = parsed.data;
