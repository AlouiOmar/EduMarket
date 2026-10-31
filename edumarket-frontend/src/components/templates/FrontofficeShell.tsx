import React from 'react';
import { Outlet } from 'react-router-dom';
import { FrontofficeNavbar } from '../organisms/FrontofficeNavbar';
import { PublicFooter } from '../organisms/PublicFooter';

export interface FrontofficeShellProps {
  children?: React.ReactNode;
  subnav?: React.ReactNode;
}

export const FrontofficeShell: React.FC<FrontofficeShellProps> = ({ children, subnav }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-indigo-500 selection:text-white">
      {/* Frontoffice Horizontal Navbar */}
      <FrontofficeNavbar />

      {/* Optional contextual subnav / horizontal sub-tabs for Dashboards */}
      {subnav && (
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {subnav}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {children || <Outlet />}
      </main>

      {/* Frontoffice Footer */}
      <PublicFooter />
    </div>
  );
};
