import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import { AccountStatusPage } from '../pages/auth/AuthPages';
import { ForbiddenPage } from '../pages/shared/ErrorPages';

export interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  requireAuth?: boolean;
  requireVerifiedTeacher?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  allowedRoles,
  requireAuth = true,
  requireVerifiedTeacher = false,
}) => {
  const { user, role, isAuthenticated, isReady } = useAuth();
  const location = useLocation();

  if (!isReady) return <div className="min-h-screen grid place-items-center text-slate-500" role="status">Loading…</div>;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  }

  if (user?.status === 'suspended') {
    return <AccountStatusPage type="suspended" />;
  }

  if (requireVerifiedTeacher && (role === 'unverified_teacher' || (role === 'teacher' && !user?.verified))) return <AccountStatusPage type="pending" />;

  if (user?.status === 'pending' && role === 'unverified_teacher') {
    // Unverified teachers can still access their verification panel
    // but blocked from verified teacher features if not allowed
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const hasRole = allowedRoles.includes(role);
    if (!hasRole) {
      return <ForbiddenPage />;
    }
  }

  return <Outlet />;
};
