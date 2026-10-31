import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  children,
  variant = 'ghost',
  size = 'md',
  className = '',
  ...props
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8 p-1.5',
    md: 'w-10 h-10 p-2',
    lg: 'w-12 h-12 p-3',
  };

  const variantClasses = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900 focus-visible:ring-slate-700',
    outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-indigo-500',
    ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-400',
    danger: 'text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-500',
  };

  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
