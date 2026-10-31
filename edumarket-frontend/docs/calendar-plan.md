# Calendrier interactif : audit initial et plan (28/10/2026)

## Existant constaté

| Domaine | Existant | Constat |
|---|---|---|
| Sessions (`sessions/model.ts`, `routes.ts`) | `TutoringSession` : créneaux publiés par un enseignant vérifié (gratuits ou payants), réservation par l'étudiant (`pending`), confirmation/refus par l'enseignant, report vers un autre créneau libre, annulation avec remboursement, lien Jitsi, verrou de planning par enseignant (`TeacherScheduleLock`), index unique `teacherId + startAt` | Pas de fuseau horaire stocké ; pas de proposition à l'initiative de l'enseignant ; pas de modification d'horaire d'un créneau |
| Calendrier (`calendar/routes.ts`, `CalendarPage.tsx`) | Liste chronologique (sessions, examens, programme des cours), export `.ics`, Google Calendar en **écriture seule** : les sessions confirmées sont poussées dans l'agenda principal (`User.googleCalendar`, jeton chiffré AES-256-GCM, portée `calendar.events`) | Pas de grille, pas d'événements personnels, pas de lecture des agendas externes, pas de Microsoft |
| Microsoft | OAuth Microsoft Graph pour OneDrive (`cloudStorage.ts`, `MICROSOFT_*`) | Réutilisable (même application Entra ID, autre URI de redirection) |
| Messagerie (`messaging/`, `ApiMessagingPage.tsx`, `ChatWindow.tsx`) | Conversations étudiant ↔ enseignant (un enseignant ne contacte que les inscrits de ses cours), temps réel SSE, bouton « Proposer une session » qui ouvre la réservation d'un créneau | Aucune détection de date |
| Notifications | `createNotification` (préférences `sessions`/`messages`, copie e-mail facultative), SSE | Réutilisé tel quel |
| Tâches | `jobs/scheduler.ts` : `setInterval` 60 s dans le processus | Ne tourne pas quand une instance Render gratuite est endormie |
| Fuseaux | `common/timezone.ts` (conversion locale → UTC, DST) | Réutilisé |
| Bibliothèques frontend | Aucune bibliothèque de calendrier ni de dates | Choix ci-dessous |
| Langues | FR, EN, AR (RTL) | Détection à couvrir dans ces trois langues |

Défaut existant relevé : la liste des sessions affiche l'heure UTC (`date`/`startTime` extraits de l'ISO) au lieu de l'heure locale.

## Choix techniques

- **Grille** : FullCalendar 6.1.21 (MIT pour `core`, `daygrid`, `timegrid`, `list`, `interaction`) : vues mois/semaine/jour/liste, sélection, glisser-déposer, redimensionnement, RTL, locales FR/AR. La v7 (juin 2026, architecture nouvelle) et la 6.1.22 (moins de 2 semaines) sont écartées. react-big-calendar couvre moins bien la sélection et le RTL.
- **Affichage** dans le fuseau du navigateur ; fuseau propre à l'événement stocké (IANA) et affiché dans le détail ; saisie convertie côté serveur avec `common/timezone.ts`. Pas de plugin Luxon.
- **Détection dans le chat** : module local et déterministe (pas de bibliothèque : `chrono-node` ne gère pas l'arabe et partiellement le français ; pas d'IA externe), exécuté dans le navigateur du participant. Aucune route ne lit les messages d'autrui pour l'analyser.
- **Fournisseurs** : abstraction backend `CalendarProvider` (Google, Microsoft) + `CalendarSyncService` ; tests avec un fournisseur simulé et `fetch` simulé, jamais de compte réel.

## Plan

1. Calendrier EduMarket autonome : modèle `CalendarEvent` (événements locaux, participants, rappels), préférences, flux unifié par plage, conflits, propositions de session par l'enseignant, déplacement des créneaux libres ; page FullCalendar + popup.
2. Détection dans le chat, suggestion, ouverture de la popup préremplie.
3. Google : connexions multi-agendas (`CalendarConnection`), lecture incrémentale (`syncToken`), écriture idempotente, notifications push, conflits ; reprise de la connexion existante sans reconsentement forcé.
4. Microsoft Graph : agendas Outlook, `calendarView/delta`, réunions Teams (`isOnlineMeeting`), abonnements.
5. Validation : tests, builds, mode sans fournisseur.

Risques de régression : flux de sessions (statuts, paiements, reports) et page Calendrier existante. Tous les comportements existants restent, et les nouvelles règles s'ajoutent sans les remplacer.
