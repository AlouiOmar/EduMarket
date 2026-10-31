import React from 'react';

export interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  hint?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  change,
  trend = 'neutral',
  icon,
  hint,
}) => {
  const trendClasses = {
    up: 'text-emerald-600 bg-emerald-50',
    down: 'text-rose-600 bg-rose-50',
    neutral: 'text-slate-600 bg-slate-100',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold text-slate-900 tabular-nums">
          {value}
        </div>
        {change && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${trendClasses[trend]}`}>
            {change}
          </span>
        )}
      </div>
      {hint && (
        <span className="text-xs text-slate-400 mt-2">
          {hint}
        </span>
      )}
    </div>
  );
};
