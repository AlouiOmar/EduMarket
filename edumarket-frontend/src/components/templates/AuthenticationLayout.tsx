import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { LanguageSwitcher } from '../atoms/LanguageSwitcher';

export const AuthenticationLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 text-slate-900">
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 bg-white">
        <Link to="/" className="flex items-center gap-2 text-indigo-950 font-extrabold text-lg">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
            <GraduationCap className="w-4 h-4" />
          </div>
          <span>EduMarket</span>
        </Link>
        <LanguageSwitcher variant="select" />
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          {children || <Outlet />}
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-slate-600 border-t border-slate-200 bg-white">
        &copy; {new Date().getFullYear()} EduMarket LMS · Tous droits réservés
      </footer>
    </div>
  );
};
