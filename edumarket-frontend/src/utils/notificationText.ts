import type { TFunction, i18n as I18n } from 'i18next';
import type { Notification } from '../types';
import { formatDate } from './format';

/**
 * Localized title/message for a notification. The API sends a template key + params; the stored English
 * title/message are used when the key is unknown (older notifications, mock data).
 */
export function notificationText(t: TFunction, i18n: I18n, notification: Notification) {
  const key = notification.template?.key;
  if (!key || !i18n.exists(`notificationTemplates.${key}.title`)) return { title: notification.title, message: notification.message };
  const params: Record<string, string | number> = { ...(notification.template?.params || {}) };
  if (typeof params.date === 'string') params.date = formatDate(params.date, i18n.language);
  return {
    title: t(`notificationTemplates.${key}.title`, params),
    message: i18n.exists(`notificationTemplates.${key}.message`) ? t(`notificationTemplates.${key}.message`, params) : notification.message,
  };
}
