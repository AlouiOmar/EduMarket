import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed';

  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 min-h-[32px]',
    md: 'text-sm px-4 py-2 gap-2 min-h-[40px]',
    lg: 'text-base px-6 py-2.5 gap-2.5 min-h-[48px]',
  };

  const variantClasses = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 focus-visible:ring-indigo-500 shadow-xs',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900 active:bg-slate-950 focus-visible:ring-slate-700 shadow-xs',
    outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-indigo-500 shadow-xs',
    ghost: 'text-slate-600 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-500 shadow-xs',
    success: 'bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 focus-visible:ring-emerald-500 shadow-xs',
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
};
