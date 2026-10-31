# Contrats API v1

Base locale : `http://localhost:4000/api/v1`. Connexion via cookie `edumarket_access` HttpOnly, SameSite=Lax, 1 h; le frontend doit envoyer les credentials. Un bearer JWT reste accepté pour les clients non navigateur. Réponses réussies utilisent `{success:true,data:...}`. Erreurs utilisent `{success:false,error:{code}}`; validation 400, auth 401, permission 403, introuvable 404, conflit 409.

| Méthode | Route | Accès | Entrée/résultat |
|---|---|---|---|
| GET | `/health` | public | état de santé API |
| POST | `/auth/register` | public, limité | `{name,email,password}`; crée un étudiant |
| POST | `/auth/login` | public, limité | `{email,password}`; cookie HttpOnly 1 h et DTO utilisateur |
| POST | `/auth/email/verification/resend` | public, limité | `{ email }`; generic accepted response; returns a preview link only outside production. |
| POST | `/auth/email/verification/confirm` | public, limité | `{ token }`; verifies the email with a hashed, expiring, one-time token. |
| POST | `/auth/password/forgot` | public, limité | `{ email }`; generic accepted response; returns a preview link only outside production. |
| POST | `/auth/password/reset` | public, limité | `{ token, newPassword }`; consumes a hashed one-time token and revokes existing sessions. |
| GET | `/auth/me` | cookie/bearer | profil de l’utilisateur courant |
| PATCH | `/auth/me` | cookie/bearer | modifie name, headline, bio ou phone du compte courant |
| POST | `/auth/logout` | public | efface le cookie de session navigateur |
| POST | `/auth/me/password` | cookie/bearer | `{ currentPassword, newPassword }`; vérifie le mot de passe actuel, remplace le hash et révoque les anciens tokens; le cookie courant est renouvelé |
| GET | `/auth/me/preferences` | cookie/bearer | Lit les préférences de notifications dans l'application du compte courant |
| PATCH | `/auth/me/preferences` | cookie/bearer | Modifie partiellement `sessions`, `messages` ou `courseActivity` (booléens) |
| GET | `/courses?page=&limit=&search=&category=&level=&price=&sort=` | public | cours publiés, filtres validés et pagination |
| GET | `/courses/:id` | public | cours publié par ObjectId ou slug |
| GET | `/courses/mine` | teacher, institution, admin | cours propres (tous les cours pour admin) |
| GET | `/courses/mine/:id` | propriétaire ou admin | cours éditable, brouillon inclus |
| POST | `/courses` | teacher vérifié, institution, admin | cours + programme validés; enseignant courant assigné; brouillon sauf admin |
| PATCH | `/courses/:id` | propriétaire vérifié ou admin | champs partiels non vides; publication admin uniquement |
| POST | `/courses/:courseId/lessons/:lessonId/assets/video` | propriétaire vérifié, institution affiliée ou admin | Multipart `file`; MP4/WebM, 250 MiB maximum; replaces the lesson video. |
| POST | `/courses/:courseId/lessons/:lessonId/assets/resources` | propriétaire vérifié, institution affiliée ou admin | Multipart `file`; PDF/ZIP, 25 MiB maximum; up to 25 resources per lesson. |
| GET | `/courses/:courseId/assets/:assetId` | enseignant propriétaire, institution affiliée, admin ou étudiant inscrit | Vidéo diffusée avec prise en charge des requêtes Range; PDF/ZIP téléchargé en pièce jointe. Les visiteurs et étudiants non inscrits sont refusés. |
| GET | `/teachers?page=&limit=&search=` | public | Répertoire paginé des enseignants actifs vérifiés avec agrégats de notes et statistiques de cours publiés |
| GET | `/teachers/:teacherId` | public | Profil vérifié et cours publiés du formateur; les champs privés ne sont pas exposés |
| POST | `/payments/checkout` | student | `{ courseIds, paymentMethod }`; validated server-side, but returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED` until a merchant provider is selected; never creates a paid enrollment |

Les prix/rôles/statuts ne viennent jamais d’une identité de navigateur sans authentification. Les cours créés par les rôles non-admin commencent en brouillon. `TEACHER_NOT_VERIFIED`, `COURSE_REVIEW_REQUIRED` et `INVALID_COURSE_FILTER` sont des codes possibles. Les contrats ci-dessous couvrent les principaux domaines livrés; les comportements non listés restent à vérifier dans les routes et matrices de statut.

`npm test` exécute les gardes et validations HTTP sans MongoDB. `npm run test:integration` exécute des workflows authentifiés contre une URI MongoDB locale et isolée (`EDUMARKET_TEST_MONGO_URI`, base suffixée `_test`), notamment apprentissage, avis et modération, préférences, avis de tutorat, vérification enseignant/audit, vérification e-mail, récupération du mot de passe et révocation de jetons.

## Enrollment endpoints

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/enrollments` | Student | Own enrollments, populated with course and teacher. |
| POST | `/enrollments` | Student | `{ courseId }`; idempotently enrolls in a published free course. A paid course returns `402 PAYMENT_REQUIRED`. |
| GET | `/enrollments/:courseId` | Enrolled student | Enrollment and completed lesson IDs. |
| PUT | `/enrollments/:courseId/lessons/:lessonId/complete` | Enrolled student | Verifies lesson membership and records completion. |

Public course catalog/detail responses expose the curriculum outline but omit lesson text, video URLs, and resource URLs. The full course content is returned only to an enrolled student. Course assets use the `course-assets` area of `PrivateStorageAdapter`, outside public web roots; the current local adapter needs a persistent private volume and backups in production.

| POST | `/enrollments/:courseId/lessons/:lessonId/quiz-attempts` | Enrolled student | `{ answers: [{ questionId, selectedOptionIndex }] }`; server grades against the stored quiz and returns score, pass state, and explanation results. Attempts are rate-limited. |

Quiz answer keys are stripped from student course DTOs. Passing a quiz-backed lesson is required before its completion can be stored.

| GET | `/courses/categories` | Public | Distinct categories used by published courses. |

## Teacher verification and administrative review

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/teacher-verifications/mine` | Student / unverified teacher / teacher | Own application or `null`. |
| POST | `/teacher-verifications` | Student / unverified teacher | `{ specialty, registrationNumber?, credentialsSummary }`; sets role to `unverified_teacher`; rate limited to 3 submissions per day. |
| POST | `/teacher-verifications/documents` | Student / unverified teacher | Multipart field `file`; PDF, PNG, or JPEG only; 5 MiB each, at most 5 per application; rate limited. Content signatures are verified. |
| GET | `/teacher-verifications/documents/:documentId` | Owner / admin | Streams one private evidence file as an attachment; other users receive 404. Files are never served as static assets. |
| GET | `/teacher-verifications/admin` | Admin | Applications with applicant identity and review status. |
| PATCH | `/teacher-verifications/admin/:userId` | Admin | `{ status: approved|rejected, reviewNote? }`; approval sets teacher role and verified status atomically on the user document. |

Evidence files use the `teacher-evidence` area of `PrivateStorageAdapter` (default `backend/private-uploads` when started from the backend package). Filenames are generated server-side; declared MIME and file signatures must match. Only the owner and admins can download them. The current adapter stores locally; production deployments must point the directory at a persistent private volume with backups and retention controls. Suspended accounts cannot submit or review applications. Current roles/statuses are resolved from MongoDB rather than trusted from the JWT payload.

| GET | `/admin/users?search=&limit=` | Admin | Sanitized account DTOs; password hashes are never selected. |
| PATCH | `/admin/users/:userId/role` | Admin | `{ role }`; cannot bypass teacher verification, modify a pending application, or remove own admin role. |
| PATCH | `/admin/users/:userId/status` | Admin | `{ status: active|suspended }`; an administrator cannot suspend their own account. |
| GET | `/admin/settings` | Admin | Returns persisted `commissionRate` and `maintenanceMode` (defaults 20 and false). |
| PATCH | `/admin/settings` | Admin | Partial `{ commissionRate?: 0..50, maintenanceMode?: boolean }`; records `platform.settings.updated` in the audit log. |
| GET | `/platform/status` | Public | Returns only the maintenance flag. When enabled, product APIs return 503 `MAINTENANCE_MODE`; authentication and role-protected admin routes stay available. |

## Tutoring sessions

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/sessions/availability?teacherId=&from=&to=` | Public | Future available slots; optional teacher and ISO datetime bounds. |
| GET | `/sessions` | Student / teacher / admin | Own bookings; teachers also receive their published slots. |
| POST | `/sessions/availability` | Verified teacher | `{ startAt, endAt, type, price, venue? }`; validates future time, duration and overlaps, serializing schedule creation per teacher so simultaneous requests cannot publish overlapping slots. Returns `409 SESSION_TIME_CONFLICT` for an overlap or `409 SESSION_SCHEDULE_BUSY` if the schedule lock cannot be acquired. |
| POST | `/sessions/:sessionId/book` | Student | `{ subject, notes? }`; atomically reserves an available slot at its server-set price. |
| PATCH | `/sessions/:sessionId/status` | Session participant / admin | `{ status }`; ownership and lifecycle transitions are enforced. A configured `JITSI_BASE_URL` creates a cryptographically random room identifier when a verified teacher confirms an online session; the response includes `meetingUrl`. |
| PUT | `/sessions/:sessionId/review` | Student who booked the completed session | `{ rating: 1..5, comment: 10..2000 characters }`; creates or updates one review for the completed session. Student session list responses include their own review if present. |

Session listings are limited to the current participant. `meetingUrl` is exposed only for a confirmed online session and only when the backend has `JITSI_BASE_URL`; the frontend verifies participation again before embedding the meeting. The configured Jitsi server creates/serves the conference when participants join; EduMarket does not claim a meeting exists before that service is reached. Google Calendar synchronization is not implemented.

## Certificates

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/certificates/mine` | Student | Certificates issued for the authenticated student. |
| GET | `/certificates/verify/:code` | Public | Returns certificate holder, course, instructor and issuance date for a valid code. |

Certificates are generated by the server when course completion meets the configured learning-and-quiz pathway. No client endpoint can create or alter a certificate.

## Notifications

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/notifications/events` | Authenticated user | Authenticated SSE stream; emits `notification.created` with the notification ID only to its owner. |
| GET | `/notifications` | Authenticated user | Up to 100 newest notifications belonging to the caller. |
| PATCH | `/notifications/:notificationId/read` | Authenticated owner | Marks one owned notification read. |
| PATCH | `/notifications/read-all` | Authenticated user | Marks all notifications owned by the caller read. |

Session booking/status changes, certificates and other in-app events generate persisted notifications; the frontend refreshes the owner-scoped inbox when it receives the SSE event. Event fanout is in-process, so multiple API instances need a shared adapter. No push/email provider is configured.

## Exams

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/exams` | Public | Published exam catalogue; authenticated students receive their enrollment/result flags. |
| POST | `/exams` | Verified teacher / admin | Creates an exam; teachers must own a published course to publish. Correct answers are accepted only on the authoring route. |
| POST | `/exams/:examId/enroll` | Student | Idempotent registration for free exams; paid exams return `402 PAYMENT_REQUIRED`; in-person capacity is reserved atomically. |
| GET | `/exams/:examId` | Registered student | Questions and options, never answer keys. |
| POST | `/exams/:examId/attempts/start` | Registered student | Starts or resumes the single timed online attempt. |
| POST | `/exams/:examId/attempts` | Registered student | `{ answers: [{ questionId, selectedOptionIndex }] }`; server enforces deadline, grades answers, and may issue an eligible certificate. |

Attempt results are immutable and limited to one attempt per student/exam. Paid exam checkout remains unavailable until a payment provider is configured; in-person exam grading is implemented and integrated.

## Messaging

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/messaging/contacts?email=` | Student / teacher | Resolves one eligible contact by email: verified teacher for a student; student enrolled in one of the teacher's published courses for a teacher. |
| GET | `/messaging/conversations` | Student / teacher | Only conversations containing the caller, with unread counts. |
| GET | `/messaging/events` | Student / teacher | Authenticated Server-Sent Events stream; emits `message.created` with message and conversation IDs only for the caller's conversations. |
| POST | `/messaging/conversations` | Student / teacher | `{ email }`; creates or returns the private one-to-one conversation. |
| GET | `/messaging/conversations/:id/messages` | Conversation participant | Up to 100 newest messages, returned chronologically with private attachment metadata when present. |
| POST | `/messaging/conversations/:id/messages` | Conversation participant | JSON `{ text }` or multipart `{ text?, file? }`; PDF/ZIP/DOCX up to 10 MiB, signature-checked. Text, attachment, or both may be sent. |
| POST | `/messaging/conversations/:id/voice-notes` | Conversation participant | Multipart `{ voice, durationSeconds }`; WebM/Ogg/MP4 audio up to 5 MiB and 60 seconds, signature-checked. |
| GET | `/messaging/attachments/:attachmentId` | Conversation participant | Downloads one private message file as an attachment; other accounts receive 404. |
| GET | `/messaging/voice-notes/:voiceNoteId` | Conversation participant | Streams one private voice note; other accounts receive 404. |
| PATCH | `/messaging/conversations/:id/read` | Conversation participant | Marks incoming messages read for the caller. |

File bytes use random keys under the `message-attachments` area of `PrivateStorageAdapter`, outside public static paths. The conversation is authorization-checked before the upload middleware receives the file. Voice notes use the same private storage and participant checks. Message events use an authenticated SSE stream and an in-process event bus; deployments with multiple API instances need a shared event adapter for cross-instance delivery.

## Forum

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/forum/posts?category=&search=&page=&limit=` | Public | Paginated published discussions; search is capped and author DTOs omit private profile data. |
| GET | `/forum/posts/:postId` | Public | Published post; increments its view count. |
| GET | `/forum/posts/:postId/replies` | Public | Chronological published replies. |
| POST | `/forum/posts` | Student / teacher / institution | Creates a discussion using caller identity. |
| POST | `/forum/posts/:postId/replies` | Student / teacher / institution | Adds a reply to a published discussion. |
| POST | `/forum/posts/:postId/upvote` | Student / teacher / institution | Idempotent one-time upvote per user/post. |
| PATCH | `/forum/posts/:postId/solution/:replyId` | Discussion author | Marks one reply on that discussion as the solution. |
| POST | `/forum/posts/:postId/report` | Authenticated user | `{ reason }`; rate limited and placed in the moderation queue. |
| GET | `/forum/reports` | Moderator / admin | Lists open reports. |
| PATCH | `/forum/reports/:reportId` | Moderator / admin | `{ decision: actioned|dismissed, note? }`; actioned reports hide their target. |

## Assignments

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/assignments` | Student | Published assignments for enrolled courses, with the student's own submission/grade. |
| GET | `/assignments/teacher` | Verified teacher | Own assignments and student submissions. |
| POST | `/assignments` | Verified teacher | `{ courseId, title, instructions, dueAt, points, status? }`; course ownership and publication are checked. |
| POST | `/assignments/:assignmentId/submissions` | Enrolled student | JSON `{ answerText }` or multipart `answerText` plus up to 3 `files`; content may be text, files, or both. PDF, ZIP, and DOCX are accepted up to 10 MiB each; resubmission replaces prior files before grading and deadline. |
| GET | `/assignments/submission-files/:fileId` | Submitting student / owning verified teacher / admin | Private attachment download; unrelated users receive 404. |
| PATCH | `/assignments/:assignmentId/submissions/:submissionId/grade` | Owning teacher | `{ score, feedback }`; score is bounded by the assignment point total. |

Submission files use the private `assignment-submissions` area of `PrivateStorageAdapter`; random storage keys and MIME/signature validation are enforced, and bytes are never exposed as static content.
# Institution affiliation

All routes below require the HttpOnly session cookie or bearer token. Institutions can list affiliated verified teachers and their invitations, then invite an existing verified teacher by email with `POST /institutions/invitations` and `{ "email": "teacher@example.com" }`. Teachers read their invitations from `GET /institutions/invitations/mine` and respond using `PATCH /institutions/invitations/:id` with `{ "decision": "accepted" | "rejected" }`. Acceptance stores the institution reference on the teacher account; the teacher cannot accept an invitation if already affiliated elsewhere. Invitation actions generate in-app notifications and audit events. `GET /courses/mine` for an institution also includes courses owned by its affiliated verified teachers. Email delivery is not configured.

## Institution applications and directory

An authenticated student submits `{name, description, country, city, website?, contactEmail}` to `POST /institution-verifications`; `GET /institution-verifications/mine` returns the account's pending, rejected, or approved profile. Only admins can list/review applications via `GET /institution-verifications/admin` and `PATCH /institution-verifications/admin/:profileId` with `{status: "approved"|"rejected", reviewNote?}`. Approval grants the institution role and publishes the profile. Public `GET /institutions` lists approved profiles; `GET /institutions/:institutionId` accepts the profile ID or slug and includes its published courses. Institution role changes through the general user editor are rejected unless the profile has been approved. Profile document uploads and public media hosting are not configured.

## Course reviews

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/courses/:courseId/reviews` | Public (optional student session) | Up to 100 published reviews, aggregate rating/count, and the current student review when available. |
| PUT | `/courses/:courseId/reviews/mine` | Enrolled student | `{ rating: 1..5, comment: 10..3000 characters }`; creates or updates the student unique review and refreshes the course aggregate. |
| GET | `/courses/moderation/reviews` | Moderator/admin | Up to 100 published or hidden course reviews with student/course display names and moderation status. |
| PATCH | `/courses/moderation/reviews/:reviewId` | Moderator/admin | `{ status: "hidden" | "published" }`; hides/restores a review and recalculates the associated published course rating. |

The isolated MongoDB workflows verify review persistence, moderator hide/restore authorization flow and public rating recalculation, as well as teacher application approval, live permissions and the persisted audit event. Concurrency paths still need broader database coverage.

## Student course favorites

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/favorites` | Student | Published courses saved by the current student, in saved order. |
| PUT | `/favorites/:courseId` | Student | Idempotently adds a published course to the current student's favorites. |
| DELETE | `/favorites/:courseId` | Student | Removes a course from the current student's favorites. |

## Learning history

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/enrollments/history` | Student | Up to 100 newest first-time lesson completions and quiz attempts, including course/lesson labels and quiz score/pass result. Older lesson completions are not backfilled. |

## Marketplace and payments (2026-10-16)

Amounts in payment DTOs are integer minor units (cents). Prices, commission rates and seller attribution are read from MongoDB at checkout; client-supplied prices are never accepted. Payment state changes only after a verified provider event (Stripe signature or sandbox HMAC) or, in development only, the sandbox confirmation route that reuses the same handler.

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/payments/config` | public | `{ enabled, provider, sandbox, currency }` |
| POST | `/payments/checkout` | student | `{ courseIds[] }` + optional `Idempotency-Key` header → `201 { orderId, checkoutUrl, totalAmount, currency, expiresAt }`; `ALREADY_ENROLLED`, `FREE_COURSE_NOT_PURCHASABLE`, `PAYMENT_PROVIDER_NOT_CONFIGURED` |
| POST | `/payments/checkout/exams/:examId` | student | Paid exam registration checkout; registration created on payment |
| POST | `/payments/checkout/sessions/:sessionId` | student | `{ subject, notes? }`; holds a paid tutoring slot 40 min (`paymentStatus=awaiting_payment`) |
| GET | `/payments/orders/mine` | student | Buyer orders (no seller split) |
| GET | `/payments/orders/:orderId` | buyer or admin | 404 for anyone else |
| GET | `/payments/orders/:orderId/invoice` | buyer or admin | Sequential `INV-YYYY-NNNNNN`, lines, buyer, totals (prices include tax) |
| POST | `/payments/sandbox/sessions/:sessionId/complete` or `/fail` | buyer, sandbox provider, non-production | Development payment simulation |
| POST | `/payments/webhooks/:provider` | provider (signature) | Raw body; 5-minute timestamp tolerance; duplicate events are no-ops; amount/currency mismatch marks the order `failed` with `AMOUNT_MISMATCH` |
| GET | `/payments/earnings` | teacher, institution | Balance (earned, pending hold, refunded, fees, requested, paid out, available) + ledger |
| GET/POST | `/payments/payouts/mine`, `/payments/payouts` | teacher, institution | Request the full available balance; one open request per seller (`PAYOUT_ALREADY_REQUESTED`), minimum `PAYOUT_MINIMUM_CENTS` |
| GET | `/admin/payments/summary` | admin | Gross revenue, fees, refunds, payout totals |
| GET | `/admin/payments/orders?status=&page=` | admin | Paginated orders with seller split |
| POST | `/admin/payments/orders/:orderId/refund` | admin | `{ reason }`; provider refund, access revoked, negative ledger entries, audited |
| GET/PATCH | `/admin/payments/payouts`, `/admin/payments/payouts/:payoutId` | admin | Manual bank-transfer settlement: `{ status: paid, reference }` or `{ status: rejected }` |

Paid tutoring: `POST /sessions/:id/book` returns `402 PAYMENT_REQUIRED` for priced slots; teachers cannot confirm while payment is pending (`SESSION_PAYMENT_PENDING`); rejecting or cancelling a paid booking refunds it automatically. A background job (every minute) releases expired reservations and fails abandoned checkouts.

## Course publication workflow and moderation

| Method | Route | Access | Contract |
|---|---|---|---|
| POST | `/courses/:id/submit-review` | owning verified teacher or institution | `draft`/`rejected` → `pending_review`; requires at least one lesson |
| GET | `/moderation/summary` | moderator, admin | Pending/suspended courses, open forum reports, hidden reviews |
| GET | `/moderation/courses?status=&search=&page=` | moderator, admin | Course queue DTOs |
| PATCH | `/moderation/courses/:id/review` | moderator, admin | `{ decision: approve or reject, note }`; reject needs a note; owner notified; audited |
| PATCH | `/moderation/courses/:id/suspension` | moderator, admin | `{ suspended, note }`; suspension needs a note; owners cannot lift it |
| GET | `/moderation/history?page=` | moderator, admin | Audited `moderation.*` events (course, review and forum report decisions) |

`PATCH /courses/:id` by owners can withdraw to `draft` but cannot publish or change the status of a suspended course.

## Administration, catalogue, support, analytics and calendar

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/admin/audit-logs?action=&severity=&targetType=&page=` | admin | Paginated audit events (action prefix filter) |
| GET/POST | `/admin/categories` | admin | Managed categories `{ slug, names: { fr, en, ar }, active, order }` |
| PATCH/DELETE | `/admin/categories/:id` | admin | Delete only when unused (`CATEGORY_IN_USE`) |
| GET | `/courses/categories` | public | Managed active categories (`names` per language) followed by legacy free-text values (`names: null`) |
| GET/POST | `/support/tickets` | any signed-in role | Own tickets; create `{ subject, category, message, relatedOrderId? }` |
| POST/PATCH | `/support/tickets/:id/messages`, `/support/tickets/:id/close` | ticket owner | 404 for non-owners; `TICKET_CLOSED` |
| GET | `/admin/support/tickets?status=&page=` | admin | Staff queue with requester identity |
| POST/PATCH | `/admin/support/tickets/:id/messages`, `/admin/support/tickets/:id` | admin | Reply (`pending_user`/`resolved`) or update status/priority; requester notified |
| GET | `/analytics/admin/overview` | admin | Users by role/status, courses by status, learning totals, queues, revenue, 14-day sign-ups |
| GET | `/analytics/institution` | institution | Totals, per-course indicators and enrolled students for own and affiliated teachers' courses |
| GET | `/calendar/events`, `/calendar/events.ics` | student, teacher, institution, admin | Personal sessions and dated exam registrations (JSON or iCalendar) |
| GET/POST/DELETE | `/calendar/google/status`, `/calendar/google/connect`, `/calendar/google` | same | Google OAuth link management; refresh token stored encrypted, never returned |
| GET | `/calendar/google/callback` | Google redirect (signed state) | Redirects to `/calendar?google=connected` or `?google=error&code=` |

New generic error codes: `INVALID_IDENTIFIER` (malformed ObjectId, 400) and `MALFORMED_JSON` (400). The full machine-readable contract is `docs/openapi.yaml`.

## Abonnements, affiliation, signalements, Q&R, parcours, équipe pédagogique et registres admin (2026-10-17)

| Method | Route | Access | Contract |
|---|---|---|---|
| GET | `/subscriptions/offer` | public | `{ enabled, monthlyPrice, yearlyPrice, currency }` (centimes) |
| GET | `/subscriptions/me` | student | Abonnement et périodes, ou `null` |
| POST | `/subscriptions/checkout` | student | `{ plan: monthly\|yearly }`, `Idempotency-Key` optionnel → session de checkout; prix fixé par le serveur |
| POST | `/subscriptions/me/cancel` | student | Arrête les rappels; l'accès reste jusqu'à la fin de la période payée |
| POST/PATCH/DELETE | `/institutions/invitations`, `/institutions/teachers/:teacherId`, `/institutions/affiliation/mine` | institution / teacher | Invitation avec `revenueSharePercent` 0–50; `PATCH { internalRole?, revenueSharePercent? }` (ventes futures); fin d'affiliation par l'une ou l'autre partie |
| GET | `/institutions/affiliation/mine` | teacher | `{ institution, revenueSharePercent, internalRole }` ou `null` |
| PUT | `/courses/:id/co-owners` | propriétaire, institution, admin | `{ emails: string[] }` (10 max., enseignants vérifiés) → liste des co-propriétaires; `COURSE_OWNER_REQUIRED`, `OWNER_CANNOT_BE_CO_OWNER` |
| PATCH | `/courses/:id` | propriétaire, co-propriétaire, coordinateur, institution, admin | `price`/`status` réservés au propriétaire principal (`COURSE_OWNER_REQUIRED`); `tags` acceptés |
| GET | `/courses?tag=` | public | Filtre catalogue par tag |
| GET | `/courses/reviews/managed` | teacher, institution | Avis publiés des cours gérés |
| PUT | `/courses/:courseId/reviews/:reviewId/reply` | gestionnaire du cours | `{ body }` (vide = suppression); visible dans `GET /courses/:id/reviews` |
| GET | `/analytics/teacher` | teacher | Même DTO que `/analytics/institution`, sur les cours propres, co-détenus et coordonnés |
| GET/POST | `/courses/:courseId/lessons/:lessonId/questions`, `.../questions/:questionId/answers` | inscrits actifs, gestionnaires | Q&R par leçon; réponses du formateur `staff: true` |
| GET | `/learning-paths`, `/learning-paths/:slug` | public (progression si étudiant connecté) | Parcours actifs et cours publiés ordonnés |
| GET/POST/PUT/DELETE | `/admin/learning-paths[/:pathId]` | admin | `PATH_COURSE_NOT_PUBLISHED`, `DUPLICATE_PATH_COURSE` |
| POST | `/reports` | tout compte connecté | `{ targetType, targetId, reason, details? }`; `REPORT_ALREADY_OPEN`, `REPORT_TARGET_NOT_FOUND` |
| GET/PATCH | `/moderation/reports[/:reportId]` | moderator, admin | File; `{ decision: actioned\|dismissed, note }`; signalement de profil escaladé aux admins |
| POST | `/sessions/:sessionId/reschedule` | participant, admin | `{ targetSessionId }` (créneau libre, même enseignant, type et prix); `RESCHEDULE_SLOT_UNAVAILABLE`, `SESSION_PAYMENT_PENDING` |
| GET/PATCH | `/admin/exams[/:examId]` | admin | Liste filtrable (`type`, `status`, `search`, `page`); `{ status: draft\|published }` (`PUBLISH_COURSE_FIRST`) |
| GET/PATCH | `/admin/certificates[/:certificateId]` | admin | Recherche code/nom/e-mail; `{ status: 'revoked', reason }` ou `{ status: 'valid' }` (`CERTIFICATE_STATUS_CONFLICT`) |
| GET | `/admin/users/:userId` | admin | Profil, affiliation, compteurs (inscriptions, certificats, cours, commandes, tickets, signalements), 15 derniers événements d'audit |
| GET | `/certificates/verify/:code` | public | `{ code, studentName, courseTitle, instructorName, issueDate, status, revokedAt }`; insensible à la casse |
| GET | `/platform/stats` | public | Compteurs de la page d'accueil |
| POST | `/support/contact` | public (limité) | Ticket invité `{ name, email, subject?, message }`, réponse par e-mail |

Les notifications renvoient `template { key, params }` en plus de `title`/`message`.

## Classes, paiements hors ligne et stockage cloud (2026-10-20)

| Method | Route | Access | Contract |
|---|---|---|---|
| GET/POST | `/classes` | teacher, institution (admin : lecture) | Classes gérées / création `{ name, level?, academicYear?, description?, joinEnabled? }` |
| GET/PATCH/DELETE | `/classes/:classId` | propriétaire, coordinateurs de l'institution, admin | Détail (étudiants avec progression par cours) ; `{ ..., archived }` ; suppression si vide (`CLASS_NOT_EMPTY`) |
| PUT | `/classes/:classId/courses` | idem | `{ courseIds }` : cours publiés gérés par le propriétaire (`CLASS_COURSE_NOT_ASSIGNABLE`) ; l'accès des membres est synchronisé |
| POST/DELETE | `/classes/:classId/students`, `/classes/:classId/students/:studentId` | idem | Ajout par e-mails (`{ added, notFound, class }`, aucun compte créé) / retrait (accès expiré, progression conservée) |
| POST | `/classes/:classId/join-code` | idem | Nouveau code |
| GET | `/classes/mine` | student | Classes et cours ouverts |
| POST | `/classes/join` | student (limité) | `{ code }` ; `CLASS_CODE_INVALID` |
| POST | `/enrollments` | student | Cours assigné à une classe de l'étudiant : accès `class` sans paiement ; cours restreint hors classe : 403 `COURSE_RESTRICTED` |
| POST | `/payments/offline-requests` | student | `{ courseIds?, plan?, method: cash\|cheque\|bank_transfer }` → `{ order, instructions }` (commande `pending`, fournisseur non requis) ; `OFFLINE_PAYMENTS_DISABLED`, `TOO_MANY_OFFLINE_REQUESTS` |
| POST | `/payments/orders/:orderId/cancel` | acheteur | Annule une demande hors ligne en attente |
| GET | `/payments/orders/:orderId/offline-proof` | acheteur, admin | Justificatif (image/PDF) |
| POST | `/admin/payments/orders/:orderId/offline-payment` | admin | multipart : `payload` JSON `{ method, reference (obligatoire sauf espèces), bankName?, payerName?, receivedAt?, note? }` + `proof` optionnel (JPG/PNG/PDF ≤ 10 Mo, signature vérifiée) → commande payée, facture, accès, grand livre ; `ORDER_NOT_PAYABLE_OFFLINE` |
| POST | `/admin/payments/offline` | admin | multipart : `payload` `{ target: { studentEmail, courseIds?, examIds?, plan? }, payment }` + `proof` → paiement au guichet créé et payé |
| POST | `/admin/payments/orders/:orderId/cancel` | admin | Annule une demande hors ligne |
| GET | `/admin/payments/orders?provider=offline\|online` | admin | Filtre par mode |
| GET | `/payments/config` | public | + `offline { enabled, instructions }` |
| GET | `/storage/providers` | teacher, institution | `[{ provider, configured }]` |
| GET | `/storage/accounts` | teacher, institution | Comptes, quota, défaut, nombre de fichiers de cours (jamais de jeton) |
| POST | `/storage/accounts/connect` | teacher (vérifié), institution | `{ provider }` → `authorizationUrl` (état signé 10 min) |
| GET | `/storage/oauth/:provider/callback` | redirection OAuth | Redirige vers `/storage?storage=connected\|error&code=` |
| PATCH/POST/DELETE | `/storage/accounts/:accountId`, `/storage/accounts/:accountId/refresh` | propriétaire | `{ isDefault: true }` ; rafraîchit le quota ; dissociation refusée si des fichiers de cours y sont (`STORAGE_ACCOUNT_IN_USE`) |
| POST | `/courses/:id/lessons/:lessonId/assets/{video,resources}?storage=local\|default\|<accountId>` | gestionnaires du cours | Stockage choisi ; par défaut le compte cloud par défaut puis le suivant ayant de l'espace (`STORAGE_ACCOUNTS_FULL`), sinon stockage local |
| POST | `/storage/exports/grades` | gestionnaires du cours | `{ courseId, destination: download\|default\|<accountId> }` → CSV (UTF-8 BOM, cellules protégées contre l'injection de formules) ou `{ fileName, webUrl, provider, accountEmail }` |
