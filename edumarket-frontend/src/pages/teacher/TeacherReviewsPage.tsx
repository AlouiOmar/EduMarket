import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader } from '../../components/molecules/PageStates';
import { courseTeamApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDate } from '../../utils/format';
import type { ManagedReview } from '../../types/platform';

/** Reviews left on the courses the teacher/institution manages, with a public reply per review. */
export const TeacherReviewsPage: React.FC = () => {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<ManagedReview[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unanswered'>('all');
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); courseTeamApi.managedReviews().then(setReviews).catch(cause => setError(apiErrorMessage(t, cause))); }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('teacherTeamUi.reviewsTitle')} subtitle={t('teacherTeamUi.reviewsSubtitle')} /><ApiModeNotice /></div>;
  const visible = (reviews || []).filter(review => filter === 'all' || !review.reply);
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title={t('teacherTeamUi.reviewsTitle')} subtitle={t('teacherTeamUi.reviewsSubtitle')} />
      <div className="flex gap-2" role="group" aria-label={t('teacherTeamUi.filter')}>
        {(['all', 'unanswered'] as const).map(value => <Button key={value} size="sm" variant={filter === value ? 'primary' : 'outline'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`teacherTeamUi.${value}`)}</Button>)}
      </div>
      <ErrorAlert message={error} onRetry={load} />
      {!reviews && !error && <LoadingState />}
      {reviews && visible.length === 0 && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('teacherTeamUi.noReviews')}</p>}
      <ul className="space-y-4">
        {visible.map(review => <ReviewItem key={review.id} review={review} onSaved={reply => setReviews(prev => (prev || []).map(item => item.id === review.id ? { ...item, reply } : item))} />)}
      </ul>
    </div>
  );
};

const ReviewItem: React.FC<{ review: ManagedReview; onSaved: (reply: ManagedReview['reply']) => void }> = ({ review, onSaved }) => {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(review.reply?.body || '');
  const [editing, setEditing] = useState(!review.reply);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (body: string) => {
    setBusy(true); setError('');
    try { const result = await courseTeamApi.replyToReview(review.courseId, review.id, body); onSaved(result.reply); setEditing(!result.reply); setDraft(result.reply?.body || ''); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  return (
    <li className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-900">{review.courseTitle}</span>
        <span className="text-slate-500">{review.studentName} · {formatDate(review.createdAt, i18n.language)}</span>
      </div>
      <div className="flex items-center gap-0.5" aria-label={t('teacherTeamUi.rating', { rating: review.rating })}>
        {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`w-3.5 h-3.5 ${index < review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} aria-hidden />)}
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-line">{review.comment}</p>
      {review.reply && !editing && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm text-indigo-900 space-y-2">
          <p className="text-xs font-semibold">{t('teacherTeamUi.yourReply')}</p>
          <p className="whitespace-pre-line">{review.reply.body}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
            <Button size="sm" variant="ghost" className="text-rose-600" isLoading={busy} onClick={() => void save('')}>{t('teacherTeamUi.removeReply')}</Button>
          </div>
        </div>
      )}
      {editing && (
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(draft.trim()); }}>
          <Textarea aria-label={t('teacherTeamUi.replyLabel')} placeholder={t('teacherTeamUi.replyPlaceholder')} rows={3} maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} required />
          <div className="flex gap-2 justify-end">
            {review.reply && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(review.reply?.body || ''); }}>{t('platformCommon.cancel')}</Button>}
            <Button type="submit" size="sm" variant="primary" isLoading={busy}>{t('teacherTeamUi.publishReply')}</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </li>
  );
};
