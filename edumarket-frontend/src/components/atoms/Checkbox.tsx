import React from 'react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({
  label,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <label className={`inline-flex items-center gap-2.5 cursor-pointer text-sm text-slate-700 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className={`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 transition-colors ${className}`}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
});

Checkbox.displayName = 'Checkbox';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(({
  label,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <label className={`inline-flex items-center gap-2.5 cursor-pointer text-sm text-slate-700 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input
        ref={ref}
        type="radio"
        disabled={disabled}
        className={`w-4 h-4 border-slate-300 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 transition-colors ${className}`}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
});

Radio.displayName = 'Radio';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled = false }) => {
  return (
    <label className={`inline-flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6 [dir="rtl"]:translate-x--6' : 'translate-x-1 [dir="rtl"]:translate-x--1'
          }`}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
};
