# Contenu du cours (plan, blocs, visibilité, copie)

Implémentation inspirée de Blackboard Learn Ultra (« Contenu du cours »). Écrans : `/teacher/courses/:id/content` (plan) et `/teacher/courses/:id/content/items/:itemId` (éditeur d'élément), accessibles depuis la liste des cours et l'onglet Programme de l'éditeur de cours.

## Modèle de données

Le plan reste stocké dans le document `Course` (tableau `chapters`), avec **deux niveaux** :

| Niveau | Champ | Contenu |
|---|---|---|
| Conteneur | `chapters[]` | `kind` (`module` \| `folder`), `title`, `description`, `visibility`, `availableFrom`, `availableUntil`, `sequential`, `thumbnail { assetId, alt }`, `lessons[]` |
| Élément | `chapters[].lessons[]` (Mixed) | `type` (`text` \| `video` \| `link` \| `interactive`), `title`, `description`, `url`, `blocks[]`, `quiz`, `visibility`, `availableFrom`, `availableUntil`, `revision` |
| Bloc | `lessons[].blocks[]` | `text`, `html`, `code`, `image`, `video`, `file`, `quiz`, `divider` |

Champs de cours ajoutés : `structureVersion`, `courseCode`, `accessState` (`open` \| `private` \| `completed`), `settings { language, startsAt, endsAt, notifyStudents }`, `banner { assetId, alt }`, `syllabus[]`, `copiedFrom`.

**Compatibilité** : aucune donnée existante n'est réécrite. Un conteneur ou élément sans `visibility` est considéré comme visible (comportement antérieur), la position est l'index du tableau. Le script optionnel `edumarket-backend/scripts/migrate-course-outline.mjs` rend ces valeurs explicites (simulation par défaut, `--apply` pour écrire ; idempotent, non destructif).

## Stratégie d'ordre et de concurrence

- **Position** = index dans le tableau MongoDB ; `order` est renuméroté (0..n-1) à chaque écriture structurelle, `chapterId` est réaligné.
- **Atomicité** : une opération structurelle (créer, déplacer, dupliquer, supprimer, importer) remplace le plan en **une seule mise à jour de document**, donc atomique sans transaction multi-documents.
- **Concurrence** : verrou optimiste `structureVersion`. Le client envoie `expectedVersion` ; une version obsolète renvoie `409 STRUCTURE_CONFLICT` et l'interface recharge le plan (testé : deux déplacements simultanés → un seul réussit).
- **Contenu d'un élément** : verrou optimiste `revision` par élément (`409 ITEM_CONFLICT`), indépendant de la structure : un co-auteur peut réorganiser pendant qu'un autre rédige.
- **Validation serveur** des déplacements (`structure.ts › applyMove`) : identifiants connus, un élément ne va que dans un conteneur, un conteneur reste à la racine (pas de cycle ni de troisième niveau), position dans les bornes.

## API (`/api/v1/courses/:courseId/…`, enseignant gestionnaire, institution, admin)

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `structure/containers` | Créer un module/dossier (masqué) à une position |
| PATCH | `structure/containers/:id` | Titre, description, type, visibilité, dates, séquentiel, vignette |
| DELETE | `structure/containers/:id?expectedVersion=` | Supprimer (audité) |
| POST | `structure/items` | Créer un document ou lien (masqué) à une position |
| PATCH | `structure/items/:id` | Contenu (`expectedRevision` requis) ou publication seule |
| DELETE | `structure/items/:id?expectedVersion=` | Supprimer (audité) |
| POST | `structure/move` | Déplacer un conteneur ou un élément |
| POST | `structure/containers/:id/duplicate`, `structure/items/:id/duplicate` | Dupliquer (copie masquée, placée après) |
| POST | `structure/batch` | Modification par lot (visibilité, dates) |
| GET | `student-preview` | Vue d'un étudiant inscrit sans progression |
| GET | `structure/sources` | Cours sources possibles pour « Copier le contenu » |
| POST | `structure/import` | Copier tout ou partie d'un autre cours géré (rapport) |
| POST | `structure/import-package` | Importer un package exporté |
| GET | `export` | Package pédagogique JSON (sans données étudiantes) |
| GET | `archive?includeStudentData=` | Archive ; données étudiantes réservées au responsable principal, auditée |
| POST | `copy` | Dupliquer le cours (brouillon, statut Privé, contenu masqué) |
| POST | `media?kind=image\|block_video\|block_file\|caption` | Médias des blocs, vignettes, bannière (signature binaire vérifiée) |
| GET | `banner` | Bannière publique d'un cours publié |

Les routes de contenu acceptent des corps JSON jusqu'à 2 Mo ; toutes les autres conservent la limite de 32 Ko.

## Visibilité appliquée côté serveur

`structure.ts › studentOutline` est l'unique règle, utilisée par : fiche cours (`GET /courses/:id`), liste des inscriptions, validation de leçon, tentatives de quiz, téléchargement d'actifs, Q&R de leçon, aperçu étudiant, analyses et export de notes (progression).

- Un conteneur masqué ou hors fenêtre de dates disparaît avec tous ses enfants (un enfant visible d'un parent masqué reste inaccessible).
- Un élément masqué ou hors fenêtre est inaccessible même par son identifiant (404).
- Module séquentiel : les éléments suivant le premier non terminé sont verrouillés (titre seul, contenu retiré).
- Cours `private` : aucun contenu servi aux étudiants ; cours `completed` : lecture seule (`409 COURSE_COMPLETED` sur progression et quiz).
- La progression ne compte que le contenu publié (`countableItems`).

## Sécurité HTML

- **Serveur** (`blocks.ts`, `sanitize-html`) : liste blanche explicite ; scripts, gestionnaires d'événements, `iframe`/`object`/`form`, URL `javascript:`/`data:` retirés ; seuls `https:` (et `mailto:` pour les liens) subsistent ; liens forcés en `rel="noopener noreferrer nofollow"`. Le bloc HTML accepte en plus des balises de présentation et un CSS filtré (pas d'`url()` ni de positionnement).
- **Client** : nouveau passage DOMPurify au rendu ; le bloc HTML est affiché dans une `iframe` `sandbox` **sans `allow-scripts`**, avec une CSP `default-src 'none'`.
- Vidéos intégrées : YouTube (domaine `youtube-nocookie.com`) et Vimeo uniquement, URL normalisées côté serveur.
- Fichiers : type réel vérifié par signature (PNG, JPEG, GIF, WebP, MP4, WebM, PDF, ZIP, WebVTT), tailles maximales par type, stockage privé (ou Drive/OneDrive appairé) — jamais en base.

## Accessibilité

- Glisser-déposer uniquement par poignée (les boutons Modifier/Supprimer ne déclenchent jamais de déplacement), avec capteurs souris (seuil 6 px), tactile (appui 200 ms) et clavier (Espace, flèches, Espace ; Échap annule) et annonces en direct traduites.
- Alternatives sans pointeur : boutons Monter/Descendre, dialogue « Déplacer vers… » (destination + position), menu « Plus d'options ».
- Modules repliables annoncés (`aria-expanded`), titres structurés, textes alternatifs obligatoires pour les images (sauf image décorative explicite), sous-titres WebVTT et transcription pour les vidéos.

## Tests

| Suite | Commande | Couverture |
|---|---|---|
| Unitaires (sans base) | `npm test` (backend) | `tests/course-structure.test.mjs` : déplacements valides/invalides, listes longues, visibilité, séquentiel, accès aux actifs, duplication, nettoyage HTML, URL vidéo, schéma des blocs |
| Intégration MongoDB | `EDUMARKET_TEST_MONGO_URI=mongodb://127.0.0.1:27017/<nom>_test npm run test:integration` | `tests/mongo-course-content.test.mjs` : R01–R03, R09–R11, conflits, concurrence, permissions, blocs, copies sans données étudiantes, export/archive, statut du cours, programme dans le calendrier |
| Navigateur (Edge) | `EDUMARKET_TEST_MONGO_URI=… npx playwright test e2e/course-content.spec.ts` | Réorganisation par boutons, clavier et souris (dans et entre modules), dialogue, panne backend simulée, blocs + autosauvegarde, aperçu étudiant, refus étudiant |

## Mission 2 : brouillons, formules, fichiers, archive v2

Règles complètes : [lms-architecture.md](lms-architecture.md).

- **Brouillons** : un élément déjà publié se modifie dans `item.draft` (titre, description, URL, blocs, quiz) ; les étudiants gardent la version publiée. Routes `POST structure/items/:id/publish` (immédiate, ou planifiée si `publishAt` est futur), `DELETE …/schedule`, `DELETE …/draft` (abandon), `GET …/versions`, `POST …/versions/:version/restore`. Le plan et l'éditeur affichent un badge « Modifications non publiées » ou « Publication programmée ».
- **Nouveaux types d'élément** : `lti` (outil enregistré par l'admin) et `scorm` (package importé).
- **Bloc `math`** : `{ latex, display: 'inline' | 'block', description }`. Les commandes `\href`, `\url`, `\includegraphics`, `\htmlClass|Id|Style|Data` sont refusées par le serveur ; rendu KaTeX en MathML avec alternative textuelle.
- **Fichiers** : `GET files` (inventaire et utilisation), `POST files/:assetId/{quarantine,restore}`, `DELETE files/:assetId` (depuis la quarantaine uniquement).
- **Liens** : `POST link-check` (lancer), `GET link-check` (dernier rapport).
- **Archive v2** : `GET export-archive` (ZIP : `course.json`, `files/`, `manifest.json` SHA-256) ; `POST structure/import-archive` (v2, ZIP) ; `POST structure/import-package` reste disponible pour les packages JSON v1.
