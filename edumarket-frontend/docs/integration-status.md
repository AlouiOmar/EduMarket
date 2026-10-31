# État d'intégration frontend/backend

Le mode est choisi explicitement par `VITE_DATA_MODE=mock|api`. En mode API, aucune donnée de démonstration n'est mélangée : les écrans sans backend affichent un avis « mode API requis » (`ApiModeNotice`) ou un état d'indisponibilité explicite. Les erreurs backend sont traduites via `apiErrors.<CODE>` (FR/EN/AR).

Statuts : `INTEGRATED` = la page consomme réellement l'API en mode API; `MOCK_ONLY` = démonstration explicite en mode mock; `BLOCKED` = dépend d'un tiers.

## Comptes, catalogue, apprentissage

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Auth, vérification e-mail, récupération, profil, préférences | `/auth/*` | INTEGRATED + E2E | Parcours inscription/confirmation/connexion et traduction FR/EN/AR/RTL testés dans Edge. |
| Catalogue, détail, avis, favoris, enseignants, institutions publiques | `/courses`, `/courses/:id`, `/courses/:id/reviews`, `/favorites`, `/teachers`, `/institutions` | INTEGRATED | « Acheter ce cours » ajoute au panier puis ouvre le checkout API. |
| Catégories (catalogue et éditeur) | `GET /courses/categories` | INTEGRATED | Libellés localisés pour les catégories gérées; valeurs historiques conservées. |
| Étudiants et progression (enseignant), avis & réponses | `/analytics/teacher`, `/courses/reviews/managed` | INTEGRATED | `/teacher/students`, `/teacher/reviews`; réponses visibles sur la fiche cours. |
| Co-propriétaires, tags | `PUT /courses/:id/co-owners`, `PATCH /courses/:id` | INTEGRATED | Éditeur de cours; prix verrouillé pour les co-auteurs. |
| Gestion des cours enseignant + soumission à validation | `/courses/mine`, `POST/PATCH /courses`, `POST /courses/:id/submit-review` | INTEGRATED | Statuts traduits (brouillon, en revue, publié, modifications demandées, suspendu) et note de modération affichée. |
| Inscription gratuite, lecteur, progression, quiz, historique | `/enrollments/*` | INTEGRATED | |
| Examens, certificats, devoirs | `/exams/*`, `/certificates/*`, `/assignments/*` | INTEGRATED | Examens payants : bouton « Payer et s'inscrire » → checkout. |
| Vérification publique de certificat | `GET /certificates/verify/:code` | INTEGRATED | `/certifications?code=…` (lien fourni avec chaque certificat); code inconnu → message explicite. |
| Questions/réponses par leçon | `/courses/:id/lessons/:lessonId/questions*` | INTEGRATED | Lecteur de cours. |
| Parcours d'apprentissage | `GET /learning-paths`, `/admin/learning-paths*` | INTEGRATED | Page « Devenir formateur »/parcours publics, `/student/learning-paths`, gestion admin. |
| Accueil (statistiques), recherche globale, contact | `GET /platform/stats`, `GET /courses?search=`, `POST /support/contact` | INTEGRATED | Plus aucun chiffre ni résultat fictif en mode API. |
| Tableau de bord étudiant | `/enrollments/*`, `/sessions/*`, `/payments/orders/mine` | INTEGRATED | |

## Marketplace

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Panier | — (localStorage) | INTEGRATED | Persisté pour survivre à la redirection fournisseur; les prix affichés sont indicatifs. |
| Checkout | `GET /payments/config`, `POST /payments/checkout` | INTEGRATED + E2E | Redirection vers `checkoutUrl`; avis si aucun fournisseur. |
| Page sandbox | `POST /payments/sandbox/sessions/:id/complete|fail` | INTEGRATED + E2E | Développement uniquement, libellée « aucun paiement réel ». |
| Retour de paiement | `GET /payments/orders/:id` | INTEGRATED + E2E | Interroge la commande jusqu'à confirmation serveur (webhook). |
| Achats & factures étudiant | `/payments/orders/mine`, `/payments/orders/:id/invoice` | INTEGRATED + E2E | Facture imprimable. |
| Réservation de tutorat payante | `POST /sessions/:id/book` → `402` → `POST /payments/checkout/sessions/:id` | INTEGRATED | Le serveur décide si un paiement est requis. |
| Revenus & reversements (enseignant, institution) | `/payments/earnings`, `/payments/payouts*` | INTEGRATED | Page partagée `pages/shared/SellerRevenuePage`. |
| Paiement hors ligne (espèces, chèque, virement) | `/payments/offline-requests`, `/payments/orders/:id/cancel`, `/payments/orders/:id/offline-proof` | INTEGRATED + E2E | Option au checkout et sur la page d'abonnement ; suivi et annulation dans « Achats & factures » ; mode de paiement sur la facture. |
| Tarifs et abonnement étudiant | `/subscriptions/*`, checkout `subscription` | INTEGRATED + E2E | Catalogue inclus pendant la période prépayée; renouvellement manuel avec rappel J-3; examens et sessions payés à part. |
| Part institution des cours d'enseignants affiliés | `/institutions/*` (taux à l'invitation) | INTEGRATED | Visible dans les revenus vendeur. |
| Paiement réel Stripe | adaptateur Stripe | BLOCKED | Nécessite clés et webhook Stripe. |

## Partagé (plusieurs rôles)

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Messagerie (texte, fichiers, vocaux, SSE) | `/messaging/*` | INTEGRATED | |
| Notifications (SSE) | `/notifications/*` | INTEGRATED | |
| Classes (enseignant, institution) | `/classes*` | INTEGRATED + E2E | `/teacher/classes`, `/institution/classes`, `/classes` : membres, code, cours assignés, progression. |
| Mes classes (étudiant) | `/classes/mine`, `/classes/join` | INTEGRATED + E2E | `/student/classes`. |
| Stockage cloud (enseignant, institution) | `/storage/*` | INTEGRATED (fournisseurs simulés en test) | `/teacher/storage`, `/institution/storage`, `/storage` (retour OAuth) ; choix du stockage dans l'éditeur de cours ; export des notes. Boutons désactivés si le fournisseur n'est pas configuré. |
| Sessions et salle Jitsi | `/sessions/*` | INTEGRATED | Jitsi si `JITSI_BASE_URL`. Reprogrammation (`POST /sessions/:id/reschedule`) depuis la liste des sessions. |
| Notifications traduites | `template` des notifications | INTEGRATED | `utils/notificationText.ts`, espace `notificationTemplates`. |
| Agenda personnel, export .ics, Google Calendar | `/calendar/*` | INTEGRATED | Google : bouton désactivé avec explication si non configuré. |
| Support | `/support/tickets*` | INTEGRATED | |
| Signalement (cours, avis, messages, profils) | `POST /reports` | INTEGRATED | Bouton `ReportButton` réutilisable. |
| Forum | `/forum/*` | INTEGRATED | |

## Institution

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Cours, enseignants affiliés, invitations, centre d'examens | `/courses/mine`, `/institutions/*`, `/exams/manage` | INTEGRATED | |
| Analyses pédagogiques | `GET /analytics/institution` | INTEGRATED | Les chiffres codés en dur ne s'affichent plus qu'en mode mock. |
| Étudiants | `GET /analytics/institution` | INTEGRATED | Recherche, progression, statut. |
| Finances | `/payments/earnings`, `/payments/payouts*` | INTEGRATED | |
| Membres et rôles internes | `PATCH /institutions/teachers/:id` | INTEGRATED | Rôle interne et part de revenus modifiables par enseignant affilié; l'enseignant voit son rôle dans « Affiliations ». |
| Avis & réponses | `/courses/reviews/managed`, `PUT .../reply` | INTEGRATED | Partagé avec l'espace enseignant. |

## Backoffice

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Dashboard admin | `/analytics/admin/overview`, `/admin/audit-logs` | INTEGRATED | Files cliquables, inscriptions sur 14 jours. |
| Utilisateurs & rôles | `/admin/users*` | INTEGRATED | Recherche, libellés traduits. |
| Dossiers enseignants (page dédiée) | `/teacher-verifications/admin*` | INTEGRATED | |
| Institutions partenaires | `/institution-verifications/admin*` | INTEGRATED | |
| Catalogue & publication (admin) / Modération des cours (modérateur) | `/moderation/courses*` | INTEGRATED + E2E (modérateur) | Même page, menus différents. |
| Catégories | `/admin/categories*` | INTEGRATED | |
| Transactions & remboursements, reversements | `/admin/payments/*` | INTEGRATED | Admin uniquement. |
| Signalements de contenus | `/moderation/reports*` | INTEGRATED | Profils escaladés aux admins. |
| Parcours d'apprentissage (admin) | `/admin/learning-paths*` | INTEGRATED | |
| File de modération, forum, avis, historique | `/forum/reports`, `/courses/moderation/reviews`, `/moderation/summary`, `/moderation/history` | INTEGRATED + E2E (historique) | |
| Support | `/admin/support/tickets*` | INTEGRATED | |
| Journaux d'audit | `/admin/audit-logs` | INTEGRATED | Filtres action/gravité, pagination. |
| Paramètres | `/admin/settings` | INTEGRATED | |
| Paiements hors ligne (admin) | `/admin/payments/orders/:id/offline-payment`, `/admin/payments/offline`, `/admin/payments/orders?provider=offline` | INTEGRATED + E2E | Page `/admin/offline-payments` : demandes à encaisser, justificatif, paiement au guichet ; paramètres (activation + instructions). |
| Examens, certificats, fiche utilisateur | `/admin/exams*`, `/admin/certificates*`, `/admin/users/:id` | INTEGRATED + E2E (révocation) | Révocation visible dans le registre public `/certifications`. |

Ne configurez `VITE_DATA_MODE=api` que si le backend et MongoDB sont démarrés. Le mode API ne bascule jamais silencieusement vers les mocks.

## Contenu du cours (2026-10-26)

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Contenu du cours (plan, modules, dossiers, liens, réorganisation, visibilité, lot, copie, export, archive) | `/courses/:id/structure/*`, `/courses/:id/{student-preview,export,archive,copy}` | INTEGRATED + E2E | `/teacher/courses/:id/content` ; glisser-déposer souris/clavier, dialogue « Déplacer vers… », panne backend testés dans Edge. Voir `course-content.md`. |
| Éditeur d'élément (blocs, quiz, publication) | `PATCH /courses/:id/structure/items/:itemId`, `POST /courses/:id/media` | INTEGRATED + E2E | Autosauvegarde avec contrôle de révision ; HTML nettoyé serveur + iframe sandbox. |
| Paramètres d'enseignement (identifiant, statut, langue, dates, bannière, programme) | `PATCH /courses/:id`, `GET /courses/:id/banner`, `GET /calendar/events` | INTEGRATED | Le programme alimente le calendrier des inscrits. |

## Fonctionnalités LMS (mission 2, 2026-10-27)

Détails et règles : `lms-architecture.md`. Écrans enseignant sous `/teacher/courses/:id/…`, étudiant sous `/student/courses/:id/…`.

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Brouillons, publication immédiate/planifiée, versions, aperçu du brouillon | `/courses/:id/structure/items/:itemId/{publish,schedule,draft,versions}`, `student-preview?draft=true` | INTEGRATED + E2E | Panneau de publication de l'éditeur d'élément ; fuseau du cours dans les paramètres. |
| Carnet de notes (enseignant), notes (étudiant) | `/gradebook/:courseId/*` | INTEGRATED + E2E | `gradebook`, `grades` ; exports CSV/XLSX. |
| Séries de questions, tests, rubriques, devoirs, formulaires | `/assessments/:courseId/*`, `/assignments/*` | INTEGRATED + E2E | `assessments` (onglets) ; `tests`, `assignments`, `forms` côté étudiant. |
| Discussions, journaux, annonces, présence, groupes | `/participation/:courseId/*` | INTEGRATED + E2E | E-mail des annonces : BLOCKED sans Resend (livraison consignée « non envoyée »). |
| Analyses du cours, classes d'un modèle, comparaison | `/analytics/courses/:id{,/classes}`, `/analytics/templates/:id/compare` | INTEGRATED + E2E | `analytics`, `template`. |
| Modèles et mise à jour sélective | `/courses/:id/{template,instances,template-diff,template-sync}` | INTEGRATED + E2E | |
| Fichiers, liens, archive v2 | `/courses/:id/files/*`, `/courses/:id/link-check`, `/courses/:id/export-archive`, `/courses/:id/structure/import-archive` | INTEGRATED + E2E | `files`. |
| Conversation d'IA | `/ai/*` | BLOCKED | Exige `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` ; sans eux, 503 affiché, aucune réponse simulée (testé E2E). |
| LTI 1.3 (outils, lancement, AGS) | `/lti/*`, `/admin/lti-tools` (écran) | BLOCKED | Exige `LTI_PRIVATE_KEY`, `LTI_KEY_ID`, `LTI_ISSUER` et un outil réel ; lancements invalides refusés (testé E2E avec une clé de test). |
| SCORM (import, lecteur, suivi) | `/scorm/*`, `/scorm-content/*` | BLOCKED (production) | Exige `SCORM_CONTENT_ORIGIN` ; parcours complet testé E2E avec une origine locale distincte. |

## Agenda interactif et calendriers connectés (2026-10-28)

Détails : `CALENDAR_INTEGRATION.md`.

| Interface | Endpoints | Statut | Remarques |
|---|---|---|---|
| Agenda Mois/Semaine/Jour/Agenda, popup, glisser-déposer, couleurs et filtres | `/calendar/{feed,events,conflicts,invitees,contexts,preferences}`, `/sessions/{availability,proposals,:id/time,:id}` | INTEGRATED + E2E | `/calendar` ; création, chevauchement, déplacement, redimensionnement, retour arrière, RTL et audit axe testés dans Edge. |
| Suggestion de rendez-vous dans le chat | — (détection locale) + `POST /calendar/events`, `POST /sessions/proposals` | INTEGRATED + E2E | Rien n'est créé avant validation dans la popup. |
| Calendriers connectés Google / Microsoft (Teams) | `/calendar/{providers,connections,…}`, callbacks, webhooks, `sync/cron` | BLOCKED (identifiants OAuth) | Testé avec des fournisseurs simulés ; sans configuration, état « Non configuré » explicite. |
