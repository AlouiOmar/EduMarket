import { Notification } from '../types';
import { API_BASE_URL, apiRequest, createSuccessResponse, delay, ApiResponse, usesApi } from './apiClient';
import { mockNotifications } from '../mocks/mockData';

class NotificationService {
  connectToEvents(onNotification: (id: string) => void): EventSource {
    const source = new EventSource(`${API_BASE_URL}/notifications/events`, { withCredentials: true });
    source.addEventListener('notification.created', event => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { id?: unknown };
        if (typeof payload.id === 'string') onNotification(payload.id);
      } catch { /* Ignore malformed event payloads and keep the stream open. */ }
    });
    return source;
  }

  async list(): Promise<ApiResponse<Notification[]>> {
    if (usesApi) {
      const result = await apiRequest<{ data: Notification[] }>('/notifications');
      return createSuccessResponse(result.data);
    }
    await delay(); return createSuccessResponse([...mockNotifications]);
  }
  async markRead(id: string): Promise<void> {
    if (usesApi) { await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); return; }
  }
  async markAllRead(): Promise<void> {
    if (usesApi) { await apiRequest('/notifications/read-all', { method: 'PATCH' }); return; }
  }
}
export const notificationService = new NotificationService();
