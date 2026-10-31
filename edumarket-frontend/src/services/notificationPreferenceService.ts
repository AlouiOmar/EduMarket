import { apiRequest, usesApi } from './apiClient';

export interface NotificationPreferences { sessions: boolean; messages: boolean; courseActivity: boolean; email: boolean; }
const defaults: NotificationPreferences = { sessions: true, messages: true, courseActivity: true, email: false };

export const notificationPreferenceService = {
  async get(): Promise<NotificationPreferences> {
    if (!usesApi) return defaults;
    return (await apiRequest<{ data: NotificationPreferences }>('/auth/me/preferences')).data;
  },
  async save(preferences: NotificationPreferences): Promise<NotificationPreferences> {
    return (await apiRequest<{ data: NotificationPreferences }>('/auth/me/preferences', {
      method: 'PATCH', body: JSON.stringify(preferences),
    })).data;
  },
};
