import React from 'react';

export interface FormFieldProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  hint,
  required = false,
  children,
  className = '',
}) => {
  // Associates the label (and hint/error text) with a single child control unless it already has an id.
  const generatedId = React.useId();
  const child = React.Children.count(children) === 1 && React.isValidElement<Record<string, unknown>>(children) ? children : null;
  const controlId = (child?.props.id as string | undefined) || generatedId;
  const describedBy = error || hint ? `${controlId}-description` : undefined;
  const control = child ? React.cloneElement(child, { id: controlId, ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true } : {}) }) : children;
  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {label && (
        <label htmlFor={child ? controlId : undefined} className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <span>{label}</span>
          {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <span id={describedBy} className="text-xs font-medium text-rose-600 transition-opacity">
          {error}
        </span>
      ) : hint ? (
        <span id={describedBy} className="text-xs text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
};
