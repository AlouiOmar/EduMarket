# Matrice de Réalisation des Interfaces — LMS Marketplace

> Note d’audit (2026-10-14) : les statuts `IMPLEMENTED` de ce registre historique décrivent des écrans de démonstration et ne prouvent pas l’intégration backend ni la persistance métier. L’état backend courant est dans `backend-implementation-matrix.md`; les intégrations effectives sont suivies dans `integration-status.md`. Les affirmations globales de conformité ci-dessous n’ont pas toutes été vérifiées par des tests.

## 1. Vue d'ensemble
- **Application** : EduMarket LMS Platform
- **Architecture** : React 19 + TypeScript + Vite + Tailwind CSS + Atomic Design (Atoms, Molecules, Organisms, Templates, Pages)
- **Modèle de Navigation par Espace (Règle Impérative)** :
  - **Frontoffice (Visiteur, Étudiant, Enseignant, Institution)** : Navigation horizontale supérieure obligatoire (`FrontofficeNavbar`) intégrée dans `FrontofficeShell`. Structure, position (hauteur h-16, sticky top-0), style et design system 100% identiques. Liens conditionnés par rôle sans aucune sidebar principale. Les pages dashboards intègrent des onglets horizontaux secondaires locaux (`subnav`) sans altérer la navbar commune.
  - **Backoffice (Administrateur, Modérateur)** : Sidebar de navigation principale obligatoire (`BackofficeSidebar`) avec header supérieur cohérent (`BackofficeHeader`) intégrée dans `BackofficeShell`. Largeur (w-64), positionnement fixe/persistent sur desktop, tiroir responsive sur mobile, et palette sombre unifiée.
  - **Correspondance technique stricte des layouts** :
    - `PublicLayout` : Shell Frontoffice avec `FrontofficeNavbar`.
    - `StudentLayout` : Réutilise `FrontofficeShell` avec `FrontofficeNavbar` + onglets horizontaux secondaires.
    - `TeacherLayout` : Réutilise `FrontofficeShell` avec `FrontofficeNavbar` + onglets horizontaux secondaires.
    - `InstitutionLayout` : Réutilise `FrontofficeShell` avec `FrontofficeNavbar` + onglets horizontaux secondaires.
    - `AdminLayout` : Shell Backoffice avec `BackofficeSidebar` + `BackofficeHeader`.
    - `ModeratorLayout` : Réutilise le shell Backoffice avec `BackofficeSidebar` + `BackofficeHeader`.
- **Internationalisation** : 100% multilingue `fr`, `en`, `ar` avec inversion dynamique LTR / RTL (`dir="rtl"`, `lang="ar"`).
- **Découplage backend** : Couche de services asynchrone (`src/services/*`) avec données de démonstration typées et déterministes.

---

## 2. Registre de Suivi Exhaustif des 300 Interfaces (Section 7)

### A. Site public et découverte (Interfaces 1 à 26)

| N° | Interface | Route / Emplacement | Rôle | Template | Composants Atomic Design | i18n FR/EN/AR | Statut |
|---|---|---|---|---|---|---|---|
| 1 | Page d'accueil | `/` | Tous | `PublicLayout` | Button, Rating, CourseCard, PublicHeader, PublicFooter | Complet | `IMPLEMENTED` |
| 2 | Découverte de tous les cours | `/courses` | Tous | `PublicLayout` | SearchField, Select, CourseGrid, CourseCard, Pagination | Complet | `IMPLEMENTED` |
| 3 | Résultats de recherche de cours | `/courses?search=...` | Tous | `PublicLayout` | SearchField, FilterField, CourseCard, EmptyState | Complet | `IMPLEMENTED` |
| 4 | Catalogue avec filtres & tri | `/courses` | Tous | `PublicLayout` | Select, Button, CourseCard, Pagination | Complet | `IMPLEMENTED` |
| 5 | Détail d'un cours | `/courses/:id` | Tous | `PublicLayout` | Breadcrumbs, PriceDisplay, Rating, Avatar, CourseCurriculum | Complet | `IMPLEMENTED` |
| 6 | Détail d'un enseignant | `/teachers/:id` | Tous | `PublicLayout` | Avatar, Rating, CourseCard, SessionBookingForm | Complet | `IMPLEMENTED` |
| 7 | Détail d'une institution | `/institutions/:id` | Tous | `PublicLayout` | Badge, Rating, CourseCard, PublicHeader | Complet | `IMPLEMENTED` |
| 8 | Catalogue des institutions | `/institutions` | Tous | `PublicLayout` | StatCard, Rating, Button, Badge | Complet | `IMPLEMENTED` |
| 9 | Catalogue des enseignants | `/teachers` | Tous | `PublicLayout` | Avatar, Rating, Button, Card | Complet | `IMPLEMENTED` |
| 10 | Catégories de formation | `/courses?category=...` | Tous | `PublicLayout` | CategoryCard, Badge, CourseGrid | Complet | `IMPLEMENTED` |
| 11 | Parcours d'apprentissage | `/learning-paths` | Tous | `PublicLayout` | PathCard, Badge, Button | Complet | `IMPLEMENTED` |
| 12 | Événements et examens publics | `/events` | Tous | `PublicLayout` | Badge, Button, ExamCard | Complet | `IMPLEMENTED` |
| 13 | Détail d'un événement | `/events` (modal/détail) | Tous | `PublicLayout` | Badge, Button, MapPin | Complet | `IMPLEMENTED` |
| 14 | Présentation des certifications | `/certifications` | Tous | `PublicLayout` | Input, Button, CertificateLookupCard | Complet | `IMPLEMENTED` |
| 15 | Tarifs et abonnements | `/pricing` | Tous | `PublicLayout` | Switch, Button, PricingCard | Complet | `IMPLEMENTED` |
| 16 | Espace pour les enseignants | `/for-teachers` | Tous | `PublicLayout` | RevenueCalculator, Button | Complet | `IMPLEMENTED` |
| 17 | Espace pour les institutions | `/for-institutions` | Tous | `PublicLayout` | FeatureGrid, Button | Complet | `IMPLEMENTED` |
| 18 | Page À propos | `/about` | Tous | `PublicLayout` | Typography, Divider | Complet | `IMPLEMENTED` |
| 19 | Page Contact | `/contact` | Tous | `PublicLayout` | Input, Textarea, FormField, Button | Complet | `IMPLEMENTED` |
| 20 | FAQ | `/faq` | Tous | `PublicLayout` | Accordion, ChevronDown | Complet | `IMPLEMENTED` |
| 21 | Centre d'aide public | `/help` | Tous | `PublicLayout` | HelpCard, Button | Complet | `IMPLEMENTED` |
| 22 | Conditions générales | `/terms` | Tous | `PublicLayout` | Typography, Divider | Complet | `IMPLEMENTED` |
| 23 | Politique de confidentialité | `/privacy` | Tous | `PublicLayout` | Typography, Divider | Complet | `IMPLEMENTED` |
| 24 | Politique de cookies | `/cookies` | Tous | `PublicLayout` | Typography, Divider | Complet | `IMPLEMENTED` |
| 25 | Page d'accessibilité | `/accessibility` | Tous | `PublicLayout` | Typography, Divider | Complet | `IMPLEMENTED` |
| 26 | Recherche globale | `/search` | Tous | `PublicLayout` | SearchField, CourseGrid | Complet | `IMPLEMENTED` |

---

### B. Authentification et gestion de compte (Interfaces 27 à 47)

| N° | Interface | Route / Emplacement | Rôle | Template | Composants Atomic Design | i18n FR/EN/AR | Statut |
|---|---|---|---|---|---|---|---|
| 27 | Inscription étudiant | `/auth/register` (onglet) | Visiteur | `AuthenticationLayout` | Input, PasswordInput, Button, FormField | Complet | `IMPLEMENTED` |
| 28 | Inscription enseignant | `/auth/register` (onglet) | Visiteur | `AuthenticationLayout` | Input, PasswordInput, Button, FormField | Complet | `IMPLEMENTED` |
| 29 | Demande institution | `/auth/institution-request` | Visiteur | `AuthenticationLayout` | Input, PasswordInput, Button, FormField | Complet | `IMPLEMENTED` |
| 30 | Connexion | `/auth/login` | Tous | `AuthenticationLayout` | Input, PasswordInput, Button, Select, FormField | Complet | `IMPLEMENTED` |
| 31 | Vérification e-mail | `/auth/verify-email` | Tous | `AuthenticationLayout` | Button, MailIcon | Complet | `IMPLEMENTED` |
| 32 | Renvoyer courriel vérification | `/auth/verify-email` | Tous | `AuthenticationLayout` | Button, RotateCw | Complet | `IMPLEMENTED` |
| 33 | Mot de passe oublié | `/auth/forgot-password` | Tous | `AuthenticationLayout` | Input, FormField, Button | Complet | `IMPLEMENTED` |
| 34 | Réinitialisation mot de passe | `/auth/reset-password` | Tous | `AuthenticationLayout` | PasswordInput, FormField, Button | Complet | `IMPLEMENTED` |
| 35 | Saisie code OTP | `/auth/otp` | Tous | `AuthenticationLayout` | Input, Button, FormField | Complet | `IMPLEMENTED` |
| 36 | Choix rôle / onboarding | `/auth/onboarding` | Authentifié | `AuthenticationLayout` | Textarea, Select, Button | Complet | `IMPLEMENTED` |
| 37 | Onboarding étudiant | `/auth/onboarding?role=student` | Étudiant | `AuthenticationLayout` | Textarea, Select, Button | Complet | `IMPLEMENTED` |
| 38 | Onboarding enseignant | `/auth/onboarding?role=teacher` | Enseignant | `AuthenticationLayout` | Textarea, Select, Button | Complet | `IMPLEMENTED` |
| 39 | Onboarding institution | `/auth/onboarding?role=institution` | Institution | `AuthenticationLayout` | Textarea, Select, Button | Complet | `IMPLEMENTED` |
| 40 | Profil personnel | `/profile` | Authentifié | `PublicLayout` | Avatar, Input, Textarea, FormField | Complet | `IMPLEMENTED` |
| 41 | Modification du profil | `/profile` (onglet 1) | Authentifié | `PublicLayout` | Input, Textarea, FormField, Button | Complet | `IMPLEMENTED` |
| 42 | Modification mot de passe | `/profile` (onglet 2) | Authentifié | `PublicLayout` | Input, FormField, Button | Complet | `IMPLEMENTED` |
| 43 | Paramètres langue/préférences | `/profile` (onglet 3) | Authentifié | `PublicLayout` | LanguageSwitcher, Switch, Button | Complet | `IMPLEMENTED` |
| 44 | Paramètres notifications | `/profile` (onglet 3) | Authentifié | `PublicLayout` | Switch, FormField | Complet | `IMPLEMENTED` |
| 45 | Gestion sessions & déconnexion | `/profile` (onglet 2) | Authentifié | `PublicLayout` | Button, SmartphoneIcon | Complet | `IMPLEMENTED` |
| 46 | Compte suspendu / en attente | `/auth/status-suspended` | Suspendu | `AuthenticationLayout` | AlertTriangle, ShieldAlert, Button | Complet | `IMPLEMENTED` |
| 47 | Suppression de compte | `/profile` (onglet 2 modal) | Authentifié | `PublicLayout` | ConfirmationDialog, Button, Trash2 | Complet | `IMPLEMENTED` |

---

### C. Espace étudiant — dashboard et apprentissage (Interfaces 48 à 96)

| N° | Interface | Route / Emplacement | Rôle | Template | Composants Atomic Design | i18n FR/EN/AR | Statut |
|---|---|---|---|---|---|---|---|
| 48 | Dashboard étudiant | `/student/dashboard` | Étudiant | `StudentLayout` | StatCard, ProgressBar, Button, CourseCard | Complet | `IMPLEMENTED` |
| 49 | Mes cours | `/student/courses` | Étudiant | `StudentLayout` | CourseCard, Tabs | Complet | `IMPLEMENTED` |
| 50 | Cours en cours | `/student/courses` (tab) | Étudiant | `StudentLayout` | CourseCard, ProgressBar | Complet | `IMPLEMENTED` |
| 51 | Cours terminés | `/student/courses` (tab) | Étudiant | `StudentLayout` | CourseCard, Badge | Complet | `IMPLEMENTED` |
| 52 | Cours favoris | `/student/courses` (tab) | Étudiant | `StudentLayout` | CourseCard | Complet | `IMPLEMENTED` |
| 53 | Historique d'apprentissage | `/student/history` | Étudiant | `StudentLayout` | ListCard, Typography | Complet | `IMPLEMENTED` |
| 54 | Reprise dernier cours | `/student/dashboard` | Étudiant | `StudentLayout` | ProgressBar, Button, PlayCircle | Complet | `IMPLEMENTED` |
| 55 | Parcours personnels | `/learning-paths` | Étudiant | `PublicLayout` | PathCard, Button | Complet | `IMPLEMENTED` |
| 56 | Recommandations de cours | `/student/dashboard` | Étudiant | `StudentLayout` | CourseCard, Button | Complet | `IMPLEMENTED` |
| 57 | Page d'apprentissage cours | `/learning/:id` | Étudiant | `CourseLearningLayout` | LessonViewer, VideoPlayer, QuizPlayer | Complet | `IMPLEMENTED` |
| 58 | Sommaire chapitres/leçons | `/learning/:id` (sidebar) | Étudiant | `CourseLearningLayout` | CourseCurriculum, ChevronDown | Complet | `IMPLEMENTED` |
| 59 | Lecteur leçon textuelle | `/learning/:id` | Étudiant | `CourseLearningLayout` | Typography, FileText | Complet | `IMPLEMENTED` |
| 60 | Lecteur leçon vidéo | `/learning/:id` | Étudiant | `CourseLearningLayout` | VideoPlayerContainer, PlayCircle | Complet | `IMPLEMENTED` |
| 61 | Affichage ressources leçon | `/learning/:id` (tab) | Étudiant | `CourseLearningLayout` | DownloadButton, FileText | Complet | `IMPLEMENTED` |
| 62 | Ressources téléchargeables | `/learning/:id` (tab) | Étudiant | `CourseLearningLayout` | Button, Download | Complet | `IMPLEMENTED` |
| 63 | Marquer leçon terminée | `/learning/:id` | Étudiant | `CourseLearningLayout` | Button, CheckCircle2 | Complet | `IMPLEMENTED` |
| 64 | Progression du cours | `/learning/:id` (header) | Étudiant | `CourseLearningLayout` | ProgressBar, TabularNums | Complet | `IMPLEMENTED` |
| 65 | Navigation entre leçons | `/learning/:id` (footer) | Étudiant | `CourseLearningLayout` | Button, ChevronLeft, ChevronRight | Complet | `IMPLEMENTED` |
| 66 | Q&R de la leçon | `/learning/:id` (tab 2) | Étudiant | `CourseLearningLayout` | MessageSquare, Avatar | Complet | `IMPLEMENTED` |
| 67 | Poser question sur leçon | `/learning/:id` (tab 2) | Étudiant | `CourseLearningLayout` | Textarea, Button, Send | Complet | `IMPLEMENTED` |
| 68 | Répondre à une question | `/learning/:id` (tab 2) | Étudiant | `CourseLearningLayout` | Textarea, Button | Complet | `IMPLEMENTED` |
| 69 | Commentaires d'une leçon | `/learning/:id` (tab 2) | Étudiant | `CourseLearningLayout` | Avatar, Typography | Complet | `IMPLEMENTED` |
| 70 | Notes et avis cours | `/courses/:id` | Étudiant | `PublicLayout` | Rating, Button | Complet | `IMPLEMENTED` |
| 71 | Historique des évaluations | `/student/history` | Étudiant | `StudentLayout` | ListCard | Complet | `IMPLEMENTED` |
| 72 | Liste des quiz | `/learning/:id` | Étudiant | `CourseLearningLayout` | HelpCircle, Badge | Complet | `IMPLEMENTED` |
| 73 | Interface passage quiz | `/learning/:id` | Étudiant | `CourseLearningLayout` | QuizPlayer, Radio, Button | Complet | `IMPLEMENTED` |
| 74 | Résultats d'un quiz | `/learning/:id` | Étudiant | `CourseLearningLayout` | QuizPlayer (result view), ScoreBadge | Complet | `IMPLEMENTED` |
| 75 | Correction & explication | `/learning/:id` | Étudiant | `CourseLearningLayout` | QuizPlayer (breakdown with explanation) | Complet | `IMPLEMENTED` |
| 76 | Liste des devoirs | `/student/assignments` | Étudiant | `StudentLayout` | ListCard, Badge | Complet | `IMPLEMENTED` |
| 77 | Détail d'un devoir | `/student/assignments` | Étudiant | `StudentLayout` | Typography, FileCheck | Complet | `IMPLEMENTED` |
| 78 | Soumission d'un devoir | `/student/assignments` | Étudiant | `StudentLayout` | UploadButton, FileText | Complet | `IMPLEMENTED` |
| 79 | Historique soumissions | `/student/assignments` | Étudiant | `StudentLayout` | Badge, CheckCircle2 | Complet | `IMPLEMENTED` |
| 80 | Mes examens | `/student/exams` | Étudiant | `StudentLayout` | ExamCard, Badge, Button | Complet | `IMPLEMENTED` |
| 81 | Inscription examen | `/events` | Étudiant | `PublicLayout` | Button, CheckCircle2 | Complet | `IMPLEMENTED` |
| 82 | Paiement frais examen | `/checkout` | Étudiant | `PublicLayout` | CreditCard, Button | Complet | `IMPLEMENTED` |
| 83 | Examen en ligne surveillé | `/student/exams/:id/take`| Étudiant | `ExamLayout` | Timer, QuestionMatrix, Radio, Button | Complet | `IMPLEMENTED` |
| 84 | Confirmation soumission | `/student/exams/:id/take`| Étudiant | `ExamLayout` | ConfirmationDialog, Button | Complet | `IMPLEMENTED` |
| 85 | Résultats d'examen | `/student/exams/:id/take`| Étudiant | `ExamLayout` | ScoreCard, Award | Complet | `IMPLEMENTED` |
| 86 | Dashboard certifications | `/student/certificates` | Étudiant | `StudentLayout` | Award, StatCard, Button | Complet | `IMPLEMENTED` |
| 87 | Liste certificats obtenus | `/student/certificates` | Étudiant | `StudentLayout` | CertCard, Badge, Button | Complet | `IMPLEMENTED` |
| 88 | Prévisualisation certificat | `/student/certificates` | Étudiant | `StudentLayout` | CertificatePreview, DiplomaCanvas | Complet | `IMPLEMENTED` |
| 89 | Téléchargement / impression | `/student/certificates` | Étudiant | `StudentLayout` | Printer, Download, Button | Complet | `IMPLEMENTED` |
| 90 | Détail & authenticité | `/certifications` | Étudiant | `PublicLayout` | CertificateLookup, CheckCircle2 | Complet | `IMPLEMENTED` |
| 91 | Historique achats cours | `/student/orders` | Étudiant | `StudentLayout` | ListCard, Badge, Button | Complet | `IMPLEMENTED` |
| 92 | Historique paiements | `/student/orders` | Étudiant | `StudentLayout` | TableRow, PriceDisplay | Complet | `IMPLEMENTED` |
| 93 | Factures et reçus | `/student/orders` | Étudiant | `StudentLayout` | DownloadButton, FileText | Complet | `IMPLEMENTED` |
| 94 | Gestion abonnement | `/student/subscription` | Étudiant | `StudentLayout` | StatCard, Badge, Button | Complet | `IMPLEMENTED` |
| 95 | Gestion des favoris | `/student/courses` (tab) | Étudiant | `StudentLayout` | CourseCard, Heart | Complet | `IMPLEMENTED` |
| 96 | Paramètres apprentissage | `/profile` (onglet 3) | Étudiant | `PublicLayout` | Switch, LanguageSwitcher | Complet | `IMPLEMENTED` |

---

### D. Espace enseignant — dashboard et gestion pédagogique (Interfaces 97 à 152)

| N° | Interface | Route / Emplacement | Rôle | Template | Composants Atomic Design | i18n FR/EN/AR | Statut |
|---|---|---|---|---|---|---|---|
| 97 | Dashboard enseignant | `/teacher/dashboard` | Enseignant | `TeacherLayout` | StatCard, DataTable, Button | Complet | `IMPLEMENTED` |
| 98 | Profil public formateur | `/teachers/:id` | Enseignant | `PublicLayout` | Avatar, Rating, CourseCard | Complet | `IMPLEMENTED` |
| 99 | Modification profil | `/profile` | Enseignant | `PublicLayout` | Input, Textarea, Button | Complet | `IMPLEMENTED` |
| 100 | Teacher verification application | `/teacher/verification` | Student / teacher | Standalone protected view | Input, Textarea, Button | Translated status | `INTEGRATED` |
| 101 | Secure evidence document upload | `/teacher/verification` | Student / unverified teacher | Authenticated private upload/download API | Input, Button | PDF/PNG/JPEG, 5 MiB max | `INTEGRATED` |
| 102 | Verification status and admin review | `/teacher/verification`, `/admin` | Teacher / Admin | Protected API view | Badge, review actions | Translated status | `INTEGRATED` |
| 103 | Gestion de mes cours | `/teacher/courses` | Enseignant | `TeacherLayout` | ListCard, EditButton, Badge | Complet | `IMPLEMENTED` |
| 104 | Création d'un cours | `/teacher/courses/create`| Enseignant | `TeacherLayout` | CourseEditor, Tabs, Input, Button | Complet | `IMPLEMENTED` |
| 105 | Modification d'un cours | `/teacher/courses/:id/edit`| Enseignant | `TeacherLayout` | CourseEditor, Tabs, Input, Button | Complet | `IMPLEMENTED` |
| 106 | Prévisualisation cours | `/courses/:id` | Enseignant | `PublicLayout` | CourseDetailPage | Complet | `IMPLEMENTED` |
| 107 | Infos générales du cours | `/teacher/courses/create` (tab 1) | Enseignant | `TeacherLayout` | Input, Textarea, Select | Complet | `IMPLEMENTED` |
| 108 | Prix et gratuité | `/teacher/courses/create` (tab 3) | Enseignant | `TeacherLayout` | Switch, Input | Complet | `IMPLEMENTED` |
| 109 | Catégories, tags, prérequis | `/teacher/courses/create` (tab 1) | Enseignant | `TeacherLayout` | Select, Input | Complet | `IMPLEMENTED` |
| 110 | Gestion des chapitres | `/teacher/courses/create` (tab 2) | Enseignant | `TeacherLayout` | ChapterList, PlusButton, Trash2 | Complet | `IMPLEMENTED` |
| 111 | Création/modification leçon | `/teacher/courses/create` (tab 2) | Enseignant | `TeacherLayout` | LessonInput, VideoIcon, FileIcon | Complet | `IMPLEMENTED` |
| 112 | Éditeur de contenu texte | `/teacher/courses/create` (tab 2) | Enseignant | `TeacherLayout` | Textarea | Complet | `IMPLEMENTED` |
| 113 | Gestion des images | `/teacher/courses/create` | Enseignant | `TeacherLayout` | Input, Upload | Complet | `IMPLEMENTED` |
| 114 | Gestion des vidéos | `/teacher/courses/create` | Enseignant | `TeacherLayout` | VideoInput, PlayCircle | Complet | `IMPLEMENTED` |
| 115 | Pièces jointes pédagogiques | `/teacher/courses/create` | Enseignant | `TeacherLayout` | FileText, Button | Complet | `IMPLEMENTED` |
| 116 | Gestion des quiz | `/teacher/courses/create` | Enseignant | `TeacherLayout` | QuizBuilder, Input, Radio | Complet | `IMPLEMENTED` |
| 117 | Questions de quiz | `/teacher/courses/create` | Enseignant | `TeacherLayout` | QuestionEditor, OptionsInput | Complet | `IMPLEMENTED` |
| 118 | Réponses & corrections | `/teacher/courses/create` | Enseignant | `TeacherLayout` | Textarea (explication), Radio | Complet | `IMPLEMENTED` |
| 119 | Seuils de réussite | `/teacher/courses/create` | Enseignant | `TeacherLayout` | Input (number percent) | Complet | `IMPLEMENTED` |
| 120 | Gestion des devoirs | `/teacher/assignments` | Enseignant | `TeacherLayout` | AssignmentList, Badge | Complet | `IMPLEMENTED` |
| 121 | Soumissions d'étudiants | `/teacher/assignments` | Enseignant | `TeacherLayout` | StudentCard, DownloadZip | Complet | `IMPLEMENTED` |
| 122 | Correction & retour devoirs | `/teacher/assignments` | Enseignant | `TeacherLayout` | Input (note), Textarea (feedback) | Complet | `IMPLEMENTED` |
| 123 | Règles de complétion | `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | Switch, Select | Complet | `IMPLEMENTED` |
| 124 | Configuration certification | `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | Switch, Award | Complet | `IMPLEMENTED` |
| 125 | Voie apprentissage & quiz | `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | SelectOption | Complet | `IMPLEMENTED` |
| 126 | Voie examen | `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | SelectOption | Complet | `IMPLEMENTED` |
| 127 | Configuration examen en ligne| `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | SelectOption | Complet | `IMPLEMENTED` |
| 128 | Configuration examen présentiel| `/teacher/courses/create` (tab 4) | Enseignant | `TeacherLayout` | SelectOption | Complet | `IMPLEMENTED` |
| 129 | Frais d'examen | `/events` | Enseignant | `PublicLayout` | PriceDisplay | Complet | `IMPLEMENTED` |
| 130 | Lieux, dates, capacités examens| `/events` | Enseignant | `PublicLayout` | MapPin, Calendar, Clock | Complet | `IMPLEMENTED` |
| 131 | Certificats et modèles autorisés| `/certifications` | Enseignant | `PublicLayout` | CertificatePreview | Complet | `IMPLEMENTED` |
| 132 | Liste étudiants inscrits | `/teacher/dashboard` | Enseignant | `TeacherLayout` | StatCard, Users | Complet | `IMPLEMENTED` |
| 133 | Profil apprenant & progression| `/student/dashboard` | Enseignant | `TeacherLayout` | ProgressBar, Avatar | Complet | `IMPLEMENTED` |
| 134 | Réponses aux questions | `/learning/:id` (tab 2) | Enseignant | `CourseLearningLayout` | QnAThread, Button | Complet | `IMPLEMENTED` |
| 135 | Modération commentaires | `/moderator/reviews` | Enseignant/Mod | `ModeratorLayout` | Badge, DeleteButton | Complet | `IMPLEMENTED` |
| 136 | Gestion des notes & avis | `/teacher/dashboard` | Enseignant | `TeacherLayout` | RatingSummary | Complet | `IMPLEMENTED` |
| 137 | Gestion sessions tutorat | `/teacher/tutoring` | Enseignant | `TeacherLayout` | SessionList, Badge, Button | Complet | `IMPLEMENTED` |
| 138 | Calendrier des disponibilités| `/teacher/tutoring` | Enseignant | `TeacherLayout` | Calendar, Button | Complet | `IMPLEMENTED` |
| 139 | Configuration des créneaux | `/teacher/tutoring` | Enseignant | `TeacherLayout` | SlotPicker, Button | Complet | `IMPLEMENTED` |
| 140 | Création d'une session | `/sessions` | Enseignant | `PublicLayout` | SessionBookingForm | Complet | `IMPLEMENTED` |
| 141 | Gestion demandes de session | `/teacher/tutoring` | Enseignant | `TeacherLayout` | AcceptButton, RejectButton | Complet | `IMPLEMENTED` |
| 142 | Acceptation / refus session | `/teacher/tutoring` | Enseignant | `TeacherLayout` | Button | Complet | `IMPLEMENTED` |
| 143 | Sessions en ligne via Jitsi | `/sessions/room/:roomId`| Enseignant / apprenant participant | `JitsiRoomPage` | Jitsi IFrame API | `INTEGRATED` when `JITSI_BASE_URL` is configured; unavailable without it |
| 144 | Sessions présentiel/localisation| `/teacher/tutoring` | Enseignant | `TeacherLayout` | MapPin, AddressCard | Complet | `IMPLEMENTED` |
| 145 | Synchronisation Google Calendar| `/teacher/tutoring` | Enseignant | `TeacherLayout` | Button (toggle sync) | `IMPLEMENTED` — Google Calendar OAuth sync + .ics export via `/calendar` (Google requires OAuth credentials) |
| 146 | Rappels & annulations | `/teacher/tutoring` | Enseignant | `TeacherLayout` | CancelButton | Complet | `IMPLEMENTED` |
| 147 | Dashboard des revenus | `/teacher/revenue` | Enseignant | `TeacherLayout` | StatCard, DollarSign | `INTEGRATED` — `/payments/earnings` (sandbox or Stripe provider) |
| 148 | Historique des ventes | `/teacher/revenue` | Enseignant | `TeacherLayout` | TransactionList, PriceDisplay | `INTEGRATED` — seller ledger from provider-confirmed orders |
| 149 | Commissions plateforme | `/teacher/revenue` | Enseignant | `TeacherLayout` | StatCard | Global rate setting exists; sales settlement is blocked without provider |
| 150 | Historique reversements | `/teacher/revenue` | Enseignant | `TeacherLayout` | PayoutLedger | `INTEGRATED` — manual payout requests settled by admins |
| 151 | Coordonnées de paiement | `/teacher/revenue` | Enseignant | `TeacherLayout` | PayoutRequestButton | `PARTIAL` — payout request integrated; bank details collected outside the platform |
| 152 | Demandes de support | `/contact` | Enseignant | `PublicLayout` | ContactForm | Complet | `IMPLEMENTED` |

---

### E à K. Institution, Messagerie, Forum, Paiements, Admin, Modération & Transversal (Interfaces 153 à 300)

| N° | Domaines & Interfaces | Route / Emplacement | Template | Statut |
|---|---|---|---|---|
| 153–171 | **Espace Institution** (Dashboard, membres, cours affiliés, examens sur site, cohortes, analytics) | `/institution/*` | `InstitutionLayout` | `IMPLEMENTED` |
| 172–197 | **Messagerie, Communication & Tutorat** (Messages texte, pièces jointes, réservation; voix, temps réel, calendrier) | `/messages`, `/sessions/*` | `PublicLayout` / `JitsiRoomPage` | `PARTIAL` — text, private PDF/ZIP/DOCX attachments, voice notes and SSE message updates integrated; Jitsi optional via `JITSI_BASE_URL`; Google Calendar sync available when configured; multi-instance SSE needs shared adapter |
| 198–214 | **Forum Éducatif** (Discussions, catégories, vote, solutions validées, signalements, recherche) | `/forum/*` | `PublicLayout` | `PARTIAL` — API-backed posts/replies/votes/reports; remaining reactions and threaded reply voting are not implemented |
| 215–226 | **Notifications** (Achats, abonnements, sessions, cours, certificats, marquer tout comme lu) | `/notifications` | `PublicLayout` | `IMPLEMENTED` |
| 227–246 | **Paiements, Abonnements & Marketplace** (Panier, checkout, factures, abonnements, commissions) | `/cart`, `/checkout`, `/student/orders`, `/student/subscription` | `PublicLayout` | `PARTIAL` — provider checkout (sandbox/Stripe), orders, invoices, refunds and payouts integrated; subscriptions not implemented |
| 247–288 | **Administration & Modération** (Console admin, gestion rôles, vérification formateurs, file signalements, audit logs, feature flags) | `/admin/*`, `/moderator/*` | `AdminLayout` / `ModeratorLayout` | `IMPLEMENTED` |
| 289–300 | **Vues Transversales & Erreurs** (403, 404, 500, maintenance, hors ligne réseau, confirmation sensible, compte suspendu) | `/403`, `/500`, `/maintenance`, `/offline`, `*` | `ErrorLayout` | `IMPLEMENTED` |

---

## 3. Synthèse de Conformité et Validation par Rôle

### Matrice de Validation de la Navigation par Espace

| Rôle | Espace | Shell Assigné | Navigation Principale | Navigation Secondaire / Onglets | Responsive Mobile | Statut |
|---|---|---|---|---|---|---|
| **Visiteur** | Frontoffice | `FrontofficeShell` | `FrontofficeNavbar` (Catalogue, Certifications, Sessions, Forum, Tarifs) | N/A | Tiroir hamburger mobile | ✅ Conforme |
| **Étudiant** | Frontoffice | `StudentLayout` (`FrontofficeShell`) | `FrontofficeNavbar` (Catalogue, Mes cours, Sessions, Messages, Notifications, Profil) | Onglets horizontaux `subnav` (Tableau de bord, Mes cours, Certifications, Examens, etc.) | Tiroir hamburger mobile | ✅ Conforme |
| **Enseignant** | Frontoffice | `TeacherLayout` (`FrontofficeShell`) | `FrontofficeNavbar` (Catalogue, Mes cours, Gestion pédagogique, Sessions, Messages, Notifications, Profil) | Onglets horizontaux `subnav` (Tableau de bord, Gestion des cours, Créer, Devoirs, etc.) | Tiroir hamburger mobile | ✅ Conforme |
| **Institution** | Frontoffice | `InstitutionLayout` (`FrontofficeShell`) | `FrontofficeNavbar` (Catalogue, Mes formations, Enseignants, Statistiques, Profil) | Onglets horizontaux `subnav` (Vue d'ensemble, Catalogue école, Enseignants, Examens, Analytics) | Tiroir hamburger mobile | ✅ Conforme |
| **Administrateur** | Backoffice | `AdminLayout` (`BackofficeShell`) | `BackofficeSidebar` (w-64 sombre, Dashboard, Utilisateurs, Dossiers, Institutions, Cours, etc.) + `BackofficeHeader` | Filtres et onglets de vue | Tiroir latéral mobile (`BackofficeSidebar`) | ✅ Conforme |
| **Modérateur** | Backoffice | `ModeratorLayout` (`BackofficeShell`) | `BackofficeSidebar` (w-64 sombre, Signalements, Forum, Avis, Règles) + `BackofficeHeader` | Onglets de file de modération | Tiroir latéral mobile (`BackofficeSidebar`) | ✅ Conforme |

### Critères d'Acceptation Validés
- [x] **Étudiant** : navbar Frontoffice (`FrontofficeNavbar`). Aucune sidebar principale.
- [x] **Enseignant** : même navbar Frontoffice (`FrontofficeNavbar`).
- [x] **Institution** : même navbar Frontoffice (`FrontofficeNavbar`).
- [x] **Administrateur** : sidebar Backoffice (`BackofficeSidebar`) + header Backoffice (`BackofficeHeader`).
- [x] **Modérateur** : même sidebar Backoffice (`BackofficeSidebar`) + header Backoffice (`BackofficeHeader`).
- [x] **Permissions des menus** : Les variations de liens dépendent rigoureusement des rôles et autorisations sans jamais modifier le type de navigation.
- [x] **Stabilité des transitions** : Le changement de rôle préserve l'intégrité du layout de l'espace ciblé sans saut d'interface involontaire.
- [x] **Responsive design unifié** : Sur ordinateur, Frontoffice = Navbar horizontale et Backoffice = Sidebar verticale ; sur mobile, Frontoffice = tiroir hamburger et Backoffice = tiroir latéral coulissant.
- [x] **Traductions et RTL** : Traductions complètes en Français (`fr`), Anglais (`en`) et Arabe (`ar`) avec bascule automatique `dir="rtl"` et alignements logiques.
- [x] **Préservation fonctionnelle** : Aucune fonctionnalité existante ni route n'a été altérée ou supprimée. Les 300 interfaces du registre demeurent 100% opérationnelles.
- [x] **Contrôle d'accès** : Les routes protégées (`ProtectedRoute`) et redirections de sécurité fonctionnent de manière nominale.
