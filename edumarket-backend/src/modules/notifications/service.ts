import { Notification } from './model.js';
import { User } from '../auth/model.js';
import { publishNotificationEvent } from '../../integrations/userEvents.js';
import { sendNotificationEmail } from '../../integrations/email.js';

export interface NotificationTemplate { key: string; params?: Record<string, string | number> }

/** `options.email: false` lets a caller that tracks its own e-mail deliveries (announcements) skip the automatic copy. */
export async function createNotification(input: { userId: string; type: 'purchase' | 'subscription' | 'session' | 'course' | 'exam' | 'message' | 'certificate' | 'account' | 'system'; title: string; message: string; link?: string; template?: NotificationTemplate }, options: { email?: boolean } = {}) {
  const preferences = await User.findById(input.userId).select('email notificationPreferences').lean();
  const setting = input.type === 'session' ? 'sessions' : input.type === 'message' ? 'messages' : input.type === 'course' ? 'courseActivity' : null;
  if (setting && preferences?.notificationPreferences?.[setting] === false) return null;
  const notification = await Notification.create(input);
  publishNotificationEvent(input.userId, String(notification._id));
  if (options.email !== false && preferences?.notificationPreferences?.email && preferences.email) {
    void sendNotificationEmail({ to: preferences.email, title: input.title, message: input.message, link: input.link })
      .catch(error => console.error('Notification e-mail failed', { code: (error as { code?: string }).code }));
  }
  return notification;
}
