import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usesApi } from '../../services/apiClient';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';
import { Filter, SlidersHorizontal, BookOpen } from 'lucide-react';
import { courseService } from '../../services/courseService';
import { Course } from '../../types';
import { CourseCard } from '../../components/organisms/CourseCard';
import { SearchField } from '../../components/molecules/SearchField';
import { EmptyState } from '../../components/molecules/EmptyState';
import { Pagination } from '../../components/molecules/Pagination';
import { Select } from '../../components/atoms/Select';
import { Button } from '../../components/atoms/Button';

export const CoursesCatalogPage: React.FC = () => {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const [searchParams, setSearchParams] = useSearchParams();

  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all');
  const [selectedLevel, setSelectedLevel] = useState(searchParams.get('level') || 'all');
  const tag = searchParams.get('tag') || '';
  const [selectedPrice, setSelectedPrice] = useState<'all' | 'free' | 'paid'>('all');
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'newest' | 'price_asc' | 'price_desc'>('popular');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  useEffect(() => {
    let active = true;
    courseService.getCategories().then(res => { if (active) setCategories(res.data); })
      .catch(() => { if (active) setError(t('auth.apiUnavailable')); });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    courseService.getCourses({
      search,
      tag,
      category: selectedCategory,
      level: selectedLevel,
      price: selectedPrice,
      sort: sortBy,
    }).then(res => {
      if (active) setCourses(res.data);
    }).catch(() => { if (active) setError(t('auth.apiUnavailable')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, tag, selectedCategory, selectedLevel, selectedPrice, sortBy, t]);

  const handleResetFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setSelectedLevel('all');
    setSelectedPrice('all');
    setSortBy('popular');
    setCurrentPage(1);
    setSearchParams({});
  };

  const paginatedCourses = courses.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(courses.length / pageSize) || 1;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Header Banner */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {t('courses.exploreTitle')}
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {t('courses.exploreSubtitle')}
        </p>
      </div>

      {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}

      {/* Top Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:max-w-md">
          <SearchField
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder={t('common.searchCoursesPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="w-40">
            <Select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: t('catalogUi.allCategories') },
                ...categories.map(c => ({ value: usesApi ? c.id : c.name, label: categoryLabel(usesApi ? c.id : c.name) }))
              ]}
            />
          </div>

          <div className="w-36">
            <Select
              value={selectedLevel}
              onChange={(e) => {
                setSelectedLevel(e.target.value);
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: t('catalogUi.allLevels') },
                { value: 'beginner', label: 'Débutant' },
                { value: 'intermediate', label: 'Intermédiaire' },
                { value: 'advanced', label: 'Avancé' },
              ]}
            />
          </div>

          <div className="w-32">
            <Select
              value={selectedPrice}
              onChange={(e) => {
                setSelectedPrice(e.target.value as any);
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: t('catalogUi.allPrices') },
                { value: 'free', label: 'Gratuit' },
                { value: 'paid', label: 'Payant' },
              ]}
            />
          </div>

          <div className="w-40">
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              options={[
                { value: 'popular', label: t('catalogUi.sort.popular') },
                { value: 'rating', label: t('catalogUi.sort.rating') },
                { value: 'newest', label: t('catalogUi.sort.newest') },
                { value: 'price_asc', label: t('catalogUi.sort.price_asc') },
                { value: 'price_desc', label: t('catalogUi.sort.price_desc') },
              ]}
            />
          </div>

          <Button variant="ghost" size="sm" onClick={handleResetFilters}>
            {t('common.reset')}
          </Button>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{t('courseTeamUi.resultsCount', { count: courses.length })}</span>
        {tag && <button type="button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('tag'); setSearchParams(next); }} className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-100" aria-label={t('courseTeamUi.clearTag', { tag })}>#{tag} ×</button>}
      </div>

      {/* Course Grid */}
      {loading ? <p className="py-12 text-center text-sm text-slate-500" role="status">{t('common.loading')}</p> : paginatedCourses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('catalogUi.noResultsTitle')}
          description={t('catalogUi.noResultsText')}
          actionLabel={t('catalogUi.resetFilters')}
          onAction={handleResetFilters}
        />
      )}

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

    </div>
  );
};
