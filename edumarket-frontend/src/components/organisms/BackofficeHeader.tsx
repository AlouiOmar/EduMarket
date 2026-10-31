import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, LogOut, Bell, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { LanguageSwitcher } from '../atoms/LanguageSwitcher';
import { Avatar } from '../atoms/Avatar';
import { UserRole } from '../../types';
import { usesApi } from '../../services/apiClient';

export interface BackofficeHeaderProps {
  onToggleSidebar?: () => void;
  title?: string;
}

export const BackofficeHeader: React.FC<BackofficeHeaderProps> = ({ onToggleSidebar, title }) => {
  const { t } = useTranslation();
  const { user, role, switchRole, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as UserRole;
    switchRole(newRole);
    if (newRole === 'student') navigate('/student/dashboard');
    else if (newRole === 'teacher') navigate('/teacher/dashboard');
    else if (newRole === 'unverified_teacher') navigate('/teacher/application');
    else if (newRole === 'institution') navigate('/institution/dashboard');
    else if (newRole === 'moderator') navigate('/moderator/dashboard');
    else if (newRole === 'admin') navigate('/admin/dashboard');
    else if (newRole === 'visitor') navigate('/');
  };

  return (
    <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-white h-16 flex items-center justify-between px-4 sm:px-6 shrink-0">
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            aria-label={t('chromeUi.toggleSidebar')}
            className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        {title && (
          <h1 className="text-base sm:text-lg font-bold text-white truncate">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Quick Backoffice / Frontoffice Link */}
        <Link
          to="/"
          className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>{t('chromeUi.viewFrontoffice')}</span>
        </Link>

        {/* Quick Demo Role Switcher */}
        {!usesApi && <div className="hidden sm:flex items-center gap-1.5 bg-slate-800 rounded-lg px-2.5 py-1 text-xs">
          <span className="text-slate-400 font-medium">Rôle:</span>
          <select
            value={role}
            onChange={handleRoleChange}
            aria-label={t('chromeUi.switchDemoRole')}
            className="bg-transparent font-semibold text-white cursor-pointer focus:outline-none"
          >
            <option value="admin" className="text-slate-900">Administrateur (Backoffice)</option>
            <option value="moderator" className="text-slate-900">Modérateur (Backoffice)</option>
            <option value="student" className="text-slate-900">Étudiant (Frontoffice)</option>
            <option value="teacher" className="text-slate-900">Enseignant (Frontoffice)</option>
            <option value="unverified_teacher" className="text-slate-900">Enseignant en attente (Frontoffice)</option>
            <option value="institution" className="text-slate-900">Institution (Frontoffice)</option>
            <option value="visitor" className="text-slate-900">Visiteur (Frontoffice)</option>
          </select>
        </div>}

        <LanguageSwitcher variant="select" />

        {/* Notifications Icon */}
        <Link
          to="/notifications"
          aria-label={t('chromeUi.notificationCenter')}
          className="relative p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 end-1.5 w-2 h-2 bg-rose-500 rounded-full" />
          )}
        </Link>

        {/* User Identity */}
        {user && (
          <div className="flex items-center gap-2 ps-2 border-s border-slate-800">
            <Avatar src={user.avatar} alt={user.name} size="sm" />
            <div className="hidden sm:flex flex-col text-start">
              <span className="text-xs font-semibold text-white leading-tight">
                {user.name}
              </span>
              <span className="text-[11px] text-slate-400 capitalize">
                {t(`common.roles.${user.role}`)}
              </span>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/auth/login');
              }}
              aria-label={t('nav.logout')}
              className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors rounded-lg"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
