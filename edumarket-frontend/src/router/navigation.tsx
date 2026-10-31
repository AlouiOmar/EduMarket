import React from 'react';
import {
  Activity, Award, BookOpen, Building2, Calendar, Clock, CreditCard, DollarSign, FileCheck, Flag, FolderTree, HelpCircle,
  History, LayoutDashboard, MessageSquareQuote, School, Cloud, Banknote, Route, ScrollText, GraduationCap, LifeBuoy, PlusCircle, Receipt, Settings, ShieldAlert, ShieldCheck, UserCheck, Users, Wallet, Plug } from 'lucide-react';
import type { UserRole } from '../types';

/**
 * Single source of truth for workspace menus. Front-office roles keep the shared navbar and get a local
 * horizontal sub-navigation; back-office roles share one sidebar filtered by role.
 */
export interface NavItem { to: string; labelKey: string; icon: React.ReactNode; roles?: UserRole[]; end?: boolean }
const icon = (Component: React.ComponentType<{ className?: string }>, size = 'w-3.5 h-3.5') => <Component className={size} />;

export const frontofficeSubnav: Record<'student' | 'teacher' | 'institution', NavItem[]> = {
  student: [
    { to: '/student/dashboard', labelKey: 'workspace.student.dashboard', icon: icon(LayoutDashboard) },
    { to: '/student/courses', labelKey: 'workspace.student.courses', icon: icon(BookOpen) },
    { to: '/student/learning-paths', labelKey: 'workspace.student.paths', icon: icon(Route) },
    { to: '/student/classes', labelKey: 'workspace.student.classes', icon: icon(School) },
    { to: '/student/certificates', labelKey: 'workspace.student.certificates', icon: icon(Award) },
    { to: '/student/exams', labelKey: 'workspace.student.exams', icon: icon(FileCheck) },
    { to: '/student/sessions', labelKey: 'workspace.student.sessions', icon: icon(Calendar) },
    { to: '/student/assignments', labelKey: 'workspace.student.assignments', icon: icon(FileCheck) },
    { to: '/student/calendar', labelKey: 'workspace.student.calendar', icon: icon(Calendar) },
    { to: '/student/orders', labelKey: 'workspace.student.orders', icon: icon(CreditCard) },
    { to: '/student/subscription', labelKey: 'workspace.student.subscription', icon: icon(Receipt) },
    { to: '/student/history', labelKey: 'workspace.student.history', icon: icon(Clock) },
    { to: '/student/support', labelKey: 'workspace.student.support', icon: icon(LifeBuoy) },
  ],
  teacher: [
    { to: '/teacher/dashboard', labelKey: 'workspace.teacher.dashboard', icon: icon(LayoutDashboard) },
    { to: '/teacher/courses', labelKey: 'workspace.teacher.courses', icon: icon(BookOpen), end: true },
    { to: '/teacher/courses/create', labelKey: 'workspace.teacher.createCourse', icon: icon(PlusCircle) },
    { to: '/teacher/students', labelKey: 'workspace.teacher.students', icon: icon(GraduationCap) },
    { to: '/teacher/reviews', labelKey: 'workspace.teacher.reviews', icon: icon(MessageSquareQuote) },
    { to: '/teacher/classes', labelKey: 'workspace.teacher.classes', icon: icon(School) },
    { to: '/teacher/storage', labelKey: 'workspace.teacher.storage', icon: icon(Cloud) },
    { to: '/teacher/assignments', labelKey: 'workspace.teacher.assignments', icon: icon(FileCheck) },
    { to: '/teacher/tutoring', labelKey: 'workspace.teacher.tutoring', icon: icon(Calendar) },
    { to: '/teacher/calendar', labelKey: 'workspace.teacher.calendar', icon: icon(Calendar) },
    { to: '/teacher/revenue', labelKey: 'workspace.teacher.revenue', icon: icon(DollarSign) },
    { to: '/teacher/application', labelKey: 'workspace.teacher.verification', icon: icon(UserCheck) },
    { to: '/teacher/affiliations', labelKey: 'workspace.teacher.affiliations', icon: icon(Users) },
  ],
  institution: [
    { to: '/institution/dashboard', labelKey: 'workspace.institution.overview', icon: icon(LayoutDashboard) },
    { to: '/institution/courses', labelKey: 'workspace.institution.courses', icon: icon(BookOpen) },
    { to: '/institution/teachers', labelKey: 'workspace.institution.teachers', icon: icon(Users) },
    { to: '/institution/students', labelKey: 'workspace.institution.students', icon: icon(Users) },
    { to: '/institution/reviews', labelKey: 'workspace.institution.reviews', icon: icon(MessageSquareQuote) },
    { to: '/institution/classes', labelKey: 'workspace.institution.classes', icon: icon(School) },
    { to: '/institution/storage', labelKey: 'workspace.institution.storage', icon: icon(Cloud) },
    { to: '/institution/exams', labelKey: 'workspace.institution.exams', icon: icon(FileCheck) },
    { to: '/institution/analytics', labelKey: 'workspace.institution.analytics', icon: icon(Activity) },
    { to: '/institution/finances', labelKey: 'workspace.institution.finances', icon: icon(Wallet) },
  ],
};

const sidebarIcon = (Component: React.ComponentType<{ className?: string }>) => icon(Component, 'w-4 h-4');
const ADMIN: UserRole[] = ['admin'];
const MODERATOR: UserRole[] = ['moderator'];

export const backofficeNav: NavItem[] = [
  { to: '/admin/dashboard', labelKey: 'workspace.backoffice.dashboard', icon: sidebarIcon(LayoutDashboard), roles: ADMIN },
  { to: '/admin/users', labelKey: 'workspace.backoffice.users', icon: sidebarIcon(Users), roles: ADMIN },
  { to: '/admin/teacher-applications', labelKey: 'teacherApplication.admin.nav', icon: sidebarIcon(UserCheck), roles: ADMIN },
  { to: '/admin/verifications', labelKey: 'workspace.backoffice.verifications', icon: sidebarIcon(UserCheck), roles: ADMIN },
  { to: '/admin/institutions', labelKey: 'workspace.backoffice.institutions', icon: sidebarIcon(Building2), roles: ADMIN },
  { to: '/admin/courses', labelKey: 'workspace.backoffice.courses', icon: sidebarIcon(BookOpen), roles: ADMIN },
  { to: '/admin/categories', labelKey: 'workspace.backoffice.categories', icon: sidebarIcon(FolderTree), roles: ADMIN },
  { to: '/admin/learning-paths', labelKey: 'workspace.backoffice.learningPaths', icon: sidebarIcon(Route), roles: ADMIN },
  { to: '/admin/lti-tools', labelKey: 'integrationUi.adminLtiNav', icon: sidebarIcon(Plug), roles: ADMIN },
  { to: '/admin/exams', labelKey: 'workspace.backoffice.exams', icon: sidebarIcon(GraduationCap), roles: ADMIN },
  { to: '/admin/certificates', labelKey: 'workspace.backoffice.certificates', icon: sidebarIcon(ScrollText), roles: ADMIN },
  { to: '/admin/transactions', labelKey: 'workspace.backoffice.transactions', icon: sidebarIcon(DollarSign), roles: ADMIN },
  { to: '/admin/payouts', labelKey: 'workspace.backoffice.payouts', icon: sidebarIcon(Wallet), roles: ADMIN },
  { to: '/admin/offline-payments', labelKey: 'workspace.backoffice.offlinePayments', icon: sidebarIcon(Banknote), roles: ADMIN },
  { to: '/admin/moderation', labelKey: 'workspace.backoffice.moderation', icon: sidebarIcon(Flag), roles: ADMIN },
  { to: '/admin/reports', labelKey: 'workspace.backoffice.reports', icon: sidebarIcon(ShieldAlert), roles: ADMIN },
  { to: '/admin/support', labelKey: 'workspace.backoffice.support', icon: sidebarIcon(LifeBuoy), roles: ADMIN },
  { to: '/admin/audit-logs', labelKey: 'workspace.backoffice.auditLogs', icon: sidebarIcon(Clock), roles: ADMIN },
  { to: '/admin/settings', labelKey: 'workspace.backoffice.settings', icon: sidebarIcon(Settings), roles: ADMIN },
  { to: '/moderator/dashboard', labelKey: 'workspace.backoffice.modDashboard', icon: sidebarIcon(LayoutDashboard), roles: MODERATOR },
  { to: '/moderator/courses', labelKey: 'workspace.backoffice.modCourses', icon: sidebarIcon(BookOpen), roles: MODERATOR },
  { to: '/moderator/forum', labelKey: 'workspace.backoffice.modForum', icon: sidebarIcon(HelpCircle), roles: MODERATOR },
  { to: '/moderator/reviews', labelKey: 'workspace.backoffice.modReviews', icon: sidebarIcon(Award), roles: MODERATOR },
  { to: '/moderator/reports', labelKey: 'workspace.backoffice.modReports', icon: sidebarIcon(ShieldAlert), roles: MODERATOR },
  { to: '/moderator/history', labelKey: 'workspace.backoffice.modHistory', icon: sidebarIcon(History), roles: MODERATOR },
  { to: '/moderator/rules', labelKey: 'workspace.backoffice.rules', icon: sidebarIcon(ShieldCheck), roles: MODERATOR },
];

export const navForRole = (items: NavItem[], role: UserRole) => items.filter(item => !item.roles || item.roles.includes(role));
