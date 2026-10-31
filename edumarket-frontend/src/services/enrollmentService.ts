import { Course } from '../types';
import { apiRequest, usesApi } from './apiClient';
import { courseService } from './courseService';

export interface EnrollmentProgress {
  completedLessonIds: string[];
  completedAt: string | null;
  totalLessons: number;
}

export interface QuizGradeResult {
  attemptId: string;
  score: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  results: Array<{ questionId: string; selectedOptionIndex: number | null; correctOptionIndex: number; explanation: string }>;
}

export interface LearningHistoryEntry {
  id: string;
  type: 'lesson_completed' | 'quiz_submitted';
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  createdAt: string;
  score?: number;
  passed?: boolean;
}

export interface CourseEnrollment {
  id: string;
  course: Course;
  enrolledAt: string;
  completedLessonIds: string[];
  completedAt: string | null;
  progressPercent: number;
  accessType?: 'free' | 'purchase' | 'subscription';
  accessExpiresAt?: string | null;
}

type RawEnrollment = {
  _id: string;
  courseId: Course & { _id?: string };
  enrolledAt: string;
  completedLessonIds: string[];
  completedAt: string | null;
  accessType?: 'free' | 'purchase' | 'subscription';
  accessExpiresAt?: string | null;
};

const mapEnrollment = (item: RawEnrollment): CourseEnrollment => {
  const course = courseService.normalizeApiCourse(item.courseId);
  const total = course.chapters.reduce((sum, chapter) => sum + chapter.lessons.length, 0);
  return {
    id: item._id,
    course,
    enrolledAt: item.enrolledAt,
    completedLessonIds: item.completedLessonIds || [],
    completedAt: item.completedAt,
    progressPercent: total ? Math.round((item.completedLessonIds.length / total) * 100) : 0,
    accessType: item.accessType, accessExpiresAt: item.accessExpiresAt ?? null,
  };
};

export const enrollmentService = {
  async getMine(): Promise<CourseEnrollment[]> {
    if (!usesApi) return [];
    const result = await apiRequest<{ data: RawEnrollment[] }>('/enrollments');
    return result.data.map(mapEnrollment);
  },

  async getHistory(): Promise<LearningHistoryEntry[]> {
    if (!usesApi) return [];
    const result = await apiRequest<{ data: LearningHistoryEntry[] }>('/enrollments/history');
    return result.data;
  },

  async getForCourse(courseId: string): Promise<RawEnrollment> {
    return apiRequest<{ data: RawEnrollment }>(`/enrollments/${encodeURIComponent(courseId)}`).then(result => result.data);
  },

  async enrollFreeCourse(courseId: string): Promise<void> {
    await apiRequest('/enrollments', { method: 'POST', body: JSON.stringify({ courseId }) });
  },

  async completeLesson(courseId: string, lessonId: string): Promise<EnrollmentProgress> {
    const result = await apiRequest<{ data: EnrollmentProgress }>(
      `/enrollments/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
      { method: 'PUT' },
    );
    return result.data;
  },

  async submitQuiz(courseId: string, lessonId: string, answers: Array<{ questionId: string; selectedOptionIndex: number }>): Promise<QuizGradeResult> {
    const result = await apiRequest<{ data: QuizGradeResult }>(
      `/enrollments/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/quiz-attempts`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    );
    return result.data;
  },
};
