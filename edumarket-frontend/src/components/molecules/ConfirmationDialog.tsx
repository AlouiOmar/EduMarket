import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../atoms/Button';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  isDangerous = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const titleId = useId(), descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Accessible modal: focus moves to the dialog on open and back to the opener on close; Escape cancels.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => opener?.focus?.();
  }, [isOpen]);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}
        className="relative w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 outline-none animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onCancel}
          aria-label={t('platformCommon.close')}
          className="absolute top-4 end-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-4 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDangerous ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 id={titleId} className="text-base font-semibold text-slate-900">{title}</h3>
            <p id={descriptionId} className="text-sm text-slate-500 mt-1">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>
            {cancelLabel || t('common.cancel')}
          </Button>
          <Button
            variant={isDangerous ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel || t('common.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};
