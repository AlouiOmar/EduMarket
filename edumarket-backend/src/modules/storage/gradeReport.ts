import { AppError } from '../../common/errors.js';
import type { Role } from '../../common/auth.js';
import { Course } from '../courses/model.js';
import { canManageCourse } from '../courses/service.js';
import { progressPercent } from '../courses/structure.js';
import { Enrollment } from '../enrollments/model.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { Assignment, AssignmentSubmission } from '../assignments/models.js';
import { Exam, ExamAttempt, InPersonExamResult } from '../exams/models.js';

/** RFC 4180 cell; formula-looking cells are prefixed so spreadsheets do not execute them (CSV injection). */
const cell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Grade sheet of a course: progress, best quiz scores, assignment grades and exam results per learner.
 * UTF-8 with BOM so Excel opens accents and Arabic correctly.
 */
export async function buildGradeReport(courseId: string, actor: { userId: string; role: Role }) {
  const course = await Course.findById(courseId).select('title teacherId coOwnerIds chapters').lean();
  if (!course || !await canManageCourse(actor, course.teacherId, course.coOwnerIds)) throw new AppError(404, 'COURSE_NOT_FOUND');
  const lessons = course.chapters.flatMap((chapter: any) => chapter.lessons || []);
  const quizzes = lessons.filter((lesson: any) => lesson.quiz).map((lesson: any) => ({ lessonId: lesson.id, quizId: lesson.quiz.id, title: lesson.quiz.title || lesson.title }));
  const [enrollments, attempts, assignments, exams] = await Promise.all([
    Enrollment.find({ courseId }).populate('studentId', 'name email').lean(),
    QuizAttempt.find({ courseId }).select('studentId quizId score').lean(),
    Assignment.find({ courseId }).select('title points').sort({ dueAt: 1 }).lean(),
    Exam.find({ courseId }).select('title type').sort({ createdAt: 1 }).lean(),
  ]);
  const [submissions, onlineResults, inPersonResults] = await Promise.all([
    AssignmentSubmission.find({ assignmentId: { $in: assignments.map(item => item._id) } }).select('assignmentId studentId score status').lean(),
    ExamAttempt.find({ examId: { $in: exams.map(item => item._id) }, submittedAt: { $ne: null } }).select('examId studentId score passed').lean(),
    InPersonExamResult.find({ examId: { $in: exams.map(item => item._id) } }).select('examId studentId score passed').lean(),
  ]);
  const best = new Map<string, number>();
  for (const attempt of attempts) {
    const key = `${attempt.studentId}:${attempt.quizId}`;
    best.set(key, Math.max(best.get(key) ?? 0, attempt.score));
  }
  const submissionOf = new Map(submissions.map(item => [`${item.studentId}:${item.assignmentId}`, item]));
  const examOf = new Map([...onlineResults, ...inPersonResults].map(item => [`${item.studentId}:${item.examId}`, item]));

  const header = ['Student', 'Email', 'Progress %', 'Completed on', ...quizzes.map(quiz => `Quiz: ${quiz.title}`), ...assignments.map(item => `Assignment: ${item.title} (/${item.points})`), ...exams.map(item => `Exam: ${item.title}`)];
  const rows = enrollments.filter(row => row.studentId).map(row => {
    const student = row.studentId as any, id = String(student._id);
    return [
      student.name, student.email, progressPercent(course.chapters as any, row.completedLessonIds || []), row.completedAt ? new Date(row.completedAt).toISOString().slice(0, 10) : '',
      ...quizzes.map(quiz => best.has(`${id}:${quiz.quizId}`) ? best.get(`${id}:${quiz.quizId}`) : ''),
      ...assignments.map(item => { const submission = submissionOf.get(`${id}:${item._id}`); return submission?.status === 'graded' ? submission.score : submission ? 'submitted' : ''; }),
      ...exams.map(item => { const result = examOf.get(`${id}:${item._id}`); return result ? `${result.score}${result.passed ? ' (passed)' : ' (failed)'}` : ''; }),
    ];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const csv = '﻿' + [header, ...rows].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
  const safeTitle = course.title.normalize('NFKD').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'course';
  return { csv, fileName: `grades-${safeTitle}-${new Date().toISOString().slice(0, 10)}.csv` };
}
