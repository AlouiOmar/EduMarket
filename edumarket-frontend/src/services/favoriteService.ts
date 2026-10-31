import { apiRequest } from './apiClient';
import { courseService } from './courseService';
import { Course } from '../types';

class FavoriteService {
  async list(): Promise<Course[]> {
    const result = await apiRequest<{ success: boolean; data: Course[] }>('/favorites');
    return result.data.map(course => courseService.normalizeApiCourse(course));
  }
  async set(courseId: string, favorited: boolean): Promise<void> {
    await apiRequest(`/favorites/${encodeURIComponent(courseId)}`, { method: favorited ? 'PUT' : 'DELETE' });
  }
}

export const favoriteService = new FavoriteService();
