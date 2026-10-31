# Architecture backend

Node.js 20+, TypeScript (ESM), Express 4, Mongoose 8, Zod. `backend/src/server.ts` valide l'environnement, ouvre MongoDB, démarre les jobs de fond (`jobs/scheduler.ts`) puis expose `app.ts` sous `/api/v1`.

```text
backend/src/
├── app.ts / server.ts
├── config/env.ts            variables validées (fournisseurs optionnels, garde-fous production)
├── database/connect.ts
├── common/                  auth (JWT + rôle relu en base), errors (enveloppe stable, codes)
├── integrations/            email (Resend), privateStorage, userEvents (SSE), payments (Stripe REST + sandbox), googleCalendar (OAuth)
├── jobs/scheduler.ts        expiration des checkouts abandonnés
└── modules/
    ├── auth, teacher-verification, teachers
    ├── courses (+ service.ts : cycle de publication), categories, enrollments, certificates, exams, assignments
    ├── sessions, calendar (iCalendar + synchronisation Google), messaging, notifications, forum
    ├── payments (models, service, routes, webhooks)
    ├── moderation (cours, synthèse, historique — modérateur et admin)
    ├── support (tickets utilisateur + file admin)
    ├── analytics (vue admin, cohortes institution)
    ├── institutions (vérification, profils, affiliations)
    └── admin (utilisateurs, paramètres, audit-logs, payments.routes : finances)
```

## Séparation des responsabilités

- **Règles métier partagées dans des services** : `courses/service.ts` (soumission, revue, suspension), `payments/service.ts` (prix serveur, commandes, exécution idempotente, remboursements, soldes, reversements), `calendar/service.ts`, `notifications/service.ts`, `certificates/service.ts`.
- **Administration distincte** : `modules/admin/*` et `modules/moderation` n'écrivent pas directement les documents métier sensibles; ils appellent ces services avec une autorisation spécifique (ex. remboursement admin → `refundOrder`, suspension modérateur → `setCourseSuspension`).
- **Routes** : validation Zod, autorisation (`allowRoles` + filtres de propriété renvoyant 404 aux non-propriétaires), adaptation HTTP. Les modules historiques gardent encore une partie de leur logique dans les routes; les nouveaux modules suivent la séparation modèle / service / routes. Refactoriser les anciens modules n'apportait pas de valeur suffisante face au risque de régression.

## Paiements

`integrations/payments.ts` expose une interface `PaymentProvider` (création de checkout, vérification de webhook, remboursement). `PAYMENT_PROVIDER=none` fait échouer le checkout proprement (`503 PAYMENT_PROVIDER_NOT_CONFIGURED`); `sandbox` est un fournisseur de développement refusé en production; `stripe` utilise l'API REST Stripe (Checkout Sessions, Refunds) et la signature `Stripe-Signature`. Les webhooks sont montés avant le parseur JSON (corps brut) et avant le mode maintenance. Une commande passe à `paid` uniquement sur événement vérifié dont le montant et la devise correspondent; l'exécution (inscription, inscription à l'examen, session payée, crédit vendeur) est idempotente et protégée par des index uniques. Sans replica set, les transactions MongoDB ne sont pas utilisées.

## Sécurité transverse

CORS explicite (`Idempotency-Key` autorisé), Helmet, limitation globale et limiteurs dédiés (checkout, support, messagerie, quiz, auth), cookie HttpOnly SameSite=Lax, rôle et statut relus en base à chaque requête, fichiers privés hors répertoires statiques, jetons Google chiffrés AES-256-GCM, état OAuth signé (10 min), journalisation sans secrets (seuls des codes d'erreur fournisseur sont logués), erreurs génériques sans détails internes.

## Limites connues

Bus SSE en mémoire (adaptateur partagé requis pour plusieurs instances), pas de driver de stockage objet, e-mail de notification uniquement sur opt-in (pas de push), gabarits de notification serveur en anglais, reversements manuels (pas de Stripe Connect), abonnements sans prélèvement automatique (renouvellement par nouveau paiement).

## Détails par module (conservés de la version précédente)

`enrollments` owns student enrollment records and lesson completion. The compound unique index prevents duplicate enrollment. The module checks that a requested course is published and free, and checks that a completed lesson belongs to that course. Paid enrollments are created by the payments service after a confirmed order. Cross-document updates are not transactional on standalone MongoDB.

### Quiz attempts

Lesson quiz attempts are persisted with server-calculated grades; the browser-supplied score is never trusted. Passing the quiz automatically records lesson completion, and completion requests for quiz lessons require a stored passing attempt. Student DTOs omit correct-option indexes and explanations until an attempt is graded.

### Teacher verification

Teacher applications and evidence metadata are embedded on the user record so role, verified status, and review decision change in one document update. Students can submit a specialty, optional professional registration number, qualifications summary, and up to five private PDF/PNG/JPEG files (5 MiB each). Files use random server-generated names, signature checks, rate limits, and authenticated owner/admin downloads; the upload directory is never static. Admins can inspect applications and download evidence before review. Approval sets `role=teacher` and `verified=true`; rejection leaves course-publishing access disabled.

JWT role claims are not used for authorization. Each authenticated request resolves the current role and account status from MongoDB, so an approval or suspension takes effect without waiting for the one-hour token to expire.

### Administrative user operations

`admin/users.routes.ts` provides an admin-only user list, role/status updates, and a persistent audit feed. Role changes cannot bypass teacher verification or alter a pending verification application; an administrator cannot remove their own admin role or suspend their own account. Suspension is checked against MongoDB on every authenticated request. Institution invitations are persisted, accepted by the teacher, and audited.

### Email and private storage

Authentication includes email verification and password reset with hashed, expiring, one-use tokens; production email delivery requires Resend credentials. Private uploads use a shared `PrivateStorageAdapter` contract with a local filesystem implementation; production must mount a persistent private volume and back it up. Jitsi meeting links are exposed only when `JITSI_BASE_URL` is configured.
