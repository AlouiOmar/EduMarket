import { mockCourses, mockCategories, mockExams, mockCertificates } from '../mocks/mockData';
import { Course, Exam, Certificate } from '../types';
import { delay, createSuccessResponse, ApiResponse, apiRequest, usesApi, downloadApiFile, apiAssetUrl } from './apiClient';
import { examService } from './examService';

class CourseService {
  private courses: Course[] = [...mockCourses];
  private exams: Exam[] = [...mockExams];
  private certificates: Certificate[] = [...mockCertificates];

  async getCourses(filters?: {
    search?: string;
    tag?: string;
    category?: string;
    level?: string;
    price?: 'all' | 'free' | 'paid';
    sort?: 'popular' | 'rating' | 'newest' | 'price_asc' | 'price_desc';
  }): Promise<ApiResponse<Course[]>> {
    if (usesApi) {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.tag) params.set('tag', filters.tag);
      if (filters?.category && filters.category !== 'all') params.set('category', filters.category);
      if (filters?.level && filters.level !== 'all') params.set('level', filters.level);
      if (filters?.price) params.set('price', filters.price);
      if (filters?.sort) params.set('sort', filters.sort);
      const result = await apiRequest<{ success: boolean; data: Course[]; pagination: { total: number } }>(`/courses?${params}`);
        return createSuccessResponse(result.data.map(course => this.normalizeApiCourse(course)), undefined, result.pagination.total);
    }
    await delay();
    let result = [...this.courses];

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.subtitle.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q)) ||
        c.teacherName.toLowerCase().includes(q)
      );
    }

    if (filters?.category && filters.category !== 'all') {
      result = result.filter(c => c.category === filters.category);
    }

    if (filters?.level && filters.level !== 'all') {
      result = result.filter(c => c.level === filters.level);
    }

    if (filters?.price === 'free') {
      result = result.filter(c => c.isFree);
    } else if (filters?.price === 'paid') {
      result = result.filter(c => !c.isFree);
    }

    if (filters?.sort) {
      switch (filters.sort) {
        case 'rating':
          result.sort((a, b) => b.rating - a.rating);
          break;
        case 'popular':
          result.sort((a, b) => b.studentsCount - a.studentsCount);
          break;
        case 'newest':
          result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          break;
        case 'price_asc':
          result.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          result.sort((a, b) => b.price - a.price);
          break;
      }
    }

    return createSuccessResponse(result, undefined, result.length);
  }

  async getCourseById(id: string): Promise<ApiResponse<Course | null>> {
    if (usesApi) {
      try {
        const result = await apiRequest<{ success: boolean; data: Course }>(`/courses/${encodeURIComponent(id)}`);
        return createSuccessResponse(this.normalizeApiCourse(result.data));
      } catch (error) {
        if ((error as { status?: number }).status === 404) return createSuccessResponse(null);
        throw error;
      }
    }
    await delay();
    const course = this.courses.find(c => c.id === id || c.slug === id) || null;
    return createSuccessResponse(course);
  }

  async getMyCourses(): Promise<ApiResponse<Course[]>> {
    if (!usesApi) return createSuccessResponse(this.courses);
    const result = await apiRequest<{ success: boolean; data: Course[]; total: number }>('/courses/mine');
    return createSuccessResponse(result.data.map(course => this.normalizeApiCourse(course)), undefined, result.total);
  }

  async getCourseForEdit(id: string): Promise<ApiResponse<Course>> {
    if (!usesApi) {
      const course = this.courses.find(item => item.id === id);
      if (!course) throw new Error('COURSE_NOT_FOUND');
      return createSuccessResponse(course);
    }
    const result = await apiRequest<{ success: boolean; data: Course }>(`/courses/mine/${encodeURIComponent(id)}`);
    return createSuccessResponse(this.normalizeApiCourse(result.data));
  }

  /** `storage`: 'local', 'default' (uploader's default drive, or local when none is paired) or a paired account id. */
  async uploadLessonAsset(courseId: string, lessonId: string, kind: 'video' | 'resources', file: File, storage = 'default'): Promise<{ id: string; name: string; type: string; size: number; url: string }> {
    const body = new FormData(); body.append('file', file);
    const result = await apiRequest<{ data: { id: string; name: string; type: string; size: number; url: string } }>(`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/assets/${kind}?storage=${encodeURIComponent(storage)}`, { method: 'POST', body });
    return result.data;
  }

  async downloadResource(resource: { title: string; url: string }): Promise<void> {
    if (resource.url.startsWith('/courses/')) return downloadApiFile(resource.url, resource.title);
    window.open(resource.url, '_blank', 'noopener,noreferrer');
  }

  normalizeApiCourse(course: Course): Course {
    // The first API slice intentionally serves a smaller course DTO. Fill UI-only
    // fields with neutral values; never merge demo content into API responses.
    const raw = course as unknown as Omit<Course, 'teacherId'> & { _id?: string; teacherId?: unknown; teacherName?: string };
    const teacher = raw.teacherId && typeof raw.teacherId === 'object' ? raw.teacherId as { _id?: string; name?: string } : undefined;
    const teacherId = teacher?._id || raw.teacherId;
    const teacherName = teacher?.name || raw.teacherName || '';
    return {
      ...course,
      id: String(course.id || raw._id || ''), teacherId: String(teacherId || ''), teacherName,
      coverImage: apiAssetUrl(course.coverImage), tags: course.tags || [], isFree: Number(course.price) === 0,
      rating: course.rating ?? 0, ratingCount: course.ratingCount ?? 0, studentsCount: course.studentsCount ?? 0,
      totalDurationMinutes: course.totalDurationMinutes ?? 0, language: course.language || 'fr',
      teacherAvatar: course.teacherAvatar || '',
      teacherTitle: course.teacherTitle || '', chapters: course.chapters || [], hasCertification: course.hasCertification ?? false,
      certificationPathway: course.certificationPathway || 'learning_and_quiz', prerequisites: course.prerequisites || [],
      learningOutcomes: course.learningOutcomes || [], updatedAt: course.updatedAt || '',
    };
  }

  async getCategories() {
    if (usesApi) {
      const result = await apiRequest<{ success: boolean; data: { id: string; name: string; coursesCount: number }[] }>('/courses/categories');
      return createSuccessResponse(result.data);
    }
    await delay(50);
    return createSuccessResponse(mockCategories);
  }

  async getExams(): Promise<ApiResponse<Exam[]>> {
    if (usesApi) return examService.list();
    await delay();
    return createSuccessResponse(this.exams);
  }

  async enrollExam(examId: string): Promise<void> {
    if (usesApi) return examService.enroll(examId);
    await delay();
  }

  async getCertificates(userId?: string): Promise<ApiResponse<Certificate[]>> {
    if (usesApi) {
      const result = await apiRequest<{ success: boolean; data: Certificate[] }>('/certificates/mine');
      return createSuccessResponse(result.data);
    }
    await delay();
    const certs = userId 
      ? this.certificates.filter(c => c.userId === userId)
      : this.certificates;
    return createSuccessResponse(certs);
  }

  async createCourse(newCourse: Partial<Course>): Promise<ApiResponse<Course>> {
    if (usesApi) {
      const result = await apiRequest<{ success: boolean; data: Course }>('/courses', {
        method: 'POST', body: JSON.stringify(this.toApiCourse(newCourse)),
      });
      return createSuccessResponse(this.normalizeApiCourse(result.data));
    }
    await delay();
    const course: Course = {
      id: `course_${Date.now()}`,
      slug: (newCourse.title || 'nouveau-cours').toLowerCase().replace(/\s+/g, '-'),
      title: newCourse.title || 'Nouveau cours',
      subtitle: newCourse.subtitle || '',
      description: newCourse.description || '',
      coverImage: newCourse.coverImage || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=80',
      category: newCourse.category || 'Développement Web & Cloud',
      tags: newCourse.tags || [],
      level: newCourse.level || 'beginner',
      price: newCourse.price || 0,
      isFree: newCourse.isFree ?? (newCourse.price === 0),
      rating: 5.0,
      ratingCount: 1,
      studentsCount: 0,
      totalDurationMinutes: 120,
      language: 'Français',
      teacherId: newCourse.teacherId || 'user_teacher_1',
      teacherName: newCourse.teacherName || 'Dr. Sarah Mansour',
      teacherAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      teacherTitle: 'Formatrice Senior',
      status: 'published',
      chapters: newCourse.chapters || [],
      hasCertification: newCourse.hasCertification ?? true,
      certificationPathway: newCourse.certificationPathway || 'learning_and_quiz',
      prerequisites: newCourse.prerequisites || [],
      learningOutcomes: newCourse.learningOutcomes || [],
      updatedAt: new Date().toISOString().split('T')[0]
    };
    this.courses.unshift(course);
    return createSuccessResponse(course, 'Cours créé avec succès');
  }

  async updateCourse(id: string, updates: Partial<Course>): Promise<ApiResponse<Course | null>> {
    if (usesApi) {
      const result = await apiRequest<{ success: boolean; data: Course }>(`/courses/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify(this.toApiCourse(updates)),
      });
      return createSuccessResponse(this.normalizeApiCourse(result.data));
    }
    await delay();
    const index = this.courses.findIndex(c => c.id === id);
    if (index === -1) return createSuccessResponse(null, 'Cours introuvable');
    this.courses[index] = { ...this.courses[index], ...updates };
    return createSuccessResponse(this.courses[index], 'Cours mis à jour');
  }
  private toApiCourse(course: Partial<Course>) {
    return {
      title: course.title, subtitle: course.subtitle, description: course.description,
      category: course.category, level: course.level === 'all' ? undefined : course.level,
      // Omitted for co-owners/coordinators: price stays with the primary owner (server enforces it too).
      price: course.price === undefined && course.isFree === undefined ? undefined : course.isFree ? 0 : course.price, chapters: course.chapters, tags: course.tags, visibility: course.visibility,
      hasCertification: course.hasCertification, certificationPathway: course.certificationPathway,
      prerequisites: course.prerequisites, learningOutcomes: course.learningOutcomes,
      courseCode: course.courseCode, accessState: course.accessState, settings: course.settings, syllabus: course.syllabus, banner: course.banner,
    };
  }
}

export const courseService = new CourseService();
