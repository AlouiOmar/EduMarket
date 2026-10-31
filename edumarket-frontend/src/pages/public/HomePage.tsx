import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  ArrowRight, 
  BookOpen, 
  Award, 
  Users, 
  ShieldCheck, 
  CheckCircle2, 
  Search, 
  Sparkles,
  Building2,
  Calendar
} from 'lucide-react';
import { courseService } from '../../services/courseService';
import { Course } from '../../types';
import { CourseCard } from '../../components/organisms/CourseCard';
import { Button } from '../../components/atoms/Button';
import { Rating } from '../../components/atoms/Rating';
import { apiRequest, usesApi } from '../../services/apiClient';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';

export const HomePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const categoryLabel = useCategoryLabel();
  // Real aggregate figures in API mode; the original marketing figures stay in mock mode only.
  const [stats, setStats] = useState<{ publishedCourses: number; certificates: number; verifiedTeachers: number; learners: number; completionRate: number } | null>(null);
  useEffect(() => { if (usesApi) apiRequest<{ data: NonNullable<typeof stats> }>('/platform/stats').then(result => setStats(result.data)).catch(() => setStats(null)); }, []);
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; coursesCount: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    courseService.getCourses().then(res => setCourses(res.data));
    courseService.getCategories().then(res => setCategories(res.data));
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/courses?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="space-y-16 sm:space-y-24 py-8">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-7 space-y-6">
            {/* Unboxed kicker */}
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600">
              <Sparkles className="w-4 h-4" />
              <span>{t('homeUi.kicker')}</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight">
              {t('homeUi.heroTitle')}<span className="text-indigo-600">{t('homeUi.heroHighlight')}</span>.
            </h1>

            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
              {t('homeUi.heroText')}
            </p>

            {/* Hero Search Bar */}
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-lg bg-white p-1.5 rounded-xl border border-slate-300 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <Search className="w-5 h-5 text-slate-400 ms-3 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.searchCoursesPlaceholder')}
                className="w-full bg-transparent px-2 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <Button type="submit" variant="primary" size="md">
                {t('common.search')}
              </Button>
            </form>

            {/* Quick Proof Metrics */}
            <div className="pt-4 flex flex-wrap items-center gap-6 text-xs text-slate-600 border-t border-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>{stats ? t('homeUi.learners', { count: stats.learners }) : t('homeUi.demoLearners')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>{t('homeUi.examsBadge')}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>{t('homeUi.jitsiBadge')}</span>
              </div>
            </div>
          </div>

          {/* Hero Visual Card / Bento Feature */}
          <div className="lg:col-span-5 relative">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-6">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900">
                <img
                  src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&auto=format&fit=crop&q=80"
                  alt={t('homeUi.heroImageAlt')}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-4">
                  <div className="text-white">
                    <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider block">{t('homeUi.liveSession')}</span>
                    <span className="text-xs font-bold">{stats ? t('homeUi.mentoringCard', { count: stats.verifiedTeachers }) : t('homeUi.demoMentor')}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-xs text-slate-500 block mb-1">{stats ? t('homeUi.completionRate') : t('homeUi.successRate')}</span>
                  <span className="text-xl font-bold text-slate-900 tabular-nums">{stats ? `${stats.completionRate} %` : '94.8%'}</span>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-xs text-slate-500 block mb-1">{t('homeUi.certificatesIssued')}</span>
                  <span className="text-xl font-bold text-indigo-600 tabular-nums">{stats ? stats.certificates.toLocaleString(i18n.language) : '12 400+'}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Categories Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {t('homeUi.byCategory')}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('homeUi.byCategoryText')}
            </p>
          </div>
          <Link to="/courses" className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
            <span>{t('common.viewAll')}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl-flip" />
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/courses?category=${encodeURIComponent(usesApi ? cat.id : cat.name)}`}
              className="p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-400 hover:shadow-sm transition-all text-center flex flex-col items-center justify-center group"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors flex items-center justify-center mb-3">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-xs font-bold text-slate-800 line-clamp-1 group-hover:text-indigo-600 mb-1">
                {categoryLabel(usesApi ? cat.id : cat.name)}
              </h3>
              <span className="text-[11px] text-slate-400 tabular-nums">
                {t('homeUi.coursesCount', { count: cat.coursesCount })}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Courses */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {t('courses.featuredCourses')}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('homeUi.featuredText')}
            </p>
          </div>
          <Link to="/courses" className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
            <span>{t('homeUi.seeCatalog')}</span>
            <ArrowRight className="w-3.5 h-3.5 rtl-flip" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.slice(0, 3).map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </section>

      {/* Certification Pathways Explainer */}
      <section className="bg-indigo-950 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2 block">
              {t('homeUi.authenticity')}
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {t('homeUi.pathwaysTitle')}
            </h2>
            <p className="text-sm text-indigo-200 mt-3">
              {t('homeUi.pathwaysText')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-indigo-900/40 border border-indigo-800/60 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('homeUi.pathway1')}</h3>
              <p className="text-xs text-indigo-200 leading-relaxed mb-4">
                {t('homeUi.pathway1Text')}
              </p>
              <span className="text-[11px] font-semibold text-emerald-400">{t('homeUi.pathway1Tag')}</span>
            </div>

            <div className="bg-indigo-900/40 border border-indigo-800/60 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-600 text-white flex items-center justify-center mb-4">
                <Award className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('homeUi.pathway2')}</h3>
              <p className="text-xs text-indigo-200 leading-relaxed mb-4">
                {t('homeUi.pathway2Text')}
              </p>
              <span className="text-[11px] font-semibold text-amber-300">{t('homeUi.pathway2Tag')}</span>
            </div>

            <div className="bg-indigo-900/40 border border-indigo-800/60 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center mb-4">
                <Building2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold mb-2">{t('homeUi.pathway3')}</h3>
              <p className="text-xs text-indigo-200 leading-relaxed mb-4">
                {t('homeUi.pathway3Text')}
              </p>
              <span className="text-[11px] font-semibold text-indigo-300">{t('homeUi.pathway3Tag')}</span>
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link to="/certifications">
              <Button variant="primary" size="md">
                {t('homeUi.learnMore')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Community / Tutoring Callout */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 rounded-2xl p-8 sm:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="max-w-xl">
            <span className="text-xs uppercase tracking-wider text-indigo-400 font-bold mb-2 block">
              {t('homeUi.tutoringKicker')}
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">
              {t('homeUi.tutoringTitle')}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {t('homeUi.tutoringText')}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Link to="/sessions">
              <Button variant="primary" size="md">
                {t('homeUi.bookSlot')}
              </Button>
            </Link>
            <Link to="/forum">
              <Button variant="outline" size="md" className="border-slate-700 text-white hover:bg-slate-800">
                {t('homeUi.exploreForum')}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
