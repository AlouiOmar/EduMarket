import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { BackofficeSidebar } from '../organisms/BackofficeSidebar';
import { BackofficeHeader } from '../organisms/BackofficeHeader';

export interface BackofficeShellProps {
  children?: React.ReactNode;
  title?: string;
}

export const BackofficeShell: React.FC<BackofficeShellProps> = ({ children, title }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      {/* Desktop Persistent Sidebar */}
      <div className="hidden lg:flex h-full shrink-0">
        <BackofficeSidebar />
      </div>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs" 
            onClick={() => setSidebarOpen(false)} 
          />
          <div className="relative z-10 w-64 h-full bg-slate-900 shadow-2xl">
            <BackofficeSidebar onCloseMobile={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Right Content Viewport */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 text-slate-900">
        <BackofficeHeader title={title} onToggleSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children || <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
};
