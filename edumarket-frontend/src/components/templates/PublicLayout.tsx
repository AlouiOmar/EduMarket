import React from 'react';
import { Outlet } from 'react-router-dom';
import { FrontofficeShell } from './FrontofficeShell';

export const PublicLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <FrontofficeShell>
      {children || <Outlet />}
    </FrontofficeShell>
  );
};
