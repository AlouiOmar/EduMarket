# Fonctionnalités LMS (mission 2) : architecture et règles

Complète [course-content.md](course-content.md) (plan, blocs, visibilité, copie). Matrice des exigences et statuts : [blackboard-ultra-audit.md](blackboard-ultra-audit.md).

Toutes les données ci-dessous portent un `courseId` : chaque classe (cours) a ses propres données. Toutes les permissions sont vérifiées par l'API, et l'interface ne fait que refléter ces contrôles. Les gestionnaires d'un cours sont : son propriétaire, ses co-auteurs, les coordinateurs de l'établissement, l'établissement propriétaire et l'admin (`canManageCourse`). Un étudiant a accès si son inscription est active et si le cours n'est pas « Privé » ; un cours « Terminé » est en lecture seule (`lms/access.ts`).

## 1. Brouillons, publication et versions (`courses/publication*.ts`, `version.model.ts`)

| État | Règle |
|---|---|
| Brouillon | Élément jamais publié (masqué, `publishedVersion` 0) : modifié en place, invisible des étudiants. |
| Publié | Visible, ou publié au moins une fois. Ses champs de contenu sont ceux que voient les étudiants. |
| Modifications en attente | Toute modification d'un élément publié va dans `item.draft`. Les étudiants gardent la version publiée. |
| Publication planifiée | `scheduledPublishAt` : la tâche de fond publie le brouillon à l'heure dite. |
| Versions | Chaque publication est archivée (`ContentVersion`, en ajout seul). La version 0 est le contenu antérieur au versionnage. La restauration copie la version dans le brouillon et ne réécrit jamais l'historique. |

- **Atomicité** : la publication passe du contenu publié au nouveau contenu en une seule mise à jour du document, protégée par la `revision` de l'élément. Deux publications simultanées : une seule réussit (409 pour l'autre), sans version orpheline.
- **Intégrité des évaluations** : si le quiz d'un élément change alors que des tentatives existent, le quiz publié reçoit un nouvel identifiant. Les tentatives existantes restent liées à la version archivée qu'elles ont reçue.
- **Fuseau horaire** : `settings.timezone` (IANA). Une heure locale sans décalage (`2026-11-02T08:30`) est convertie par le serveur dans le fuseau du cours, changement d'heure compris (`common/timezone.ts`). Sans fuseau, l'interface envoie un instant ISO.
- **Aperçu** : `GET student-preview?draft=true` (gestionnaires uniquement). Les brouillons, plannings et révisions sont retirés de toutes les représentations destinées aux étudiants (`toStudentCourse`).
- **Copies** : une copie part de la copie de travail et a son propre historique ; la source n'est jamais modifiée.

## 2. Carnet de notes (`gradebook/`)

- **Catégories** à poids relatifs ; **colonnes** manuelles ou liées à une activité (devoir, quiz de leçon, test, discussion, journal, SCORM, conversation IA, LTI). Chaque activité notée a exactement une colonne, créée dans une catégorie adaptée.
- **Saisie** : la note de travail (`score`) est distincte de la note publiée (`published`). Les étudiants ne voient que `published`. Une correction après publication reste privée jusqu'à une nouvelle publication.
- **États** : non noté, en attente (remise à corriger), corrigé (non publié), publié. Publication individuelle ou globale par colonne. Par défaut, une colonne n'est jamais publiée automatiquement ; seuls les quiz de leçon le sont, car leur score est déjà affiché à l'élève après chaque tentative.
- **Calcul** (`compute.ts`) :
  - une note absente (`null`) n'est jamais un 0 : elle est exclue ;
  - « absence = 0 » ne s'applique, et sur option, qu'après la date limite (individuelle si une prolongation existe) ;
  - une dispense est toujours exclue ;
  - moyenne de catégorie = points obtenus / points maximum des notes comptées ;
  - note globale = moyenne pondérée des catégories ayant au moins une note (poids renormalisés) ;
  - note sur 20 = pourcentage ÷ 5 ;
  - arrondi au plus proche à 2 décimales (le demi s'arrondit en s'éloignant de zéro), appliqué à l'affichage ;
  - aucune note : « — », jamais 0.
- **Exceptions individuelles** : date limite prolongée et tentatives supplémentaires, utilisées par les devoirs et les tests.
- **Exports** CSV (UTF-8 avec BOM, neutralisation des formules) et XLSX (écrit sans dépendance, `common/xlsx.ts` et `common/zip.ts`).
- **Reprise de l'existant** : les devoirs déjà corrigés et montrés aux élèves avant le carnet sont importés comme publiés, pour ne rien masquer rétroactivement.

## 3. Évaluations (`assessments/`, `assignments/`)

- **Séries de questions** : QCM à réponse unique ou multiple, vrai/faux, réponse courte, question ouverte, classées par chapitre et difficulté, avec barème. Copie entre cours (questions et barèmes, jamais de réponses).
- **Tests** :
  - sections fixes ou tirées au hasard dans une série (nombre, chapitre, difficulté) ;
  - mélange des questions et des choix ;
  - durée, tentatives, ouverture et clôture ;
  - politique de note : meilleure ou dernière tentative.
  - Une tentative stocke l'instantané de ses questions, clé comprise côté serveur : modifier une question ensuite ne change ni la tentative ni sa note.
  - Une seule tentative en cours par étudiant (index unique) ; deux onglets reprennent la même.
  - Sauvegarde automatique ; reprise à l'identique (mêmes questions, même échéance).
  - Après l'échéance, plus 30 s de grâce, la tentative est remise avec les réponses enregistrées (à la consultation et par une tâche de fond).
  - Correction automatique des QCM, vrai/faux et réponses courtes. Les QCM multiples sont en tout ou rien, pour que cocher toutes les cases ne rapporte rien. Les questions ouvertes sont corrigées à la main.
  - La note et, si l'option est activée, le corrigé ne sont montrés qu'après publication dans le carnet. La clé de réponse n'est jamais envoyée avant.
- **Rubriques** : critères × niveaux (points). Le score est la somme des niveaux, ramenée au barème du devoir ; chaque critère doit être noté une seule fois. Elles sont réutilisables et copiables, et peuvent être rendues visibles avant la remise.
- **Devoirs** (module existant étendu) :
  - consignes avec pièces jointes ;
  - remise de texte, de liens (https, 5 maximum) et de fichiers (PDF, ZIP, DOCX, vérifiés par signature) ;
  - remise tardive jusqu'à `lateUntil`, avec une pénalité forfaitaire appliquée à la correction (la note brute est conservée) ;
  - `maxAttempts` = 0 garde l'ancien comportement (remplacement jusqu'à la correction). Au-delà de 0, l'historique des tentatives est conservé et une nouvelle correction est possible ;
  - correction par note ou par rubrique, ouverte aux co-gestionnaires ;
  - publication contrôlée par le carnet.
- **Formulaires** : questions configurables, sans colonne de note. En mode anonyme, aucun identifiant n'est stocké, seulement une empreinte HMAC qui empêche de répondre deux fois. L'anonymat ne peut plus être levé une fois des réponses reçues.

## 4. Participation et suivi (`participation/`, `analytics/course.routes.ts`)

- **Groupes** :
  - création manuelle, aléatoire (répartition équilibrée) ou en inscription libre (capacité vérifiée de façon atomique, un seul groupe par ensemble) ;
  - un espace de fichiers par groupe, avec contrôle de signature ;
  - discussions de groupe ;
  - les étudiants ne voient les membres que de leurs propres groupes.
- **Discussions** :
  - fil à l'échelle du cours ou d'un groupe ;
  - modération : masquer avec un motif (motif visible des enseignants seulement), épingler, fermer ;
  - notation facultative vers le carnet ;
  - l'accès direct à une discussion de groupe par un non-membre renvoie 404.
- **Journaux** : les entrées sont privées. Un étudiant ne reçoit que les siennes, même s'il passe `studentId`. Commentaires de l'auteur et des enseignants, notation facultative.
- **Annonces** :
  - publication immédiate ou programmée, ciblage par groupe ;
  - l'annonce est réservée de façon atomique (`scheduled` → `sending`) : jamais deux envois ;
  - une ligne de livraison unique par destinataire et par canal, donc aucun doublon, même après une reprise ;
  - e-mail uniquement pour les étudiants qui l'ont activé, et seulement si Resend est configuré, sinon « non envoyé » avec le motif ;
  - les e-mails en échec sont réessayés trois fois ;
  - une annonce envoyée ne se modifie plus.
- **Présence** : séances ; statuts présent, en retard, absent, excusé ; historique ; export CSV et XLSX. Un étudiant ne voit que ses propres présences.
- **Analyses** : trois notions distinctes :
  1. préparation du cours : éléments publiés, jamais publiés, en attente, programmés ;
  2. progression effective : éléments publiés terminés ;
  3. activité sur la période : leçons, tentatives, remises, messages.

  S'y ajoutent les étudiants inactifs (seuil réglable), les résultats par évaluation (moyenne des notes existantes uniquement) et des filtres par classe et par période.

## 5. Modèles et classes (`courses/templates*.ts`)

- Un cours marqué « modèle » produit des **classes indépendantes** : copie complète, brouillon privé, contenu masqué, avec les évaluations et la structure du carnet. Les inscriptions, notes, remises, groupes, messages, journaux et présences ne sont jamais copiés.
- **Comparaison** (`GET /analytics/templates/:id/compare`) : pour chaque classe, données réelles (étudiants, actifs, inactifs, progression, achèvement, moyenne sur 20 calculée à partir de ses propres notes).
- **Mise à jour depuis le modèle** : comparaison élément par élément, à partir d'empreintes de contenu enregistrées à la copie. Statuts possibles : inchangé, modifié dans le modèle, adapté localement, conflit, nouveau, supprimé. L'auteur choisit les changements à récupérer.
  - Une adaptation locale n'est remplacée que sur choix explicite (`overwriteLocal`).
  - Un élément déjà publié reçoit le changement comme brouillon.
  - Les nouveaux éléments arrivent masqués.
  - Toute l'opération est une seule mise à jour, protégée par `structureVersion`.

## 6. Intégrations

| Intégration | Implémenté | Prérequis pour être opérationnel | Sans configuration |
|---|---|---|---|
| Conversation d'IA (`ai/`, `integrations/aiProvider.ts`) | Fournisseur côté serveur (Anthropic ou API compatible OpenAI), consigne pédagogique cachée aux étudiants, limite d'échanges, longueur et débit, notice de données avec accord explicite, conservation limitée puis purge, transcriptions lisibles par les enseignants du cours (lecture journalisée), notation non publiée | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (`AI_BASE_URL` pour le mode compatible) | 503 `AI_PROVIDER_NOT_CONFIGURED`, publication refusée, aucune réponse simulée |
| LTI 1.3 plateforme (`lti/`) | Outils enregistrés par l'admin (identifiants générés, URI de redirection exactes, clé PEM ou JWKS, minimisation des données), JWKS, connexion OIDC à usage unique liée à l'utilisateur, `id_token` RS256 de 5 min (iss, aud, nonce, deployment_id, rôles, sujet pseudonyme), jetons de service avec assertion signée vérifiée (iss = sub, aud, signature, durée, rejeu de jti, refus de HS256), retour de notes AGS vers le carnet | `LTI_PRIVATE_KEY`, `LTI_KEY_ID`, `LTI_ISSUER` + un outil réel | 503 `LTI_NOT_CONFIGURED` |
| SCORM 1.2 / 2004 (`scorm/`) | Import ZIP validé (manifeste, fichier de lancement, chemins, types autorisés, tailles, archives chiffrées ou zip64 refusées), lecteur sur une origine séparée sans cookie de session (contrôle de l'hôte, CSP `connect-src 'self'`, cadrage limité à l'application), API d'exécution des deux versions, CMI en liste blanche, reprise (`entry=resume`, `suspend_data`), complétion vers la progression, score vers le carnet | `SCORM_CONTENT_ORIGIN` (nom d'hôte distinct de l'application) | Import et validation possibles ; lancement 503 `SCORM_NOT_CONFIGURED` |

**Limites déclarées**
- IA : testée contre un faux fournisseur local, ce qui vérifie la gestion des erreurs, des limites et des autorisations. Aucun appel à un vrai fournisseur n'a été fait.
- LTI : validée avec des clés de test et un outil simulé au niveau HTTP. Aucune certification IMS, aucun test avec un outil réel. Le lancement en `POST` depuis un autre site ne transmet pas le cookie `SameSite=Lax` : seul le `GET` est pris en charge. Pas de liens profonds (Deep Linking) ni de service des membres (NRPS).
- SCORM : un SCO par package (le premier élément de l'organisation). Pas de séquencement SCORM 2004 ni d'interactions `cmi.interactions`.

## 7. Éditeur et fichiers (`courses/files*.ts`, `links.ts`)

- **Formules** : bloc `math` qui stocke le LaTeX (jamais du HTML). Les commandes de lien ou de ressource externe sont refusées par le serveur. Rendu KaTeX (`trust: false`) en MathML pour les lecteurs d'écran, avec alternative textuelle.
- **Liens** :
  - liens des éléments et des blocs, publiés et brouillons, testés par le serveur (HEAD, puis GET si HEAD est refusé, 3 redirections au plus) ;
  - protection SSRF : http(s) uniquement, ports standards, refus des adresses privées, de boucle locale, link-local, CGNAT et réservées, vérification à chaque redirection ;
  - rapport par emplacement ;
  - vérification annuelle automatique.
- **Fichiers** :
  - inventaire avec nom, taille, type et lieux d'utilisation (contenu publié, brouillon, version archivée, vignette, bannière, devoir, média de leçon) ;
  - un fichier utilisé ne peut être ni mis en quarantaine ni supprimé ;
  - suppression définitive uniquement depuis la quarantaine, après une nouvelle vérification ;
  - purge automatique après 30 jours si le fichier est toujours inutilisé, sinon il est libéré ;
  - le fichier stocké est conservé s'il est partagé avec une copie du cours.
- **Archive v2** : ZIP contenant `course.json`, `files/…` (chemins relatifs) et `manifest.json` (taille et SHA-256 de chaque fichier).
  - À l'import, les fichiers manquants, modifiés ou non déclarés sont refusés et les types vérifiés par signature.
  - Les fichiers deviennent de nouveaux fichiers du cours et les références des blocs sont réécrites.
  - En cas d'échec, rien n'est importé.
  - Format EduMarket : aucune compatibilité Blackboard ou IMS n'est revendiquée.

## 8. Tâches de fond (`jobs/scheduler.ts`, toutes les 60 s, idempotentes)

Publications planifiées, livraison des annonces et nouvelles tentatives d'e-mail, remise des tentatives expirées, purge des transcriptions d'IA, purge des fichiers en quarantaine, vérification annuelle des liens (une par heure au maximum). Ces tâches s'ajoutent aux tâches existantes de paiement et d'abonnement.

## 9. Migrations et retour arrière

- **Aucune migration obligatoire, aucune migration destructive.** Les nouveaux champs sont facultatifs avec des valeurs par défaut compatibles : un élément sans `publishedVersion` qui est visible reste publié, `maxAttempts` vaut 0 (comportement historique des devoirs), `settings.timezone` est absent (fuseau du navigateur) et les fichiers ne sont pas en quarantaine. Les nouvelles collections et leurs index sont créés par Mongoose au démarrage.
- **Script facultatif existant** : `scripts/migrate-course-outline.mjs` (visibilité explicite ; simulation par défaut, `--apply` pour écrire).
- **Retour arrière** : revenir au code précédent laisse les champs et collections ajoutés sans effet. Les modules antérieurs ignorent `draft` et `publishedVersion`, et les étudiants voient alors le contenu publié. Exception : un brouillon non publié n'apparaît plus dans l'éditeur ; il reste en base et peut être relu avec MongoDB.

## 10. Dépendances ajoutées

| Paquet | Où | Justification |
|---|---|---|
| `katex` 0.19.1 | frontend | Rendu des formules en MathML accessible ; la version 0.16 corrigée par avis de sécurité n'a pas été retenue. |
| `@axe-core/playwright` 4.11 | frontend (dev) | Audit automatisé WCAG 2.1 A/AA dans Playwright. |
| `dompurify` 3.2 → 3.4.17 | frontend | Mise à jour de sécurité (avis XSS). |
| `sanitize-html` 2.17 → 2.18.1, `multer` → 2.5.0, `body-parser` → 1.20.9 | backend | Correctifs de sécurité non cassants (`npm audit fix`). |

Aucune dépendance pour le ZIP et le XLSX (écrits avec `node:zlib`), le JWT LTI (`jsonwebtoken`, déjà présent) ou le XML SCORM (analyse restreinte, DOCTYPE et entités refusés). **Risque résiduel** : `zod` 3 fait l'objet d'un avis (épuisement mémoire sur de très grandes collections). Le risque est atténué par les limites de taille des corps de requête et les bornes `max()` des tableaux ; la migration vers zod 4 est cassante et n'a pas été faite.
