import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Video, 
  MapPin, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  X, 
  Star,
  ExternalLink,
  Plus
} from 'lucide-react';
import { sessionService } from '../../services/sessionService';
import { TutoringSession } from '../../types';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { JitsiMeetingRoom, SessionBookingForm } from '../../components/organisms/SessionOrganisms';
import { useAuth } from '../../contexts/AuthContext';
import { usesApi } from '../../services/apiClient';
import { paymentApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { Textarea } from '../../components/atoms/Textarea';

export const SessionsListPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { role } = useAuth();
  const [sessions, setSessions] = useState<TutoringSession[]>([]);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [ratedSessionId, setRatedSessionId] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  useEffect(() => {
    sessionService.getSessions().then(res => setSessions(res.data)).catch(() => setSessions([]));
  }, []);

  const handleBook = async (data: { slotId: string; subject: string; notes?: string }) => {
    try {
      const res = await sessionService.bookSession(data);
      setSessions(prev => [res.data, ...prev]); setShowBooking(false); setBookingError('');
    } catch (cause) {
      if (usesApi && (cause as { code?: string }).code === 'PAYMENT_REQUIRED') {
        // Paid slots are reserved and settled through the payment provider before the teacher can confirm.
        try { window.location.assign((await paymentApi.checkoutSession(data.slotId, { subject: data.subject, notes: data.notes })).checkoutUrl); }
        catch (checkoutError) { setBookingError(apiErrorMessage(t, checkoutError)); }
        return;
      }
      setBookingError(usesApi ? apiErrorMessage(t, cause) : t('sharedUi.slotTaken'));
    }
  };

  const [actionError, setActionError] = useState('');
  const [rescheduling, setRescheduling] = useState<{ session: TutoringSession; slots: (TutoringSession & { slotId: string })[] | null } | null>(null);
  const handleCancel = async (id: string) => {
    setActionError('');
    try {
      const res = await sessionService.updateSessionStatus(id, 'cancelled');
      setSessions(prev => prev.map(s => s.id === id ? res.data : s));
    } catch (cause) { setActionError(apiErrorMessage(t, cause)); }
  };
  const openReschedule = async (session: TutoringSession) => {
    setActionError(''); setRescheduling({ session, slots: null });
    try {
      const result = await sessionService.getAvailability(session.teacherId);
      setRescheduling({ session, slots: result.data.filter(slot => slot.type === session.type && slot.price === session.price && slot.slotId !== session.id) });
    } catch (cause) { setRescheduling(null); setActionError(apiErrorMessage(t, cause)); }
  };
  const confirmReschedule = async (targetId: string) => {
    if (!rescheduling) return;
    setActionError('');
    try {
      const moved = await sessionService.reschedule(rescheduling.session.id, targetId);
      const sourceId = rescheduling.session.id;
      setSessions(prev => [...prev.filter(s => s.id !== sourceId && s.id !== moved.id), moved].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)));
      setRescheduling(null);
    } catch (cause) { setActionError(apiErrorMessage(t, cause)); }
  };
  const canReschedule = (session: TutoringSession) => usesApi && ['pending', 'confirmed'].includes(session.status) && session.paymentStatus !== 'awaiting_payment'
    && new Date(`${session.date}T${session.startTime}:00Z`).getTime() > Date.now();

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('sessions.tutoringSessions')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('sharedUi.sessionsSubtitle')}</p>
        </div>
        {role === 'student' && <Button variant="primary" size="sm" onClick={() => setShowBooking(true)} leftIcon={<Plus className="w-4 h-4" />}>
          {t('sessions.bookSession')}
        </Button>}
      </div>

      {showBooking && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          {bookingError && <p role="alert" className="mb-4 text-sm text-rose-600">{bookingError}</p>}
          <SessionBookingForm
            onBook={handleBook}
            onCancel={() => setShowBooking(false)}
          />
        </div>
      )}

      {/* Sessions Cards */}
      <div className="space-y-4">
        {sessions.map(s => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={s.type === 'online' ? 'purple' : 'info'} size="sm">
                  {s.type === 'online' ? t('sharedUi.jitsi') : t('sharedUi.inPerson')}
                </Badge>
                <Badge variant={s.status === 'confirmed' ? 'success' : s.status === 'pending' ? 'warning' : 'default'} size="sm">
                  {t(`teacherUi.statuses.${s.status}`, { defaultValue: s.status === 'confirmed' ? t('teacherUi.confirmed') : s.status })}
                </Badge>
              </div>

              <h3 className="text-base font-bold text-slate-900">{s.subject}</h3>
              <p className="text-xs text-slate-500">{s.notes || t('sharedUi.defaultNotes')}</p>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  {/* date/startTime are UTC parts of the API instant: shown in the user's own time zone. */}
                  <span>{formatDateTime(`${s.date}T${s.startTime}:00Z`, i18n.language)} ({s.durationMinutes} min)</span>
                </div>
                <span>Avec {s.teacherName}</span>
                {s.location && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-indigo-600" />
                    <span>{s.location.venue}, {s.location.city}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {s.type === 'online' && (usesApi ? s.meetingUrl : s.jitsiRoomId) && s.status === 'confirmed' && (
                <Link to={`/sessions/room/${s.jitsiRoomId}`}>
                  <Button variant="primary" size="sm" leftIcon={<Video className="w-4 h-4" />}>
                    {t('sessions.joinJitsiRoom')}
                  </Button>
                </Link>
              )}

              {(usesApi ? role === 'student' && s.status === 'completed' : s.status === 'confirmed') && (
                <Button variant="outline" size="sm" onClick={() => { setRatedSessionId(s.id); setRatingScore(s.rating || 5); setReviewComment(s.reviewComment || ''); setReviewError(''); }}>
                  {usesApi && s.rating ? t('sessions.editReview') : t('sessions.rateSession')}
                </Button>
              )}
              {usesApi && s.rating && <span className="text-xs text-amber-600">{s.rating}/5</span>}

              {canReschedule(s) && (
                <Button variant="outline" size="sm" onClick={() => void openReschedule(s)}>
                  {t('rescheduleUi.reschedule')}
                </Button>
              )}
              {['pending', 'confirmed'].includes(s.status) && (
                <Button variant="ghost" size="sm" onClick={() => void handleCancel(s.id)} className="text-rose-600 hover:bg-rose-50">
                  {t('rescheduleUi.cancel')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {actionError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{actionError}</p>}
      {rescheduling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
          <div className="bg-white rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 id="reschedule-title" className="text-sm font-bold text-slate-900">{t('rescheduleUi.title')}</h3>
            <p className="text-xs text-slate-500">{t(role === 'student' ? 'rescheduleUi.studentHint' : 'rescheduleUi.teacherHint')}</p>
            {!rescheduling.slots && <p role="status" className="text-xs text-slate-500">{t('platformCommon.loading')}</p>}
            {rescheduling.slots?.length === 0 && <p className="text-xs text-slate-500">{t('rescheduleUi.noSlots')}</p>}
            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {rescheduling.slots?.map(slot => (
                <li key={slot.slotId} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <span>{formatDateTime(`${slot.date}T${slot.startTime}:00Z`, i18n.language)} · {slot.durationMinutes} min</span>
                  <Button size="sm" variant="primary" onClick={() => void confirmReschedule(slot.slotId)}>{t('rescheduleUi.choose')}</Button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => setRescheduling(null)}>{t('platformCommon.cancel')}</Button></div>
          </div>
        </div>
      )}

      {/* Rating Dialog */}
      {ratedSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-sm font-bold text-slate-900">{t('sessions.reviewTitle')}</h3>
            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} / 5`}
                  onClick={() => setRatingScore(star)}
                  className={`p-1 ${star <= ratingScore ? 'text-amber-500' : 'text-slate-300'}`}
                >
                  <Star className="w-6 h-6 fill-current" />
                </button>
              ))}
            </div>
            {usesApi && <label className="block text-xs font-medium text-slate-700">{t('sessions.reviewFeedback')}
              <Textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} required minLength={10} maxLength={2000} rows={4} className="mt-2" />
            </label>}
            {reviewError && <p role="alert" className="text-xs text-rose-700">{reviewError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRatedSessionId(null)}>
                Annuler
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={savingReview}
                onClick={async () => {
                  const sessionId = ratedSessionId;
                  if (!sessionId) return;
                  if (!usesApi) { alert('Merci pour votre avis !'); setRatedSessionId(null); return; }
                  if (reviewComment.trim().length < 10) { setReviewError(t('sessions.reviewMinLength')); return; }
                  setSavingReview(true); setReviewError('');
                  try {
                    const review = await sessionService.reviewSession(sessionId, ratingScore, reviewComment);
                    setSessions(previous => previous.map(session => session.id === sessionId ? { ...session, rating: review.rating, reviewComment: review.comment } : session));
                    setRatedSessionId(null);
                  } catch (cause) { setReviewError((cause as { code?: string }).code || 'REVIEW_FAILED'); }
                  finally { setSavingReview(false); }
                }}
              >
                {usesApi ? t('sessions.saveReview') : t('sessions.rateSession')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const JitsiRoomPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [meeting, setMeeting] = useState<TutoringSession | null>(null);
  const [checked, setChecked] = useState(!usesApi);
  const [meetingLoadFailed, setMeetingLoadFailed] = useState(false);
  const meetingContainer = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    setMeeting(null);
    setChecked(false);
    sessionService.getSessions().then(result => {
      if (active) setMeeting(result.data.find(session => session.jitsiRoomId === roomId && session.meetingUrl && session.status === 'confirmed' && session.type === 'online') || null);
    }).catch(() => { if (active) setMeeting(null); }).finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (!meeting?.meetingUrl || !meetingContainer.current) return;
    let active = true;
    let api: { dispose: () => void } | undefined;
    setMeetingLoadFailed(false);
    const meetingUrl = new URL(meeting.meetingUrl);
    const roomName = decodeURIComponent(meetingUrl.pathname.split('/').filter(Boolean).at(-1) || '');
    const jitsiWindow = window as Window & { JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => { dispose: () => void } };
    const mountMeeting = () => {
      if (!active || !meetingContainer.current || !jitsiWindow.JitsiMeetExternalAPI || !roomName) return;
      api = new jitsiWindow.JitsiMeetExternalAPI(meetingUrl.hostname, {
        roomName,
        parentNode: meetingContainer.current,
        width: '100%',
        height: '100%',
        configOverwrite: { prejoinPageEnabled: true },
      });
    };
    if (jitsiWindow.JitsiMeetExternalAPI) mountMeeting();
    else {
      const script = document.createElement('script');
      script.src = `${meetingUrl.origin}/external_api.js`;
      script.async = true;
      script.onload = mountMeeting;
      script.onerror = () => { if (active) setMeetingLoadFailed(true); };
      document.head.appendChild(script);
    }
    return () => { active = false; api?.dispose(); };
  }, [meeting?.meetingUrl]);

  if (usesApi) return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {!checked ? <p className="text-sm text-slate-500">{t('sessions.meetingLoading')}</p>
        : meeting?.meetingUrl ? <div className="space-y-3"><h1 className="text-lg font-semibold text-slate-800">{meeting.subject || t('sessions.tutoringSessions')}</h1>{meetingLoadFailed ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{t('sessions.meetingConnectionFailed')}</p> : <div ref={meetingContainer} className="w-full h-[min(78vh,760px)] overflow-hidden rounded-2xl border border-slate-200 bg-black" />}</div>
          : <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">{t('sessions.meetingUnavailable')} <Button className="ms-3" variant="outline" size="sm" onClick={() => navigate('/student/sessions')}>{t('sessions.tutoringSessions')}</Button></div>}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-4">
      <JitsiMeetingRoom
        roomId={roomId || 'session-771'}
        sessionTitle={t('sharedUi.roomTitle')}
        onLeave={() => navigate('/student/sessions')}
      />
    </div>
  );
};
