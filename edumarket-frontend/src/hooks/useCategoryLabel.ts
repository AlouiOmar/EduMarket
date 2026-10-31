import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usesApi } from '../services/apiClient';
import { courseWorkflowApi } from '../services/platformServices';
import type { PublicCategory } from '../types/platform';

// One request per page load: category labels change rarely and every course card needs them.
let categoriesPromise: Promise<PublicCategory[]> | null = null;
const loadCategories = () => {
  categoriesPromise ??= courseWorkflowApi.categories().catch(() => { categoriesPromise = null; return []; });
  return categoriesPromise;
};

/** Courses store a category slug (managed taxonomy) or a legacy free-text value; this returns the localized label. */
export function useCategoryLabel() {
  const { i18n } = useTranslation();
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    void loadCategories().then(list => { if (active) setCategories(list); });
    return () => { active = false; };
  }, []);
  const language = i18n.language.slice(0, 2) as 'fr' | 'en' | 'ar';
  return (value: string) => {
    const category = categories.find(item => item.id === value);
    return category?.names?.[language] || category?.name || value;
  };
}
