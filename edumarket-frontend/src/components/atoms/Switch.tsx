import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  /** Accessible name when no visible label is rendered next to the switch. */
  ariaLabel?: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled = false, ariaLabel }) => {
  return (
    <label className={`inline-flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
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
