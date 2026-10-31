import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations } from './resources';

export const defaultLanguage = (localStorage.getItem('app_language') as 'fr' | 'en' | 'ar') || 'fr';

const resources = {
  fr: { translation: translations.fr },
  en: { translation: translations.en },
  ar: { translation: translations.ar },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: defaultLanguage,
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false,
    },
  });

export const applyDirection = (lang: string) => {
  const isRTL = lang === 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  localStorage.setItem('app_language', lang);
};

// Initial apply
applyDirection(defaultLanguage);

i18n.on('languageChanged', (lng) => {
  applyDirection(lng);
});

export default i18n;
