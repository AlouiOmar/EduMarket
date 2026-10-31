import { Course } from '../types';
import { apiRequest, usesApi } from './apiClient';
import { courseService } from './courseService';

export interface PublicTeacher {
  id: string;
  name: string;
  headline: string;
  bio: string;
  joinedDate: string;
  avatar: string;
  rating: number;
  ratingCount: number;
  coursesCount: number;
  studentsCount: number;
  website?: string;
  courses?: Course[];
}
export interface PublicTeacherPage { items: PublicTeacher[]; total: number; page: number; limit: number; }

class PublicTeacherService {
  async list(search?: string, page = 1): Promise<PublicTeacherPage> {
    if (!usesApi) return { items: [], total: 0, page, limit: 20 };
    const params = new URLSearchParams();
    if (search?.trim()) params.set('search', search.trim());
    params.set('page', String(page)); params.set('limit', '20');
    const result = await apiRequest<{ data: PublicTeacher[]; pagination: { page: number; limit: number; total: number } }>(`/teachers?${params}`);
    return { items: result.data, ...result.pagination };
  }
  async get(teacherId: string): Promise<PublicTeacher> {
    const result = await apiRequest<{ data: PublicTeacher & { courses: Course[] } }>(`/teachers/${encodeURIComponent(teacherId)}`);
    return { ...result.data, courses: result.data.courses.map(course => courseService.normalizeApiCourse(course)) };
  }
}

export const publicTeacherService = new PublicTeacherService();
