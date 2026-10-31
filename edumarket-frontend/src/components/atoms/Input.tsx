import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  hasError = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <div className="relative w-full">
      {leftIcon && (
        <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-slate-400">
          {leftIcon}
        </div>
      )}
      <input
        ref={ref}
        disabled={disabled}
        className={`w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
          leftIcon ? 'ps-10' : ''
        } ${rightIcon ? 'pe-10' : ''} ${
          hasError
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
        } ${className}`}
        {...props}
      />
      {rightIcon && (
        <div className="absolute inset-y-0 end-0 flex items-center pe-3 pointer-events-none text-slate-400">
          {rightIcon}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';
