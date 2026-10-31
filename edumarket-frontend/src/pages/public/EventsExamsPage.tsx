import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, MapPin, Clock, Award, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { courseService } from '../../services/courseService';
import { Exam } from '../../types';
import { Button } from '../../components/atoms/Button';
import { usesApi } from '../../services/apiClient';
import { paymentApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatPrice } from '../../utils/format';
import { describeApiError } from '../../utils/apiErrors';
import { Badge } from '../../components/atoms/Badge';

export const EventsExamsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [exams, setExams] = useState<Exam[]>([]);
  const [enrolledMap, setEnrolledMap] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    courseService.getExams().then(res => setExams(res.data)).catch(() => setError(t('examUi.loadError')));
  }, []);

  const handleEnroll = async (examId: string) => {
    const exam = exams.find(item => item.id === examId);
    if (usesApi && exam && exam.fee > 0) {
      // Paid registrations are created server-side only after the provider confirms the payment.
      try { window.location.assign((await paymentApi.checkoutExam(examId)).checkoutUrl); }
      catch (cause) { setError(apiErrorMessage(t, cause)); }
      return;
    }
    try { await courseService.enrollExam(examId); setEnrolledMap(prev => ({ ...prev, [examId]: true })); setError(''); }
    catch (cause) {
      setError((cause as { status?: number }).status === 401 ? t('examUi.loginRequired') : (cause as { code?: string }).code === 'PAYMENT_REQUIRED' ? t('examUi.paymentRequired') : usesApi ? describeApiError(cause) : t('examUi.registerError'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {t('nav.events')}
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {t('examUi.eventsSubtitle')}
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

      <div className="space-y-6">
        {exams.map((exam) => {
          const isEnrolled = enrolledMap[exam.id] || exam.isEnrolled;

          return (
            <div key={exam.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2">
                  <Badge variant={exam.type === 'online' ? 'purple' : 'success'} size="sm">
                    {exam.type === 'online' ? t('examUi.online') : t('examUi.inPerson')}
                  </Badge>
                  <span className="text-xs font-semibold text-slate-500">
                    {exam.durationMinutes} min
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-900">
                  {exam.title}
                </h3>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {exam.description}
                </p>

                {exam.location && (
                  <div className="flex items-center gap-2 text-xs text-slate-600 pt-1">
                    <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{exam.location.venue} · {exam.location.city} ({exam.date})</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-slate-100 justify-end">
                <div className="text-start md:text-end">
                  <span className="text-xs text-slate-400 block">{t('examUi.fee')}</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">
                    {exam.fee === 0 ? t('examUi.free') : formatPrice(exam.fee, 'eur', i18n.language)}
                  </span>
                </div>

                {isEnrolled ? (
                  <div className="flex items-center gap-2">
                    {exam.type === 'online' ? (
                      <Link to={`/student/exams/${exam.id}/take`}>
                        <Button variant="success" size="sm">
                          {t('examUi.start')}
                        </Button>
                      </Link>
                    ) : exam.userResult ? (
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-200">
                        {t('examUi.result', { score: exam.userResult.score, status: exam.userResult.passed ? t('examUi.passed') : t('examUi.notPassed') })}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> {t('examUi.confirmed')}
                      </span>
                    )}
                  </div>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => handleEnroll(exam.id)}>
                    {usesApi && exam.fee > 0 ? t('checkout.payExam', { amount: formatPrice(exam.fee, 'eur', i18n.language) }) : t('examUi.register')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
