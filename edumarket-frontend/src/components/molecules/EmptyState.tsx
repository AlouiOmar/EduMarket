import React from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { Button } from '../atoms/Button';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className = '',
}) => {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center bg-white border border-slate-200 rounded-xl ${className}`}>
      <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
        {icon || <Inbox className="w-6 h-6" />}
      </div>
      <h3 className="text-base font-semibold text-slate-800 mb-1">{title || t('common.emptyTitle')}</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-5">{description || t('common.emptyDescription')}</p>
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
