import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({
  options,
  hasError = false,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        disabled={disabled}
        className={`w-full appearance-none rounded-lg border bg-white px-3.5 pe-10 py-2 text-sm text-slate-900 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed ${
          hasError
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
        } ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 end-0 flex items-center pe-3 pointer-events-none text-slate-400">
        <ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
});

Select.displayName = 'Select';
