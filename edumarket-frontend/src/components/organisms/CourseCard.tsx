import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';
import { BookOpen, Award, Users, Heart } from 'lucide-react';
import { Course } from '../../types';
import { Rating } from '../atoms/Rating';
import { PriceDisplay } from '../molecules/PriceDisplay';
import { Avatar } from '../atoms/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import { favoriteService } from '../../services/favoriteService';

export interface CourseCardProps {
  course: Course;
  progressPercent?: number;
  isFavorite?: boolean;
  onFavoriteChange?: (courseId: string, favorited: boolean) => void;
}

export const CourseCard: React.FC<CourseCardProps> = ({ course, progressPercent, isFavorite, onFavoriteChange }) => {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const { user } = useAuth();
  const [imageError, setImageError] = useState(false);
  const [favorite, setFavorite] = useState(isFavorite ?? false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState(false);
  useEffect(() => { if (isFavorite !== undefined) setFavorite(isFavorite); }, [isFavorite]);

  const durationHours = Math.round(course.totalDurationMinutes / 60);

  return (
    <div className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
      <div>
        {/* Cover image container with fallback */}
        <Link to={`/courses/${course.id}`} className="block relative aspect-video bg-slate-100 overflow-hidden">
          {!imageError ? (
            <img
              src={course.coverImage || undefined}
              alt={course.title}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-indigo-50 text-indigo-400">
              <BookOpen className="w-10 h-10" />
            </div>
          )}

          {course.hasCertification && (
            <div className="absolute top-2.5 end-2.5 bg-slate-900/80 backdrop-blur-xs text-white text-[11px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 shadow-xs">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('chromeUi.certifying')}</span>
            </div>
          )}
        </Link>
        {usesApi && user?.role === 'student' && <button type="button" disabled={favoriteBusy} aria-pressed={favorite} aria-label={favorite ? t('courses.removeFavorite') : t('courses.addFavorite')} onClick={async event => { event.preventDefault(); setFavoriteBusy(true); setFavoriteError(false); try { await favoriteService.set(course.id, !favorite); setFavorite(!favorite); await onFavoriteChange?.(course.id, !favorite); } catch { setFavoriteError(true); } finally { setFavoriteBusy(false); } }} className="absolute top-2.5 start-2.5 z-10 rounded-full bg-white/95 p-2 text-rose-600 shadow hover:bg-white disabled:opacity-50">
          <Heart className={`h-4 w-4 ${favorite ? 'fill-rose-500' : ''}`} />
        </button>}
        {favoriteError && <span role="alert" className="absolute top-12 start-2.5 z-10 rounded bg-white px-2 py-1 text-[10px] text-rose-700 shadow">{t('auth.apiUnavailable')}</span>}

        {/* Content */}
        <div className="p-4">
          {/* Unboxed clean metadata with typographic separators */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 truncate">
            <span className="font-medium text-indigo-600">{categoryLabel(course.category)}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`common.levels.${course.level}`)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{durationHours}h</span>
          </div>

          {/* Title */}
          <Link to={`/courses/${course.id}`} className="block">
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-2 leading-snug mb-2">
              {course.title}
            </h3>
          </Link>

          {/* Instructor Identity */}
          <div className="flex items-center gap-2 mb-3">
            <Avatar src={course.teacherAvatar} alt={course.teacherName} size="xs" />
            <span className="text-xs text-slate-600 truncate">{course.teacherName}</span>
          </div>

          {/* Rating */}
          <div className="flex items-center justify-between mb-3">
            <Rating score={course.rating} count={course.ratingCount} size="sm" />
            <div className="flex items-center gap-1 text-xs text-slate-400 tabular-nums">
              <Users className="w-3.5 h-3.5" />
              <span>{course.studentsCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Price & Progress */}
      <div className="px-4 pb-4 pt-3 border-t border-slate-100 flex items-center justify-between">
        {progressPercent !== undefined ? (
          <div className="w-full">
            <div className="flex justify-between text-xs text-slate-600 mb-1">
              <span>{t('learning.courseProgress')}</span>
              <span className="font-bold tabular-nums">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-600 h-1.5 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <PriceDisplay
              price={course.price}
              discountPrice={course.discountPrice}
              isFree={course.isFree}
              size="sm"
            />
            <Link
              to={`/courses/${course.id}`}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              {t('courses.startLearning')} &rarr;
            </Link>
          </>
        )}
      </div>
    </div>
  );
};
