# Matrice des permissions (état implémenté)

| Opération | Visiteur | Étudiant | Enseignant non vérifié | Enseignant | Institution | Modérateur | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lire cours publiés | oui | oui | oui | oui | oui | oui | oui |
| Inscription publique | oui (rôle étudiant uniquement) | — | — | — | — | — | — |
| Lire son profil `/auth/me` | non | oui | oui | oui | oui | oui | oui |
| Créer cours | non | non | non | oui | oui | non | oui |
| Modifier son cours | non | non | non | oui | oui | non | — |
| Modifier tout cours | non | non | non | non | non | non | oui |

Rôles de compte issus de MongoDB; l'inscription publique ne crée que des comptes étudiants. Les permissions frontend ne remplacent pas les contrôles serveur. Les routes métier documentées dans `api-contracts.md` appliquent aussi des règles de propriété et d'état de compte, pas seulement le rôle global.

Pour créer ou modifier des cours en API, un enseignant doit avoir une vérification approuvée. Les institutions ne peuvent agir que sur les cours liés à leur compte ou à leurs enseignants affiliés acceptés; les administrateurs disposent des contrôles d'administration prévus par les routes. Les rôles et statuts actuels sont relus en base sur chaque requête authentifiée.

## Enrollment and learning permissions

| Operation | Visitor | Student | Teacher | Institution | Moderator | Admin |
|---|---:|---:|---:|---:|---:|---:|
| View public course outline | Yes | Yes | Yes | Yes | Yes | Yes |
| View lesson media/content | No | Enrolled only | No | No | No | No |
| Enroll in a published free course | No | Yes | No | No | No | No |
| Record own lesson completion | No | Enrolled only | No | No | No | No |
| View own enrollments | No | Yes | No | No | No | No |

Paid enrollment is granted only by a provider-confirmed order (see the marketplace section). Without `PAYMENT_PROVIDER`, checkout fails closed with `PAYMENT_PROVIDER_NOT_CONFIGURED` and never grants enrollment or reports a successful payment. Frontend route guards complement backend checks and do not grant content access.

## Teacher verification permissions

| Operation | Student | Unverified teacher | Verified teacher | Admin |
|---|---:|---:|---:|---:|
| Submit own verification application | Yes | Yes (after rejection) | No | No |
| Read own application | Yes | Yes | Yes | No |
| Read/review application queue | No | No | No | Yes |
| Upload evidence to own non-approved application | Yes | Yes | No | No |
| Download own evidence | Yes | Yes | Yes | Yes |
| Download another applicant's evidence | No | No | No | Yes |
| Publish teacher courses | No | No | Yes | Yes |

A pending application changes the persisted account role to `unverified_teacher`; verified-teacher actions and course writes remain unavailable until an admin approves it. After rejection, the student or unverified-teacher account may submit a new application. An approved teacher cannot replace the approved application through the submission route.

## Administrative user access

| Operation | Visitor | Student | Teacher | Institution | Moderator | Admin |
|---|---:|---:|---:|---:|---:|---:|
| List platform users | No | No | No | No | No | Yes |
| Change a user role | No | No | No | No | No | Yes |
| Suspend/reactivate an account | No | No | No | No | No | Yes |

An admin cannot suspend their own account or remove their own admin role. Assigning the `teacher` role requires an already approved verification; a pending teacher application cannot be overridden from user management. Role and account-status changes are recorded in the persistent admin audit feed.

## Marketplace, moderation, support and calendar (2026-10-16)

| Operation | Visitor | Student | Unverified teacher | Teacher | Institution | Moderator | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|
| Read payment configuration | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Start a checkout (course, exam, tutoring slot) | No | Yes | No | No | No | No | No |
| Read own orders and invoices | No | Own | No | No | No | No | All |
| Complete a sandbox checkout (dev only) | No | Own order | No | No | No | No | No |
| Read seller earnings / request payout | No | No | No | Own | Own | No | No |
| Refund an order, settle payouts, financial summary | No | No | No | No | No | **No** | Yes |
| Submit own course for review | No | No | No | Own (verified) | Own | No | — |
| Approve/reject/suspend/restore courses | No | No | No | No | No | Yes | Yes |
| Read moderation history and summary | No | No | No | No | No | Yes | Yes |
| Manage categories, read audit logs | No | No | No | No | No | No | Yes |
| Open and follow own support tickets | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Answer the support queue | No | No | No | No | No | No | Yes |
| Platform analytics overview | No | No | No | No | No | No | Yes |
| Institution cohort analytics | No | No | No | No | Own scope | No | No |
| Personal calendar, .ics export, Google link | No | Yes | No | Yes | Yes | No | Yes |
| Buy/renew a catalogue subscription, read own subscription | No | Yes | No | No | No | No | No |
| Configure subscription prices | No | No | No | No | No | No | Yes |
| Set affiliation revenue share (0–50 %) when inviting, end an affiliation | No | No | No | End own | Own teachers | No | No |
| Report a course, review, message or profile | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Handle content reports | No | No | No | No | No | Yes (profiles escalated) | Yes |
| Ask a lesson question / answer it | No | Enrolled | No | Own course | Own course | No | No |
| Read public learning paths / manage them | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No | Yes / Yes |
| Send the public contact form | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Verify a certificate code, read public platform stats | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Set an affiliated teacher's internal role (teacher/coordinator/examiner) | No | No | No | No | Own teachers | No | No |
| Edit content of institution courses as coordinator | No | No | No | Coordinator of that institution | Own scope | No | Yes |
| Grade institution exams as examiner/coordinator | No | No | No | Examiner/coordinator of that institution | Own scope | No | Yes |
| Manage course co-owners | No | No | No | Primary owner | Owning institution | No | Yes |
| Edit course content as co-owner (not price/status) | No | No | No | Listed co-owner | — | No | — |
| Reply to reviews of managed courses | No | No | No | Yes | Yes | No | Yes |
| Follow learners of managed courses | No | No | No | Yes (`/analytics/teacher`) | Yes | No | No |
| Reschedule a booked session | No | Own booking | No | Own session | No | No | Yes |
| Manage exams / revoke certificates / open user detail | No | No | No | No | No | **No** | Yes |
| Create and manage classes (students, courses, join code) | No | No | No | Own classes | Own classes (+ coordinators) | No | Yes |
| Join a class with a code, open its courses | No | Yes | No | No | No | No | No |
| See a restricted course | No | Class members only | No | Managers of the course | Managers of the course | No | Yes |
| Request an offline payment (cash, cheque, transfer) | No | Yes | No | No | No | No | No |
| Record offline payments, upload / read proofs, desk registration | No | Own proof (read) | No | No | No | **No** | Yes |
| Pair Google Drive / OneDrive accounts, switch default, export grades | No | No | No | Yes (verified) | Yes | No | No |

Moderators share the back-office sidebar but never inherit financial, user-management, category, audit or support-queue permissions. Every row is enforced by backend middleware (`allowRoles`) plus ownership filters, and covered by HTTP 401 tests and the MongoDB marketplace workflow suite (403 checks for moderator access to refunds, categories, analytics and the support queue).

## Course content (2026-10-26)

| Operation | Visitor | Student | Unverified teacher | Teacher | Institution | Moderator | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|
| Create, move, duplicate, delete, publish course content; batch visibility; student preview | No | No (403) | No | Owner, co-owner, coordinator (verified) | Own / affiliated courses | No | Yes |
| Copy content from another course, duplicate a course, export the teaching package | No | No | No | Courses they manage | Courses they manage | No | Yes |
| Change the course status (open / private / completed); archive **with** student data | No | No | No | Primary owner only | Owning institution | No | Yes |
| Read published, available, unlocked content and its files | Outline titles only | Active enrollment, course not private | — | Managers | Managers | No | Yes |

Hidden, scheduled, out-of-window and locked items answer 404 to students on every route (course view, enrollment list, completion, quiz attempts, files, lesson Q&A); a visible child of a hidden module stays unreachable. Covered by `tests/mongo-course-content.test.mjs` and `e2e/course-content.spec.ts`.

## LMS features (mission 2, 2026-10-27)

"Managers" = owner, co-owner, coordinator, owning institution, admin (`canManageCourse`). "Student" = active enrollment in a non-private course; a completed course is read-only (`lms/access.ts`). Every rule is enforced by the API.

| Operation | Student | Managers | Other users |
|---|---|---|---|
| Edit drafts, publish, schedule, restore versions, preview drafts | No (drafts never sent) | Yes | No (403/404) |
| Gradebook: structure, entries, publication, exceptions, exports | Own **published** grades and average only | Yes | No |
| Banks, tests, rubrics, forms: authoring and grading | Take open tests and forms; answer key only after publication when allowed | Yes | No |
| Assignments: submit / grade | Submit own work | Grade, comment, publish | No |
| Anonymous form responses | Own response only, never identified | Aggregated, without identity | No |
| Discussions: post / moderate | Post in course threads and own groups' threads (other groups: 404) | Moderate, pin, close, grade | No |
| Journals | Own entries only (`studentId` ignored) | All entries, comments, grades | No |
| Announcements | Read those targeted at them | Create, schedule, target | No |
| Attendance | Own records | Record, export | No |
| Groups | Self-enrol where allowed; see members of own groups only | Manage | No |
| Course analytics, template comparison | No | Yes | No |
| Templates: create classes, sync from template | No | Managers of the template **and** of the class | No |
| Files: quarantine, delete; link check; archive v2 | No | Yes | No |
| AI conversation: chat / read transcripts | Chat after consent | Configure, read transcripts (audited) | No |
| LTI tools registry | No | Use registered tools in their course | Admin only registers tools |
| SCORM: import / launch | Launch (with `SCORM_CONTENT_ORIGIN`) | Import, configure, launch | No |

Covered by the 403/404 cases of `tests/mongo-{publication,gradebook,assessments,participation,templates,integrations,files}.test.mjs`.

## Calendar (2026-10-28)

| Operation | Student | Teacher | Institution / Admin | Others |
|---|---|---|---|---|
| Own calendar feed, preferences, connections | Own only | Own only | Own only (admin: own) | No |
| Create / edit / delete EduMarket events | Own events | Own events | Own events | No |
| Invite participants | Conversation partners, teachers of enrolled courses | Conversation partners, students of their courses | Admin: any active account; institution: conversation partners | No (404) |
| See an event | Owner, invited participants | Owner, invited participants | Same | No |
| Answer an invitation | Invited participant | Invited participant | Invited participant | No |
| Publish / move / delete an open tutoring slot | No (403) | Verified teacher, own slots | Admin: delete | No |
| Propose a tutoring session | No | Verified teacher, to own students | No | No |
| Accept / decline a teacher proposal | The student concerned | No (cannot confirm own proposal) | Admin (existing rule) | No |
| Edit an imported external event | Owner, two-way mode, writable calendar | Same | Same | No |
| Provider webhooks / cron | Public endpoints verified by channel secret / shared secret | — | — | — |

Covered by `tests/mongo-calendar.test.mjs` and `e2e/calendar.spec.ts`.
