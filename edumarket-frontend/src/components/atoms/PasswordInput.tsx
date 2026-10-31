import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  hasError?: boolean;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(({
  hasError = false,
  className = '',
  disabled,
  ...props
}, ref) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative w-full">
      <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-slate-400">
        <Lock className="w-4 h-4" />
      </div>
      <input
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        disabled={disabled}
        className={`w-full rounded-lg border bg-white ps-10 pe-10 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed ${
          hasError
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
        } ${className}`}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? t('chromeUi.hidePassword') : t('chromeUi.showPassword')}
        className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 hover:text-slate-600 transition-colors"
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';
