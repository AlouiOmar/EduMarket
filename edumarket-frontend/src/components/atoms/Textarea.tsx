import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({
  hasError = false,
  className = '',
  rows = 4,
  ...props
}, ref) => {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed ${
        hasError
          ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
          : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
      } ${className}`}
      {...props}
    />
  );
});

Textarea.displayName = 'Textarea';
