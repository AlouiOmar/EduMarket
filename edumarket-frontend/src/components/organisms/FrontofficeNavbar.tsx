import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  ShoppingCart, 
  Menu, 
  X, 
  GraduationCap, 
  Bell, 
  LogOut, 
  User as UserIcon, 
  ShieldCheck, 
  ChevronDown 
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useCart } from '../../contexts/CartContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { LanguageSwitcher } from '../atoms/LanguageSwitcher';
import { Button } from '../atoms/Button';
import { Avatar } from '../atoms/Avatar';
import { UserRole } from '../../types';
import { usesApi } from '../../services/apiClient';

export const FrontofficeNavbar: React.FC = () => {
  const { t } = useTranslation();
  const { user, role, switchRole, logout, isAuthenticated } = useAuth();
  const { items } = useCart();
  const { unreadCount } = useNotifications();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const navigate = useNavigate();

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as UserRole;
    switchRole(newRole);
    if (newRole === 'admin') navigate('/admin/dashboard');
    else if (newRole === 'moderator') navigate('/moderator/dashboard');
    else if (newRole === 'student') navigate('/student/dashboard');
    else if (newRole === 'teacher') navigate('/teacher/dashboard');
    else if (newRole === 'unverified_teacher') navigate('/teacher/application');
    else if (newRole === 'institution') navigate('/institution/dashboard');
    else if (newRole === 'visitor') navigate('/');
  };

  // Dynamic links according to user role in Frontoffice
  const getNavLinks = () => {
    switch (role) {
      case 'student':
        return [
          { to: '/courses', label: t('nav.catalog') },
          { to: '/student/courses', label: t('nav.myCourses') },
          { to: '/student/sessions', label: t('nav.sessions') },
          { to: '/messages', label: t('nav.messages') },
          { to: '/notifications', label: t('nav.notifications') },
          { to: '/profile', label: t('nav.profile') },
        ];
      case 'teacher':
      case 'unverified_teacher':
        return [
          { to: '/courses', label: t('nav.catalog') },
          { to: '/teacher/courses', label: t('nav.myCourses') },
          { to: '/teacher/courses/create', label: t('nav.pedagogicalManagement') },
          { to: '/teacher/tutoring', label: t('nav.sessions') },
          { to: '/messages', label: t('nav.messages') },
          { to: '/notifications', label: t('nav.notifications') },
          { to: '/profile', label: t('nav.profile') },
        ];
      case 'institution':
        return [
          { to: '/courses', label: t('nav.catalog') },
          { to: '/institution/courses', label: t('nav.myTrainings') },
          { to: '/institution/teachers', label: t('nav.teachers') },
          { to: '/institution/analytics', label: t('nav.statistics') },
          { to: '/profile', label: t('nav.profile') },
        ];
      case 'admin':
      case 'moderator':
        return [
          { to: '/courses', label: t('nav.catalog') },
          { to: '/certifications', label: t('nav.certifications') },
          { to: '/sessions', label: t('nav.sessions') },
          { to: '/forum', label: t('nav.forum') },
          { to: '/pricing', label: t('nav.pricing') },
        ];
      case 'visitor':
      default:
        return [
          { to: '/courses', label: t('nav.catalog') },
          { to: '/certifications', label: t('nav.certifications') },
          { to: '/sessions', label: t('nav.sessions') },
          { to: '/forum', label: t('nav.forum') },
          { to: '/pricing', label: t('nav.pricing') },
        ];
    }
  };

  const navLinks = getNavLinks();

  const getDashboardPath = () => {
    switch (role) {
      case 'student':
        return '/student/dashboard';
      case 'teacher':
        return '/teacher/dashboard';
      case 'unverified_teacher':
        return '/teacher/application';
      case 'institution':
        return '/institution/dashboard';
      case 'admin':
        return '/admin/dashboard';
      case 'moderator':
        return '/moderator/dashboard';
      default:
        return '/student/dashboard';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Horizontal Navigation: 3 zones, single line */}
        <div className="flex items-center justify-between h-16 gap-4 lg:gap-8">
          
          {/* Zone 1: Brand wordmark */}
          <Link to="/" className="flex items-center gap-2.5 text-indigo-950 font-extrabold text-xl tracking-tight whitespace-nowrap shrink-0 hover:text-indigo-600 transition-colors">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <span>EduMarket</span>
          </Link>

          {/* Zone 2: Navigation Links (Frontoffice Horizontal Bar) */}
          <nav className="hidden lg:flex items-center gap-5 xl:gap-6 text-sm font-medium text-slate-600">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `transition-colors whitespace-nowrap shrink-0 hover:text-indigo-600 ${
                    isActive ? 'text-indigo-600 font-bold' : ''
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}

            {/* Direct Switch to Backoffice if Admin or Moderator */}
            {(role === 'admin' || role === 'moderator') && (
              <Link
                to={role === 'admin' ? '/admin/dashboard' : '/moderator/dashboard'}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>{role === 'admin' ? t('workspace.backoffice.adminConsole') : t('workspace.backoffice.moderationSpace')}</span>
              </Link>
            )}
          </nav>

          {/* Zone 3: Actions (Role switcher, Language, Cart, Notifications, Auth/Profile) */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            
            {/* Demo role quick switcher */}
            {!usesApi && <div className="hidden sm:flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1 text-xs">
              <span className="text-slate-500 font-medium">Rôle:</span>
              <select
                value={role}
                onChange={handleRoleChange}
                aria-label={t('chromeUi.switchDemoRole')}
                className="bg-transparent font-semibold text-slate-800 cursor-pointer focus:outline-none"
              >
                <option value="visitor">Visiteur</option>
                <option value="student">Étudiant</option>
                <option value="teacher">Enseignant</option>
                <option value="unverified_teacher">Enseignant (En attente)</option>
                <option value="institution">Institution</option>
                <option value="admin">Administrateur</option>
                <option value="moderator">Modérateur</option>
              </select>
            </div>}

            <LanguageSwitcher variant="select" />

            {/* Cart Icon */}
            <Link
              to="/cart"
              aria-label={t('chromeUi.viewCart')}
              className="relative p-2 text-slate-600 hover:text-indigo-600 transition-colors rounded-lg hover:bg-slate-100"
            >
              <ShoppingCart className="w-5 h-5" />
              {items.length > 0 && (
                <span className="absolute top-1 end-1 bg-indigo-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center tabular-nums">
                  {items.length}
                </span>
              )}
            </Link>

            {/* Notifications Icon if authenticated */}
            {isAuthenticated && (
              <Link
                to="/notifications"
                aria-label={t('chromeUi.notificationCenter')}
                className="relative p-2 text-slate-600 hover:text-indigo-600 transition-colors rounded-lg hover:bg-slate-100"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 end-1.5 w-2 h-2 bg-rose-500 rounded-full" />
                )}
              </Link>
            )}

            {/* User Account Button / Dropdown */}
            {isAuthenticated && user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                  aria-expanded={userDropdownOpen}
                >
                  <Avatar src={user.avatar} alt={user.name} size="sm" />
                  <span className="hidden md:inline text-xs font-semibold text-slate-800 max-w-[120px] truncate">
                    {user.name}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {userDropdownOpen && (
                  <div 
                    className="absolute end-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-50 animate-in fade-in zoom-in-95"
                    onClick={() => setUserDropdownOpen(false)}
                  >
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-900 truncate">{user.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                      <span className="inline-block mt-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                        {t(`common.roles.${user.role}`)}
                      </span>
                    </div>

                    <Link
                      to={getDashboardPath()}
                      className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-indigo-600 font-medium"
                    >
                      {t('nav.dashboard')}
                    </Link>

                    {role === 'student' && (
                      <>
                        <Link to="/student/courses" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('nav.myCourses')}
                        </Link>
                        <Link to="/student/certificates" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('nav.certifications')}
                        </Link>
                        <Link to="/student/orders" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.student.orders')}
                        </Link>
                      </>
                    )}

                    {role === 'teacher' && (
                      <>
                        <Link to="/teacher/courses" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.teacher.courses')}
                        </Link>
                        <Link to="/teacher/tutoring" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.teacher.tutoring')}
                        </Link>
                        <Link to="/teacher/revenue" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.teacher.revenue')}
                        </Link>
                      </>
                    )}

                    {role === 'institution' && (
                      <>
                        <Link to="/institution/courses" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.institution.courses')}
                        </Link>
                        <Link to="/institution/teachers" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.institution.teachers')}
                        </Link>
                        <Link to="/institution/finances" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                          {t('workspace.institution.finances')}
                        </Link>
                      </>
                    )}

                    {(role === 'admin' || role === 'moderator') && (
                      <Link
                        to={role === 'admin' ? '/admin/dashboard' : '/moderator/dashboard'}
                        className="block px-4 py-2 text-xs font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-50"
                      >
                        {role === 'admin' ? t('workspace.backoffice.adminConsole') : t('workspace.backoffice.moderationSpace')}
                      </Link>
                    )}

                    {role !== 'moderator' && role !== 'unverified_teacher' && (
                      <Link to="/calendar" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                        {t('workspace.student.calendar')}
                      </Link>
                    )}
                    <Link to="/support" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                      {t('workspace.student.support')}
                    </Link>

                    <Link to="/profile" className="block px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                      {t('nav.profile')} & Sécurité
                    </Link>

                    <div className="border-t border-slate-100 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        navigate('/');
                      }}
                      className="w-full text-start px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{t('nav.logout')}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/auth/login')}>
                  {t('nav.login')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => navigate('/auth/register')}>
                  {t('nav.register')}
                </Button>
              </div>
            )}

            {/* Mobile menu hamburger button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t('chromeUi.mobileMenu')}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-4 border-t border-slate-200 flex flex-col gap-2 animate-in fade-in">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-600 rounded-lg"
              >
                {link.label}
              </Link>
            ))}

            {(role === 'admin' || role === 'moderator') && (
              <Link
                to={role === 'admin' ? '/admin/dashboard' : '/moderator/dashboard'}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 text-sm font-bold text-indigo-600 bg-indigo-50 rounded-lg"
              >
                {t('chromeUi.openBackoffice')}
              </Link>
            )}

            {isAuthenticated && (
              <Link
                to={getDashboardPath()}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 text-sm font-semibold text-slate-900 bg-slate-50 rounded-lg"
              >
                {t('nav.dashboard')}
              </Link>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
