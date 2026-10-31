import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size = 'md',
  className = '',
}) => {
  const sizeMap = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-10 h-10',
  };
  return <Loader2 className={`animate-spin text-indigo-600 ${sizeMap[size]} ${className}`} />;
};

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => {
  return <div className={`animate-pulse bg-slate-200 rounded-md ${className}`} />;
};

export const Divider: React.FC<{ label?: string; className?: string }> = ({ label, className = '' }) => {
  if (label) {
    return (
      <div className={`relative flex py-3 items-center ${className}`}>
        <div className="flex-grow border-t border-slate-200"></div>
        <span className="flex-shrink mx-4 text-xs uppercase tracking-wider text-slate-400 font-medium">
          {label}
        </span>
        <div className="flex-grow border-t border-slate-200"></div>
      </div>
    );
  }
  return <hr className={`border-slate-200 my-4 ${className}`} />;
};

export const ProgressBar: React.FC<{ percent: number; className?: string; showLabel?: boolean }> = ({
  percent,
  className = '',
  showLabel = false,
}) => {
  const { t } = useTranslation();
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center text-xs font-medium text-slate-600 mb-1.5">
          <span>{t('chromeUi.progress')}</span>
          <span className="tabular-nums">{Math.round(clamped)}%</span>
        </div>
      )}
      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

export const StatusIndicator: React.FC<{ status: 'active' | 'pending' | 'suspended' | 'completed' }> = ({ status }) => {
  const colorMap = {
    active: 'bg-emerald-500',
    pending: 'bg-amber-500',
    suspended: 'bg-rose-500',
    completed: 'bg-indigo-500',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colorMap[status]}`} />;
};
