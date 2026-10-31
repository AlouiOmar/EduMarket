import React, { useEffect, useState } from 'react';
import { describeApiError } from '../../utils/apiErrors';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Award, 
  CheckCircle2, 
  Clock, 
  PlayCircle, 
  FileText, 
  HelpCircle, 
  Users, 
  Calendar, 
  ShieldCheck, 
  Share2, 
  ShoppingCart,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { courseService } from '../../services/courseService';
import { Course } from '../../types';
import { useCart } from '../../contexts/CartContext';
import { Rating } from '../../components/atoms/Rating';
import { Avatar } from '../../components/atoms/Avatar';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { PriceDisplay } from '../../components/molecules/PriceDisplay';
import { Breadcrumbs } from '../../components/molecules/Breadcrumbs';
import { enrollmentService } from '../../services/enrollmentService';
import { subscriptionApi } from '../../services/platformServices';
import type { SubscriptionStatus } from '../../types/platform';
import { ReportButton } from '../../components/organisms/ReportButton';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';
import { formatDate } from '../../utils/format';
import { usesApi } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { courseReviewService, CourseReviewsData } from '../../services/courseReviewService';

export const CourseDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { addToCart, isInCart } = useCart();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [reviewsData, setReviewsData] = useState<CourseReviewsData | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  useEffect(() => {
    if (usesApi && user?.role === 'student') subscriptionApi.mine().then(setSubscription).catch(() => setSubscription(null));
  }, [user?.role]);
  const coveredBySubscription = !!subscription?.active && !!course && !course.isFree;

  const enrollWithSubscription = async () => {
    if (!course) return;
    setEnrolling(true); setPurchaseError('');
    try { await enrollmentService.enrollFreeCourse(course.id); navigate(`/learning/${course.id}`); }
    catch (cause) { setPurchaseError(describeApiError(cause)); }
    finally { setEnrolling(false); }
  };

  useEffect(() => {
    if (id) {
      courseService.getCourseById(id).then(res => {
        setCourse(res.data);
        if (res.data?.chapters[0]) {
          setOpenChapter(res.data.chapters[0].id);
        }
        setLoading(false);
      });
    }
  }, [id]);

  useEffect(() => {
    if (usesApi && id) courseReviewService.list(id).then(data => {
      setReviewsData(data);
      if (data.mine) { setReviewRating(data.mine.rating); setReviewComment(data.mine.comment); }
    }).catch(cause => setReviewError(describeApiError(cause)));
  }, [id]);

  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course) return;
    setSavingReview(true); setReviewError('');
    try {
      const summary = await courseReviewService.save(course.id, reviewRating, reviewComment);
      setCourse(current => current ? { ...current, rating: summary.rating, ratingCount: summary.ratingCount } : current);
      setReviewsData(await courseReviewService.list(course.id));
    } catch (cause) { setReviewError((cause as { code?: string }).code || (describeApiError(cause))); }
    finally { setSavingReview(false); }
  };

  if (loading) {
    return <div className="max-w-7xl mx-auto p-12 text-center text-slate-500">{t('common.loading')}</div>;
  }

  if (!course) {
    return (
      <div className="max-w-7xl mx-auto p-12 text-center">
        <h2 className="text-xl font-bold mb-4">{t('catalogUi.notFound')}</h2>
        <Link to="/courses"><Button variant="primary">{t('catalogUi.backToCatalog')}</Button></Link>
      </div>
    );
  }

  const durationHours = Math.round(course.totalDurationMinutes / 60);
  const totalLessons = course.chapters.reduce((acc, c) => acc + c.lessons.length, 0);

  const handleEnrollOrBuy = async () => {
    setPurchaseError('');
    if (course.isFree) {
      if (usesApi) {
        if (!isAuthenticated) {
          navigate('/auth/login', { state: { from: `/courses/${course.id}` } });
          return;
        }
        setEnrolling(true);
        try {
          await enrollmentService.enrollFreeCourse(course.id);
        } catch (cause) {
          setPurchaseError(describeApiError(cause));
          setEnrolling(false);
          return;
        }
        setEnrolling(false);
      }
      navigate(`/learning/${course.id}`);
    } else {
      // Prices shown here are informative: the API reprices the order and the provider confirms payment.
      if (!isInCart(course.id)) addToCart(course);
      navigate(usesApi ? '/checkout' : '/cart');
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Hero Header */}
      <div className="bg-slate-900 text-white py-10 lg:py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Breadcrumbs
            items={[
              { label: t('nav.home'), href: '/' },
              { label: t('nav.courses'), href: '/courses' },
              { label: course.title },
            ]}
            className="mb-4 text-slate-400"
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-8 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-indigo-400">{categoryLabel(course.category)}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-300">{t(`common.levels.${course.level}`)}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-300">{t('catalogUi.updatedOn', { date: formatDate(course.updatedAt, i18n.language) || course.updatedAt })}</span>
              </div>
              {course.tags.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label={t('courseTeamUi.tags')}>{course.tags.map(tag => <li key={tag}><Link to={`/courses?tag=${encodeURIComponent(tag)}`} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700">#{tag}</Link></li>)}</ul>}

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                {course.title}
              </h1>
              <ReportButton targetType="course" targetId={course.id} className="text-slate-400" />

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-3xl">
                {course.subtitle}
              </p>

              <div className="flex flex-wrap items-center gap-6 pt-2 text-xs">
                <Rating score={course.rating} count={course.ratingCount} size="md" />
                <div className="flex items-center gap-1.5 text-slate-300 tabular-nums">
                  <Users className="w-4 h-4 text-slate-400" />
                  <span>{course.studentsCount} {t('courses.enrolledStudents')}</span>
                </div>
                {course.hasCertification && (
                  <div className="flex items-center gap-1 text-amber-400 font-semibold">
                    <Award className="w-4 h-4" />
                    <span>{t('catalogUi.certificationIncluded')}</span>
                  </div>
                )}
              </div>

              {/* Instructor badge */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
                <Avatar src={course.teacherAvatar} alt={course.teacherName} size="md" />
                <div>
                  <span className="text-xs text-slate-400 block">{t('courses.instructor')}</span>
                  <Link to={`/teachers/${course.teacherId}`} className="text-sm font-bold text-white hover:text-indigo-400">
                    {course.teacherName}
                  </Link>
                  <span className="text-xs text-slate-400 block">{course.teacherTitle}</span>
                </div>
              </div>
            </div>

            {/* Desktop Sticky Purchase Card */}
            <div className="lg:col-span-4 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-xl p-6 space-y-6">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 group cursor-pointer" onClick={() => setShowPreviewModal(true)}>
                <img
                  src={course.coverImage || undefined}
                  alt={course.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-102 transition-transform"
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-white/90 text-indigo-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <PlayCircle className="w-6 h-6" />
                  </div>
                </div>
                <span className="absolute bottom-2.5 start-2.5 bg-slate-900/80 text-white text-[11px] px-2 py-0.5 rounded font-medium">
                  {t('catalogUi.preview')}
                </span>
              </div>

              <div>
                <PriceDisplay
                  price={course.price}
                  discountPrice={course.discountPrice}
                  isFree={course.isFree}
                  size="lg"
                />
              </div>

              <div className="space-y-3">
                {coveredBySubscription && (
                  <Button variant="success" size="lg" className="w-full" onClick={() => void enrollWithSubscription()} disabled={enrolling}>
                    {t('subscriptionUi.includedEnroll')}
                  </Button>
                )}
                <Button
                  variant={coveredBySubscription ? 'outline' : 'primary'}
                  size="lg"
                  className="w-full"
                  onClick={handleEnrollOrBuy}
                  disabled={enrolling}
                >
                  {enrolling ? t('common.loading') : course.isFree ? t('courses.freeEnroll') : t('courses.buyNow')}
                </Button>

                {!course.isFree && (
                  <Button
                    variant="outline"
                    size="md"
                    className="w-full"
                    disabled={isInCart(course.id)}
                    onClick={() => addToCart(course)}
                    leftIcon={<ShoppingCart className="w-4 h-4" />}
                  >
                    {isInCart(course.id) ? t('catalogUi.alreadyInCart') : t('courses.addToCart')}
                  </Button>
                )}
              </div>

              {purchaseError && <p role="alert" className="text-xs text-rose-600">{purchaseError}</p>}

              <div className="border-t border-slate-100 pt-4 space-y-2.5 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>{t('catalogUi.fullAccess')}</span>
                  <strong className="text-slate-800">{t('catalogUi.lifetime')}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t('catalogUi.volume')}</span>
                  <strong className="text-slate-800 tabular-nums">{t('catalogUi.hours', { count: durationHours })}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t('catalogUi.content')}</span>
                  <strong className="text-slate-800 tabular-nums">{t('catalogUi.contentCount', { chapters: course.chapters.length, lessons: totalLessons })}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t('catalogUi.certification')}</span>
                  <strong className="text-slate-800">{t('catalogUi.verifiable')}</strong>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Main Body Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-8 space-y-10">
          
          {/* What you will learn */}
          <section className="bg-white p-6 rounded-xl border border-slate-200">
            <h2 className="text-base font-bold text-slate-900 mb-4">
              {t('courses.whatYouWillLearn')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {course.learningOutcomes.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Curriculum */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t('courses.curriculum')}</h2>
                <span className="text-xs text-slate-500">
                  {course.chapters.length} chapitres · {totalLessons} leçons · {durationHours}h de contenu
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {course.chapters.map((chapter) => {
                const isOpen = openChapter === chapter.id;
                return (
                  <div key={chapter.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <button
                      onClick={() => setOpenChapter(isOpen ? null : chapter.id)}
                      className="w-full px-5 py-4 flex items-center justify-between text-start text-sm font-bold text-slate-800 hover:bg-slate-50 transition-colors"
                    >
                      <span>{chapter.title}</span>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="tabular-nums">{chapter.lessons.length} leçons</span>
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-slate-100 bg-slate-50/50">
                        {chapter.lessons.map((lesson) => (
                          <div key={lesson.id} className="px-5 py-3 flex items-center justify-between text-xs text-slate-700">
                            <div className="flex items-center gap-2.5 truncate">
                              {lesson.type === 'video' ? (
                                <PlayCircle className="w-4 h-4 text-indigo-500" />
                              ) : lesson.type === 'text' ? (
                                <FileText className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <HelpCircle className="w-4 h-4 text-amber-500" />
                              )}
                              <span className="truncate">{lesson.title}</span>
                            </div>
                            <span className="text-slate-400 tabular-nums shrink-0">
                              {lesson.durationMinutes} min
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Prerequisites */}
          <section className="bg-white p-6 rounded-xl border border-slate-200 space-y-3">
            <h2 className="text-base font-bold text-slate-900">{t('courses.requirements')}</h2>
            <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5">
              {course.prerequisites.map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </section>

          {/* Description */}
          <section className="bg-white p-6 rounded-xl border border-slate-200 space-y-3">
            <h2 className="text-base font-bold text-slate-900">{t('catalogUi.detailedDescription')}</h2>
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
              {course.description}
            </p>
          </section>

          {/* Certification Pathway Details */}
          <section className="bg-amber-50/60 border border-amber-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
              <Award className="w-5 h-5 text-amber-600" />
              <span>{t('catalogUi.certificationRules')}</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              {t(`catalogUi.pathwayText.${course.certificationPathway}`)}
            </p>
            {course.examId && (
              <div className="pt-2">
                <Link to={`/events`}>
                  <Button variant="outline" size="sm" className="bg-white border-amber-300 text-amber-900">
                    {t('catalogUi.examDates')}
                  </Button>
                </Link>
              </div>
            )}
          </section>

          <section className="space-y-4" aria-labelledby="course-reviews-title">
            <div><h2 id="course-reviews-title" className="text-lg font-bold text-slate-900">{t('courses.reviewsAndRatings')}</h2><div className="mt-2"><Rating score={reviewsData?.rating ?? course.rating} count={reviewsData?.ratingCount ?? course.ratingCount} size="sm" /></div></div>
            {usesApi && user?.role === 'student' && <form onSubmit={submitReview} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <label className="block text-xs font-semibold text-slate-700">{t('courses.writeReview')}
                <select aria-label="Rating" value={reviewRating} onChange={event => setReviewRating(Number(event.target.value))} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2">
                  {[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} / 5</option>)}
                </select>
              </label>
              <textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} required minLength={10} maxLength={3000} rows={4} className="w-full rounded-lg border border-slate-300 p-3 text-sm" placeholder={t('courses.reviewPlaceholder')} />
              {reviewError && <p role="alert" className="text-xs text-rose-700">{reviewError === 'ENROLLMENT_REQUIRED' ? t('courses.reviewEnrollmentRequired') : reviewError}</p>}
              <Button type="submit" variant="primary" size="sm" isLoading={savingReview}>{reviewsData?.mine ? t('courses.updateReview') : t('courses.submitReview')}</Button>
            </form>}
            {usesApi && !isAuthenticated && <p className="text-xs text-slate-500"><Link className="text-indigo-600 hover:underline" to="/auth/login" state={{ from: `/courses/${course.id}` }}>{t('nav.login')}</Link> {t('courses.loginToReview')}</p>}
            {usesApi && isAuthenticated && user?.role !== 'student' && <p className="text-xs text-slate-500">{t('courses.studentsOnlyReview')}</p>}
            {usesApi && reviewError && user?.role !== 'student' && <p role="alert" className="text-xs text-rose-700">{reviewError}</p>}
            <div className="space-y-3">{reviewsData?.reviews.map(review => <article key={review.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">{review.studentName}</h3><time className="text-xs text-slate-400">{new Date(review.createdAt).toLocaleDateString()}</time></div><Rating score={review.rating} size="sm" /></div><p className="mt-3 whitespace-pre-line text-sm text-slate-700">{review.comment}</p>{review.reply && <div className="mt-3 rounded-lg border-s-2 border-indigo-400 bg-indigo-50 p-3 text-sm text-indigo-900"><p className="text-xs font-semibold">{t('courseTeamUi.teacherReply')}</p><p className="mt-1 whitespace-pre-line">{review.reply.body}</p></div>}<div className="mt-2 flex justify-end"><ReportButton targetType="course_review" targetId={review.id} compact /></div></article>)}</div>
          </section>

        </div>
      </div>

      {/* Video Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="relative w-full max-w-3xl bg-black rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 bg-slate-900 flex justify-between items-center text-white">
              <span className="text-sm font-bold truncate">Aperçu vidéo : {course.title}</span>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-slate-400 hover:text-white"
              >
                {t('catalogUi.close')}
              </button>
            </div>
            <div className="aspect-video">
              <video
                src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                controls
                autoPlay
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
