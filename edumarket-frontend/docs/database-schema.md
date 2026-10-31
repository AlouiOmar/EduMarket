# Schéma MongoDB

## Collections présentes

### `users`

`name`, `email` (unique, lowercase), `passwordHash` (sélectionné uniquement explicitement), `emailVerified`, email/reset token hashes with expiry timestamps (also excluded by default selection), `authVersion` (invalidates previously issued JWTs on password change/reset), `notificationPreferences`, `role`, teacher `verified` state and timestamps. Public registration creates only an unverified student; verification is required before login. Existing records without `emailVerified` use the schema default for compatibility.

### `courses`

`title`, `slug` (unique), `subtitle`, `description`, `category`, `level`, `price`, `teacherId` (référence User), `status`, `tags`, `chapters`/`lessons`, critères de certification, prérequis et objectifs. Les sous-documents leçon incluent quelques propriétés flexibles; leur validation métier plus complète reste à écrire. Index textuel sur titre/sous-titre/description, index sur statut et propriétaire.

### `courseassets`

Stores private course video/resource metadata: course and lesson references, kind, sanitized original name, random storage key, MIME type, byte size and uploader. A partial unique index allows one video per course lesson; resources are limited by the upload workflow. The `PrivateStorageAdapter` stores bytes under `PRIVATE_UPLOAD_DIR/course-assets`, never in a public static directory. Only enrolled students on published courses and authorized course staff can retrieve them. The configured implementation is local filesystem storage; production needs a persistent private volume and backups.

## Cohérence et travail restant

La propriété des ressources et les transitions métier sont contrôlées côté serveur. Les collections `enrollments`, `quizattempts`, `exams`, `examregistrations`, `examattempts`, `certificates`, `tutoringsessions`, `sessionreviews`, `conversations`, `messages`, `notifications`, `forumposts`, `forumreplies`, `forumvotes`, `forumreports`, `assignments`, `assignmentsubmissions`, `coursereviews` et `auditEvents` sont définies plus bas ou dans leurs modules. Les commandes, paiements, remboursements, grand livre vendeur et reversements sont décrits dans la section Marketplace ci-dessous; les métadonnées média privées, elles, sont modélisées, et leurs octets passent par `PrivateStorageAdapter`. Certaines opérations multi-documents restent hors transaction MongoDB.

## `platformsettings`

A singleton document with `_id: global`, `commissionRate` (0–50%, default 20), `maintenanceMode` (default false), `updatedBy`, and timestamps. Admin updates are written to `auditEvents`; a short process-local cache shares maintenance state across API requests.

## `enrollments`

Each record references `users` through `studentId` and `courses` through `courseId`. A unique compound index on both references prevents duplicate enrollments. `completedLessonIds` stores server-validated lesson IDs; `enrolledAt`, `lastAccessedAt`, and `completedAt` track activity and completion. This currently supports published free courses only. Course media, lesson text, and downloadable resource URLs are omitted from public course DTOs and returned only to an enrolled student.

### `quizattempts`

Stores `studentId`, `courseId`, `lessonId`, `quizId`, selected question/option pairs, score, pass state, and question counts with timestamps. Correct answers are not copied into attempt documents. Indexes support a student's attempt history by course and lesson. Quiz attempt creation is limited to 30 per hour per client IP, in addition to the global API limit.

## Teacher verification workflow

The user document stores an embedded teacher application (specialty, optional registration number, qualifications summary, status, submit/review dates, reviewer, note, and evidence metadata). Evidence bytes use the `teacher-evidence` area of `PrivateStorageAdapter` (currently the root of `PRIVATE_UPLOAD_DIR` for compatibility), with random storage keys and validated PDF/PNG/JPEG signatures; metadata retains only the sanitized display name, storage key, MIME type, byte count, and upload time. Access is limited to the owner and admins through an authenticated download route. There is no separate verification collection.

JWT identity carries a subject and expiry; middleware loads role and account status from MongoDB on each authenticated API request. Admin approval and suspension therefore take effect immediately for backend authorization.

Administrative account routes return only name, email, role, verified flag, status, and creation date. They never select `passwordHash`. User role and suspension changes update the same `users` record used by request-time RBAC.

## Tutoring sessions

`tutoringsessions` stores a published availability slot and then its booking lifecycle in one document. Fields include teacher/student references, absolute `startAt`/`endAt`, mode, server-held price, subject/notes, venue, status, generated room identifier, and timestamps. A compound unique index prevents duplicate starts for a teacher; query indexes support teacher, student, status, and time lookups. Booking atomically changes `available` to `pending`, so two students cannot reserve the same slot. Teacher review, participant cancellation, and completion enforce ownership and state transitions. Availability creation takes a MongoDB-backed per-teacher lease lock around the overlap check and insert; the lease expires after 60 seconds if a process exits unexpectedly. An isolated concurrent-request test verifies only one of two overlapping slots is created. When `JITSI_BASE_URL` is configured, teacher confirmation of an online session assigns an unpredictable room ID; the API derives a join URL for that confirmed session and exposes it only to its participants. No room ID is generated when the provider is unconfigured. Payment fields (`paymentStatus`: not_required/awaiting_payment/paid/refunded, `orderId`, `reservationExpiresAt`) hold a paid slot during checkout; `googleEventIds` maps participant IDs to Google Calendar event IDs when sync is configured.

`sessionreviews` stores one student review per completed tutoring session, with a unique session reference, rating, comment and timestamps. Only the student who booked the completed session can create or update it.

## Certificates

`certificates` records a random public verification code, `studentId`, `courseId`, and issuance timestamp. Compound uniqueness permits one certificate per student/course; the verification code is unique. The API issues after eligible learning/quiz completion or a passing online/in-person exam outcome when the course enables the corresponding certification pathway.

## Notifications

`notifications` stores a recipient reference, typed title/message, optional internal link, `readAt`, and timestamps. A compound recipient/time index supports newest-first inbox reads. Reads and read-all updates are scoped to the authenticated recipient. Server events create in-app records for tutoring, certificate, and message activity; delivery is not realtime, email, or push.

## Exams

`exams` references a course and creator, stores schedule/type/fee/duration/pass percentage and authored questions with answer keys. Public and registered-student DTOs strip answer keys. `examregistrations` uniquely pairs exam and student; exam counters reserve physical capacity atomically. `examattempts` uniquely pairs exam/student and stores start/submission timestamps, selected options, server score and pass state. Attempt answers do not contain copied correct answers. Paid registration is created only after a confirmed payment order (capacity re-checked at fulfillment, automatic refund if full); course owners/admins can record in-person outcomes for registered students.

## Messaging

`conversations` stores exactly two participants, a canonical unique participant key and a last-message summary. `messages` references a conversation and sender, stores bounded text, optional private document or voice metadata and a `readBy` array, with chronological lookup indexes. Every read/send/download verifies participant membership. Only student/verified-teacher pairs are allowed; teacher initiated chats additionally require a published-course enrollment relationship. Attachment bytes use the `message-attachments` area of `PrivateStorageAdapter` with random storage keys; documents accept PDF/ZIP/DOCX signatures (10 MiB maximum), while voice notes accept WebM/Ogg/MP4 signatures (5 MiB and 60 seconds maximum). Authenticated SSE sends `message.created` event IDs only to conversation participants; the current event bus is in-process.

## Forum

`forumposts` and `forumreplies` store published/hidden text records with author references and counters. A post stores a reference to its accepted solution. `forumvotes` uniquely pairs user, target type, and target ID, preventing repeated upvotes. `forumreports` records target, reporter, reason, review status, reviewer and decision note. Moderator/admin action hides the reported post or reply. Report review and target hiding are separate writes and do not yet use a Mongo transaction.

## Assignments

`assignments` reference an owned course and teacher with instructions, due date, points, and publication state. `assignmentsubmissions` uniquely pair a student and assignment, recording an optional text answer, up to three private PDF/ZIP/DOCX file records, submission timestamp, grade, feedback and grader. Submissions require course enrollment, can be updated only before grading and deadline, and grades are bounded by assignment points. File bytes use the `assignment-submissions` area of `PrivateStorageAdapter` and are available only to the student, owning verified teacher, or admin through an authenticated download endpoint.

## Course reviews

`coursereviews` stores `courseId`, `studentId`, integer rating, comment, moderation status and timestamps. A unique compound index enforces one review per student/course; aggregate rating and review count are also cached on the course document. The public API computes aggregates from published reviews. Isolated MongoDB workflows cover persistence, moderation hide/restore and aggregate changes; concurrent upsert behavior still needs coverage.

Student favorites are stored as an ordered `favoriteCourseIds` array on the user document. Course additions use `$addToSet` and removal uses `$pull`, so favorites remain scoped to the owning account without a separate collection.

`lessonactivities` records the first completion time for each student/course/lesson, with a unique compound index. The history endpoint combines those rows with timestamped `quizattempts`. Existing enrollment completion IDs do not contain timestamps and are not retroactively inserted into history.

## Marketplace (2026-10-16)

All amounts are integer minor units. MongoDB transactions are not used (the default deployment is a standalone `mongod`); consistency relies on conditional single-document transitions and unique indexes, and every fulfillment step is idempotent.

- `orders`: `studentId`, `items[]` snapshot (`itemType` course/exam/session, `itemId`, `title`, `sellerId`, `unitAmount`, `commissionRate`, `platformFee`, `sellerAmount`), `currency`, `totalAmount`, `status` (pending → paid → refunded, or pending → failed), `provider`, `providerSessionId` (unique, partial), `providerPaymentId`, `checkoutUrl`, `idempotencyKey` (unique per student, partial), `expiresAt`, `paidAt`, `invoiceNumber` (unique, partial, sequential per year), `failureReason`, `refund { refundId, reason, refundedAt, refundedBy }`. Indexes: `{ items.sellerId, status }`, `{ status, expiresAt }`.
- `paymentevents`: processed provider events, unique `{ provider, eventId }`, so webhook redelivery is a no-op.
- `ledgerentries`: seller credits (`sale`) and debits (`refund`) with gross amount, platform fee, net amount and `availableAt` (paid date + `PAYOUT_HOLD_DAYS`). Unique `{ orderId, itemId, type }` prevents double crediting.
- `payoutrequests`: seller manual payout requests (`requested`, `paid` with bank reference, `rejected`). A partial unique index on `{ sellerId }` where `status = requested` guarantees one open request per seller, which prevents concurrent over-withdrawal.
- `counters`: `{ _id: invoice-YYYY, seq }` for gap-free invoice numbers, allocated only when an order transitions to paid.

Refunds delete the purchased enrollment (and decrement `studentsCount`), remove an unattempted exam registration, and cancel a pending/confirmed paid tutoring session. Seller balances can become negative after refunding already paid-out sales; the finance team settles this manually.

## Course moderation fields

`courses.status` is one of `draft`, `pending_review`, `published`, `rejected`, `suspended`; `courses.review { submittedAt, reviewedAt, reviewedBy, note }` stores the last decision. Public catalogue queries only return `published`.

## `categories`

`slug` (unique, kebab-case), `names { fr, en, ar }`, `active`, `order`. Courses reference the slug in `category`; when at least one managed category exists, new or changed course categories must match an active slug. Existing free-text values remain valid and are listed after managed categories.

## `supporttickets`

`requesterId`, `subject`, `category`, `priority`, `status` (open, pending_user, resolved, closed), `assigneeId`, `relatedOrderId`, bounded `messages[]` (at most 200: author, role requester/staff, body, date), `lastActivityAt`. Index `{ status, lastActivityAt }`.

## Google Calendar link

`users.googleCalendar { refreshToken, connectedAt }` is `select: false`; the refresh token is AES-256-GCM encrypted with a key derived from `JWT_SECRET` (rotating `JWT_SECRET` invalidates stored links and users reconnect).

## Ajouts du 2026-10-17

- `users` : `institutionId`, `institutionRevenueShare` (0–50, snapshot copié dans chaque commande), `institutionRole` (`teacher` | `coordinator` | `examiner`, remis à `teacher` à la fin de l'affiliation), `notificationPreferences.email` (opt-in, défaut `false`).
- `courses` : `coOwnerIds[]` (enseignants vérifiés co-auteurs, indexé; les ventes restent créditées à `teacherId`), `tags[]` (minuscules, dédoublonnés, 15 max., filtre `?tag=`).
- `coursereviews` : `reply { body, authorId, repliedAt }` (réponse publique du propriétaire/gestionnaire).
- `certificates` : `revokedAt`, `revokedReason`, `revokedBy` (révocation admin, l'enregistrement est conservé; le registre public renvoie `status: revoked`).
- `notifications` : `template { key, params }` traduit côté client (`notificationTemplates.<key>`); `title`/`message` restent le repli anglais et le contenu de l'e-mail.
- `enrollments` : `accessType` (`free` | `purchase` | `subscription`) et `accessExpiresAt` (accès abonnement borné; toutes les vérifications d'accès utilisent `activeAccess()`).
- `subscriptions` : un document par étudiant (`studentId` unique), `plan`, `currentPeriodEnd`, `cancelledAt`, `reminderSentForPeriodEnd` (rappel J-3 envoyé une seule fois par échéance).
- `subscriptionperiods` : une période prépayée par commande (`orderId` unique), montant, commission figée, `status` (`active` | `refunded`), `settledAt`, `distributedAmount`; index `{ status, settledAt, endsAt }` pour le job de règlement au prorata des leçons terminées.
- `ledgerentries.type` : en plus de `sale`/`refund`, `affiliation_share`/`affiliation_share_refund` et `subscription_share`/`subscription_share_refund`.
- `contentreports` : `reporterId`, `targetType` (`course` | `course_review` | `message` | `user`), `targetId`, `reason`, `details`, `snapshot { title, excerpt, ownerId }`, `status` (`open` | `escalated` | `actioned` | `dismissed`), décision; index unique partiel `{ reporterId, targetType, targetId }` sur `status: open`.
- `lessonquestions` : `courseId`, `lessonId`, `authorId`, `body`, `answers[] { authorId, body, staff }`; index `{ courseId, lessonId, createdAt }`.
- `learningpaths` : `slug` unique, `title`/`description` localisés FR/EN/AR, `skills[]` (20 max.), `courseIds[]` ordonnés (30 max., cours publiés uniquement), `active`, `order`.
- `supporttickets` : `requesterId` optionnel et `guest { name, email }` pour le formulaire de contact public.
- `tutoringsessions` : la reprogrammation déplace la réservation vers un autre créneau libre du même enseignant (même type et même prix), libère l'ancien et met à jour l'`itemId` de la commande associée.

## Classes, paiements hors ligne et stockage cloud (2026-10-20)

- `classgroups` : `ownerId` (enseignant ou institution), `ownerRole`, `name`, `level`, `academicYear`, `description`, `studentIds[]` (500 max.), `courseIds[]` (100 max.), `joinCode` (unique, 8 caractères), `joinEnabled`, `archivedAt`. Index `{ studentIds, archivedAt }` et `{ courseIds, archivedAt }`.
- `courses.visibility` : `public` (défaut) ou `restricted` (absent du catalogue, des profils, des parcours, des statistiques et du checkout ; visible uniquement par les membres des classes auxquelles il est assigné, ses gestionnaires et les admins).
- `enrollments.accessType` : nouvelle valeur `class`. La synchronisation (`syncClassAccess`) crée l'inscription quand un étudiant et un cours se retrouvent dans une classe active, et la fait expirer (`accessExpiresAt`) quand ce n'est plus le cas ; la progression est conservée. Les achats et inscriptions gratuites ne sont jamais modifiés.
- `orders` : `provider` accepte `offline` ; `paymentMethod` (`online` | `cash` | `cheque` | `bank_transfer`) ; `offlinePayment { reference, bankName, payerName, receivedAt, note, recordedBy, recordedAt, proof { storageKey, originalName, mimeType, size, uploadedAt } }`. Une demande hors ligne reste `pending` pendant `OFFLINE_PAYMENT_DAYS` ; le justificatif est stocké dans la zone privée `payment-proofs`.
- `platformsettings.offlinePayments { enabled, instructions }`.
- `storageaccounts` : `ownerId`, `provider` (`google_drive` | `onedrive`), `accountEmail`, `displayName`, `refreshToken` (chiffré AES-256-GCM, `select: false`), `folderId` (dossier « EduMarket »), `quota { total, used, checkedAt }`, `isDefault`, `status` (`connected` | `reconnect_required`). Index unique `{ ownerId, provider, accountEmail }`.
- `courseassets.storage { provider: local|google_drive|onedrive, accountId, fileId }` ; `storageKey` n'est requis que pour le stockage local.
