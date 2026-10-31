# Architecture frontend

React 19, TypeScript, Vite, React Router 7, i18next (FR/EN/AR + RTL), Tailwind. Le frontend est à la racine du dépôt (`src/`), le backend dans `backend/`; cette disposition existante a été conservée.

## Organisation

```text
src/
├── router/
│   ├── index.tsx          routes (chargement paresseux par page) et gardes
│   ├── navigation.tsx     source unique des menus (sous-navigation Frontoffice, sidebar Backoffice)
│   └── ProtectedRoute.tsx session, rôles, suspension, enseignant non vérifié
├── components/            Atomic Design
│   ├── atoms/             Button, Badge, Input, Select, ProgressBar…
│   ├── molecules/         FormField, StatCard, EmptyState, PageStates (PageHeader, LoadingState, ErrorAlert, NoticeBanner, ApiModeNotice, SimplePager)…
│   ├── organisms/         FrontofficeNavbar, BackofficeSidebar, BackofficeHeader, CourseCard, ChatWindow…
│   └── templates/         FrontofficeShell, BackofficeShell, WorkspaceLayouts, PublicLayout, AuthenticationLayout, SpecializedLayouts
├── pages/
│   ├── public/            accueil, catalogue, annuaires, événements, tarifs, pages institutionnelles, panier/checkout (CheckoutPages)
│   ├── auth/              inscription, connexion, vérification, récupération, onboarding, statuts de compte
│   ├── student/           dashboard, cours, lecteur, examens/certificats/devoirs, achats & factures (OrdersPages)
│   ├── teacher/           dashboard, gestion/édition des cours, tutorat, revenus, vérification, devoirs
│   ├── institution/       dashboard, catalogue, enseignants, examens, analyses et étudiants (InstitutionAnalyticsPages)
│   ├── admin/             dashboard, utilisateurs, dossiers enseignants, institutions, finances, audit, support, catégories, paramètres
│   ├── moderator/         file de modération (filtrable), modération des cours, historique
│   └── shared/            pages communes : profil, notifications, messagerie, sessions/Jitsi, forum, agenda, support, revenus vendeur, erreurs
├── services/              couche API centralisée (apiClient + services par domaine, platformServices pour marketplace/modération/support/agenda/analytics)
├── contexts/              Auth, Cart (persisté), Notifications
├── types/                 index.ts (modèles UI historiques) et platform.ts (DTO des nouveaux modules)
├── utils/                 apiErrors (traduction des codes), format (montants/dates localisés), i18nValidator
├── i18n/                  locales historiques + platform.{fr,en,ar}.ts fusionnés dans resources.ts
└── mocks/                 données de démonstration (mode mock uniquement)
```

**Règle `shared`** : une page y vit lorsque sa logique est identique pour plusieurs rôles (messagerie, notifications, sessions, agenda, support, profil, forum, erreurs, revenus vendeur enseignant/institution). Les différences passent par le rôle courant et les permissions serveur; aucune copie par rôle. Une même page peut être montée sous plusieurs routes pour rester dans le layout du rôle (ex. `/calendar`, `/student/calendar`, `/teacher/calendar`).

Le dossier `features/` suggéré n'a pas été créé : la logique métier est déjà regroupée par domaine dans `services/` et les composants de domaine dans `components/organisms`. Créer un second emplacement aurait dupliqué ces responsabilités.

## Layouts et navigation

- **Frontoffice** (visiteur, étudiant, enseignant, institution) : `FrontofficeShell` avec la navbar horizontale commune (`FrontofficeNavbar`, menu hamburger mobile). Les espaces de travail ajoutent une sous-navigation horizontale locale générée depuis `frontofficeSubnav`; elle ne remplace jamais la navbar.
- **Backoffice** (admin, modérateur) : `BackofficeShell` avec la sidebar unique (`BackofficeSidebar`, tiroir sur mobile) et `BackofficeHeader`. Les entrées viennent de `backofficeNav` filtré par rôle : un modérateur ne voit ni finances, ni utilisateurs, ni catégories, ni audit, ni support.
- Tous les libellés de menus sont des clés i18n (`workspace.*`).

## Routage et permissions

`router/index.tsx` sépare routes publiques, auth, espaces Frontoffice, Backoffice et erreurs. Le helper `guard(roles, element, requireVerifiedTeacher)` applique `ProtectedRoute` (attente de restauration de session, redirection vers la connexion, page suspendue, compte enseignant en attente, 403). Les pages sont chargées à la demande (`React.lazy`), ce qui ramène le bundle initial de 777 kB à 469 kB. Les gardes frontend n'accordent aucun droit : chaque opération est vérifiée par le backend.

## Données et API

`services/apiClient.ts` centralise l'URL, les cookies (`credentials: include`), les erreurs (`code`, `status`, `NETWORK_ERROR`), `queryString` et le type `Paginated`. `services/platformServices.ts` regroupe les clients des modules ajoutés (paiements, administration financière, modération, catégories, audit, support, agenda, analytics). Les écrans gèrent les états chargement / erreur (avec réessai) / vide / succès via `PageStates`.

`VITE_DATA_MODE=mock` conserve les démonstrations d'origine. En mode `api`, les nouveaux écrans sans équivalent mock affichent `ApiModeNotice` plutôt que des données fictives, et aucune erreur réseau ne bascule vers des mocks.

## Internationalisation

Les traductions historiques (`locales/{fr,en,ar}.ts`) sont intactes; les espaces ajoutés (`apiErrors`, `workspace`, `courseStatus`, `checkout`, `orders`, `revenue`, `adminPanel`, `moderation`, `support`, `calendar`, `institutionAnalytics`, `platformCommon`) sont dans `locales/platform.{fr,en,ar}.ts`, typés sur la version française. `npm run i18n:check` vérifie la parité (845 clés par langue au 2026-10-16). Montants et dates passent par `utils/format.ts` (`Intl`, locale fr-FR / en-GB / ar-TN). Certaines pages héritées d'AI Studio contiennent encore des libellés français codés en dur : voir `architecture-audit.md`.
