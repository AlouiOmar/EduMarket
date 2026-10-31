# Inscription, candidature et vérification des enseignants indépendants

## 1. Principes

- **Pas de second système de comptes.** Le candidat est un `User` ordinaire. Il passe par la même inscription (`POST /auth/register`), la même vérification d'e-mail, la même politique de mot de passe, les mêmes limites de tentatives et le même cookie de session.
- **Le dossier est séparé du compte.** La collection `teacherapplications` contient l'identité, les diplômes, l'expérience, les documents et l'historique.
- **Les permissions viennent des champs existants.** Un enseignant actif est un compte qui a `role: 'teacher'`, `verified: true` et `teacherVerification.status: 'approved'`. Seule l'approbation par l'administration centrale écrit ces champs. Toutes les routes enseignant existantes (cours, contenus, tutorat, agenda…) restent donc protégées côté serveur, sans exception. Aucun nouveau rôle n'a été créé.
- **Candidat.** Un candidat inscrit par ce parcours reçoit le rôle existant `unverified_teacher`. Un étudiant qui se porte candidat garde le rôle `student`, et donc ses cours, jusqu'à l'approbation. Le rôle n'est jamais choisi par le client : la route d'inscription refuse tout champ `role`, et une valeur envoyée par l'inscription classique est ignorée.
- **`teacherType`.** Ce champ du `User` vaut `independent` (posé à l'approbation) ou `institutional`. Il est écrit uniquement par le serveur.

## 2. Enseignants d'établissement

Aujourd'hui, un établissement **invite** un enseignant déjà vérifié à s'affilier (`/institutions/invitations`). Le compte prend alors `institutionId`. Ce processus n'a pas été modifié.

Un compte qui a un `institutionId` ou `teacherType: 'institutional'` :
- ne peut pas ouvrir de candidature indépendante (erreur `409 INSTITUTIONAL_TEACHER`) ;
- ne peut pas non plus emprunter l'ancien formulaire `/teacher-verifications`.

À l'approbation, si le compte est devenu institutionnel entre-temps, l'opération est annulée : le dossier revient « en vérification » (`APPLICATION_ACCOUNT_NOT_ELIGIBLE`).

> **Écart avec le cahier des charges.** Il décrit un enseignant d'établissement « créé par l'administrateur de son institut ». EduMarket n'a pas de création de compte par un établissement, seulement l'affiliation par invitation. Cette fonctionnalité n'a pas été ajoutée : c'est une décision produit (mot de passe initial, e-mail d'activation, statut de vérification).

## 3. Parcours candidat

| Étape | Où | Contenu |
|---|---|---|
| 1. Compte | `/auth/register/teacher` | Prénom, nom, e-mail, mot de passe et confirmation, téléphone international (préfixe proposé selon le pays), pays, ville, langue, acceptation des conditions. Ensuite : vérification de l'e-mail. |
| 2. Identité | `/teacher/application` | Date de naissance (18 ans minimum), nationalité, adresse facultative. Type de pièce : CIN, passeport, titre de séjour, permis, autre document officiel. Numéro, pays et autorité de délivrance, dates de délivrance et d'expiration. |
| 3. Formation | idem | Plusieurs diplômes (niveau, intitulé, spécialité, établissement, pays, année, diplôme le plus élevé). Certifications et formations. |
| 4. Expérience | idem | Présentation, biographie (100 caractères minimum), spécialités, matières, expertises, langues d'enseignement, compétences, années d'expérience. Expériences professionnelles et pédagogiques multiples. Portfolio et LinkedIn en HTTPS, facultatifs. |
| 5. Documents | idem | Pièce d'identité, CV, un diplôme pour **chaque** diplôme déclaré. Justificatifs complémentaires. Barre de progression d'envoi, aperçu, remplacement, retrait (brouillon uniquement). |
| 6. Récapitulatif | idem | Éléments manquants, synthèse, attestation sur l'honneur, puis « Soumettre ma candidature ». |

**Sauvegarde.** Le brouillon est enregistré automatiquement 2,5 s après la dernière modification et à chaque changement d'étape. Un bouton « Enregistrer le brouillon » existe aussi. Chaque écriture porte la `revision` lue : une modification depuis un autre onglet donne `APPLICATION_REVISION_CONFLICT` et propose de recharger.

**Suivi.** L'espace candidat montre :
- le statut, la référence (`EMT-AAAA-XXXXXXXX`), la date de soumission et les étapes de vérification ;
- l'état de chaque document et le commentaire qui lui est destiné ;
- les demandes de compléments, le motif d'un refus ou d'une suspension ;
- l'historique et un lien vers les notifications ;
- après approbation, un lien vers le tableau de bord enseignant.

Il ne montre jamais les notes internes ni l'identité des vérificateurs.

## 4. Statuts et transitions

| Action | De | Vers | Par |
|---|---|---|---|
| Soumettre | `draft` | `submitted` | candidat |
| Commencer la vérification | `submitted`, `resubmitted` | `under_review` | admin |
| Demander des compléments | `under_review` | `additional_information_required` | admin |
| Soumettre à nouveau | `additional_information_required` | `resubmitted` | candidat |
| Approuver | `under_review` | `approved` | admin |
| Refuser | `under_review` | `rejected` | admin |
| Suspendre | `approved` | `suspended` | admin |

- **Contrôle serveur.** Toute écriture est conditionnelle : statut attendu et révision lue (`findOneAndUpdate`). Une transition invalide renvoie `409 INVALID_APPLICATION_TRANSITION`. Le candidat n'a aucune route qui change le statut, en dehors de la soumission.
- **Modification.** Le candidat modifie son dossier en `draft` et en `additional_information_required` seulement (`APPLICATION_LOCKED` sinon).
- **Soumission.** Elle exige un dossier complet (`422 APPLICATION_INCOMPLETE`, avec la liste `missing`) et un stockage persistant (§6). La référence et la date sont attribuées à ce moment.
- **Approbation.** Elle exige une confirmation explicite (`confirm: true`) et que chaque document obligatoire soit **vérifié** (`422 APPROVAL_BLOCKED`, avec la liste `blockers`). Elle est idempotente : un double clic renvoie le même résultat.
- **Refus.** Le motif est obligatoire, avec une catégorie interne. Le dossier est clos (`open: false`). Une nouvelle candidature n'est possible qu'après `TEACHER_APPLICATION_REAPPLY_DAYS` (90 jours par défaut, `REAPPLY_TOO_EARLY` avant). Elle reprend les réponses précédentes mais **ni documents ni données d'identité**. Le dossier refusé est conservé.
- **Suspension.** Le motif est obligatoire. Le compte repasse en `unverified_teacher`, `verified: false`, `teacherVerification.status: 'suspended'` : il perd toutes les fonctions enseignant. Les cours et l'historique sont conservés. L'audit est en sévérité `critical`.

## 5. Vérification des documents

- **Statuts** : `pending_review`, `verified`, `rejected` (motif obligatoire) ou `replacement_requested` (motif obligatoire). Chaque décision est enregistrée avec son auteur et sa date dans `reviews`.
- **Remplacement.** Il crée un **nouveau** document. L'ancien reçoit `replacedBy` et reste consultable par l'administration, avec son historique. Un document déjà vérifié ne se remplace qu'en brouillon.
- **Demande de compléments.** L'administrateur coche les éléments à corriger (sections ou documents précis) et rédige un message. Les documents cochés passent en `replacement_requested`.

## 6. Stockage et sécurité des fichiers

**Abstraction** : `src/integrations/documentStore.ts`, avec deux implémentations.
- `local` : `PRIVATE_UPLOAD_DIR/teacher-applications`, fichiers en mode 600.
- `s3` : tout bucket S3 compatible et **privé**. La signature AWS SigV4 est implémentée sans dépendance et testée contre le vecteur officiel d'AWS. Aucune ACL publique.

**Disque éphémère.** En production, le stockage `local` n'est accepté que si `PRIVATE_UPLOAD_PERSISTENT=true` déclare un disque persistant. Sinon la soumission finale est refusée (`503 DOCUMENT_STORAGE_NOT_PERSISTENT`) et l'espace candidat l'explique. Le système de fichiers éphémère de Render ne doit pas être déclaré persistant. Sur Render, utilisez un bucket S3, R2 ou B2, ou un disque persistant Render monté.

**Drive et OneDrive non réutilisés.** Les intégrations Drive et OneDrive existantes servent aux fichiers des utilisateurs eux-mêmes, et leurs autorisations appartiennent à ces utilisateurs. Elles ne conviennent pas à des pièces d'identité gérées par la plateforme.

**Contrôles appliqués à chaque fichier :**
- fichiers jamais stockés dans MongoDB ;
- clés générées par le serveur (`<32 hex>.<ext>`) et jamais renvoyées au client ;
- type réel lu dans les octets (PDF, PNG ou JPEG), et cohérence vérifiée avec le type déclaré et l'extension ;
- refus des PDF à contenu actif (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`) ;
- taille maximale `TEACHER_DOCUMENT_MAX_MB` (10 Mo par défaut), 30 documents actifs au maximum ;
- empreinte SHA-256 conservée ;
- noms d'origine nettoyés (chemins retirés, UTF-8 restauré).

**Téléchargement :**
- uniquement via l'API authentifiée ;
- le candidat ne voit que ses fichiers (la propriété fait partie de la requête : l'identifiant d'un autre dossier donne 404) ;
- l'administration centrale voit tous les fichiers ; chaque consultation ou téléchargement est journalisé (`AuditEvent`) ;
- en-têtes `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` et une CSP `sandbox`, pour qu'aucun script contenu dans un document ne s'exécute sous l'origine de l'API.

**Limites connues :**
- pas d'antivirus : un fichier peut être valide sur la forme et malveillant sur le fond. Un point d'extension naturel est `inspectDocument` dans `rules.ts`, par exemple un appel à ClamAV avant `put` ;
- les images ne sont pas réencodées.

## 7. Données sensibles

- **Numéro de pièce d'identité.** Chiffré au repos (AES-256-GCM, clé `TEACHER_DATA_KEY` ou dérivée de `JWT_SECRET`). Seuls les 4 derniers caractères sont lisibles (`•••• 1234`).
  - Il n'apparaît dans aucune liste, notification ou réponse candidat.
  - L'administrateur peut l'afficher en entier sur demande ; chaque affichage est journalisé (`teacher.application.identity_revealed`, sévérité `warning`).
- **Liste du back-office.** Elle n'expose jamais le numéro, la date de naissance ni l'adresse (vérifié par les tests).
- **Journaux.** Ils ne contiennent ni données de dossier ni contenu de fichier. Les erreurs du stockage S3 ne sont ni journalisées ni renvoyées en détail.
- **Aucun service externe.** Aucune donnée du dossier n'est envoyée à un service d'analyse ou d'IA.

**Conservation.** Le job planifié `purgeExpiredApplications` traite les dossiers refusés et les brouillons inactifs depuis `TEACHER_APPLICATION_RETENTION_DAYS` (365 jours par défaut) :
- il supprime les fichiers ;
- il efface le numéro chiffré, la date de naissance et l'adresse ;
- il conserve un enregistrement minimal (référence, statuts, historique).

La durée doit être fixée selon les obligations légales applicables. Les dossiers approuvés et suspendus sont conservés.

## 8. Back-office (administration centrale uniquement)

Les routes sont `/admin/teacher-applications` et `/admin/teacher-applications/:id`, réservées au rôle `admin`. Le rôle `institution` (administrateur d'établissement) reçoit 403 côté API.

- **Indicateurs** : total, nouvelles, en vérification, incomplètes (documents refusés), compléments demandés, approuvées, refusées, suspendues.
- **Liste** :
  - recherche par nom, e-mail ou référence ;
  - filtres par statut, spécialité et pays ;
  - tri par date de soumission ou de mise à jour ;
  - pagination ;
  - les brouillons restent masqués sauf demande explicite.
- **Fiche** : identité, informations personnelles, diplômes, expériences, spécialités et langues, documents (aperçu, téléchargement, type, taille, empreinte, vérifier, refuser, demander un remplacement, versions précédentes), historique, notes internes jamais visibles du candidat.
- **Actions** : commencer la vérification, demander des compléments, approuver (avec confirmation), refuser (motif et catégorie), suspendre (motif).

L'ancienne file « Vérifications » (`/admin/verifications`, formulaire simplifié `/teacher-verifications`) reste accessible pour les demandes déjà déposées. Un compte qui possède une candidature complète ne peut plus l'utiliser (`USE_TEACHER_APPLICATION`).

## 9. Notifications

Les notifications passent par le système existant (`createNotification`, modèles traduits côté client).

**Événements notifiés au candidat :**
- compte créé (l'e-mail de vérification existant est envoyé en plus) ;
- candidature soumise, prise en charge, soumise à nouveau ;
- document vérifié, refusé, ou à remplacer ;
- compléments demandés ;
- candidature approuvée ou refusée ;
- compte suspendu.

**Administrateurs.** Ils sont notifiés à chaque nouvelle soumission ou resoumission.

**E-mails transactionnels.** Les décisions (compléments, approbation, refus, suspension) partent aussi par e-mail quand `RESEND_API_KEY` est configuré, quelle que soit la préférence de notification. Aucune pièce jointe n'est envoyée, seulement la référence.

## 10. API (`/api/v1/teacher-applications`)

**Candidat** (authentifié) :
- `GET /mine` ;
- `POST /` (ouvrir ou rouvrir, idempotent) ;
- `PATCH /mine` (sections et `revision`) ;
- `POST /mine/documents` (multipart : `file`, `type`, `degreeId?`, `replaces?`) ;
- `DELETE /mine/documents/:id` ;
- `GET /mine/documents/:id` ;
- `POST /mine/submit`.

**Administration** (`admin`) :
- `GET /admin/stats` ;
- `GET /admin` ;
- `GET /admin/:id` ;
- `POST /admin/:id/identity-number` ;
- `GET /admin/:id/documents/:docId[?download=1]` ;
- `POST /admin/:id/start-review` ;
- `POST /admin/:id/documents/:docId/review` ;
- `POST /admin/:id/request-information` ;
- `POST /admin/:id/approve` ;
- `POST /admin/:id/reject` ;
- `POST /admin/:id/suspend` ;
- `POST /admin/:id/notes`.

**Inscription** : `POST /auth/register` avec `accountType: 'teacher_candidate'`, `firstName`, `lastName`, `phone` (E.164), `country`, `city`, `preferredLanguage` et `acceptTerms: true`.

**Limites de débit** : 30 envois de fichiers par heure, 10 soumissions par heure, en plus des limites d'authentification existantes.

## 11. Configuration (`edumarket-backend/.env.example`)

| Variable | Rôle |
|---|---|
| `TEACHER_DOCUMENTS_STORAGE` | `local` (par défaut) ou `s3` |
| `PRIVATE_UPLOAD_PERSISTENT` | `true` uniquement si `PRIVATE_UPLOAD_DIR` est sur un disque persistant |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE` | Bucket privé S3 compatible (HTTPS obligatoire en production) |
| `TEACHER_DOCUMENT_MAX_MB` | Taille maximale d'un fichier (10 par défaut, 25 au maximum) |
| `TEACHER_DATA_KEY` | Clé de chiffrement des numéros d'identité (32 caractères minimum, à conserver stable) |
| `TEACHER_APPLICATION_RETENTION_DAYS` | Conservation des dossiers refusés ou abandonnés (365 par défaut) |
| `TEACHER_APPLICATION_REAPPLY_DAYS` | Délai avant une nouvelle candidature après un refus (90 par défaut) |

**Exemple : Vercel, Render et Atlas avec Cloudflare R2.**

```
TEACHER_DOCUMENTS_STORAGE=s3
S3_ENDPOINT=https://<id-compte>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=edumarket-documents
S3_PREFIX=prod/teacher-applications/
```

Le jeton R2 doit être limité à ce seul bucket, en lecture et écriture d'objets. Ajoutez une valeur stable à `TEACHER_DATA_KEY`.

**En local**, le stockage de développement est `./private-uploads/teacher-applications`. Il est séparé de la production. Les tests utilisent leurs propres répertoires et bases `_test`.

## 12. Tests

| Suite | Contenu |
|---|---|
| `edumarket-backend/tests/teacher-documents.test.mjs` (unitaire) | Signature SigV4 (vecteur officiel AWS), types réels et contenu actif, règles de transition, chiffrement authentifié, mineur ou pièce expirée, refus des clés de stockage non générées |
| `edumarket-backend/tests/mongo-teacher-applications.test.mjs` (intégration, base `…_applications_test`) | Inscription et doublons, aucune permission avant approbation, brouillon et révision, chiffrement, refus des fichiers invalides ou trop gros, isolation entre candidats, stockage non persistant, back-office sans données sensibles, audit, workflow complet, approbation idempotente, suspension, refus et nouvelle candidature, rétention, enseignants d'établissement |
| `edumarket-frontend/e2e/teacher-application.spec.ts` | Parcours complet depuis l'interface : inscription, vérification d'e-mail, dossier, dépôt des documents, soumission, refus d'accès au tableau de bord, vérification et demande de compléments par l'administration, remplacement, resoumission, approbation, accès au tableau de bord enseignant. Audits axe (espace candidat, fiche admin, inscription en arabe RTL) |

Seuls des documents fictifs, générés en mémoire, sont utilisés.

## 13. Limites

- **Création de comptes enseignants par un établissement** : inexistante dans EduMarket, non ajoutée (§2).
- **Antivirus** : absent (§6).
- **Stockage S3** : la signature est vérifiée contre le vecteur d'AWS, mais aucun envoi vers un vrai bucket n'a été testé. À valider avec un bucket de préproduction : dépôt, aperçu, téléchargement, suppression par le job de rétention.
- **Réactivation** : un enseignant suspendu n'a pas d'action « Réactiver » ; elle n'est pas prévue par le workflow demandé.
- **Mode démonstration** (`VITE_DATA_MODE=mock`) : la candidature complète nécessite le mode API. La démo conserve le formulaire simplifié.
