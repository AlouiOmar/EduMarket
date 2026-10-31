# Mission 2 : audit initial et plan d'implémentation (27/10/2026)

Point de départ revalidé avant toute modification : backend 80/80 tests unitaires, 51/51 tests d'intégration MongoDB (exécutés le 27/10/2026), Playwright exécuté avant modification (résultat consigné dans [blackboard-ultra-audit.md](blackboard-ultra-audit.md)).

## Existant constaté (au-delà de la mission 1)

| Domaine | Existant | Nature |
|---|---|---|
| Contenu | Plan 2 niveaux, blocs, visibilité, copie/export | Fonctionnel (mission 1) |
| Devoirs | `assignments` : consignes, date limite, fichiers PDF/ZIP/DOCX, note + feedback, une remise remplaçable | Fonctionnel mais propriétaire `teacherId` seul, pas de retard, pas de tentatives, pas de rubrique, note publiée immédiatement |
| Quiz de leçon | QCM dans l'élément, `QuizAttempt` | Fonctionnel ; changer les questions d'un élément publié modifiait la base des tentatives existantes |
| Examens | `exams` : QCM en ligne (1 tentative), présentiel noté | Fonctionnel, hors cours (certification) |
| Export notes | CSV `storage/gradeReport.ts` | Fonctionnel, sans pondération ni publication |
| Forum | Forum global, Q&R par leçon | Fonctionnel, pas rattaché au cours, pas de notation |
| Classes | `ClassGroup` : groupe d'accès (étudiants ↔ cours) | Fonctionnel ; pas d'espace de groupe |
| Notifications | In-app + e-mail Resend opt-in (`sendNotificationEmail`) | Fonctionnel ; pas de journal d'envoi ni de déduplication |
| Planificateur | `jobs/scheduler.ts` (intervalle 60 s, mises à jour conditionnelles idempotentes) | Fonctionnel, réutilisable |
| IA | `@google/genai` présent dans `package.json` du frontend mais **inutilisé** (aucune importation) | Absent ; aucune clé côté serveur |
| LTI, SCORM, formules, liens morts, GC fichiers | — | Absent |

## Dépendances entre fonctionnalités

1. Brouillons/versions → conditionne tout le reste (une évaluation publiée ne doit pas changer sous les tentatives).
2. Carnet de notes (catégories, colonnes, saisies) → requis par tests, devoirs, discussions, journaux, IA (colonnes notées).
3. Rubriques et séries de questions → requises par devoirs et tests.
4. Groupes de cours → requis par annonces ciblées, discussions de groupe, devoirs de groupe.
5. Modèles/classes → s'appuie sur la copie (mission 1) + isolation des données par cours (toutes les collections ci-dessus portent `courseId`).
6. Intégrations : IA (le moins risqué, fournisseur configurable), puis LTI 1.3 (clés, JWT), puis SCORM (zip, isolation d'origine).

## Plan par lots (exécuté dans cet ordre, tests après chaque lot)

| Lot | Contenu | Tests |
|---|---|---|
| A | Brouillons, publication immédiate/planifiée, versions archivées, fuseau du cours, intégrité des quiz déjà tentés, migration | unitaires `publication`, intégration, e2e brouillon → publication |
| B | Carnet de notes : catégories, colonnes, pondérations, /20, états, publication, CSV/XLSX, exceptions | unitaires calcul, intégration permissions, e2e note publiée |
| C | Séries de questions, tests (aléatoire, minutage, tentatives, reprise, correction auto/manuelle), rubriques, devoirs étendus, formulaires | unitaires notation, intégration, e2e test aléatoire + devoir corrigé |
| D | Discussions de cours, journaux, annonces (programmées, ciblées, e-mail dédupliqué), présence, groupes, analyses | intégration (confidentialité journal, annonce programmée), e2e |
| E | Modèles et classes indépendantes, tableau comparatif, mise à jour sélective depuis le modèle | intégration séparation des données |
| F | IA (fournisseur configurable, non opérationnelle sans clé), LTI 1.3 (plateforme), SCORM (import validé, exécution isolée) | intégration autorisations, lancement LTI invalide, e2e SCORM |
| G | Formules, vérification des liens, fichiers inutilisés (quarantaine), export zip + manifeste SHA-256 | unitaires, intégration |
| H | Audit accessibilité (axe), documentation, matrice finale | e2e axe |

## Hypothèses retenues (option la plus sûre pour les données)

- Un élément **jamais publié** (masqué, sans version publiée) est un brouillon : on l'édite directement. Dès qu'un élément a été publié (visible, ou version publiée ≥ 1), toute modification de contenu va dans un brouillon séparé, invisible des étudiants jusqu'à publication. Les éléments existants visibles sont considérés comme publiés (version 0 implicite) : rien ne devient inaccessible.
- Une note absente (`null`) n'est jamais comptée comme 0 ; elle est exclue de la moyenne, sauf si l'enseignant saisit explicitement 0 ou applique « absence = 0 » sur une colonne (option désactivée par défaut).
- Les notes ne sont jamais publiées automatiquement (tests corrigés automatiquement compris), sauf option explicite par colonne.
