import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../atoms/Button';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}) => {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between border-t border-slate-200 pt-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          leftIcon={<ChevronLeft className="w-4 h-4 rtl-flip" />}
        >
          {t('chromeUi.previous')}
        </Button>
      </div>
      <span className="text-xs text-slate-500 tabular-nums">
        Page <strong className="text-slate-800">{currentPage}</strong> sur <strong className="text-slate-800">{totalPages}</strong>
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          rightIcon={<ChevronRight className="w-4 h-4 rtl-flip" />}
        >
          {t('chromeUi.next')}
        </Button>
      </div>
    </div>
  );
};
