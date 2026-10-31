import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, EyeOff, Flag, PauseCircle } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { StatCard } from '../../components/molecules/StatCard';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader, SimplePager } from '../../components/molecules/PageStates';
import { usesApi } from '../../services/apiClient';
import { forumService } from '../../services/forumService';
import { courseReviewService } from '../../services/courseReviewService';
import { moderationApi } from '../../services/platformServices';
import { useCategoryLabel } from '../../hooks/useCategoryLabel';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate, formatDateTime, formatPrice } from '../../utils/format';
import type { CourseStatus, ModerationCourse, ModerationEvent, ModerationSummary } from '../../types/platform';

type QueueFilter = 'all' | 'forum' | 'reviews';
interface QueueItem { id: string; kind: 'report' | 'course-review'; title: string; target: string; reporter: string; reason: string; status: string }

const mockItems: QueueItem[] = [
  { id: 'mod_1', kind: 'report', title: 'Contenu potentiellement hors sujet', target: 'Discussion #post_2 : Conseils pour réussir l’examen en présentiel...', reporter: 'Utilisateur anonyme', reason: 'Lien promotionnel externe non autorisé', status: 'pending' },
  { id: 'mod_2', kind: 'course-review', title: 'Avis contenant des propos discourtois', target: 'Avis sur « Architectures Modernes React 19 »', reporter: 'Dr. Sarah Mansour', reason: 'Non-respect de la charte de bienveillance', status: 'published' },
];

/** Moderation queue for forum reports and course reviews; `filter` scopes the dedicated forum and review routes. */
export const ModeratorQueuePage: React.FC<{ filter?: QueueFilter }> = ({ filter = 'all' }) => {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<QueueItem[]>(usesApi ? [] : mockItems);
  const [summary, setSummary] = useState<ModerationSummary | null>(null);
  const [loading, setLoading] = useState(usesApi);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!usesApi) return;
    setLoading(true); setError('');
    Promise.all([
      filter === 'reviews' ? Promise.resolve([]) : forumService.getReports(),
      filter === 'forum' ? Promise.resolve([]) : courseReviewService.getModerationQueue(),
      moderationApi.summary(),
    ]).then(([reports, reviews, counts]) => {
      setSummary(counts);
      setItems([
        ...reports.map(report => ({ id: report.id, kind: 'report' as const, title: t('moderation.forumReport'), target: `${report.targetType} #${report.targetId}`, reporter: report.reporter?.name || '', reason: report.reason, status: 'open' })),
        ...reviews.map(review => ({ id: review.id, kind: 'course-review' as const, title: `${review.rating}/5 · ${review.courseTitle}`, target: `${t('moderation.by', { name: review.studentName })} · ${formatDate(review.createdAt, i18n.language)}`, reporter: review.studentName, reason: review.comment, status: review.status })),
      ]);
    }).catch(cause => setError(apiErrorMessage(t, cause))).finally(() => setLoading(false));
  }, [filter, i18n.language, t]);
  useEffect(load, [load]);

  const visible = usesApi ? items : items.filter(item => filter === 'all' || (filter === 'forum' ? item.kind === 'report' : item.kind === 'course-review'));
  const handleResolve = async (item: QueueItem, action: 'approved' | 'rejected') => {
    try {
      if (usesApi && item.kind === 'course-review') await courseReviewService.setModerationStatus(item.id, action === 'approved' ? 'hidden' : 'published');
      else if (usesApi) await forumService.reviewReport(item.id, action === 'approved' ? 'actioned' : 'dismissed');
      setItems(prev => prev.filter(entry => entry.id !== item.id));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };

  const titleKey = filter === 'forum' ? 'forumTitle' : filter === 'reviews' ? 'reviewsTitle' : 'dashboardTitle';
  const subtitleKey = filter === 'forum' ? 'forumSubtitle' : filter === 'reviews' ? 'reviewsSubtitle' : 'dashboardSubtitle';
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title={t(`moderation.${titleKey}`)} subtitle={t(`moderation.${subtitleKey}`)} />
      {summary && filter === 'all' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('moderation.pendingCourses')} value={summary.pendingCourses} icon={<BookOpen className="w-5 h-5" />} />
          <StatCard label={t('moderation.openReports')} value={summary.openForumReports} icon={<Flag className="w-5 h-5" />} />
          <StatCard label={t('moderation.hiddenReviews')} value={summary.hiddenReviews} icon={<EyeOff className="w-5 h-5" />} />
          <StatCard label={t('moderation.openContentReports')} value={summary.openContentReports} icon={<PauseCircle className="w-5 h-5" />} />
        </div>
      )}
      <ErrorAlert message={error} onRetry={usesApi ? load : undefined} />
      {loading && <LoadingState />}
      <div className="space-y-4">
        {!loading && visible.length === 0 ? (
          <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-xs text-slate-500">{t('moderation.queueEmpty')}</div>
        ) : visible.map(item => (
          <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="warning" size="sm">{item.kind === 'report' ? t('moderation.forumReport') : t('moderation.reviewItem')}</Badge>
                <span className="font-bold text-slate-900">{item.title}</span>
              </div>
              <p className="text-slate-600">{item.target}</p>
              {item.kind === 'report' && item.reporter && <span className="text-[11px] text-slate-500 block">{t('moderation.reporter', { name: item.reporter })}</span>}
              <span className="text-[11px] text-rose-600 block">{t('moderation.reason', { reason: item.reason })}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {item.kind === 'course-review' ? (
                item.status === 'hidden'
                  ? <Button variant="outline" size="sm" onClick={() => void handleResolve(item, 'rejected')}>{t('moderation.restoreReview')}</Button>
                  : <Button variant="danger" size="sm" onClick={() => void handleResolve(item, 'approved')}>{t('moderation.hideReview')}</Button>
              ) : <>
                <Button variant="outline" size="sm" onClick={() => void handleResolve(item, 'rejected')}>{t('moderation.dismissReport')}</Button>
                <Button variant="danger" size="sm" onClick={() => void handleResolve(item, 'approved')}>{t('moderation.removeContent')}</Button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const statusVariant: Record<CourseStatus, 'warning' | 'success' | 'danger' | 'default'> = { draft: 'default', pending_review: 'warning', published: 'success', rejected: 'danger', suspended: 'danger' };
const statusFilters: Array<CourseStatus | 'all'> = ['pending_review', 'published', 'suspended', 'rejected', 'draft', 'all'];

/** Course publication review shared by moderators (/moderator/courses) and administrators (/admin/courses). */
export const CourseModerationPage: React.FC<{ titleKey?: string; subtitleKey?: string }> = ({ titleKey = 'moderation.coursesTitle', subtitleKey = 'moderation.coursesSubtitle' }) => {
  const { t, i18n } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const [status, setStatus] = useState<CourseStatus | 'all'>('pending_review');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [courses, setCourses] = useState<ModerationCourse[] | null>(null);
  const [pages, setPages] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    moderationApi.courses({ status, search: search.trim() || undefined, page })
      .then(result => { setCourses(result.data); setPages(result.pagination.pages || 1); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [status, search, page, t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t(titleKey)} subtitle={t(subtitleKey)} /><ApiModeNotice /></div>;

  const act = async (course: ModerationCourse, action: () => Promise<ModerationCourse>, needsNote: boolean) => {
    if (needsNote && !notes[course.id]?.trim()) { setError(t('moderation.noteRequired')); return; }
    setBusyId(course.id); setError('');
    try {
      const updated = await action();
      setCourses(prev => (prev || []).map(item => item.id === updated.id ? updated : item).filter(item => status === 'all' || item.status === status));
      setNotes(prev => ({ ...prev, [course.id]: '' }));
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusyId(''); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t(titleKey)} subtitle={t(subtitleKey)} />
      <div className="flex flex-col sm:flex-row gap-3">
        <Input aria-label={t('platformCommon.search')} placeholder={t('platformCommon.search')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
        <Select aria-label={t('adminPanel.filterStatus')} value={status} onChange={event => { setStatus(event.target.value as CourseStatus | 'all'); setPage(1); }}
          options={statusFilters.map(value => ({ value, label: value === 'all' ? t('adminPanel.all') : t(`courseStatus.${value}`) }))} />
      </div>
      <ErrorAlert message={error} onRetry={courses ? undefined : load} />
      {!courses && !error && <LoadingState />}
      {courses?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('moderation.noCourses')}</p>}
      <div className="space-y-4">
        {courses?.map(course => (
          <article key={course.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">{course.title}</h3>
                  <Badge variant={statusVariant[course.status]} size="sm">{t(`courseStatus.${course.status}`)}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  {t('moderation.by', { name: course.teacherName })} · {categoryLabel(course.category)} · {course.price > 0 ? formatPrice(course.price, 'eur', i18n.language) : t('common.free')} · {t('moderation.lessons', { count: course.lessonsCount })}
                  {course.review.submittedAt ? ` · ${t('moderation.submittedOn', { date: formatDateTime(course.review.submittedAt, i18n.language) })}` : ''}
                </p>
                {course.review.note && <p className="text-xs text-rose-700">{t('courseStatus.moderationNote', { note: course.review.note })}</p>}
              </div>
              {course.status === 'published' && <Link to={`/courses/${course.id}`} className="text-xs font-semibold text-indigo-700 underline underline-offset-2 shrink-0">{t('moderation.preview')}</Link>}
            </div>
            {['pending_review', 'published', 'suspended'].includes(course.status) && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Input aria-label={t('moderation.notePlaceholder')} placeholder={t('moderation.notePlaceholder')} value={notes[course.id] || ''} onChange={event => setNotes(prev => ({ ...prev, [course.id]: event.target.value }))} />
                <div className="flex gap-2 shrink-0">
                  {course.status === 'pending_review' && <>
                    <Button variant="outline" size="sm" disabled={busyId === course.id} onClick={() => void act(course, () => moderationApi.reviewCourse(course.id, 'reject', notes[course.id] || ''), true)}>{t('moderation.reject')}</Button>
                    <Button variant="success" size="sm" isLoading={busyId === course.id} onClick={() => void act(course, () => moderationApi.reviewCourse(course.id, 'approve', notes[course.id] || ''), false)}>{t('moderation.approve')}</Button>
                  </>}
                  {course.status === 'published' && <Button variant="danger" size="sm" isLoading={busyId === course.id} onClick={() => void act(course, () => moderationApi.setSuspension(course.id, true, notes[course.id] || ''), true)}>{t('moderation.suspend')}</Button>}
                  {course.status === 'suspended' && <Button variant="outline" size="sm" isLoading={busyId === course.id} onClick={() => void act(course, () => moderationApi.setSuspension(course.id, false, notes[course.id] || ''), false)}>{t('moderation.restore')}</Button>}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};

/** Audited moderation decisions (courses, reviews, forum reports). */
export const ModerationHistoryPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<ModerationEvent[] | null>(null);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!usesApi) return;
    moderationApi.history(page).then(result => { setEvents(result.data); setPages(result.pagination.pages || 1); }).catch(cause => setError(apiErrorMessage(t, cause)));
  }, [page, t]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title={t('moderation.historyTitle')} subtitle={t('moderation.historySubtitle')} />
      {!usesApi && <ApiModeNotice />}
      <ErrorAlert message={error} />
      {usesApi && !events && !error && <LoadingState />}
      {events?.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('moderation.historyEmpty')}</p>}
      {!!events?.length && (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs text-xs">
          {events.map(event => (
            <li key={event.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-bold text-slate-900">{t(`moderation.actions.${event.action}`, { defaultValue: event.action })}</span>
                <span className="text-slate-500 block">{event.actorName} ({t(`adminPanel.roles.${event.actorRole}`, { defaultValue: event.actorRole })}) · {event.targetType} #{event.targetId.slice(-8)}</span>
              </div>
              <span className="text-slate-400 tabular-nums">{formatDateTime(event.createdAt, i18n.language)}</span>
            </li>
          ))}
        </ul>
      )}
      <SimplePager page={page} pages={pages} onChange={setPage} />
    </div>
  );
};
