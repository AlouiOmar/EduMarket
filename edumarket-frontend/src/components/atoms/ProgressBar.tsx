import React from 'react';
import { useTranslation } from 'react-i18next';

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
          <span className="tabular-nums font-bold">{Math.round(clamped)}%</span>
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
