import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { Enrollment } from '../enrollments/model.js';
import { QuizAttempt } from '../enrollments/quiz-attempt.model.js';
import { Certificate } from '../certificates/model.js';
import { Exam, ExamAttempt, InPersonExamResult } from '../exams/models.js';
import { InstitutionProfile } from '../institutions/profile.model.js';
import { ForumReport } from '../forum/models.js';
import { ContentReport } from '../reports/model.js';
import { SupportTicket } from '../support/model.js';
import { Order } from '../payments/models.js';
import { manageableCourseFilter } from '../courses/service.js';
import { progressPercent } from '../courses/structure.js';

export const analyticsRoutes = Router();
analyticsRoutes.use(authenticate);

const countBy = async (model: mongoose.Model<any>, field: string, match: Record<string, unknown> = {}) => {
  const rows = await model.aggregate<{ _id: string; count: number }>([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map(row => [row._id ?? 'unknown', row.count]));
};

analyticsRoutes.get('/admin/overview', allowRoles('admin'), async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 13 * 86_400_000); since.setUTCHours(0, 0, 0, 0);
    const [usersByRole, usersByStatus, coursesByStatus, enrollments, completedEnrollments, certificates, pendingTeachers, pendingInstitutions, openReports, openTickets, revenue, signups] = await Promise.all([
      countBy(User, 'role'), countBy(User, 'status'), countBy(Course, 'status'),
      Enrollment.countDocuments(), Enrollment.countDocuments({ completedAt: { $ne: null } }), Certificate.countDocuments(),
      User.countDocuments({ 'teacherVerification.status': 'pending' }), InstitutionProfile.countDocuments({ status: 'pending' }),
      ForumReport.countDocuments({ status: 'open' }).then(async forum => forum + await ContentReport.countDocuments({ status: { $in: ['open', 'escalated'] } })), SupportTicket.countDocuments({ status: { $in: ['open', 'pending_user'] } }),
      Order.aggregate<{ gross: number; orders: number }>([{ $match: { status: 'paid' } }, { $group: { _id: null, gross: { $sum: '$totalAmount' }, orders: { $sum: 1 } } }]),
      User.aggregate<{ _id: string; count: number }>([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ]);
    const signupMap = new Map(signups.map(row => [row._id, row.count]));
    const dailySignups = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(since.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      return { date: day, count: signupMap.get(day) || 0 };
    });
    res.json({ success: true, data: {
      users: { total: Object.values(usersByRole).reduce((sum, count) => sum + count, 0), byRole: usersByRole, byStatus: usersByStatus },
      courses: { byStatus: coursesByStatus }, learning: { enrollments, completedEnrollments, certificates },
      queues: { pendingTeachers, pendingInstitutions, pendingCourseReviews: coursesByStatus.pending_review || 0, openReports, openTickets },
      revenue: { grossAmount: revenue[0]?.gross || 0, paidOrders: revenue[0]?.orders || 0 }, dailySignups,
    } });
  } catch (error) { next(error); }
});

/** Institution cohort analytics derived from the institution's courses and those of its verified affiliated teachers. */
/** Learning indicators for the courses an institution or teacher manages (own, affiliated, co-owned or coordinated). */
const learningReport = async (req: AuthRequest, res: any, next: any) => {
  try {
    const courses = await Course.find(await manageableCourseFilter({ userId: req.auth!.userId, role: req.auth!.role })).select('title status chapters teacherId').populate('teacherId', 'name').lean();
    const courseIds = courses.map(course => course._id);
    const outlines = new Map(courses.map(course => [String(course._id), course.chapters as any]));
    const [enrollments, quizStats, exams] = await Promise.all([
      Enrollment.find({ courseId: { $in: courseIds } }).sort({ enrolledAt: -1 }).limit(2000).populate('studentId', 'name email').lean(),
      QuizAttempt.aggregate<{ _id: unknown; attempts: number; passed: number }>([{ $match: { courseId: { $in: courseIds } } }, { $group: { _id: '$courseId', attempts: { $sum: 1 }, passed: { $sum: { $cond: ['$passed', 1, 0] } } } }]),
      Exam.find({ courseId: { $in: courseIds } }).select('_id').lean(),
    ]);
    const examIds = exams.map(exam => exam._id);
    const [online, inPerson] = await Promise.all([
      ExamAttempt.aggregate<{ avg: number; count: number; passed: number }>([{ $match: { examId: { $in: examIds }, submittedAt: { $ne: null } } }, { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 }, passed: { $sum: { $cond: ['$passed', 1, 0] } } } }]),
      InPersonExamResult.aggregate<{ avg: number; count: number; passed: number }>([{ $match: { examId: { $in: examIds } } }, { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 }, passed: { $sum: { $cond: ['$passed', 1, 0] } } } }]),
    ]);
    const progressOf = (enrollment: any) => {
      return progressPercent(outlines.get(String(enrollment.courseId)) || [], enrollment.completedLessonIds || []);
    };
    const quizMap = new Map(quizStats.map(row => [String(row._id), row]));
    const perCourse = courses.map(course => {
      const rows = enrollments.filter(enrollment => String(enrollment.courseId) === String(course._id));
      const quiz = quizMap.get(String(course._id));
      return {
        courseId: String(course._id), title: course.title, status: course.status, teacherName: (course.teacherId as any)?.name || '',
        enrollments: rows.length, completions: rows.filter(row => row.completedAt).length,
        averageProgress: rows.length ? Math.round(rows.reduce((sum, row) => sum + progressOf(row), 0) / rows.length) : 0,
        quizPassRate: quiz?.attempts ? Math.round(quiz.passed / quiz.attempts * 100) : null,
      };
    });
    const examCount = (online[0]?.count || 0) + (inPerson[0]?.count || 0);
    const examAverage = examCount ? ((online[0]?.avg || 0) * (online[0]?.count || 0) + (inPerson[0]?.avg || 0) * (inPerson[0]?.count || 0)) / examCount : null;
    res.json({ success: true, data: {
      totals: {
        courses: courses.length, publishedCourses: courses.filter(course => course.status === 'published').length,
        enrollments: enrollments.length, uniqueStudents: new Set(enrollments.map(row => String((row.studentId as any)?._id || row.studentId))).size,
        completionRate: enrollments.length ? Math.round(enrollments.filter(row => row.completedAt).length / enrollments.length * 100) : null,
        averageProgress: enrollments.length ? Math.round(enrollments.reduce((sum, row) => sum + progressOf(row), 0) / enrollments.length) : null,
        examAverageScore: examAverage === null ? null : Math.round(examAverage * 10) / 10,
        examPassRate: examCount ? Math.round(((online[0]?.passed || 0) + (inPerson[0]?.passed || 0)) / examCount * 100) : null,
      },
      courses: perCourse,
      students: enrollments.slice(0, 500).map(row => ({
        studentId: String((row.studentId as any)?._id || row.studentId), name: (row.studentId as any)?.name || '', email: (row.studentId as any)?.email || '',
        courseId: String(row.courseId), courseTitle: courses.find(course => String(course._id) === String(row.courseId))?.title || '',
        progress: progressOf(row), enrolledAt: row.enrolledAt, completedAt: row.completedAt,
      })),
    } });
  } catch (error) { next(error); }
};
analyticsRoutes.get('/institution', allowRoles('institution'), learningReport);
analyticsRoutes.get('/teacher', allowRoles('teacher'), learningReport);
