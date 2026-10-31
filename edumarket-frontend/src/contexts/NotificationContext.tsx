import React, { createContext, useContext, useEffect, useState } from 'react';
import { Notification } from '../types';
import { mockNotifications } from '../mocks/mockData';
import { notificationService } from '../services/notificationService';
import { usesApi } from '../services/apiClient';
import { useAuth } from './AuthContext';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isReady } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>(usesApi ? [] : [...mockNotifications]);

  useEffect(() => {
    let current = true;
    if (!usesApi) return () => { current = false; };
    if (!isReady || !user) { setNotifications([]); return () => { current = false; }; }
    let requestVersion = 0;
    let fallbackTimer: number | undefined;
    const refresh = async () => {
      const version = ++requestVersion;
      try {
        const result = await notificationService.list();
        if (!current || version !== requestVersion) return;
        setNotifications(previous => {
          const alreadyRead = new Set(previous.filter(item => item.read).map(item => item.id));
          return result.data.map(item => alreadyRead.has(item.id) ? { ...item, read: true } : item);
        });
      } catch { if (current && version === requestVersion) setNotifications([]); }
    };
    void refresh();
    const eventSource = notificationService.connectToEvents(() => { void refresh(); });
    eventSource.onerror = () => {
      eventSource.close();
      if (current && fallbackTimer === undefined) fallbackTimer = window.setInterval(() => void refresh(), 15_000);
    };
    return () => { current = false; eventSource.close(); if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer); };
  }, [user?.id, isReady]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    if (usesApi) void notificationService.markRead(id).then(() => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))).catch(() => undefined);
    else
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    if (usesApi) void notificationService.markAllRead().then(() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))).catch(() => undefined);
    else setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const addNotification = (item: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    if (usesApi) return;
    const newNotif: Notification = {
      ...item,
      id: `notif_${Date.now()}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
