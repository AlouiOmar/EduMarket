import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../../utils/apiErrors';
import { Assignment, Course } from '../../types';
import { assignmentService } from '../../services/assignmentService';
import { courseService } from '../../services/courseService';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';

export const ApiTeacherAssignmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [points, setPoints] = useState('100');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const refresh = async () => {
    const [assignmentResult, courseResult] = await Promise.all([assignmentService.listTeacher(), courseService.getMyCourses()]);
    setAssignments(assignmentResult.data); setCourses(courseResult.data.filter(course => course.status === 'published'));
    setCourseId(current => current || courseResult.data.find(course => course.status === 'published')?.id || '');
  };
  useEffect(() => { void refresh().catch(() => setError(t('teacherDashUi.assignmentsLoadError'))); }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await assignmentService.create({ courseId, title, instructions, dueAt: new Date(dueAt).toISOString(), points: Number(points) });
      setTitle(''); setInstructions(''); setDueAt(''); await refresh();
    } catch (cause) { setError(describeApiError(cause) || t('teacherDashUi.assignmentCreateError')); }
  };
  const grade = async (assignmentId: string, submissionId: string) => {
    try { await assignmentService.grade(assignmentId, submissionId, Number(scores[submissionId]), feedback[submissionId] || ''); setError(''); await refresh(); }
    catch { setError(t('teacherDashUi.gradeError')); }
  };

  return <div className="space-y-6 max-w-4xl">
    <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('teacherDashUi.assignmentsTitle')}</h1><p className="text-xs text-slate-500 mt-1">{t('teacherDashUi.assignmentsSubtitle')}</p></div>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-bold">{t('teacherDashUi.createAssignment')}</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <select required value={courseId} onChange={event => setCourseId(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm"><option value="">{t('teacherDashUi.choosePublishedCourse')}</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
        <input required minLength={3} maxLength={180} value={title} onChange={event => setTitle(event.target.value)} placeholder={t('teacherDashUi.assignmentTitle')} className="rounded-lg border border-slate-300 p-2 text-sm" />
        <input required type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm" />
        <input required type="number" min="1" max="1000" value={points} onChange={event => setPoints(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm" aria-label={t('teacherDashUi.maxPoints')} />
      </div>
      <textarea required minLength={5} maxLength={12000} rows={4} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Instructions" className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
      <Button type="submit" variant="primary" size="sm" disabled={!courseId}>{t('teacherDashUi.publishAssignment')}</Button>
    </form>
    {assignments.map(assignment => <article key={assignment.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex justify-between gap-4"><div><span className="text-xs text-indigo-600">{assignment.courseTitle}</span><h2 className="font-bold">{assignment.title}</h2><p className="text-xs text-slate-500">Échéance : {new Date(assignment.dueAt).toLocaleString()}</p></div><Badge variant="info" size="sm">/{assignment.points}</Badge></div>
      {(assignment.submissions || []).length === 0 && <p className="text-xs text-slate-500">{t('teacherDashUi.noSubmissions')}</p>}
      {(assignment.submissions || []).map(submission => <section key={submission.id} className="border-t pt-4 space-y-2">
        <div className="flex justify-between"><strong className="text-sm">{submission.studentName}</strong><Badge variant={submission.status === 'graded' ? 'success' : 'warning'} size="sm">{submission.status}</Badge></div>
        {submission.answerText && <p className="text-sm whitespace-pre-line text-slate-700">{submission.answerText}</p>}
        {submission.files?.map((file, index) => <button key={`${file.url}-${index}`} type="button" onClick={() => void assignmentService.downloadFile(file).catch(() => setError(t('teacherVerification.downloadError')))} className="me-3 text-xs text-indigo-700 underline underline-offset-2">{file.name} · {t('teacherVerification.downloadDocument')}</button>)}
        <p className="text-[11px] text-slate-400">Soumis le {new Date(submission.submittedAt).toLocaleString()}</p>
        {submission.status === 'graded' ? <p className="text-sm">{t('teacherDashUi.graded', { score: submission.score, points: assignment.points, feedback: submission.feedback })}</p> : <div className="grid sm:grid-cols-[130px_1fr_auto] gap-2"><input type="number" min="0" max={assignment.points} value={scores[submission.id] ?? ''} onChange={event => setScores(prev => ({ ...prev, [submission.id]: event.target.value }))} placeholder={`/${assignment.points}`} className="rounded-lg border p-2 text-sm" /><input value={feedback[submission.id] || ''} onChange={event => setFeedback(prev => ({ ...prev, [submission.id]: event.target.value }))} maxLength={4000} placeholder="Commentaire pédagogique" className="rounded-lg border p-2 text-sm" /><Button variant="primary" size="sm" disabled={scores[submission.id] === undefined || scores[submission.id] === ''} onClick={() => void grade(assignment.id, submission.id)}>Enregistrer la note</Button></div>}
      </section>)}
    </article>)}
    {assignments.length === 0 && <p className="text-sm text-slate-500">{t('teacherDashUi.noAssignments')}</p>}
  </div>;
};
