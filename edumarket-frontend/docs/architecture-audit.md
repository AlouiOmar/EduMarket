# Architecture audit

## Initial state

- The existing application was a React 19, TypeScript, and Vite frontend with role and domain page folders, Atomic Design components, centralized routing, frontoffice/backoffice layouts, and French/English/Arabic i18next resources.
- Authentication and most domain services used in-memory demonstration data. No persistent API or MongoDB layer existed at the start of this implementation.
- Some routes intentionally reused existing screens. Those mappings were retained to preserve the supplied routes and behavior.

## Current implementation

- The frontend remains in place. `src/router/index.tsx`, `src/services/apiClient.ts`, existing role page folders, shared layouts, and `src/components/{atoms,molecules,organisms,templates}` provide the current structure; no broad file move was needed.
- `VITE_DATA_MODE=mock|api` explicitly selects demonstration or API behavior. API errors do not silently fall back to mock data.
- `backend/` contains modular Express and Mongoose services for authentication, courses, enrollments and learning, reviews, teacher verification, sessions, certificates, notifications, exams, messaging, forum, assignments, payments, institutions, and administration.
- Authentication, authorization, private downloads, server-side quiz grading, email verification/recovery, per-teacher session overlap locking, and owner-scoped SSE are implemented. Private files use a local adapter behind a shared storage contract.
- Browser smoke coverage now includes API registration, email confirmation, login, and login translation/RTL checks. HTTP and isolated MongoDB workflow coverage is recorded in `backend-implementation-matrix.md`.

## Current limitations

- Real money movement requires Stripe credentials (`PAYMENT_PROVIDER=stripe`); the sandbox provider is development-only. Payouts are settled manually by bank transfer (no Stripe Connect). Subscriptions are not implemented.
- Google Calendar sync requires an OAuth client; a cloud object-storage driver is not configured, so local private storage requires persistent production storage and backups.
- Email delivery in production requires Resend credentials. Jitsi links require `JITSI_BASE_URL`.
- SSE fanout is process-local; multiple API instances need a shared event adapter. Email and push notification delivery are not implemented.
- The frontend retains explicit mock mode; interfaces consuming the API are listed in `integration-status.md`.

See the implementation and integration matrices for per-feature status and test evidence.

## Audit de reprise (2026-10-16)

Vérification de l'état laissé par l'agent précédent : backend et frontend compilaient, 39 tests HTTP et 12 workflows MongoDB passaient, 2 tests E2E. Écarts constatés par rapport au cahier des charges :

| Constat | Gravité | Action |
|---|---|---|
| Un enseignant ne pouvait jamais faire publier un cours en mode API (publication réservée à l'admin, sans soumission ni écran de validation) | Bloquant | Workflow `draft → pending_review → published/rejected`, suspension/rétablissement, module `moderation`, écrans enseignant/modérateur/admin. |
| Créneaux de tutorat payants réservables sans paiement | Sécurité / finance | `402 PAYMENT_REQUIRED`, réservation pendant le checkout, confirmation bloquée tant que non payé, remboursement automatique à l'annulation. |
| Marketplace absente (checkout toujours en échec, aucune commande, facture, commission, reversement, remboursement) | Bloquant | Module `payments` complet avec adaptateurs Stripe et sandbox, webhooks signés, idempotence, grand livre, reversements manuels. |
| Pas de répertoire `pages/shared`; pages communes dispersées (`messaging`, `notifications`, `sessions`, `forum`, `errors`, `auth/ProfilePages`) | Organisation | Déplacées dans `pages/shared`. Panier/checkout séparés (`public/CheckoutPages`) des achats étudiant (`student/OrdersPages`). |
| Routes admin réutilisant des pages d'autres rôles (`/admin/courses` → liste enseignant, `/admin/verifications` et `/admin/audit-logs` → dashboard, `/admin/transactions` → historique étudiant); routes modérateur toutes identiques | Non-conformité | Pages dédiées (catalogue & publication, dossiers enseignants, journal d'audit, transactions, reversements, support, catégories) et file modérateur filtrée (forum, avis), modération des cours, historique. Comportement mock d'origine conservé là où il existait. |
| Menus de sous-navigation et sidebar codés en dur en français, badge « 1 » fictif | i18n / maintenabilité | `router/navigation.tsx` centralise les menus (clés i18n, filtrage par rôle). |
| Analyses institution et dashboard admin affichant des chiffres fictifs en mode API | Données mélangées | Module `analytics` et écrans réels; chiffres fictifs limités au mode mock. |
| Abonnement étudiant affichant un abonnement actif fictif en mode API | Données mélangées | Module `subscriptions` réel (catalogue inclus, règlement au prorata des leçons suivies). |
| Vérification de certificat, statistiques d'accueil, recherche globale, contact, Q&R de leçon, onboarding et tableau de bord étudiant fictifs en mode API | Données mélangées | Branchés sur l'API (`/certificates/verify`, `/platform/stats`, `/courses?search=`, `/support/contact`, questions de leçon, `/enrollments`). |
| Codes d'erreur backend affichés bruts (`COURSE_NOT_FOUND`) | i18n | Espace `apiErrors` FR/EN/AR et helpers `apiErrorMessage` / `describeApiError`. |
| Identifiant Mongo invalide ou JSON mal formé → 500 | Robustesse | 400 `INVALID_IDENTIFIER` / `MALFORMED_JSON`. |
| Panier non persisté (perdu lors d'une redirection fournisseur) | Fonctionnel | Persistance `localStorage` tolérante aux erreurs. |
| Catégories codées en dur dans l'éditeur | Fonctionnel | Catégories gérées et traduites, compatibles avec les valeurs existantes. |
| Support, agenda personnel, Google Calendar absents | Fonctionnel | Modules `support` et `calendar` (iCalendar + OAuth Google chiffré). |
| Bundle initial de 777 kB (avertissement Vite) | Performance | Chargement paresseux des pages : 469 kB. |
| Fichiers morts : `templates/{Admin,Student,Teacher,Institution,Moderator}Layout.tsx`, `organisms/Sidebars.tsx` (sidebars par rôle rendant `null`), `organisms/PublicHeader.tsx` | Dette | Supprimés : aucun import, et ils contredisaient la règle d'un seul modèle de navigation par espace. |
| Pas de `docker-compose.yml` | Déploiement | Hors périmètre : le projet est lancé sans Docker (décision du 2026-10-16); instructions locales dans le README. |

### Dette restante identifiée

- Les pages héritées d'AI Studio ont été migrées vers i18next (1690 clés FR/EN/AR, parité vérifiée par `npm run i18n:check`). Seules les données de démonstration du mode mock (conversations, catégories du forum mock) restent en français. Les titres/messages de notifications générés par le serveur sont en anglais.
- Les modules backend historiques mélangent encore validation, règles et persistance dans les fichiers de routes; les nouveaux modules utilisent des services.
- Le dossier `features/` n'a pas été introduit : `services/` et `components/organisms` jouent déjà ce rôle (voir `frontend-architecture.md`).
