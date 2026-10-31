import React from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { applyDirection } from '../../i18n';

export const LanguageSwitcher: React.FC<{ variant?: 'minimal' | 'select'; className?: string }> = ({
  variant = 'select',
  className = '',
}) => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (newLang: string) => {
    i18n.changeLanguage(newLang);
    applyDirection(newLang);
  };

  const currentLang = i18n.language || 'fr';

  if (variant === 'minimal') {
    return (
      <div className={`inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium ${className}`}>
        <button
          type="button"
          onClick={() => handleLanguageChange('fr')}
          className={`px-2 py-1 rounded transition-colors ${
            currentLang === 'fr' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          FR
        </button>
        <button
          type="button"
          onClick={() => handleLanguageChange('en')}
          className={`px-2 py-1 rounded transition-colors ${
            currentLang === 'en' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => handleLanguageChange('ar')}
          className={`px-2 py-1 rounded transition-colors font-arabic ${
            currentLang === 'ar' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          عربي
        </button>
      </div>
    );
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <Languages className="w-4 h-4 text-slate-500 absolute start-2.5 pointer-events-none" />
      <select
        value={currentLang}
        onChange={(e) => handleLanguageChange(e.target.value)}
        aria-label={t('chromeUi.selectLanguage')}
        className="appearance-none ps-8 pe-6 py-1.5 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-xs font-semibold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
      >
        <option value="fr">Français (FR)</option>
        <option value="en">English (EN)</option>
        <option value="ar">العربية (AR)</option>
      </select>
    </div>
  );
};
