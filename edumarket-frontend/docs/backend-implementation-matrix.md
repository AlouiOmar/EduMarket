# Matrice d'implémentation backend

Statuts : `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED` (logique réelle présente), `INTEGRATED` (consommée par le frontend en mode API), `TESTED` (couverte par des tests réellement exécutés), `BLOCKED` (dépend d'un tiers ou d'une décision produit).

Dernière vérification : 2026-10-20 — `npm run lint` (backend et frontend), `npm test` (66/66 HTTP), `npm run test:integration` (38/38 MongoDB : classes, paiements hors ligne, stockage cloud, workflows historiques + marketplace, modération, support, calendrier, affiliation, rôles internes et co-propriété, reprogrammation, avis/suivi enseignant, registres admin, abonnements, signalements, Q&R, contact, parcours, certificats), `npm run test:e2e` (9/9 Playwright Edge), `npm run build`, `npm run i18n:check`.

## Fondations

| Domaine | Statut | Évidence / limites |
|---|---|---|
| Configuration validée (Zod), Express, MongoDB, erreurs stables | TESTED | `config/env.ts` refuse sandbox en production et Stripe sans secrets; valeurs vides = non configurées. Erreurs `{success:false,error:{code}}`, nouveaux codes `INVALID_IDENTIFIER` et `MALFORMED_JSON` (testé). |
| Authentification, sessions, vérification e-mail, récupération | TESTED | bcrypt, cookie HttpOnly, jetons hashés à usage unique, révocation (`authVersion`). Livraison e-mail de production : Resend requis. |
| RBAC relu en base à chaque requête, suspension | TESTED | `common/auth.ts`; tests 401/403 HTTP et workflows Mongo. |
| Stockage privé des fichiers | TESTED | `PrivateStorageAdapter` local. Aucun driver S3 : volume persistant requis en production (**BLOCKED** côté cloud). |
| Jobs de fond | TESTED | `jobs/scheduler.ts` : expiration des checkouts abandonnés, règlement des périodes d'abonnement échues, rappels de renouvellement (J-3); chaque tâche testée via sa fonction de service. |

## Catalogue, apprentissage, évaluation

| Domaine | Statut | Évidence / limites |
|---|---|---|
| CRUD cours, curriculum, médias privés | TESTED | Propriété/rôles côté serveur; médias réservés aux inscrits. |
| Workflow de publication (soumission → revue → publication/rejet → suspension/rétablissement) | TESTED | `courses/service.ts` partagé par propriétaires et modération; notes obligatoires, notifications, audit; un propriétaire ne peut pas lever une suspension. |
| Catégories gérées (FR/EN/AR) | TESTED | `modules/categories`; validation des slugs actifs, valeurs libres historiques conservées, suppression interdite si utilisée. |
| Inscriptions gratuites, progression, quiz notés serveur, historique | TESTED | Workflows Mongo existants. |
| Avis de cours et modération | TESTED | Masquage/rétablissement désormais audités (`moderation.review.*`). |
| Examens en ligne / présentiel, certificats | TESTED (parcours nommés) | Inscription payante via commande confirmée; capacité revérifiée à l'exécution, remboursement automatique si complet. Vérification publique `GET /certificates/verify/:code` (insensible à la casse, 404 `CERTIFICATE_NOT_FOUND`) consommée par `/certifications?code=`. |
| Questions/réponses par leçon | TESTED | `courses/questions.routes.ts` : réservé aux inscrits actifs et au formateur; réponses du formateur signalées. |
| Parcours d'apprentissage | TESTED | `modules/learning-paths` : CRUD admin, cours publiés uniquement (`PATH_COURSE_NOT_PUBLISHED`), liste publique. |
| Devoirs et corrections | TESTED | Fichiers privés signés. |
| Favoris | IMPLEMENTED | Test de persistance basique. |

## Marketplace

| Domaine | Statut | Évidence / limites |
|---|---|---|
| Commandes (cours, examens, sessions) avec prix/commission figés côté serveur | TESTED | `payments/service.ts`; montants en centimes; aucun prix accepté du navigateur. |
| Idempotence (clé `Idempotency-Key`, événements dédupliqués, étapes d'exécution idempotentes) | TESTED | Réutilisation de commande, redélivrance de webhook sans double crédit. |
| Webhooks signés (Stripe `Stripe-Signature`, sandbox `X-Sandbox-Signature`) | TESTED (sandbox) / IMPLEMENTED (Stripe) | Signature HMAC + tolérance 5 min; mauvaise signature → 400; montant falsifié → commande `failed AMOUNT_MISMATCH`. L'adaptateur Stripe (API REST) n'a pas été exécuté contre Stripe faute de clés. |
| Fournisseur sandbox de développement | TESTED | Interdit en production; page `/checkout/sandbox/:id` clairement identifiée. |
| Fournisseur Stripe (Checkout Sessions, remboursements) | BLOCKED | Implémenté mais non vérifié : nécessite `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et un compte marchand. |
| Factures numérotées (`INV-YYYY-NNNNNN`) | TESTED | Attribuées uniquement au passage en `paid`; accès acheteur/admin seulement. |
| Remboursements admin (accès révoqué, grand livre débité) | TESTED | Non répétables; sessions payantes annulées/refusées remboursées automatiquement (testé). |
| Grand livre vendeur, période de rétention, soldes | TESTED | `ledgerentries`, `PAYOUT_HOLD_DAYS`. |
| Reversements (demande vendeur, règlement manuel admin) | TESTED | Une demande ouverte par vendeur (index partiel unique, testé en concurrence). Virements exécutés hors plateforme : pas de Stripe Connect. |
| Partage de revenus institution ↔ enseignant affilié | TESTED | Taux fixé par affiliation (0–50 %) à l'invitation; après commission plateforme, la part institution est créditée en `affiliation_share` (contre-passée au remboursement). Fin d'affiliation par l'institution ou l'enseignant (statut `ended`). |
| Abonnements (catalogue inclus) | TESTED (sandbox) | Périodes prépayées mensuelles/annuelles (`SubscriptionPeriod` par commande), accès à tous les cours payants publiés pendant la période (`Enrollment.accessType = subscription`, `accessExpiresAt`); examens/sessions payés à part. Règlement en fin de période : pool réparti au prorata des leçons suivies (`subscription_share`). Pas de prélèvement récurrent automatique : renouvellement par nouveau paiement, rappel J-3. Prix gérés dans les paramètres admin. |
| Transactions MongoDB | NOT_STARTED (choix documenté) | Déploiement `mongod` standalone : cohérence par transitions conditionnelles et index uniques. |

## Sessions, communication, calendrier

| Domaine | Statut | Évidence / limites |
|---|---|---|
| Classes (groupes d'étudiants) et cours restreints | TESTED | `modules/classes` : création par enseignants/institutions (coordinateurs inclus), ajout par e-mail ou code, cours assignés ouverts sans paiement (`accessType: class`), cours `restricted` masqués partout ailleurs (catalogue, profils, parcours, stats, favoris, checkout, examens) ; retrait/archivage = accès expiré, progression conservée. Test d'intégration + E2E. |
| Paiements hors ligne (espèces, chèque, virement) | TESTED | Demande étudiant (`pending`, `OFFLINE_PAYMENT_DAYS`), enregistrement admin avec justificatif (signature JPG/PNG/PDF vérifiée, stockage privé), paiement au guichet en une étape, même chemin que les webhooks (`markOrderPaid` : facture, accès, grand livre, notifications), remboursement sans fournisseur, activation dans les paramètres. Test d'intégration + E2E. |
| Stockage cloud Google Drive / OneDrive | TESTED (API simulées) | `integrations/cloudStorage.ts` : OAuth (état signé), jetons chiffrés, rotation des jetons Microsoft, upload reprenable (Drive) / par blocs de 10 Mio (OneDrive), lecture en flux avec `Range` (vidéos), quotas ; plusieurs comptes par propriétaire, compte par défaut, bascule automatique vers le compte suivant si plein ; export CSV des notes. **BLOCKED** pour la recette réelle : identifiants Google/Microsoft requis. |
| Reprogrammation de session | TESTED | Vers un créneau libre du même enseignant (même type et prix), commande et calendrier mis à jour, notification traduite. |
| Disponibilités, réservation, conflits, avis, Jitsi | TESTED | Créneaux payants : 402 sur `/book`, réservation pendant le checkout, confirmation bloquée tant que non payé (testé). |
| Export iCalendar personnel | TESTED | `/calendar/events.ics`. |
| Synchronisation Google Calendar (OAuth, création/suppression d'événements) | TESTED (API Google simulée) | Jeton chiffré AES-256-GCM, état OAuth signé. Non vérifié contre Google réel : nécessite un client OAuth (**BLOCKED** pour la recette réelle). |
| Messagerie (texte, pièces jointes, vocaux, SSE) | TESTED | Bus SSE en processus : adaptateur partagé requis en multi-instance. |
| Notifications in-app + préférences | TESTED | Chaque notification porte `template { key, params }` traduit en FR/EN/AR côté client (40 modèles); copie e-mail sur opt-in (Resend; en anglais). Push non implémenté. |
| Forum | IMPLEMENTED | Décisions de signalement désormais auditées; pas de réactions au-delà des votes. |

## Administration, modération, support

| Domaine | Statut | Évidence / limites |
|---|---|---|
| Utilisateurs, rôles, statuts, vérifications enseignants/institutions | TESTED | Garde-fous auto-verrouillage. |
| Module `moderation` (cours, synthèse, historique) | TESTED | Ouvert aux modérateurs et admins; aucun accès financier (403 testé). |
| Gestion admin des examens, des certificats (révocation motivée) et fiche utilisateur | TESTED | `modules/admin/catalog.routes.ts`, `GET /admin/users/:id`; registre public renvoie `revoked`. |
| Suivi des étudiants et réponses aux avis (enseignant) | TESTED | `/analytics/teacher`, `/courses/reviews/managed`, réponse publique par avis. |
| Tags de cours | TESTED | Normalisés, filtre `?tag=`. |
| Journal d'audit paginé et filtrable | IMPLEMENTED | `/admin/audit-logs` (garde 401 testée). |
| Paramètres plateforme et maintenance | TESTED | Commission appliquée aux nouvelles commandes uniquement. |
| Support (tickets privés, file admin, notifications) | TESTED | Isolation par demandeur testée. Formulaire de contact public (`POST /support/contact`, ticket invité, réponse par e-mail). |
| Statistiques publiques | TESTED | `GET /platform/stats` (cours publiés, apprenants, formateurs vérifiés) pour la page d'accueil. |
| Statistiques admin et institution | TESTED | Données réelles agrégées; testées dans la suite marketplace. |
| Membres et rôles internes d'institution, cours co-détenus | TESTED | Les membres sont les enseignants affiliés avec un rôle interne (`teacher`, `coordinator` co-gère le contenu des cours de l'institution, `examiner` gère/corrige ses examens). Co-propriétaires par cours (`coOwnerIds`) : contenu modifiable, prix/statut/co-propriétaires réservés au propriétaire principal; ventes créditées au propriétaire principal. Pas de comptes « staff » non enseignants rattachés à l'institution. |
| Signalement générique (cours, avis, messages, profils) | TESTED | `modules/reports` : un signalement ouvert par auteur et cible; file modérateur; les signalements de profils sont escaladés aux admins; masquage de message audité. |

`TESTED` ne couvre que les parcours cités; les autres transitions restent à couvrir avec une base isolée.
