import { apiRequest } from './apiClient';

export interface CourseReview { id: string; rating: number; comment: string; createdAt: string; studentName: string; reply?: { body: string; repliedAt: string } | null; }
export interface ModerationCourseReview extends CourseReview { courseTitle: string; status: 'published' | 'hidden'; }
export interface CourseReviewsData { reviews: CourseReview[]; mine: Omit<CourseReview, 'studentName'> | null; rating: number; ratingCount: number; }

class CourseReviewService {
  async list(courseId: string): Promise<CourseReviewsData> {
    return (await apiRequest<{ data: CourseReviewsData }>(`/courses/${encodeURIComponent(courseId)}/reviews`)).data;
  }
  async save(courseId: string, rating: number, comment: string): Promise<{ rating: number; ratingCount: number }> {
    const result = await apiRequest<{ data: { courseRating: number; ratingCount: number } }>(`/courses/${encodeURIComponent(courseId)}/reviews/mine`, {
      method: 'PUT', body: JSON.stringify({ rating, comment }),
    });
    return { rating: result.data.courseRating, ratingCount: result.data.ratingCount };
  }
  async getModerationQueue(): Promise<ModerationCourseReview[]> {
    return (await apiRequest<{ data: ModerationCourseReview[] }>('/courses/moderation/reviews')).data;
  }
  async setModerationStatus(reviewId: string, status: 'published' | 'hidden'): Promise<void> {
    await apiRequest(`/courses/moderation/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  }
}

export const courseReviewService = new CourseReviewService();
