import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { backofficeNav, navForRole } from '../../router/navigation';

export interface BackofficeSidebarProps {
  onCloseMobile?: () => void;
}

/** Single back-office sidebar shared by administrators and moderators; entries come from the central menu config. */
export const BackofficeSidebar: React.FC<BackofficeSidebarProps> = ({ onCloseMobile }) => {
  const { t } = useTranslation();
  const { role } = useAuth();
  const isModerator = role === 'moderator';
  const links = navForRole(backofficeNav, role).map(item => ({ ...item, label: t(item.labelKey), badge: undefined as string | undefined }));

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-full shrink-0 select-none border-e border-slate-800">
      {/* Brand & Area Title */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 text-white font-extrabold text-base">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="block leading-none">EduMarket</span>
            <span className="text-[10px] font-normal text-slate-400">
              {isModerator ? t('workspace.backoffice.moderationSpace') : t('workspace.backoffice.adminConsole')}
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onCloseMobile}
            className={({ isActive }) =>
              `flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <div className="flex items-center gap-3">
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </div>
            {item.badge && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-500/30 text-indigo-300 font-bold tabular-nums">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer link to Frontoffice */}
      <div className="p-3 border-t border-slate-800">
        <Link
          to="/"
          onClick={onCloseMobile}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 rtl-flip" />
          <span>{t('workspace.backoffice.backToFrontoffice')}</span>
        </Link>
      </div>
    </aside>
  );
};
