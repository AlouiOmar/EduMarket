import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, Trash2, BookOpen, Calendar, Award, DollarSign, MessageSquare } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { notificationText } from '../../utils/notificationText';
import { formatDateTime } from '../../utils/format';

export const NotificationsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { notifications, markAsRead, markAllAsRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'course':
        return <BookOpen className="w-4 h-4 text-indigo-600" />;
      case 'session':
        return <Calendar className="w-4 h-4 text-emerald-600" />;
      case 'certificate':
        return <Award className="w-4 h-4 text-amber-600" />;
      case 'purchase':
        return <DollarSign className="w-4 h-4 text-blue-600" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('nav.notifications')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('sharedUi.notificationsSubtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={markAllAsRead} leftIcon={<CheckCheck className="w-4 h-4" />}>
            {t('sharedUi.markAllRead')}
          </Button>
        </div>
      </div>

      <div className="flex border-b border-slate-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setFilter('all')}
          className={`pb-3 border-b-2 transition-colors ${filter === 'all' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('sharedUi.all', { count: notifications.length })}
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`pb-3 border-b-2 transition-colors ${filter === 'unread' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}
        >
          {t('sharedUi.unread', { count: notifications.filter(n => !n.read).length })}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            {t('sharedUi.empty')}
          </div>
        ) : (
          filtered.map(notif => (
            <div
              key={notif.id}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                !notif.read ? 'bg-indigo-50/40' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-100 rounded-lg shrink-0 mt-0.5">
                  {getTypeIcon(notif.type)}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">{notificationText(t, i18n, notif).title}</h4>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{notificationText(t, i18n, notif).message}</p>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {formatDateTime(notif.timestamp, i18n.language)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!notif.read && (
                  <button
                    onClick={() => markAsRead(notif.id)}
                    className="text-xs text-indigo-600 hover:underline font-semibold"
                  >
                    {t('sharedUi.markRead')}
                  </button>
                )}
                {notif.link && (
                  <Link to={notif.link}>
                    <Button variant="outline" size="sm">
                      Voir
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
