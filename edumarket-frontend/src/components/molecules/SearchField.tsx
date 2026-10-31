import { useTranslation } from 'react-i18next';
import React from 'react';
import { Search, X } from 'lucide-react';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
}

export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  className = '',
}) => {
  const { t } = useTranslation();
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      onSubmit();
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-slate-400">
        <Search className="w-4 h-4" />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t('chromeUi.search')}
        className="w-full rounded-lg border border-slate-300 bg-white ps-9 pe-9 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('chromeUi.clearSearch')}
          className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
