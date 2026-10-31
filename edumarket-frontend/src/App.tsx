import React, { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { router } from './router';
import { apiRequest, usesApi } from './services/apiClient';
import { useAuth } from './contexts/AuthContext';
import { MaintenancePage } from './pages/shared/ErrorPages';
import './i18n';

function PlatformMaintenanceBoundary({ children }: { children: React.ReactNode }) {
  const { role, isReady } = useAuth();
  const [maintenance, setMaintenance] = useState(false);
  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    const refresh = () => apiRequest<{ data: { maintenanceMode: boolean } }>('/platform/status')
      .then(result => { if (active) setMaintenance(result.data.maintenanceMode); })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (usesApi && isReady && maintenance && role !== 'admin') return <MaintenancePage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <NotificationProvider>
          <PlatformMaintenanceBoundary><RouterProvider router={router} /></PlatformMaintenanceBoundary>
        </NotificationProvider>
      </CartProvider>
    </AuthProvider>
  );
}
