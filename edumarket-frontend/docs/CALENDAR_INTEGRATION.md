# Calendrier interactif, synchronisation externe et détection dans le chat

Audit initial et choix : [calendar-plan.md](calendar-plan.md). Cette page décrit ce qui est implémenté, comment le configurer et ses limites.

## 1. Vue d'ensemble

| Partie | Où | Fonctionne sans service externe |
|---|---|---|
| Agenda Mois / Semaine / Jour / Agenda, popup, glisser-déposer, couleurs, filtres | `edumarket-frontend/src/pages/shared/CalendarPage.tsx`, `src/components/calendar/*` | Oui |
| Événements EduMarket (rendez-vous, réunions, personnels), participants, rappels, conflits | `edumarket-backend/src/modules/calendar/{models,rules,events.service,routes}.ts` | Oui |
| Sessions de tutorat (créneaux, propositions de l'enseignant, déplacement d'un créneau libre) | `edumarket-backend/src/modules/sessions/routes.ts` (règles existantes conservées) | Oui |
| Détection de date/heure dans le chat | `edumarket-frontend/src/utils/scheduleDetection.ts` (navigateur, aucune requête réseau) | Oui |
| Google Agenda | `edumarket-backend/src/integrations/calendarProviders/google.ts` | Non : identifiants OAuth Google |
| Microsoft 365 / Outlook / Teams | `edumarket-backend/src/integrations/calendarProviders/microsoft.ts` | Non : application Microsoft Entra |
| Synchronisation commune (`CalendarSyncService`) | `edumarket-backend/src/modules/calendar/sync.service.ts` | Inactive sans connexion |

Bibliothèque de grille : **FullCalendar 6.1.21** (licence MIT pour `core`, `daygrid`, `timegrid`, `interaction`, `react` ; aucune extension premium). La vue Agenda est une liste React accessible, pour afficher durée, participants, type et calendrier d'origine.

## 2. Modèle de données (MongoDB)

| Collection | Rôle | Index |
|---|---|---|
| `tutoringsessions` (existante) | + `timeZone` (IANA, affichage) et `proposedBy` (`teacher` pour une proposition) | inchangés |
| `calendarevents` | Événements EduMarket et copies importées des calendriers externes (`source`). UTC + `timeZone`, `participants[{userId,status,invitedAt}]`, `reminderMinutes`, `revision` (verrou optimiste), `external{connectionId, provider, calendarId, eventId, etag, syncedRevision, state, conflict}` | `{ownerId,start,end}`, `{participants.userId,start}`, **unique** `{external.connectionId, external.calendarId, external.eventId}` (anti-doublon), file des envois en attente |
| `calendarpreferences` | Couleurs par calendrier, calendriers masqués, vue par défaut, fuseau préféré, durée par défaut ; jamais mélangé aux données d'événement | `_id` = utilisateur |
| `calendarconnections` | Une connexion par fournisseur et utilisateur : jetons chiffrés, portées, mode (`read_only`/`push`/`two_way`), calendriers (sélection, droits, curseur incrémental), état, dernière synchro, erreur (code sans donnée sensible), canaux de notification | **unique** `{userId, provider}` |
| `sessioncalendarlinks` | Copie d'une session de tutorat dans le calendrier d'un participant | **unique** `{sessionId,userId}` et `{connectionId,calendarId,eventId}` |

**Migration** : aucune migration obligatoire. Les champs ajoutés sont facultatifs. Une connexion Google existante (`User.googleCalendar`) est convertie à la première ouverture de l'agenda en `CalendarConnection` (jeton conservé, mode `push`, agenda principal), avec ses liens de sessions. Aucune reconnexion n'est imposée ; un bandeau propose de reconnecter pour lister tous les agendas.

## 3. Règles

- **Temps** : instants stockés en UTC et fuseau IANA conservé. Les heures saisies (`2026-11-02T14:00`) sont converties par le serveur dans le fuseau choisi, changements d'heure compris (`common/timezone.ts`). La grille s'affiche dans le fuseau de l'appareil. Le détail d'un événement montre aussi l'heure dans son propre fuseau. Le fuseau préféré sert aux nouveaux événements et à la détection.
- **Conflits** :
  - un enseignant ne peut jamais avoir deux sessions ou créneaux qui se chevauchent (règle existante, `409 SESSION_TIME_CONFLICT` avec le détail) ;
  - pour les événements, un chevauchement est expliqué (`409 EVENT_CONFLICT` avec la liste) et peut être confirmé (`allowOverlap`), car des événements personnels peuvent se superposer ;
  - pour les autres participants, seul « occupé » est indiqué, jamais le contenu de leur agenda.
- **Sessions pédagogiques** :
  - l'enseignant publie un créneau (règles existantes : enseignant vérifié, futur, 4 h au plus, payant ou non) ou propose une session gratuite à l'un de ses étudiants ;
  - seul l'étudiant accepte ou refuse une proposition, et l'enseignant ne peut pas confirmer la sienne ;
  - l'étudiant ne crée jamais de session : il demande un créneau ouvert (réservation existante, paiement inclus) ;
  - seuls un créneau libre ou une proposition en attente se déplacent dans la grille. Une session confirmée passe par la reprogrammation existante, qui reporte le paiement.
- **Participants** : invitables seulement les personnes avec qui l'on a une conversation, ou la relation enseignant ↔ étudiant d'un cours (même règle que la messagerie) ; l'administration peut inviter tout compte actif. Les invitations EduMarket ne partent qu'avec « Enregistrer et envoyer les invitations ». Les invitations e-mail de Google ou Microsoft demandent une case distincte, car elles transmettent l'adresse du participant au fournisseur.
- **Notifications** : système existant (`createNotification`, préférence « sessions », copie e-mail facultative) pour les cas suivants :
  - proposition de session ;
  - invitation, réponse, modification ou annulation d'un événement ;
  - rappels.

  Les rappels sont envoyés une seule fois par délai, réservés de façon atomique. Une synchronisation ne crée aucune notification.
- **Couleurs** : par calendrier, avec des valeurs par défaut :
  - sessions : bleu ;
  - Google : orange ;
  - Microsoft : violet ;
  - événements EduMarket : vert ;
  - en attente : ambre.

  Elles sont modifiables et enregistrées en base. L'état métier est indiqué par un style et un libellé (« En attente » en pointillés, « Annulé » barré et hachuré, créneau libre hachuré), jamais par la seule couleur. La couleur du texte est choisie pour garder le contraste.

## 4. API (`/api/v1/calendar`, utilisateur connecté sauf mention)

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `feed?from&to` | Tout ce que l'agenda affiche sur la plage visible (400 jours au plus), avec les permissions de chaque élément |
| POST / PATCH / DELETE | `events`, `events/:id` | Créer, modifier (`expectedRevision`), supprimer (annulé pour les invités) |
| POST | `events/:id/respond` | Réponse d'un invité |
| POST | `events/:id/resolve`, `events/:id/retry-sync` | Conflit de synchronisation, nouvel essai d'envoi |
| POST | `conflicts` | Chevauchements avant enregistrement |
| GET | `invitees`, `contexts` | Personnes invitables, cours associables |
| GET / PUT | `preferences` | Couleurs, calendriers masqués, vue, fuseau |
| GET | `providers`, `connections` | Fournisseurs configurés, connexions de l'utilisateur |
| POST | `connections/:provider/connect` | URL d'autorisation OAuth (`access`: `read` ou `write`) |
| PATCH / DELETE | `connections/:id` | Mode, calendrier par défaut, calendriers affichés / déconnexion |
| POST | `connections/:id/sync`, `connections/:id/refresh-calendars` | Synchronisation manuelle (30 s minimum entre deux), liste des agendas |
| GET (public) | `google/callback`, `microsoft/callback` | Retour OAuth |
| POST (public) | `webhooks/google`, `webhooks/microsoft` | Notifications des fournisseurs |
| POST (secret) | `sync/cron` | Tâche périodique déclenchée de l'extérieur (`X-Calendar-Cron-Secret`) |

Sessions : `POST /sessions/proposals`, `PATCH /sessions/:id/time`, `DELETE /sessions/:id` (créneau libre), plus les routes existantes. Les anciennes routes `GET /calendar/events`, `/events.ics`, `/google/status`, `POST /google/connect` et `DELETE /google` restent valides.

**Pas d'API d'analyse des messages** : la détection tourne dans le navigateur, sur les messages déjà reçus par leur participant. À l'enregistrement, `sourceMessageId` n'est accepté que si le message appartient à une conversation de l'utilisateur.

## 5. Synchronisation (`CalendarSyncService`)

| Aspect | Google Calendar API v3 | Microsoft Graph |
|---|---|---|
| OAuth | Code d'autorisation (application web), `access_type=offline`, `prompt=consent` | Microsoft identity platform v2, permissions déléguées |
| Portées | `calendar.calendarlist.readonly` + `calendar.events` (ou `calendar.events.readonly`) | `offline_access User.Read Calendars.ReadWrite` (ou `Calendars.Read`) |
| Lecture incrémentale | `events.list` avec `syncToken` ; 410 → liste complète, puis suppression des copies disparues | `calendarView/delta` (fenêtre −30 j / +365 j), `@odata.deltaLink` ; 410 / `syncStateNotFound` → liste complète |
| Création idempotente | Identifiant d'événement déterministe (`em` + id EduMarket) ; 409 → l'existant est repris | `transactionId` = id EduMarket |
| Modification | `PATCH` avec `If-Match: etag` → 412 = conflit | `PATCH` avec `If-Match` |
| Réunion | — | `isOnlineMeeting` + `teamsForBusiness`, seulement si le calendrier le permet ; lien enregistré uniquement quand Graph le renvoie (relecture si absent) |
| Notifications | `events.watch` (canal 7 jours, jeton secret), renouvelé à moins de 24 h de l'expiration | Abonnement `me/calendars/{id}/events` (≤ 4230 min), `clientState` secret, validation `validationToken` |
| Révocation | `oauth2.googleapis.com/revoke` | Pas d'API de révocation par application : jetons supprimés, consentement retirable depuis le compte Microsoft |

- **Boucles et doublons** :
  - un changement reçu avec le même etag que celui enregistré après notre propre écriture est ignoré (écho) ;
  - les copies de sessions ne sont jamais réimportées ;
  - l'index unique empêche deux copies du même événement externe ;
  - l'application d'un changement est idempotente, et le curseur n'est enregistré qu'après coup : une interruption rejoue sans dupliquer.
- **Conflits** : si l'événement a changé des deux côtés, il est marqué « conflit » avec la version distante, et rien n'est écrasé. Le propriétaire choisit « garder EduMarket » (réécrit chez le fournisseur sans condition) ou « prendre la version du fournisseur ».
- **Sens** :
  - `read_only` : affichage seul ;
  - `push` : les sessions confirmées vont dans le calendrier par défaut et les événements créés pour un calendrier y sont écrits. Les événements importés restent en lecture seule, et une modification externe d'un événement d'origine EduMarket n'est pas réappliquée ;
  - `two_way` : on peut aussi modifier les événements des calendriers externes accessibles en écriture, et les modifications externes des événements EduMarket sont reprises.
- **États visibles** : connecté, synchronisé (date de la dernière synchro réussie), en cours, erreur (code expliqué), autorisation expirée (bouton « Reconnecter »). Pour chaque événement : en attente, synchronisé, erreur avec « Réessayer », conflit, supprimé chez le fournisseur.
- **Sécurité** :
  - jetons chiffrés en AES-256-GCM (clé `CALENDAR_TOKEN_KEY`, sinon dérivée de `JWT_SECRET`), jamais renvoyés ni journalisés ;
  - état OAuth signé, valable 10 minutes, lié à l'utilisateur et au fournisseur ;
  - un lien de pagination ou de delta Graph est refusé s'il ne pointe pas vers `graph.microsoft.com` ;
  - les webhooks sont vérifiés par identifiant de canal et secret comparé à temps constant, et leur contenu n'est jamais pris comme donnée : il ne déclenche qu'une lecture incrémentale.

**Pas instantané** : une modification chez le fournisseur arrive par notification, si elle est configurée, puis par une lecture côté serveur, en quelques secondes à quelques minutes. Sans notification, elle arrive par la tâche périodique, à l'ouverture de l'agenda (connexions non synchronisées depuis 10 minutes) ou à la demande.

## 6. Configuration

### Google Cloud

1. Projet → *APIs & Services* → activer **Google Calendar API**.
2. *OAuth consent screen* :
   - renseigner le nom, le domaine et la politique de confidentialité ;
   - ajouter les portées listées au §5 (portées « sensibles » : en mode *Testing*, seuls les comptes de test déclarés peuvent se connecter ; en production, la vérification Google est requise).
3. *Credentials* → **OAuth client ID** de type *Web application* :
   - URI de redirection : `https://<api>/api/v1/calendar/google/callback`, plus `http://localhost:4000/api/v1/calendar/google/callback` en local ;
   - Drive, s'il est utilisé, garde sa propre URI.
4. Pour les notifications : `CALENDAR_WEBHOOK_BASE_URL=https://<api>/api/v1`, qui doit être en HTTPS public.

### Microsoft Entra ID

1. *App registrations* → la même application que OneDrive ou une nouvelle, plateforme **Web**. URI de redirection : `https://<api>/api/v1/calendar/microsoft/callback`.
2. Permissions déléguées : `offline_access`, `User.Read`, `Calendars.ReadWrite` (ou `Calendars.Read`). Aucun consentement administrateur n'est requis pour ces permissions déléguées, sauf si la politique du tenant l'impose.
3. `MICROSOFT_TENANT` :
   - `common` (comptes professionnels et personnels) ou l'identifiant du tenant ;
   - les réunions Teams exigent un compte professionnel ou scolaire avec Teams.

### Variables (backend, voir `.env.example`)

| Variable | Rôle |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Agenda |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALENDAR_REDIRECT_URI`, `MICROSOFT_TENANT` | Outlook / Teams |
| `CALENDAR_WEBHOOK_BASE_URL` | Notifications des fournisseurs (HTTPS obligatoire en production) |
| `CALENDAR_CRON_SECRET` | Déclenchement externe de la synchronisation |
| `CALENDAR_TOKEN_KEY` | Clé de chiffrement dédiée des jetons (recommandée en production) |
| `APP_ORIGIN` | URL du frontend (retour après OAuth) |
| `CORS_ORIGIN` | URL du frontend autorisée par l'API |

Sans ces variables, l'agenda EduMarket et la détection fonctionnent entièrement. L'écran « Synchronisation » indique « Non configuré » et nomme les variables manquantes, sans afficher de bouton inopérant.

### Déploiement de démonstration (Vercel + Render + MongoDB Atlas)

- **Frontend (Vercel)** : `VITE_DATA_MODE=api`, `VITE_API_BASE_URL=https://<api>.onrender.com/api/v1`.
- **Backend (Render)** :
  - `APP_ORIGIN` et `CORS_ORIGIN` = URL Vercel ;
  - URI de redirection OAuth sur le domaine Render ;
  - `CALENDAR_WEBHOOK_BASE_URL=https://<api>.onrender.com/api/v1`.
- **Atlas** : les index sont créés au démarrage par Mongoose ; aucun script n'est à lancer.
- **Limites de Render gratuit** :
  - l'instance s'endort après une période d'inactivité. La tâche `setInterval` (rappels, synchronisation toutes les 15 minutes, nouveaux essais) ne tourne pas pendant le sommeil, et le réveil prend de quelques dizaines de secondes à une minute ;
  - une notification Google ou Microsoft reçue pendant le sommeil réveille l'instance. Les fournisseurs réessaient en cas d'échec, mais une notification peut être perdue : le curseur incrémental garantit que rien n'est perdu à la synchronisation suivante ;
  - pour une exécution régulière, programmer un appel externe, par exemple toutes les 10 minutes : `POST https://<api>.onrender.com/api/v1/calendar/sync/cron` avec l'en-tête `X-Calendar-Cron-Secret: <CALENDAR_CRON_SECRET>`. GitHub Actions `schedule` ou cron-job.org conviennent ; l'appel réveille aussi l'instance. Ce n'est pas une garantie de service, seulement le meilleur effort compatible avec l'offre gratuite.
- **Cookies** : l'authentification EduMarket repose sur un cookie. Entre `*.vercel.app` et `*.onrender.com`, la configuration de cookie inter-sites existante du projet s'applique ; elle n'a pas été modifiée par ce travail.

## 7. Détection dans le chat

- **Séparation des étapes** (`scheduleDetection.ts`) :
  1. détection des expressions de date et d'heure ;
  2. interprétation (proposition future ou non : négation, passé, constat, « je termine à… ») ;
  3. résolution (à partir de l'horodatage du message, dans le fuseau du lecteur) ;
  4. suggestion.

  La création reste une action de l'utilisateur dans la popup.
- **Langues** : français, anglais, arabe, y compris le dialecte tunisien (غدوة, نتقابلو) et les noms de mois du Maghreb et du Levant. Ce sont les seules langues du projet.
- **Données extraites** :
  - date, début, et fin seulement si le message la donne (plage ou durée). Sinon, la popup utilise la durée par défaut et le signale ;
  - type (réunion, rendez-vous, session, appel) et sujet (« pour avancer sur le projet ») ;
  - fuseau, niveau de confiance, ambiguïtés (« jeudi prochain », 05/11 en anglais, heure sans indication du matin ou de l'après-midi), propositions multiples.
- **Messages ignorés** : date passée, disponibilité refusée, simple constat d'heure, échéance, demande sans rendez-vous.
- **Participants** : l'interlocuteur est proposé dans la popup, jamais ajouté sans un clic. Une session pédagogique n'est proposée que si les rôles le permettent : un enseignant propose à un étudiant, et un étudiant voit les créneaux de son enseignant.
- **« Ignorer »** est mémorisé par appareil (localStorage). C'est une commodité : aucune donnée n'est perdue.

## 7 bis. Passerelles Tutorat ↔ Agenda

Les deux pages restent distinctes : `/teacher/tutoring` gère l'activité commerciale (créneaux, demandes, prix, paiement, salle visio) et `/calendar` montre le temps. Elles lisent **le même enregistrement** `TutoringSession` : un créneau publié (`available`) devient la demande puis la séance (`pending` → `confirmed`, `rejected`, `cancelled`, `completed`). Il n'y a ni copie ni second modèle.

- **Publier depuis l'agenda** : type « Créneau de tutorat » (enseignant), avec sujet et description facultatifs, horaire et fuseau, prix, modalité, lieu. Le formulaire appelle `POST /sessions/availability`, la même route que la page Tutorat, qui accepte désormais `subject` et `notes` facultatifs. Lors d'une demande, l'étudiant remplace le sujet par le sien (règle existante).
- **Doublons** : l'index unique `{ teacherId, startAt }`, le verrou d'agenda de l'enseignant et la règle « pas de chevauchement » refusent un second créneau (409). Les boutons sont désactivés pendant l'envoi.
- **Flux `/calendar/feed`** : clé `slots` pour les créneaux ouverts de l'enseignant (seul lui les voit), `pending` pour les demandes, `sessions` pour les autres statuts. Un paiement en cours (`awaiting_payment`) est montré à l'enseignant avec ce statut et reste masqué pour l'étudiant jusqu'au paiement. Chaque état a un style et un libellé : hachuré « Libre », pointillés « En attente », barré « Annulé », double bordure « Terminé ». Le filtre « Tutorat » de la légende masque ou affiche les trois clés à la fois.
- **Tutorat → Agenda** : le lien « Voir dans l'agenda » ouvre `/calendar?date=<instant ISO>&event=session-<id>`. L'agenda se place sur la date, met l'élément en évidence et ouvre sa fiche, puis retire les paramètres de l'URL. `date=YYYY-MM-DD` est aussi accepté.
- **Agenda → Tutorat** : sur une séance dont il est l'enseignant, le lien « Gérer les demandes » (si une demande d'étudiant attend) ou « Ouvrir dans Tutorat » mène à `/teacher/tutoring?session=<id>`. La ligne y est défilée, focalisée et marquée `aria-current`. Accepter, refuser, la règle du paiement et la salle visio restent sur la page Tutorat. Les étudiants ne voient pas ce lien, et la route reste réservée aux enseignants (403).
- **Déplacements** : seuls un créneau libre et une proposition de l'enseignant encore en attente se déplacent (`PATCH /sessions/:id/time`, règle existante). Une confirmation est demandée quand un étudiant est concerné, et il est notifié. Une séance réservée ou confirmée ne se déplace pas dans la grille ; l'erreur `SESSION_NOT_MOVABLE` renvoie vers la page Tutorat (reprogrammation existante).
- **Actualisation** : chaque page recharge ses données à l'ouverture et quand l'onglet redevient visible. Il n'y a pas de cache partagé (le projet n'utilise ni React Query ni SWR), donc pas de seconde copie d'état.

## 8. État des fonctionnalités

**Terminé et testé automatiquement** :
- vues Mois, Semaine, Jour et Agenda, avec navigation et conservation de la date ;
- sélection d'un créneau, popup préremplie, création rapide en vue Mois ;
- création, modification, déplacement, redimensionnement et suppression ;
- retour arrière sur erreur serveur ;
- chevauchements expliqués ;
- couleurs et filtres persistés, RTL ;
- propositions de session et réponse de l'étudiant ;
- invitations, rappels, préférences ;
- détection dans le chat et ouverture de la popup ;
- état « non configuré ».

**Implémenté, testé avec des fournisseurs simulés, en attente d'identifiants réels** :
- connexion Google et Microsoft, sélection des agendas, lecture incrémentale, écriture, conflits ;
- réunions Teams, notifications, révocation ;
- copie des sessions dans l'agenda des participants.

Aucun appel réel à Google ni à Microsoft n'a été fait.

**Pas fait / limites** :
- **Récurrence** :
  - pas de création d'événements récurrents dans EduMarket ;
  - les occurrences externes sont importées une à une (`singleEvents`). En mode bidirectionnel, modifier une occurrence ne modifie que celle-ci.
- **Google Meet** : pas de création automatique de réunion.
- **Teams** : uniquement pour les comptes professionnels ou scolaires (`teamsForBusiness`).
- **Réponses externes** : les réponses des invités chez Google ou Microsoft ne sont pas recopiées dans EduMarket.
- **Sessions** :
  - les sessions confirmées sont copiées dans le calendrier par défaut seulement ;
  - les propositions de l'enseignant sont gratuites (une session payante passe par un créneau publié et le paiement).
- **Fuseau d'affichage** : la grille suit le fuseau de l'appareil. Afficher un autre fuseau demanderait un plugin (Luxon).
- **Détection** : elle repose sur des règles. Des tournures rares peuvent échapper à la détection ou être mal lues ; les ambiguïtés sont signalées et la date exacte est toujours montrée avant l'enregistrement.
- **Index existant `{teacherId, startAt}`** : il couvre aussi les sessions annulées. On ne peut donc pas recréer un créneau à la même minute de début qu'une session annulée. Le comportement existe déjà et n'a pas été modifié, pour ne pas toucher un index de production.
- **Accessibilité** : la grille FullCalendar reste plus difficile au lecteur d'écran que la vue Agenda. Tout se fait sans glisser-déposer (bouton « Créer », champs de date, liste Agenda), mais aucun test n'a été fait avec un lecteur d'écran réel.

## 9. Commandes

```bash
# Backend
cd edumarket-backend
npm run build && npm test                      # unitaires (dont adaptateurs Google/Microsoft avec réseau simulé)
EDUMARKET_TEST_MONGO_URI=mongodb://127.0.0.1:27017/edumarket_test npm run test:integration   # chaque suite a sa base « …_xxx_test »
npm run dev                                    # API sur :4000

# Frontend
cd edumarket-frontend
npm run test:unit                              # détection de dates (node --test)
npm run lint && npm run i18n:check && npm run build
VITE_DATA_MODE=api npm run dev                 # interface sur :3000
EDUMARKET_TEST_MONGO_URI=mongodb://127.0.0.1:27017/edumarket_e2e_test npx playwright test e2e/calendar.spec.ts
```

Les tests refusent toute base qui n'est pas locale ou dont le nom ne finit pas par `_test`. Chaque suite d'intégration utilise sa propre base (`…_calendar_test` pour celle-ci).

## 10. Validation manuelle des intégrations réelles (avec de vrais comptes)

1. **Google** :
   1. Configurer les trois variables, redémarrer, puis *Synchronisation* → « Connecter (lecture et écriture) ». Accepter le consentement : le statut passe à « Connecté » puis « Synchronisé », et l'agenda principal apparaît en orange.
   2. Créer un événement dans Google : il apparaît dans EduMarket après « Synchroniser maintenant » (ou par notification si `CALENDAR_WEBHOOK_BASE_URL` est configurée).
   3. Créer dans EduMarket un événement avec la destination Google : il est présent une seule fois dans Google, même après plusieurs synchronisations.
   4. Passer en bidirectionnel, déplacer l'événement Google dans EduMarket, et vérifier dans Google.
   5. Modifier le même événement des deux côtés avant de synchroniser : le conflit est proposé.
   6. Révoquer l'accès dans les paramètres du compte Google, puis synchroniser : le statut devient « Autorisation expirée ».
   7. Déconnecter : les copies disparaissent d'EduMarket, et les événements restent dans Google.
2. **Microsoft** :
   1. Faire le même parcours.
   2. Avec un compte professionnel, créer un événement en ligne avec « Créer une réunion Microsoft Teams » : le lien Teams apparaît uniquement après la réponse de Microsoft, et l'événement Outlook contient la réunion.
   3. Avec un compte personnel, l'option est expliquée comme indisponible.
3. **Sessions** :
   1. Avec les deux participants connectés en mode `push`, faire confirmer une session : elle apparaît dans les deux agendas externes.
   2. L'annuler : elle disparaît des deux.
4. **Render** : laisser l'instance s'endormir, modifier un événement Google, puis vérifier qu'il arrive à l'appel cron suivant ou à l'ouverture de l'agenda.
