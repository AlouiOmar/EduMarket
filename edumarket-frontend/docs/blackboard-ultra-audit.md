# Audit EduMarket vs cahier des charges « Blackboard Learn Ultra » (mis à jour le 27/10/2026, mission 2)

Statuts : **terminé** (fonctionnel, persisté, permissions vérifiées par l'API, testé), **partiel** (présent mais incomplet, la limite est indiquée), **absent**, **bloqué** (implémenté mais non opérationnel sans un prérequis externe : clé, service ou domaine). Architecture : [course-content.md](course-content.md) (mission 1) et [lms-architecture.md](lms-architecture.md) (mission 2). Les tests cités sont dans `edumarket-backend/tests/` (unitaires `*.test.mjs`, intégration MongoDB `mongo-*.test.mjs`) et `edumarket-frontend/e2e/` (Playwright, Edge).

## État initial constaté (avant modifications)

- Plan stocké dans `Course.chapters[].lessons[]` (`edumarket-backend/src/modules/courses/model.ts`), enregistré en bloc par `PATCH /courses/:id` depuis `CourseEditorPage.tsx` : aucune visibilité par élément, aucune API ni interface de réorganisation, aucun bloc (texte brut `textContent`), aucun nettoyage HTML, aucune copie/export.
- Défaut existant corrigé : les vidéos téléversées (`/courses/:id/assets/:id`) étaient passées telles quelles à `<video src>`, donc résolues sur l'origine du frontend au lieu de l'API (lecture impossible en mode API).
- Défaut existant corrigé : `playwright.config.ts` et `e2e/marketplace.spec.ts` cherchaient le backend dans `./backend` ; les e2e ne démarraient pas avec l'arborescence `edumarket-frontend` / `edumarket-backend`.

## Matrice des exigences

### Contenu et publication

| Exigence | Statut | Preuves |
|---|---|---|
| Structure à deux niveaux, insertion, recherche, réorganisation glisser-déposer et clavier (EX-ARC, EX-MOD-01, EX-CRE-01..03/05) | terminé | `structure.ts`, `structure.routes.ts`, `CourseOutlineEditor.tsx` ; `course-structure`, `mongo-course-content`, `course-content.spec` |
| Visibilité masqué / visible / programmée, statut du cours, parcours séquentiel (EX-VIS-01..03/05, EX-MOD-04) | terminé | `studentOutline`, `lms/access.ts` ; `mongo-course-content` |
| Brouillon distinct de la version publiée | terminé | `publication.ts`, `item.draft` ; `publication`, `mongo-publication`, `publication.spec` |
| Publication immédiate et planifiée, dans le fuseau du cours | terminé | `publication.service.ts`, `common/timezone.ts`, tâche `publishDueItems` ; conversion avec changement d'heure (`publication`), planification (`mongo-publication`) |
| Versions archivées, restauration dans le brouillon | terminé | `version.model.ts` (ajout seul) ; `mongo-publication` |
| Publication atomique (pas d'état intermédiaire, conflits) | terminé | Mise à jour gardée par `revision` ; publications concurrentes testées (`mongo-publication`) |
| Intégrité des évaluations déjà utilisées | terminé | Nouveau quiz à la publication si des tentatives existent ; instantané des questions dans les tentatives de test ; `mongo-publication`, `mongo-assessments` |
| Copies indépendantes de leur source | terminé | `duplicateCourse` part de la copie de travail ; `mongo-publication`, `mongo-templates` |
| Aperçu étudiant (publié ou brouillon) | terminé | `student-preview?draft=true` ; `publication.spec` |
| Condition de performance (note minimale) / diffusion par groupe (EX-VIS-04) | partiel | Le séquentiel exige la complétion ; annonces et discussions ciblables par groupe ; pas de seuil de note configurable sur un élément |
| Document riche, code, HTML sécurisé, images avec texte alternatif, vidéo (EX-DOC-01..03) | terminé | Mission 1 (`blocks.ts`, DOMPurify) |
| Formules mathématiques | terminé | Bloc `math`, KaTeX MathML, commandes dangereuses refusées (`blocks.ts`) ; `files-links`, `files-math.spec` |
| Vérification des liens morts (EX-LIE-02, §14.2) | terminé | `links.ts` (protection SSRF), rapport, tâche annuelle ; `files-links`, `mongo-files` |
| Gestion des fichiers (utilisation, quarantaine, purge) | terminé | `files.ts`, `files.routes.ts`, `CourseFilesPage.tsx` ; `mongo-files`, `files-math.spec` |
| Archive avec fichiers et manifeste | terminé | Archive v2 (`common/zip.ts`, SHA-256, import tout ou rien) ; `files-links`, `mongo-files` |
| Compatibilité d'import et d'export Blackboard / IMS Common Cartridge | absent | Non revendiquée : format propre à EduMarket |
| Import Word/Markdown/PDF dans un bloc | partiel | `.html` (nettoyé) et `.txt` seulement |
| Notification à l'heure d'une publication programmée (EX-COM-02) | terminé | Envoyée par la tâche de publication ; `mongo-publication` |

### Notes et évaluations

| Exigence | Statut | Preuves |
|---|---|---|
| Carnet : catégories, pondérations, colonnes manuelles et liées (EX-NOT-01..03) | terminé | `gradebook/` ; `gradebook`, `mongo-gradebook`, `gradebook.spec` |
| Note sur 20, arrondi, absence ≠ 0 | terminé | `compute.ts` ; cas limites dans `gradebook` (null, dispense, absence = 0 après échéance, renormalisation) |
| États de saisie, publication individuelle et globale (EX-NOT-04/06) | terminé | `published` distinct de `score` ; `mongo-gradebook` (rien de visible pour l'étudiant avant publication) |
| Export CSV et XLSX (EX-NOT-05) | terminé | `common/xlsx.ts`, neutralisation des formules CSV ; `gradebook`, `mongo-gradebook` |
| Exceptions individuelles (date, tentatives) (EX-EVA-04) | terminé | `GradebookException`, utilisé par les tests et les devoirs ; `mongo-assessments` |
| Séries de questions copiables entre cours (EX-QBK-*) | terminé | `assessments/` ; `mongo-assessments` |
| Tests : tirage aléatoire, minutage, tentatives, mélange (EX-EVA-01/02) | terminé | `service.ts`, mélange cryptographique ; `assessments`, `mongo-assessments`, `assessments.spec` |
| Sauvegarde automatique et reprise des tentatives | terminé | Index unique d'une tentative en cours, expiration avec délai de grâce ; `mongo-assessments`, `assessments.spec` |
| Correction automatique et manuelle | terminé | `grading.ts` (QCM multiple en tout ou rien) ; `assessments` |
| Mot de passe d'accès à un test | absent | Non implémenté |
| Devoirs : retard, tentatives, rubrique, fichiers et liens | terminé | `assignments/` étendu (`maxAttempts` 0 = ancien comportement) ; `mongo-assessments`, `assessments.spec` |
| Devoirs de groupe | absent | Les groupes existent ; la remise de groupe n'est pas implémentée |
| Détection de plagiat | absent | Nécessite un service externe |
| Rubriques (EX-RUB-*) | terminé | `Rubric`, score normalisé ; `assessments` |
| Formulaires anonymes sans colonne de note | terminé | Empreinte HMAC, aucun identifiant stocké ; `mongo-assessments` |

### Participation et suivi

| Exigence | Statut | Preuves |
|---|---|---|
| Discussions de cours et de groupe, modération, épinglage, notation (EX-PAR-01/02) | terminé | `participation/` ; `mongo-participation`, `participation.spec` |
| Journaux privés (EX-PAR-03) | terminé | Filtre côté serveur ; confidentialité testée (`mongo-participation`) |
| Annonces programmées, ciblées, sans doublon (EX-COM-01) | terminé | Livraisons uniques, réservation atomique ; `participation`, `mongo-participation` |
| Envoi réel des annonces par e-mail | bloqué | Exige Resend ; sans configuration, la livraison est consignée « non envoyée » avec son motif. Nouvelles tentatives non testées contre un vrai fournisseur |
| Présence (EX-COM-04) | terminé | Séances, statuts, exports ; `mongo-participation` |
| Groupes et espaces de groupe (EX-COM-05) | terminé | Manuel, aléatoire, inscription libre atomique, fichiers de groupe ; `mongo-participation` |
| Analyses, étudiants inactifs (EX-COM-03) | terminé | `analytics/course.routes.ts` ; `mongo-participation` |
| Réussites / badges | absent | Certificats existants seulement |

### Modèles et classes

| Exigence | Statut | Preuves |
|---|---|---|
| Classes indépendantes créées depuis un modèle | terminé | `templates.ts` ; aucune donnée étudiante copiée (`mongo-templates`) |
| Tableau comparatif des classes | terminé | `GET /analytics/templates/:id/compare` ; `mongo-templates`, `templates.spec` |
| Mise à jour sélective depuis le modèle, protection des adaptations locales | terminé | `diffTemplate`, `overwriteLocal` ; `templates`, `mongo-templates` |

### Intégrations

| Exigence | Statut | Preuves |
|---|---|---|
| Conversation d'IA (EX-PAR-04/05) | bloqué | Code complet (`ai/`, `integrations/aiProvider.ts`), testé contre un faux fournisseur local (`mongo-integrations`) ; exige `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`. Sans eux : 503, aucune réponse simulée |
| LTI 1.3 (plateforme) | bloqué | `lti/` testé avec des clés de test (`integrations-config`, `mongo-integrations`, `integrations.spec`) ; exige `LTI_PRIVATE_KEY`, `LTI_KEY_ID`, `LTI_ISSUER` et un outil réel. Pas de certification IMS, pas de Deep Linking ni de NRPS |
| SCORM 1.2 / 2004 | bloqué (lancement) | Import et validation opérationnels ; lecteur et suivi testés avec une origine locale distincte (`scorm`, `mongo-integrations`, `integrations.spec`). En production, exige `SCORM_CONTENT_ORIGIN` (sous-domaine dédié). Un SCO par package, pas de séquencement |

### Transversal

| Exigence | Statut | Preuves |
|---|---|---|
| Rôles et permissions vérifiés par l'API | terminé | `canManageCourse`, `lms/access.ts` ; cas 403/404 dans chaque suite d'intégration ; [permissions-matrix.md](permissions-matrix.md) |
| i18n FR / EN / AR avec RTL | terminé | `lms.{fr,en,ar}.ts`, parité vérifiée (3228 clés, 0 manquante) ; `accessibility.spec` (rendu arabe `dir=rtl`) |
| WCAG 2.1 AA | partiel | Audit axe sans violation grave ou critique sur 26 écrans (13 enseignant, 11 étudiant, 2 en arabe) (`accessibility.spec`) ; clavier testé dans les specs ; aucun test avec un lecteur d'écran réel |
| Sécurité (secrets, journaux, XSS, SSRF, zip) | terminé | Clés côté serveur uniquement, aucun secret journalisé, nettoyage HTML et LaTeX, protection SSRF, lecteur ZIP borné ; risque résiduel `zod` 3 documenté ([lms-architecture.md](lms-architecture.md) §10) |
| Performance (< 3 s pour 50 éléments) | partiel | Plan chargé en une requête ; pas de mesure instrumentée |

## Points d'attention

- Les suites d'intégration historiques `mongo-workflows` et `mongo-marketplace` partagent la même base et la vident au démarrage alors que `node --test` les exécute en parallèle : risque d'instabilité préexistant (un échec isolé observé une fois, non reproduit sur 5 exécutions). La nouvelle suite utilise sa propre base `…_content_test`.
- Mission 2 : aucune migration obligatoire (champs facultatifs, valeurs par défaut compatibles) ; voir [lms-architecture.md](lms-architecture.md) §9.
- `bun.lock` n'a pas été régénéré (dépendances installées avec npm, `package-lock.json` à jour).
- Le frontend conserve une erreur de typage préexistante (`e2e/marketplace.spec.ts` importe le type `mongoose`, non installé côté frontend).
