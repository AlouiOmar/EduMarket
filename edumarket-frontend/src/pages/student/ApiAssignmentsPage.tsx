import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../utils/format';
import { CheckCircle2, Clock } from 'lucide-react';
import { Assignment } from '../../types';
import { assignmentService } from '../../services/assignmentService';
import { Button } from '../../components/atoms/Button';
import { Textarea } from '../../components/atoms/Textarea';
import { Badge } from '../../components/atoms/Badge';

export const ApiAssignmentsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const refresh = () => assignmentService.listStudent().then(result => setAssignments(result.data));
  useEffect(() => { void refresh().catch(() => setError(t('studentUi.assignmentsLoadError'))); }, []);

  const submit = async (assignmentId: string) => {
    const files = selectedFiles[assignmentId] || [];
    const answerText = answers[assignmentId] || '';
    if (!answerText.trim() && files.length === 0) { setError(t('learning.noAssignmentContent')); return; }
    setBusy(assignmentId); setError('');
    try {
      await assignmentService.submit(assignmentId, answerText, files);
      await refresh();
      setAnswers(prev => ({ ...prev, [assignmentId]: '' }));
      setSelectedFiles(prev => ({ ...prev, [assignmentId]: [] }));
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(code === 'ASSIGNMENT_CLOSED' ? t('studentUi.assignmentClosed') : code === 'ASSIGNMENT_FILE_TOO_LARGE' ? t('studentUi.assignmentFileTooLarge') : t('studentUi.assignmentSubmitError'));
    } finally { setBusy(''); }
  };

  return <div className="space-y-6 max-w-4xl">
    <div><h1 className="text-xl font-bold text-slate-900">{t('studentUi.assignmentsTitle')}</h1><p className="text-xs text-slate-500 mt-1">{t('studentUi.assignmentsSubtitle')}</p></div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {assignments.map(assignment => <article key={assignment.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
      <div className="flex items-start justify-between gap-4"><div><span className="text-xs text-indigo-600 font-semibold">{assignment.courseTitle}</span><h2 className="text-base font-bold text-slate-900">{assignment.title}</h2></div><Badge variant={assignment.status === 'graded' ? 'success' : assignment.status === 'overdue' ? 'danger' : 'warning'} size="sm">{assignment.status}</Badge></div>
      <p className="text-sm text-slate-700 whitespace-pre-line">{assignment.instructions}</p>
      <div className="flex items-center gap-2 text-xs text-slate-500"><Clock className="w-4 h-4" />{t('studentUi.dueDate', { date: formatDateTime(assignment.dueAt, i18n.language), points: assignment.points })}</div>
      {assignment.submission?.status === 'graded' ? <div className="rounded-lg bg-emerald-50 p-4 text-sm"><p className="font-semibold text-emerald-800">{t('studentUi.grade', { score: assignment.submission.score, points: assignment.points })}</p><p className="mt-1 text-slate-700">{assignment.submission.feedback || 'Aucun commentaire.'}</p></div> : assignment.submission ? <div className="rounded-lg bg-indigo-50 p-4 text-xs text-indigo-800"><CheckCircle2 className="inline w-4 h-4 me-1" />Devoir soumis le {new Date(assignment.submission.submittedAt).toLocaleString()} · En attente de correction.</div> : assignment.status === 'overdue' ? <p className="text-sm text-rose-600">La date limite est dépassée.</p> : <div className="space-y-3">
        <Textarea value={answers[assignment.id] || ''} onChange={event => setAnswers(prev => ({ ...prev, [assignment.id]: event.target.value }))} maxLength={12000} rows={5} placeholder={t('studentUi.answerPlaceholder')} />
        <div className="space-y-1"><input type="file" accept="application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.zip,.docx" multiple onChange={event => setSelectedFiles(prev => ({ ...prev, [assignment.id]: Array.from(event.target.files || []).slice(0, 3) }))} aria-label={t('learning.uploadWork')} className="block w-full text-xs text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-indigo-700" /><p className="text-[11px] text-slate-500">{t('learning.assignmentFilesHint')}</p>{selectedFiles[assignment.id]?.length ? <p className="text-xs text-slate-600">{t('learning.selectedFiles', { count: selectedFiles[assignment.id].length })}</p> : null}</div>
        <Button variant="primary" size="sm" disabled={!answers[assignment.id]?.trim() && !selectedFiles[assignment.id]?.length} isLoading={busy === assignment.id} onClick={() => void submit(assignment.id)}>{t('learning.submitAssignment')}</Button>
      </div>}
      {assignment.submission?.files?.length ? <ul className="space-y-1">{assignment.submission.files.map((file, index) => <li key={`${file.url}-${index}`}><button type="button" onClick={() => void assignmentService.downloadFile(file).catch(() => setError(t('teacherVerification.downloadError')))} className="text-xs text-indigo-700 underline underline-offset-2">{file.name} · {t('teacherVerification.downloadDocument')}</button></li>)}</ul> : null}
    </article>)}
    {assignments.length === 0 && !error && <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">{t('studentUi.noAssignments')}</p>}
  </div>;
};
