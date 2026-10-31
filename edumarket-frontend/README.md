<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# EduMarket LMS Marketplace

React/Vite front end plus an Express/MongoDB API (`backend/`). The UI runs on explicit demo data by default (`VITE_DATA_MODE=mock`) or on the real API (`VITE_DATA_MODE=api`). Architecture, API contracts, permissions and implementation status are documented in `docs/`.

View your app in AI Studio: https://ai.studio/apps/a9801e6c-405a-482b-a25a-7de82d8a3f8f

## Run Locally

**Prerequisites:** Node.js 20+, MongoDB (local or hosted)


### Frontend

```powershell
npm install
npm run dev
```

The default `VITE_DATA_MODE=mock` selects demo data. Set `VITE_DATA_MODE=api` in `.env.local` (and restart Vite) to use the backend for every integrated screen listed in `docs/integration-status.md`: accounts, catalogue and course publication workflow, learning, exams, certificates, sessions and calendar, messaging, forum, notifications, purchases and invoices, seller revenue and payouts, institution analytics, support, and the admin/moderator back office. API errors never fall back silently to demo data; API-only screens show an explicit notice in mock mode. Set `VITE_API_BASE_URL` if the API is not at `http://localhost:4000/api/v1`.

### Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
# Set MONGODB_URI and a private JWT_SECRET of at least 32 characters in .env
# Set APP_ORIGIN for verification/reset links; configure RESEND_API_KEY and EMAIL_FROM for production email delivery
# Optionally set JITSI_BASE_URL to your Jitsi Meet deployment to enable online session rooms
# Payments: PAYMENT_PROVIDER=none (default, checkout fails closed), sandbox (development only) or stripe
npm run dev
```

#### Payments

- `PAYMENT_PROVIDER=sandbox` (development only, refused when `NODE_ENV=production`): checkout redirects to `/checkout/sandbox/:id`, a page clearly labelled "no real payment" that simulates success or failure through the same server handler as real webhooks.
- `PAYMENT_PROVIDER=stripe` with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: Stripe Checkout; register the webhook `POST {API}/api/v1/payments/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `checkout.session.async_payment_failed`.
- Prices and commission are always computed by the server. Seller earnings become available after `PAYOUT_HOLD_DAYS`; payouts are requested by sellers and settled manually by an admin with the bank-transfer reference.
- Subscriptions (enabled and priced in admin settings) are prepaid monthly/yearly periods that unlock every paid published course; exams and tutoring sessions stay paid separately. When a period ends, the scheduler splits the seller pool by lessons completed during the period. There is no automatic recurring charge: students renew with a new payment and receive a reminder 3 days before expiry.
- Affiliated teachers: an institution sets a 0–50% share when inviting a teacher; after platform commission that share of the teacher's sales is credited to the institution.

#### Classes and restricted courses

Teachers and institutions create classes (groups of students) under **Classes**, add students by e-mail or share the class join code, and tick the courses opened to the class. Class members get those courses without payment. A course set to **Restricted to classes** (course editor → pricing) disappears from the catalogue, search, profiles and checkout: only members of the classes it is assigned to can open it (for example, 3rd-year students only see 3rd-year material). Removing a student or archiving the class expires the access but keeps the progress.

#### Offline payments (cash, cheque, bank transfer)

Enabled by default (admin settings → *Offline payments*, with instructions shown to students). Students choose "pay offline" at checkout or on the subscription page; the order stays pending for `OFFLINE_PAYMENT_DAYS`. Admins open **Offline payments** to record the payment (method, cheque/transfer number, bank, date, optional scan or photo in JPG/PNG/PDF) or register a desk payment for a student in one step. Access, invoice and seller earnings then follow exactly the online flow. Offline refunds update the platform only: the money is returned by the finance team.

#### Cloud storage: Google Drive and OneDrive (optional)

Teachers and institutions pair one or more accounts under **Cloud storage**. New course videos/resources go to the default account; when it lacks space the next paired account with room is used automatically, and the default can be switched at any time. Learners always download through the API after the access check (no drive links are shared). Grade sheets (progress, quizzes, assignments, exams) can be downloaded as CSV or saved to a paired drive.

- **Google Drive:** in the Google Cloud project used for Calendar (or a new one), enable the *Google Drive API*, add the `.../auth/drive.file` scope to the consent screen, and add `{API}/api/v1/storage/oauth/google_drive/callback` as an authorized redirect URI of the OAuth client. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`.
- **OneDrive:** in the Microsoft Entra admin center, *App registrations → New registration* (accounts in any organizational directory and personal Microsoft accounts), add a *Web* redirect URI `{API}/api/v1/storage/oauth/onedrive/callback`, create a client secret, and grant the delegated Microsoft Graph permissions `Files.ReadWrite`, `User.Read`, `offline_access`. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (and `MICROSOFT_TENANT` to restrict to one organization).

An account that still holds course files cannot be unpaired (learners would lose access); replace those files first.

#### Google Calendar (optional)

Create an OAuth client ("Web application") with the `calendar.events` scope, register `{API}/api/v1/calendar/google/callback` as redirect URI, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Without them, users can still export their calendar as `.ics`.

In development, email verification and password reset return one-time preview links in the browser response; links are never written to logs. In production, configure a Resend API key and a verified sender address. `APP_ORIGIN` must point to the frontend origin that serves the auth routes.

Teacher evidence uploads use `PRIVATE_UPLOAD_DIR` (default `./private-uploads` inside `backend`). Keep this directory private and persistent in production; the API never exposes it as static content.

The API starts only after it can connect to MongoDB. See [OpenAPI](docs/openapi.yaml) and `docs/` for architecture, API routes, permissions, and implementation status. Backend HTTP tests use an isolated in-process server and do not require a database. MongoDB workflows require a separate local test database whose name ends in `_test`; the integration test script refuses non-local hosts or other database names. For example:

```powershell
cd backend
$env:EDUMARKET_TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/edumarket_integration_test'
npm run test:integration
```

Frontend checks run from the project root:

```powershell
npm run lint
npm run build
npm run i18n:check   # FR/EN/AR key parity + every static t('…') key exists
```

The browser smoke test uses Microsoft Edge and starts isolated frontend/API servers on ports 3300/4400. It requires a local MongoDB database ending in `_test`; it will refuse remote hosts or other database names. Set the URI in PowerShell, then run:

```powershell
$env:EDUMARKET_TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/edumarket_browser_test'
npm run test:e2e
```

The tests exercise API registration, email verification, login, French/English/Arabic translation with RTL, a complete sandbox purchase (checkout → sandbox provider → confirmation → order → invoice → course access), a moderator publishing a submitted course, a subscription bought from the pricing page that opens a paid course, a teacher authoring a lesson with a quiz and submitting it for review, an admin revoking a certificate that the public registry then reports as revoked, an institution opening a restricted course to a class joined by code, and a cheque payment requested by a student and recorded by an admin with a scan. They seed uniquely named fixtures in that isolated database.

Backend checks run from `backend`:

```powershell
cd backend
npm run lint
npm run build
npm test
```

`npm test` runs the HTTP authentication/validation/permission suite and skips database workflows. `npm run test:integration` runs two isolated MongoDB suites in parallel (`<name>_test` and `<name>_marketplace_test`): learning, messaging, files, settings, plus marketplace, refunds, payouts, paid sessions, moderation, support, categories, analytics, Google Calendar (Google API mocked in-process), institution revenue share, subscriptions and settlement, content reports, lesson Q&A, contact form, learning paths, notification emails (provider mocked), certificate verification, classes and restricted courses, offline payments (cash/cheque with proof scans), Google Drive/OneDrive storage with automatic fallback (providers mocked), institution internal roles and course co-owners, session rescheduling, teacher review replies and learner follow-up, and admin exam/certificate/user records.


`GEMINI_API_KEY` is not required by the currently implemented application paths.
