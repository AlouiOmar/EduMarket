# Mission 2 : rapport de livraison (27/10/2026)

Plan initial : [mission2-plan.md](mission2-plan.md). Matrice des exigences : [blackboard-ultra-audit.md](blackboard-ultra-audit.md). Architecture et règles : [lms-architecture.md](lms-architecture.md).

## 1. Résultats des tests (exécutés, non estimés)

| Suite | Avant la mission | Après la mission |
|---|---|---|
| Backend unitaires (`npm test`) | 80/80 | 123/123 |
| Backend intégration MongoDB (`npm run test:integration`) | 51/51 | 111/111 |
| Playwright (Edge, `npx playwright test`) | 1 échec sur l'exécution initiale (glisser-déposer, voir §6) | 31/31 (4,1 min) |
| Lint backend | propre | propre |
| Typage frontend (`tsc --noEmit`) | 1 erreur préexistante | la même erreur, aucune nouvelle (`e2e/marketplace.spec.ts` importe `mongoose`) |
| Build frontend (`vite build`) | OK | OK |
| Parité i18n FR / EN / AR | — | 3228 clés, 0 manquante |
| Audit axe WCAG 2.1 A/AA | non fait | 0 violation grave ou critique sur 26 écrans |

Commande d'intégration : `EDUMARKET_TEST_MONGO_URI=mongodb://127.0.0.1:27017/<base>_test npm run test:integration`. Chaque suite utilise sa propre base suffixée, vidée au début.

## 2. Fichiers créés ou modifiés

**Backend (`edumarket-backend/src/`)**

Créés :
- `common/` : `timezone.ts`, `zip.ts`, `xlsx.ts`.
- `courses/` : `publication.ts`, `publication.service.ts`, `version.model.ts`, `templates.ts`, `templates.routes.ts`, `files.ts`, `files.routes.ts`, `links.ts`, `linkReport.model.ts`.
- `gradebook/` : `models.ts`, `compute.ts`, `service.ts`, `routes.ts`.
- `assessments/` : `models.ts`, `grading.ts`, `service.ts`, `routes.ts`.
- `participation/` : `models.ts`, `service.ts`, `routes.ts`.
- Autres modules : `lms/access.ts`, `analytics/course.routes.ts`, `ai/{models,routes}.ts`, `integrations/aiProvider.ts`, `lti/{models,keys,routes}.ts`, `scorm/{manifest,models,routes}.ts`.

Modifiés :
- `courses/` : `structure.routes.ts`, `structure.ts`, `dto.ts`, `model.ts`, `routes.ts`, `assets.model.ts`, `assets.routes.ts`, `blocks.ts`.
- `assignments/` : `models.ts`, `routes.ts`.
- Autres modules : `enrollments/routes.ts`, `notifications/service.ts`, `integrations/privateStorage.ts`, `storage/service.ts`.
- Configuration et démarrage : `config/env.ts`, `app.ts`, `jobs/scheduler.ts`, `package.json`, `.env.example`.

**Tests backend (`edumarket-backend/tests/`)**
- Unitaires : `publication`, `gradebook`, `assessments`, `participation`, `templates`, `scorm`, `integrations-config`, `files-links`.
- Intégration : `mongo-publication`, `mongo-gradebook`, `mongo-assessments`, `mongo-participation`, `mongo-templates`, `mongo-integrations`, `mongo-files`.

**Frontend (`edumarket-frontend/src/`)**

Créés :
- Services : `gradebookService`, `assessmentService`, `participationService`, `templateService`, `integrationService`.
- Composants : `LmsShared.tsx`, `ParticipationViews.tsx`, `IntegrationViews.tsx`.
- Pages enseignant : `GradebookPage`, `assessments/*` (6 fichiers), `TeacherParticipationPages`, `CourseTemplatePage`, `IntegrationsPage`, `CourseFilesPage`.
- Pages admin et étudiant : `AdminLtiToolsPage`, `StudentGradesPage`, `StudentAssessmentPages`, `StudentParticipationPages`, `StudentActivitiesPage`.
- Traductions : `lms.{fr,en,ar}.ts`.

Modifiés :
- Éditeur et contenu : `ContentItemEditorPage`, `CourseContentPage`, `CourseOutlineEditor`, `CourseEditorPage`, `CourseLearningPage`, `LessonBlockEditor`, `LessonBlocksView`, `LearningOrganisms`.
- Composants partagés : `ConfirmationDialog`, `Button`, `PublicFooter`.
- Code commun : `types`, `utils/outline.ts`, `utils/format.ts`, `courseContentService`, `router/index.tsx`, `navigation.tsx`, `i18n/resources.ts`.

**E2E (`edumarket-frontend/e2e/`)**
- Créés : `publication`, `gradebook`, `assessments`, `participation`, `templates`, `integrations`, `files-math`, `accessibility`, `support/lms.ts`.
- Modifiés : `course-content.spec.ts` (stabilité, voir §6), `playwright.config.ts`.

**Documentation** :
- Créés : `lms-architecture.md`, `mission2-plan.md`, ce rapport.
- Mis à jour : `blackboard-ultra-audit.md`, `course-content.md`, `integration-status.md`, `permissions-matrix.md`.

## 3. Migrations

Aucune migration obligatoire ni destructive : les nouveaux champs sont facultatifs avec des valeurs par défaut qui reproduisent le comportement antérieur, et les nouvelles collections et index sont créés au démarrage. Le retour au code précédent est possible : les données ajoutées sont alors ignorées. Le détail et la seule réserve (brouillons non publiés) sont dans [lms-architecture.md §9](lms-architecture.md).

## 4. Dépendances

Voir [lms-architecture.md §10](lms-architecture.md) :
- ajoutées : `katex` 0.19.1, `@axe-core/playwright` (dev) ;
- mises à jour de sécurité : `dompurify`, `sanitize-html`, `multer`, `body-parser` ;
- **aucune nouvelle dépendance backend** : ZIP, XLSX et JWT LTI sont écrits avec `node:zlib` et `jsonwebtoken`, déjà présent.

## 5. Fonctionnalités soumises à une clé ou à un service

| Fonctionnalité | Variables | Comportement sans configuration |
|---|---|---|
| Conversation d'IA | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (+ `AI_BASE_URL`) | 503 explicite, publication de l'activité refusée, aucune réponse simulée |
| LTI 1.3 | `LTI_PRIVATE_KEY`, `LTI_KEY_ID`, `LTI_ISSUER` + un outil réel enregistré par l'admin | 503 explicite |
| SCORM (lancement) | `SCORM_CONTENT_ORIGIN` (sous-domaine dédié pointant vers le backend) | Import et validation possibles, lancement 503 |
| E-mail des annonces | Resend (configuration existante) | Livraison consignée « non envoyée » avec le motif ; in-app inchangé |

Toutes ces variables sont documentées, commentées, dans `edumarket-backend/.env.example`, sans valeur secrète.

## 6. Régressions et défauts trouvés, corrections

| Constat | Correction |
|---|---|
| Test e2e de glisser-déposer au pointeur instable sur l'exécution initiale (défilement automatique de dnd-kit au bord de la fenêtre) | Test : fenêtre plus haute et paire centrée. Le composant n'a pas été modifié (une modification a été essayée puis annulée). |
| La fenêtre de dates du plan renvoyait 422 au lieu du 400 historique | Contrat 400 restauré |
| Détection des annonces bloquées en « envoi » mesurée avec l'heure injectée | Mesure avec l'horloge réelle |
| SCORM : fichiers refusés sous un chemin contenant `.tmp` (`dotfiles: 'deny'`) | Option `root` de `sendFile` |
| Dialogue de test : une section aléatoire créée avant le chargement des séries recevait une série vide | Ajout d'une section aléatoire désactivé tant que les séries ne sont pas chargées ; enregistrement refusé si une section n'a pas de série |
| `ConfirmationDialog` sans rôle `dialog` ni gestion du focus | Rôle, étiquette et focus ajoutés |
| Contrastes insuffisants signalés par axe (pied de page, bouton « succès », page d'apprentissage) | Couleurs ajustées (`slate-400`, `emerald-700`) |
| Identifiant de modèle de type ObjectId passé à un validateur de chaîne | Conversion explicite |
| Avis de sécurité `katex` 0.16, `dompurify`, `multer`, `sanitize-html`, `body-parser` | Versions corrigées |

Les autres corrections faites pendant le développement portaient sur les tests eux-mêmes (sélecteurs, attente, données d'amorçage) et n'ont modifié aucune attente métier. Une seule attente a été corrigée : « 50 / 100 » remplacé par « 10 / 20 », car le carnet affiche la note sur 20, comme spécifié.

## 7. Limites et risques

- **Non fait** : mot de passe d'accès aux tests, devoirs de groupe, détection de plagiat, badges, seuil de note comme condition d'accès, import Word/PDF, compatibilité Blackboard ou IMS Common Cartridge (non revendiquée).
- **IA** : jamais appelée sur un vrai fournisseur ; coût et latence réels inconnus.
- **LTI** :
  - non certifié IMS, aucun test avec un outil réel ;
  - lancement en GET uniquement, à cause du cookie `SameSite=Lax` ;
  - pas de Deep Linking ni de NRPS.
- **SCORM** : un SCO par package, pas de séquencement 2004 ni de `cmi.interactions`.
- **E-mail** : nouvelles tentatives non vérifiées contre Resend réel.
- **Accessibilité** : audit automatisé et clavier seulement ; aucun test avec un lecteur d'écran réel.
- **Sécurité** : avis `zod` 3 non corrigé (correctif uniquement en v4, cassant). Le risque est atténué par les limites de taille des requêtes.
- **Divers** :
  - `bun.lock` non régénéré (npm utilisé) ;
  - les suites historiques `mongo-workflows` et `mongo-marketplace` partagent une base (risque d'instabilité préexistant) ;
  - aucune mesure de performance instrumentée.
- **Environnement** : le dossier n'est pas un dépôt git, donc aucun historique de commits ne retrace ces changements.

## 8. Procédure de validation manuelle

Prérequis :
- MongoDB local ;
- backend `npm run dev` ;
- frontend `VITE_DATA_MODE=api npm run dev` ;
- un compte enseignant vérifié qui gère un cours ;
- deux comptes étudiants inscrits (A et B), chacun dans une fenêtre privée distincte.

1. **Brouillon et publication** :
   1. Dans *Contenu*, rendez une leçon visible, puis modifiez son texte : le badge « Modifications non publiées » apparaît.
   2. Étudiant A : l'ancien texte s'affiche toujours. Activez l'aperçu du brouillon : le nouveau texte s'y affiche.
   3. Cliquez sur « Publier les modifications » : A voit le nouveau texte après actualisation. *Versions* liste v1.
   4. Planifiez une publication dans 2 minutes, dans le fuseau du cours (*Paramètres*) : elle a lieu à l'heure dite, sans action.
2. **Intégrité** : après une tentative de quiz par A, modifiez une question et publiez. Dans l'historique de A, la tentative et sa note sont inchangées.
3. **Carnet** :
   1. Créez deux catégories (poids 60/40) et une colonne manuelle sur 20.
   2. Notez A sans publier : A ne voit rien.
   3. Publiez la colonne : A voit sa note et sa moyenne sur 20. B, sans note, voit « — », et non 0.
   4. Exportez en CSV et en XLSX, puis ouvrez les fichiers dans un tableur.
4. **Test** :
   1. Créez une série de 5 questions et un test qui en tire 3, durée 5 min, 2 tentatives.
   2. A commence, répond à une question, ferme l'onglet et rouvre : mêmes questions, réponse conservée, minuteur continu.
   3. A remet. Publiez la note : A la voit, avec le corrigé si l'option est activée.
5. **Devoir** :
   1. Créez un devoir avec une rubrique et une remise tardive autorisée.
   2. B remet après l'échéance, avec un fichier PDF et un lien : la remise est marquée « en retard ».
   3. Corrigez avec la rubrique, puis publiez.
6. **Formulaire anonyme** : A répond. Les résultats ne montrent aucun nom, et A ne peut pas répondre une seconde fois.
7. **Participation** :
   1. Créez deux groupes (A dans G1, B dans G2) et une discussion de groupe G1 : B ne la voit pas, et l'URL directe renvoie « introuvable ».
   2. Journal : A écrit une entrée ; B ne la voit pas.
   3. Annonce ciblée G1, programmée dans 2 minutes : seul A la reçoit, une seule fois.
   4. Présence : saisissez une séance, puis exportez-la.
8. **Modèle** :
   1. Marquez le cours comme modèle et créez deux classes.
   2. Inscrivez A dans la classe 1 : la comparaison montre 1 étudiant dans la classe 1 et 0 dans la classe 2.
   3. Modifiez un élément dans le modèle et le même élément dans la classe 2. La synchronisation de la classe 2 signale un conflit et ne remplace rien sans « écraser l'adaptation locale ».
9. **Fichiers et liens** :
   1. Téléversez une image sans l'utiliser, puis mettez-la en quarantaine. Une image utilisée n'a pas de bouton de quarantaine.
   2. Lancez la vérification des liens : un lien vers `http://127.0.0.1` est refusé.
   3. Exportez l'archive, puis réimportez-la dans un autre cours. Modifiez un octet d'un fichier du ZIP : l'import est refusé.
10. **Formules** : ajoutez un bloc formule avec une alternative textuelle. Côté étudiant, un lecteur d'écran (NVDA ou Narrateur) doit lire la formule : c'est à vérifier manuellement, ce n'est pas automatisé.
11. **Intégrations sans configuration** : un élément IA, LTI ou SCORM affiche un message « non configuré » explicite, sans contenu simulé.
12. **Intégrations avec configuration** (environnement de recette) :
    - définissez les variables du §5 et redémarrez ;
    - enregistrez un outil LTI réel comme admin et lancez-le comme étudiant, puis vérifiez le retour de note dans le carnet ;
    - importez un package SCORM réel et vérifiez la reprise et la note ;
    - lancez une conversation d'IA et vérifiez la transcription côté enseignant.
13. **Langues** : passez en arabe. L'interface est en RTL, et le carnet et les notes restent lisibles.
