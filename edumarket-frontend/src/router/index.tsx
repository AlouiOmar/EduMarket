import React, { Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

// Layouts (eager: they frame every page)
import { PublicLayout } from '../components/templates/PublicLayout';
import { AuthenticationLayout } from '../components/templates/AuthenticationLayout';
import { StudentLayout, TeacherLayout, InstitutionLayout, AdminLayout, ModeratorLayout } from '../components/templates/WorkspaceLayouts';
import { ProtectedRoute } from './ProtectedRoute';
import { usesApi } from '../services/apiClient';
import type { UserRole } from '../types';

// Home and error pages stay in the main bundle; every other page is code-split per module.
import { HomePage } from '../pages/public/HomePage';
import { NotFoundPage, ForbiddenPage, ServerErrorPage, MaintenancePage, NetworkOfflinePage } from '../pages/shared/ErrorPages';

type PageModule = Record<string, unknown>;
const lazyPage = <M extends PageModule>(loader: () => Promise<M>, name: keyof M & string) =>
  React.lazy(() => loader().then(module => ({ default: module[name] as React.ComponentType<any> })));
const RouteFallback = () => <div className="min-h-[40vh] grid place-items-center text-sm text-slate-500" role="status">…</div>;
const page = (element: React.ReactNode) => <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
const guard = (roles: UserRole[], element: React.ReactNode, requireVerifiedTeacher = false) => ({
  element: <ProtectedRoute allowedRoles={roles} requireVerifiedTeacher={requireVerifiedTeacher} />,
  children: [{ index: true, element: page(element) }],
});

const publicPages = () => import('../pages/public/StaticPublicPages');
const authPages = () => import('../pages/auth/AuthPages');
const teacherManagement = () => import('../pages/teacher/TeacherManagementPages');
const institutionPages = () => import('../pages/institution/InstitutionPages');
const adminPages = () => import('../pages/admin/AdminPages');
const adminFinance = () => import('../pages/admin/AdminFinancePages');
const adminPlatform = () => import('../pages/admin/AdminPlatformPages');
const moderatorPages = () => import('../pages/moderator/ModeratorPages');
const checkoutPages = () => import('../pages/public/CheckoutPages');
const orderPages = () => import('../pages/student/OrdersPages');
const studentExams = () => import('../pages/student/ExamAndCertificatesPages');
const sessionPages = () => import('../pages/shared/SessionsPages');

// Public
const CoursesCatalogPage = lazyPage(() => import('../pages/public/CoursesCatalogPage'), 'CoursesCatalogPage');
const CourseDetailPage = lazyPage(() => import('../pages/public/CourseDetailPage'), 'CourseDetailPage');
const TeachersDirectoryPage = lazyPage(() => import('../pages/public/TeachersDirectoryPage'), 'TeachersDirectoryPage');
const TeacherDetailPage = lazyPage(() => import('../pages/public/TeachersDirectoryPage'), 'TeacherDetailPage');
const InstitutionsDirectoryPage = lazyPage(() => import('../pages/public/InstitutionsDirectoryPage'), 'InstitutionsDirectoryPage');
const InstitutionDetailPage = lazyPage(() => import('../pages/public/InstitutionsDirectoryPage'), 'InstitutionDetailPage');
const EventsExamsPage = lazyPage(() => import('../pages/public/EventsExamsPage'), 'EventsExamsPage');
const CertificationsPage = lazyPage(() => import('../pages/public/CertificationsPage'), 'CertificationsPage');
const PricingPage = lazyPage(() => import('../pages/public/PricingPage'), 'PricingPage');
const ForTeachersPage = lazyPage(() => import('../pages/public/ForTeachersPage'), 'ForTeachersPage');
const ForInstitutionsPage = lazyPage(() => import('../pages/public/ForTeachersPage'), 'ForInstitutionsPage');
const LearningPathsPage = lazyPage(() => import('../pages/public/ForTeachersPage'), 'LearningPathsPage');
const AboutPage = lazyPage(publicPages, 'AboutPage');
const ContactPage = lazyPage(publicPages, 'ContactPage');
const FaqPage = lazyPage(publicPages, 'FaqPage');
const HelpCenterPage = lazyPage(publicPages, 'HelpCenterPage');
const TermsPage = lazyPage(publicPages, 'TermsPage');
const PrivacyPage = lazyPage(publicPages, 'PrivacyPage');
const CookiesPage = lazyPage(publicPages, 'CookiesPage');
const AccessibilityPage = lazyPage(publicPages, 'AccessibilityPage');
const GlobalSearchResultsPage = lazyPage(publicPages, 'GlobalSearchResultsPage');
const CartPage = lazyPage(checkoutPages, 'CartPage');
const CheckoutPage = lazyPage(checkoutPages, 'CheckoutPage');
const SandboxCheckoutPage = lazyPage(checkoutPages, 'SandboxCheckoutPage');
const CheckoutCompletePage = lazyPage(checkoutPages, 'CheckoutCompletePage');

// Auth & onboarding
const LoginPage = lazyPage(authPages, 'LoginPage');
const RegisterPage = lazyPage(authPages, 'RegisterPage');
const ForgotPasswordPage = lazyPage(authPages, 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(authPages, 'ResetPasswordPage');
const VerifyEmailPage = lazyPage(authPages, 'VerifyEmailPage');
const OtpVerificationPage = lazyPage(authPages, 'OtpVerificationPage');
const OnboardingPage = lazyPage(authPages, 'OnboardingPage');
const AccountStatusPage = lazyPage(authPages, 'AccountStatusPage');
const InstitutionApplicationPage = lazyPage(() => import('../pages/institution/InstitutionApplicationPage'), 'InstitutionApplicationPage');

// Shared (several roles, one implementation)
const ProfilePage = lazyPage(() => import('../pages/shared/ProfilePages'), 'ProfilePage');
const MessagingPage = lazyPage(() => import('../pages/shared/MessagingPages'), 'MessagingPage');
const ForumListPage = lazyPage(() => import('../pages/shared/ForumPages'), 'ForumListPage');
const ForumDetailPage = lazyPage(() => import('../pages/shared/ForumPages'), 'ForumDetailPage');
const SessionsListPage = lazyPage(sessionPages, 'SessionsListPage');
const JitsiRoomPage = lazyPage(sessionPages, 'JitsiRoomPage');
const NotificationsPage = lazyPage(() => import('../pages/shared/NotificationsPage'), 'NotificationsPage');
const SupportPage = lazyPage(() => import('../pages/shared/SupportPage'), 'SupportPage');
const CalendarPage = lazyPage(() => import('../pages/shared/CalendarPage'), 'CalendarPage');

// Student
const StudentDashboardPage = lazyPage(() => import('../pages/student/StudentDashboardPage'), 'StudentDashboardPage');
const StudentCoursesPage = lazyPage(() => import('../pages/student/StudentCoursesPages'), 'StudentCoursesPage');
const LearningHistoryPage = lazyPage(() => import('../pages/student/StudentCoursesPages'), 'LearningHistoryPage');
const CourseLearningPage = lazyPage(() => import('../pages/student/CourseLearningPage'), 'CourseLearningPage');
const OnlineExamPage = lazyPage(studentExams, 'OnlineExamPage');
const CertificatesPage = lazyPage(studentExams, 'CertificatesPage');
const AssignmentsPage = lazyPage(studentExams, 'AssignmentsPage');
const OrdersHistoryPage = lazyPage(orderPages, 'OrdersHistoryPage');
const InvoicePage = lazyPage(orderPages, 'InvoicePage');
const StudentSubscriptionPage = lazyPage(orderPages, 'StudentSubscriptionPage');

// Teacher
const TeacherDashboardPage = lazyPage(() => import('../pages/teacher/TeacherDashboardPage'), 'TeacherDashboardPage');
const TeacherAffiliationsPage = lazyPage(() => import('../pages/teacher/TeacherDashboardPage'), 'TeacherAffiliationsPage');
const TeacherStudentsPage = lazyPage(() => import('../pages/institution/InstitutionAnalyticsPages'), 'TeacherStudentsPage');
const TeacherReviewsPage = lazyPage(() => import('../pages/teacher/TeacherReviewsPage'), 'TeacherReviewsPage');
const classesPages = () => import('../pages/shared/ClassesPages');
const ClassesPage = lazyPage(classesPages, 'ClassesPage');
const ClassDetailPage = lazyPage(classesPages, 'ClassDetailPage');
const StoragePage = lazyPage(() => import('../pages/shared/StoragePage'), 'StoragePage');
const StudentClassesPage = lazyPage(() => import('../pages/student/StudentClassesPage'), 'StudentClassesPage');
const AdminOfflinePaymentsPage = lazyPage(() => import('../pages/admin/AdminOfflinePaymentsPage'), 'AdminOfflinePaymentsPage');
const adminRecords = () => import('../pages/admin/AdminRecordsPages');
const AdminExamsPage = lazyPage(adminRecords, 'AdminExamsPage');
const AdminCertificatesPage = lazyPage(adminRecords, 'AdminCertificatesPage');
const AdminUserDetailPage = lazyPage(adminRecords, 'AdminUserDetailPage');
const CourseEditorPage = lazyPage(() => import('../pages/teacher/CourseEditorPage'), 'CourseEditorPage');
const CourseContentPage = lazyPage(() => import('../pages/teacher/CourseContentPage'), 'CourseContentPage');
const ContentItemEditorPage = lazyPage(() => import('../pages/teacher/ContentItemEditorPage'), 'ContentItemEditorPage');
const GradebookPage = lazyPage(() => import('../pages/teacher/GradebookPage'), 'GradebookPage');
const StudentGradesPage = lazyPage(() => import('../pages/student/StudentGradesPage'), 'StudentGradesPage');
const AssessmentsPage = lazyPage(() => import('../pages/teacher/assessments/AssessmentsPage'), 'AssessmentsPage');
const studentAssessments = () => import('../pages/student/StudentAssessmentPages');
const StudentTestsPage = lazyPage(studentAssessments, 'StudentTestsPage');
const StudentAttemptPage = lazyPage(studentAssessments, 'StudentAttemptPage');
const StudentCourseAssignmentsPage = lazyPage(studentAssessments, 'StudentCourseAssignmentsPage');
const StudentFormsPage = lazyPage(studentAssessments, 'StudentFormsPage');
const teacherParticipation = () => import('../pages/teacher/TeacherParticipationPages');
const DiscussionsPage = lazyPage(teacherParticipation, 'DiscussionsPage');
const JournalsPage = lazyPage(teacherParticipation, 'JournalsPage');
const AnnouncementsPage = lazyPage(teacherParticipation, 'AnnouncementsPage');
const AttendancePage = lazyPage(teacherParticipation, 'AttendancePage');
const GroupsPage = lazyPage(teacherParticipation, 'GroupsPage');
const CourseAnalyticsPage = lazyPage(teacherParticipation, 'CourseAnalyticsPage');
const CourseTemplatePage = lazyPage(() => import('../pages/teacher/CourseTemplatePage'), 'CourseTemplatePage');
const IntegrationsPage = lazyPage(() => import('../pages/teacher/IntegrationsPage'), 'IntegrationsPage');
const CourseFilesPage = lazyPage(() => import('../pages/teacher/CourseFilesPage'), 'CourseFilesPage');
const AdminLtiToolsPage = lazyPage(() => import('../pages/admin/AdminLtiToolsPage'), 'AdminLtiToolsPage');
const StudentActivitiesPage = lazyPage(() => import('../pages/student/StudentActivitiesPage'), 'StudentActivitiesPage');
const studentParticipation = () => import('../pages/student/StudentParticipationPages');
const StudentDiscussionsPage = lazyPage(studentParticipation, 'StudentDiscussionsPage');
const StudentJournalPage = lazyPage(studentParticipation, 'StudentJournalPage');
const StudentAnnouncementsPage = lazyPage(studentParticipation, 'StudentAnnouncementsPage');
const StudentGroupsPage = lazyPage(studentParticipation, 'StudentGroupsPage');
const StudentAttendancePage = lazyPage(studentParticipation, 'StudentAttendancePage');
const TeacherCoursesListPage = lazyPage(teacherManagement, 'TeacherCoursesListPage');
const TeacherTutoringPage = lazyPage(teacherManagement, 'TeacherTutoringPage');
const TeacherRevenuePage = lazyPage(teacherManagement, 'TeacherRevenuePage');
const TeacherAssignmentsPage = lazyPage(teacherManagement, 'TeacherAssignmentsPage');
const TeacherVerificationPage = lazyPage(() => import('../pages/teacher/TeacherVerificationPage'), 'TeacherVerificationPage');
const teacherApplicationPages = () => import('../pages/teacher-application/TeacherApplicationPage');
const TeacherApplicationPage = lazyPage(teacherApplicationPages, 'TeacherApplicationPage');
const TeacherSignupPage = lazyPage(() => import('../pages/teacher-application/TeacherSignupPage'), 'TeacherSignupPage');
const teacherApplicationAdminPages = () => import('../pages/admin/TeacherApplicationsAdminPages');
const TeacherApplicationsAdminPage = lazyPage(teacherApplicationAdminPages, 'TeacherApplicationsAdminPage');
const TeacherApplicationAdminDetailPage = lazyPage(teacherApplicationAdminPages, 'TeacherApplicationAdminDetailPage');

// Institution
const InstitutionDashboardPage = lazyPage(institutionPages, 'InstitutionDashboardPage');
const InstitutionTeachersPage = lazyPage(institutionPages, 'InstitutionTeachersPage');
const InstitutionCoursesPage = lazyPage(institutionPages, 'InstitutionCoursesPage');
const InstitutionAnalyticsPage = lazyPage(institutionPages, 'InstitutionAnalyticsPage');
const InstitutionExamGradingPage = lazyPage(institutionPages, 'InstitutionExamGradingPage');
const InstitutionStudentsPage = lazyPage(() => import('../pages/institution/InstitutionAnalyticsPages'), 'InstitutionStudentsPage');

// Back office
const AdminDashboardPage = lazyPage(adminPages, 'AdminDashboardPage');
const AdminUsersPage = lazyPage(adminPages, 'AdminUsersPage');
const AdminVerificationsPage = lazyPage(adminPages, 'AdminVerificationsPage');
const AdminSettingsPage = lazyPage(adminPages, 'AdminSettingsPage');
const InstitutionApplicationsPage = lazyPage(() => import('../pages/admin/InstitutionApplicationsPage'), 'InstitutionApplicationsPage');
const AdminTransactionsPage = lazyPage(adminFinance, 'AdminTransactionsPage');
const AdminPayoutsPage = lazyPage(adminFinance, 'AdminPayoutsPage');
const AdminAuditLogsPage = lazyPage(adminPlatform, 'AdminAuditLogsPage');
const AdminSupportPage = lazyPage(adminPlatform, 'AdminSupportPage');
const AdminCategoriesPage = lazyPage(adminPlatform, 'AdminCategoriesPage');
const AdminLearningPathsPage = lazyPage(() => import('../pages/admin/AdminLearningPathsPage'), 'AdminLearningPathsPage');
const ModeratorQueuePage = lazyPage(moderatorPages, 'ModeratorQueuePage');
const CourseModerationPage = lazyPage(moderatorPages, 'CourseModerationPage');
const ModerationHistoryPage = lazyPage(moderatorPages, 'ModerationHistoryPage');
const ContentReportsPage = lazyPage(() => import('../pages/moderator/ContentReportsPage'), 'ContentReportsPage');

const SIGNED_IN: UserRole[] = ['student', 'teacher', 'unverified_teacher', 'institution', 'moderator', 'admin'];

export const router = createBrowserRouter([
  // Public front office (shared navbar)
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'courses', element: page(<CoursesCatalogPage />) },
      { path: 'courses/:id', element: page(<CourseDetailPage />) },
      { path: 'learning-paths', element: page(<LearningPathsPage />) },
      { path: 'teachers', element: page(<TeachersDirectoryPage />) },
      { path: 'teachers/:id', element: page(<TeacherDetailPage />) },
      { path: 'institutions', element: page(<InstitutionsDirectoryPage />) },
      { path: 'institutions/:id', element: page(<InstitutionDetailPage />) },
      { path: 'events', element: page(<EventsExamsPage />) },
      { path: 'certifications', element: page(<CertificationsPage />) },
      { path: 'pricing', element: page(<PricingPage />) },
      { path: 'for-teachers', element: page(<ForTeachersPage />) },
      { path: 'for-institutions', element: page(<ForInstitutionsPage />) },
      { path: 'about', element: page(<AboutPage />) },
      { path: 'contact', element: page(<ContactPage />) },
      { path: 'faq', element: page(<FaqPage />) },
      { path: 'help', element: page(<HelpCenterPage />) },
      { path: 'terms', element: page(<TermsPage />) },
      { path: 'privacy', element: page(<PrivacyPage />) },
      { path: 'cookies', element: page(<CookiesPage />) },
      { path: 'accessibility', element: page(<AccessibilityPage />) },
      { path: 'search', element: page(<GlobalSearchResultsPage />) },
      { path: 'cart', element: page(<CartPage />) },
      { path: 'checkout', element: page(<CheckoutPage />) },
      { path: 'checkout/sandbox/:sessionId', ...guard(['student'], <SandboxCheckoutPage />) },
      { path: 'checkout/complete', ...guard(['student'], <CheckoutCompletePage />) },
      { path: 'forum', element: page(<ForumListPage />) },
      { path: 'forum/:id', element: page(<ForumDetailPage />) },
      // Shared signed-in pages
      { path: 'profile', element: page(<ProfilePage />) },
      { path: 'notifications', ...guard(SIGNED_IN, <NotificationsPage />) },
      { path: 'classes', ...guard(['teacher', 'institution', 'admin'], <ClassesPage />) },
      { path: 'classes/:classId', ...guard(['teacher', 'institution', 'admin'], <ClassDetailPage />) },
      { path: 'storage', ...guard(['teacher', 'institution'], <StoragePage />) },
      { path: 'messages', ...guard(['student', 'teacher'], <MessagingPage />) },
      { path: 'support', ...guard(SIGNED_IN, <SupportPage />) },
      { path: 'calendar', ...guard(['student', 'teacher', 'institution', 'admin'], <CalendarPage />) },
    ],
  },

  // Auth & onboarding
  {
    path: '/auth',
    element: <AuthenticationLayout />,
    children: [
      { path: 'login', element: page(<LoginPage />) },
      { path: 'register', element: page(<RegisterPage />) },
      { path: 'register/teacher', element: page(<TeacherSignupPage />) },
      { path: 'institution-request', element: page(usesApi ? <InstitutionApplicationPage /> : <RegisterPage />) },
      { path: 'forgot-password', element: page(<ForgotPasswordPage />) },
      { path: 'reset-password', element: page(<ResetPasswordPage />) },
      { path: 'verify-email', element: page(<VerifyEmailPage />) },
      { path: 'otp', element: page(<OtpVerificationPage />) },
      { path: 'onboarding', element: page(<OnboardingPage />) },
      { path: 'status-pending', element: page(<AccountStatusPage type="pending" />) },
      { path: 'status-suspended', element: page(<AccountStatusPage type="suspended" />) },
    ],
  },

  // Student workspace
  {
    path: '/student',
    element: <ProtectedRoute allowedRoles={['student', 'admin']} />,
    children: [
      {
        element: <StudentLayout />,
        children: [
          { path: 'dashboard', element: page(<StudentDashboardPage />) },
          { path: 'courses', element: page(<StudentCoursesPage />) },
          { path: 'history', element: page(<LearningHistoryPage />) },
          { path: 'learning-paths', element: page(<LearningPathsPage />) },
          { path: 'classes', element: page(<StudentClassesPage />) },
          { path: 'certificates', element: page(<CertificatesPage />) },
          { path: 'exams', element: page(<EventsExamsPage />) },
          { path: 'assignments', element: page(<AssignmentsPage />) },
          { path: 'courses/:id/grades', element: page(<StudentGradesPage />) },
          { path: 'courses/:id/tests', element: page(<StudentTestsPage />) },
          { path: 'courses/:id/tests/attempts/:attemptId', element: page(<StudentAttemptPage />) },
          { path: 'courses/:id/assignments', element: page(<StudentCourseAssignmentsPage />) },
          { path: 'courses/:id/forms', element: page(<StudentFormsPage />) },
          { path: 'courses/:id/discussions', element: page(<StudentDiscussionsPage />) },
          { path: 'courses/:id/journal', element: page(<StudentJournalPage />) },
          { path: 'courses/:id/announcements', element: page(<StudentAnnouncementsPage />) },
          { path: 'courses/:id/groups', element: page(<StudentGroupsPage />) },
          { path: 'courses/:id/attendance', element: page(<StudentAttendancePage />) },
          { path: 'courses/:id/activities', element: page(<StudentActivitiesPage />) },
          { path: 'sessions', element: page(<SessionsListPage />) },
          { path: 'calendar', element: page(<CalendarPage />) },
          { path: 'orders', element: page(<OrdersHistoryPage />) },
          { path: 'orders/:orderId/invoice', element: page(<InvoicePage />) },
          { path: 'subscription', element: page(<StudentSubscriptionPage />) },
          { path: 'support', element: page(<SupportPage />) },
        ],
      },
    ],
  },
  { path: '/sessions', ...guard(['student', 'teacher', 'admin'], <SessionsListPage />) },

  // Dedicated focus modes
  { path: '/learning/:id', ...guard(['student', 'admin'], <CourseLearningPage />) },
  { path: '/student/exams/:examId/take', ...guard(['student', 'admin'], <OnlineExamPage />) },
  { path: '/sessions/room/:roomId', ...guard(['student', 'teacher', 'admin'], <JitsiRoomPage />) },

  // Teacher workspace (verification page stays reachable before approval)
  { path: '/teacher/verification', ...guard(['student', 'unverified_teacher', 'teacher', 'admin'], <TeacherVerificationPage />) },
  // Independent teacher application (API mode); the demo keeps the simple verification form.
  { path: '/teacher/application', ...guard(['student', 'unverified_teacher', 'teacher'], usesApi ? <TeacherApplicationPage /> : <TeacherVerificationPage />) },
  {
    path: '/teacher',
    element: <ProtectedRoute allowedRoles={['teacher', 'unverified_teacher', 'admin']} />,
    children: [
      {
        element: <TeacherLayout />,
        children: [
          { path: 'dashboard', ...guard(['teacher', 'admin'], <TeacherDashboardPage />, true) },
          { path: 'courses', ...guard(['teacher', 'admin'], <TeacherCoursesListPage />, true) },
          { path: 'courses/create', ...guard(['teacher', 'admin'], <CourseEditorPage />, true) },
          { path: 'courses/:id/edit', ...guard(['teacher', 'admin'], <CourseEditorPage />, true) },
          { path: 'courses/:id/content', ...guard(['teacher', 'admin'], <CourseContentPage />, true) },
          { path: 'courses/:id/content/items/:itemId', ...guard(['teacher', 'admin'], <ContentItemEditorPage />, true) },
          { path: 'courses/:id/gradebook', ...guard(['teacher', 'admin'], <GradebookPage />, true) },
          { path: 'courses/:id/assessments', ...guard(['teacher', 'admin'], <AssessmentsPage />, true) },
          { path: 'courses/:id/discussions', ...guard(['teacher', 'admin'], <DiscussionsPage />, true) },
          { path: 'courses/:id/journals', ...guard(['teacher', 'admin'], <JournalsPage />, true) },
          { path: 'courses/:id/announcements', ...guard(['teacher', 'admin'], <AnnouncementsPage />, true) },
          { path: 'courses/:id/attendance', ...guard(['teacher', 'admin'], <AttendancePage />, true) },
          { path: 'courses/:id/groups', ...guard(['teacher', 'admin'], <GroupsPage />, true) },
          { path: 'courses/:id/analytics', ...guard(['teacher', 'admin'], <CourseAnalyticsPage />, true) },
          { path: 'courses/:id/template', ...guard(['teacher', 'admin'], <CourseTemplatePage />, true) },
          { path: 'courses/:id/integrations', ...guard(['teacher', 'admin'], <IntegrationsPage />, true) },
          { path: 'courses/:id/files', ...guard(['teacher', 'admin'], <CourseFilesPage />, true) },
          { path: 'tutoring', ...guard(['teacher', 'admin'], <TeacherTutoringPage />, true) },
          { path: 'calendar', ...guard(['teacher', 'admin'], <CalendarPage />, true) },
          { path: 'revenue', ...guard(['teacher', 'admin'], <TeacherRevenuePage />, true) },
          { path: 'assignments', ...guard(['teacher', 'admin'], <TeacherAssignmentsPage />, true) },
          { path: 'affiliations', ...guard(['teacher', 'admin'], <TeacherAffiliationsPage />, true) },
          { path: 'students', ...guard(['teacher'], <TeacherStudentsPage />, true) },
          { path: 'reviews', ...guard(['teacher'], <TeacherReviewsPage />, true) },
          { path: 'classes', ...guard(['teacher', 'admin'], <ClassesPage />, true) },
          { path: 'classes/:classId', ...guard(['teacher', 'admin'], <ClassDetailPage />, true) },
          { path: 'storage', ...guard(['teacher'], <StoragePage />, true) },
        ],
      },
    ],
  },

  // Institution workspace
  {
    path: '/institution',
    element: <ProtectedRoute allowedRoles={['institution', 'admin']} />,
    children: [
      {
        element: <InstitutionLayout />,
        children: [
          { path: 'dashboard', element: page(<InstitutionDashboardPage />) },
          { path: 'teachers', element: page(<InstitutionTeachersPage />) },
          { path: 'courses', element: page(<InstitutionCoursesPage />) },
          { path: 'analytics', element: page(<InstitutionAnalyticsPage />) },
          { path: 'exams', element: page(<InstitutionExamGradingPage />) },
          { path: 'students', element: page(<InstitutionStudentsPage fallback={<InstitutionAnalyticsPage />} />) },
          { path: 'reviews', element: page(<TeacherReviewsPage />) },
          { path: 'classes', element: page(<ClassesPage />) },
          { path: 'classes/:classId', element: page(<ClassDetailPage />) },
          { path: 'storage', element: page(<StoragePage />) },
          { path: 'finances', element: page(<TeacherRevenuePage />) },
          { path: 'settings', element: page(<ProfilePage />) },
        ],
      },
    ],
  },

  // Back office: administration (sidebar layout)
  {
    path: '/admin',
    element: <ProtectedRoute allowedRoles={['admin']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: 'dashboard', element: page(<AdminDashboardPage />) },
          { path: 'users', element: page(<AdminUsersPage />) },
          { path: 'users/:userId', element: page(<AdminUserDetailPage />) },
          { path: 'exams', element: page(<AdminExamsPage />) },
          { path: 'certificates', element: page(<AdminCertificatesPage />) },
          { path: 'verifications', element: page(<AdminVerificationsPage />) },
          { path: 'teacher-applications', element: page(<TeacherApplicationsAdminPage />) },
          { path: 'teacher-applications/:applicationId', element: page(<TeacherApplicationAdminDetailPage />) },
          { path: 'institutions', element: page(<InstitutionApplicationsPage />) },
          { path: 'courses', element: page(usesApi ? <CourseModerationPage titleKey="adminPanel.coursesTitle" subtitleKey="adminPanel.coursesSubtitle" /> : <TeacherCoursesListPage />) },
          { path: 'categories', element: page(<AdminCategoriesPage />) },
          { path: 'learning-paths', element: page(<AdminLearningPathsPage />) },
          { path: 'lti-tools', element: page(<AdminLtiToolsPage />) },
          { path: 'transactions', element: page(<AdminTransactionsPage />) },
          { path: 'payouts', element: page(<AdminPayoutsPage />) },
          { path: 'offline-payments', element: page(<AdminOfflinePaymentsPage />) },
          { path: 'moderation', element: page(<ModeratorQueuePage />) },
          { path: 'reports', element: page(<ContentReportsPage />) },
          { path: 'support', element: page(<AdminSupportPage />) },
          { path: 'audit-logs', element: page(usesApi ? <AdminAuditLogsPage /> : <AdminDashboardPage />) },
          { path: 'settings', element: page(<AdminSettingsPage />) },
        ],
      },
    ],
  },

  // Back office: moderation (same sidebar, moderator menu)
  {
    path: '/moderator',
    element: <ProtectedRoute allowedRoles={['moderator', 'admin']} />,
    children: [
      {
        element: <ModeratorLayout />,
        children: [
          { path: 'dashboard', element: page(<ModeratorQueuePage />) },
          { path: 'courses', element: page(<CourseModerationPage />) },
          { path: 'forum', element: page(<ModeratorQueuePage filter="forum" />) },
          { path: 'reviews', element: page(<ModeratorQueuePage filter="reviews" />) },
          { path: 'reports', element: page(<ContentReportsPage />) },
          { path: 'history', element: page(<ModerationHistoryPage />) },
          { path: 'rules', element: page(<TermsPage />) },
        ],
      },
    ],
  },

  // System & errors
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/500', element: <ServerErrorPage /> },
  { path: '/maintenance', element: <MaintenancePage /> },
  { path: '/offline', element: <NetworkOfflinePage /> },
  { path: '*', element: <NotFoundPage /> },
]);
