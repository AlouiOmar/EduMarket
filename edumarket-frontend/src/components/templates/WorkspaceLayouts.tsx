import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FrontofficeShell } from './FrontofficeShell';
import { BackofficeShell } from './BackofficeShell';
import { frontofficeSubnav, type NavItem } from '../../router/navigation';

interface LayoutProps {
  children?: React.ReactNode;
  title?: string;
}

const HorizontalSubnavLink: React.FC<{ item: NavItem }> = ({ item }) => {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex items-center gap-1.5 py-3 px-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
          isActive
            ? 'border-indigo-600 text-indigo-600'
            : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
        }`
      }
    >
      <span className="shrink-0">{item.icon}</span>
      <span>{t(item.labelKey)}</span>
    </NavLink>
  );
};

/** Front-office workspace: shared navbar plus a role-specific local sub-navigation from the central menu config. */
const FrontofficeWorkspace: React.FC<LayoutProps & { space: keyof typeof frontofficeSubnav }> = ({ children, space }) => (
  <FrontofficeShell subnav={(
    <nav className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1">
      {frontofficeSubnav[space].map(item => <HorizontalSubnavLink key={item.to} item={item} />)}
    </nav>
  )}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {children || <Outlet />}
    </div>
  </FrontofficeShell>
);

export const StudentLayout: React.FC<LayoutProps> = ({ children }) => <FrontofficeWorkspace space="student">{children}</FrontofficeWorkspace>;
export const TeacherLayout: React.FC<LayoutProps> = ({ children }) => <FrontofficeWorkspace space="teacher">{children}</FrontofficeWorkspace>;
export const InstitutionLayout: React.FC<LayoutProps> = ({ children }) => <FrontofficeWorkspace space="institution">{children}</FrontofficeWorkspace>;

export const AdminLayout: React.FC<LayoutProps> = ({ children, title }) => {
  const { t } = useTranslation();
  return <BackofficeShell title={title || t('workspace.backoffice.adminConsole')}>{children || <Outlet />}</BackofficeShell>;
};

export const ModeratorLayout: React.FC<LayoutProps> = ({ children, title }) => {
  const { t } = useTranslation();
  return <BackofficeShell title={title || t('workspace.backoffice.moderationSpace')}>{children || <Outlet />}</BackofficeShell>;
};
