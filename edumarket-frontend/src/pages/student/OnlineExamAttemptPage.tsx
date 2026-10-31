import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Award } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../../utils/apiErrors';
import { Exam, ExamAttemptResult, ExamQuestion } from '../../types';
import { mockExams } from '../../mocks/mockData';
import { examService } from '../../services/examService';
import { usesApi } from '../../services/apiClient';
import { ExamLayout } from '../../components/templates/SpecializedLayouts';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { Button } from '../../components/atoms/Button';

const demoQuestions: ExamQuestion[] = [
  { id: 'demo-1', question: 'Which React hook exposes pending state for an action?', options: ['useActionState', 'useMemo', 'useId', 'useRef'] },
  { id: 'demo-2', question: 'Where must an exam score be calculated?', options: ['Only in the browser', 'On the server from stored answers', 'In a URL parameter', 'In local storage'] },
  { id: 'demo-3', question: 'Which CSS properties adapt to writing direction?', options: ['Physical margin-left', 'Logical properties', 'Absolute coordinates', 'GPU transforms'] },
];

export const OnlineExamAttemptPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [exam, setExam] = useState<Exam | null>(usesApi ? null : mockExams[0] || null);
  const [questions, setQuestions] = useState<ExamQuestion[]>(usesApi ? [] : demoQuestions);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const [result, setResult] = useState<ExamAttemptResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!usesApi) {
      if (exam) setDeadline(Date.now() + exam.durationMinutes * 60_000);
      return;
    }
    let active = true;
    void (async () => {
      try {
        let current = await examService.get(examId);
        if (!active) return;
        setExam(current); setQuestions(current.questions || []);
        if (current.submittedAt && current.userResult) {
          setResult({ ...current.userResult, passPercentage: current.passPercentage, submittedAt: current.submittedAt, certificateIssued: !!current.userResult.certificateIssued });
          return;
        }
        try {
          const attempt = await examService.start(examId);
          if (active) setDeadline(new Date(attempt.deadline).getTime());
        } catch (cause) {
          if ((cause as { code?: string }).code === 'EXAM_TIME_EXPIRED') {
            current = await examService.get(examId);
            if (active && current.userResult && current.submittedAt) {
              setExam(current); setResult({ ...current.userResult, passPercentage: current.passPercentage, submittedAt: current.submittedAt, certificateIssued: !!current.userResult.certificateIssued });
            } else if (active) setError('EXAM_TIME_EXPIRED');
          } else throw cause;
        }
      } catch (cause) { if (active) setError((cause as { code?: string }).code || 'EXAM_LOAD_FAILED'); }
    })();
    return () => { active = false; };
  }, [examId]);

  useEffect(() => {
    if (!deadline || result) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) { setExpired(true); setConfirmOpen(true); }
    };
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, result]);

  const submit = async () => {
    if (!exam) return;
    setBusy(true); setError('');
    try {
      if (usesApi) {
        const graded = await examService.submit(examId, Object.entries(answers).map(([questionId, selectedOptionIndex]) => ({ questionId, selectedOptionIndex })));
        setResult(graded);
      } else {
        const score = Math.round(Object.keys(answers).length / Math.max(questions.length, 1) * 100);
        setResult({ score, passed: score >= exam.passPercentage, passPercentage: exam.passPercentage, submittedAt: new Date().toISOString(), certificateIssued: false });
      }
      setConfirmOpen(false);
    } catch (cause) { setError((cause as { code?: string }).code || 'EXAM_SUBMIT_FAILED'); }
    finally { setBusy(false); }
  };

  if (result && exam) return <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6">
    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${result.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}><Award className="w-8 h-8" /></div>
    <h1 className="text-2xl font-bold text-slate-900">{result.passed ? t('examUi.passedTitle') : t('examUi.resultTitle')}</h1>
    <p className="text-sm text-slate-600">{t('examUi.serverScore', { score: result.score, pass: result.passPercentage })}</p>
    {result.certificateIssued && <p className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800">{t('examUi.certificateIssued')}</p>}
    <div className="flex justify-center gap-3">
      {result.certificateIssued && <Link to="/student/certificates"><Button variant="primary" size="md">{t('examUi.viewCertificate')}</Button></Link>}
      <Link to="/student/exams"><Button variant="outline" size="md">{t('examUi.backToExams')}</Button></Link>
    </div>
  </div>;

  if (error && !exam) return <div className="p-8 text-center text-rose-600" role="alert">{error === 'EXAM_TIME_EXPIRED' ? t('examUi.timeExpired') : describeApiError({ code: error })}</div>;
  if (!exam) return <div className="p-8 text-center text-slate-500" role="status">{t('examUi.loading')}</div>;
  const current = questions[questionIndex];
  if (!current) return <div className="p-8 text-center text-rose-600" role="alert">{t('examUi.noQuestions')}</div>;

  return <ExamLayout examTitle={exam.title} timeRemainingSeconds={secondsLeft} onFinishExam={() => setConfirmOpen(true)}>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <section className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="text-xs font-bold text-indigo-600">{t('examUi.questionOf', { index: questionIndex + 1, total: questions.length })}</div>
        <h2 className="text-base font-bold text-slate-900">{current.question}</h2>
        <div className="space-y-3">{current.options.map((option, index) => <button key={index} type="button" onClick={() => setAnswers(prev => ({ ...prev, [current.id]: index }))} className={`w-full p-4 rounded-xl border text-start text-sm ${answers[current.id] === index ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>{option}</button>)}</div>
        <div className="flex justify-between"><Button variant="outline" size="sm" disabled={questionIndex === 0} onClick={() => setQuestionIndex(index => index - 1)}>{t('examUi.previous')}</Button>{questionIndex < questions.length - 1 ? <Button variant="primary" size="sm" onClick={() => setQuestionIndex(index => index + 1)}>{t('examUi.next')}</Button> : <Button variant="success" size="sm" onClick={() => setConfirmOpen(true)}>{t('examUi.submitExam')}</Button>}</div>
      </section>
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-6"><h3 className="text-xs font-bold uppercase mb-4">{t('examUi.navigation')}</h3><div className="grid grid-cols-5 gap-2">{questions.map((question, index) => <button key={question.id} onClick={() => setQuestionIndex(index)} className={`h-10 rounded-lg text-xs font-bold ${index === questionIndex ? 'bg-indigo-600 text-white' : answers[question.id] !== undefined ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{index + 1}</button>)}</div></aside>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-rose-600">{describeApiError({ code: error })}</p>}
    <ConfirmationDialog isOpen={confirmOpen} title={expired ? t('examUi.timeUpTitle') : t('examUi.submitTitle')} description={t('examUi.submitDescription')} confirmLabel={t('examUi.submit')} isLoading={busy} onConfirm={submit} onCancel={() => { if (!expired) setConfirmOpen(false); }} />
  </ExamLayout>;
};
