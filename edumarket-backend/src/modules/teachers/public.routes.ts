import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { toPublicCourse } from '../courses/dto.js';
import { PUBLIC_COURSE_FILTER } from '../classes/service.js';

export const publicTeacherRoutes = Router();

async function teacherSummaries(ids: unknown[]) {
  const summaries = await Course.aggregate<{ _id: unknown; coursesCount: number; studentsCount: number; ratingCount: number; ratingTotal: number }>([
    { $match: { teacherId: { $in: ids }, status: 'published', visibility: { $ne: 'restricted' } } },
    { $group: { _id: '$teacherId', coursesCount: { $sum: 1 }, studentsCount: { $sum: '$studentsCount' }, ratingCount: { $sum: '$ratingCount' }, ratingTotal: { $sum: { $multiply: ['$rating', '$ratingCount'] } } } },
  ]);
  return new Map(summaries.map(item => [String(item._id), {
    coursesCount: item.coursesCount, studentsCount: item.studentsCount, ratingCount: item.ratingCount,
    rating: item.ratingCount ? Math.round(item.ratingTotal / item.ratingCount * 100) / 100 : 0,
  }]));
}

function teacherDto(teacher: any, summary?: { coursesCount: number; studentsCount: number; ratingCount: number; rating: number }) {
  return {
    id: String(teacher._id), name: teacher.name, headline: teacher.headline || '', bio: teacher.bio || '',
    joinedDate: teacher.createdAt, avatar: '', coursesCount: summary?.coursesCount || 0,
    studentsCount: summary?.studentsCount || 0, ratingCount: summary?.ratingCount || 0, rating: summary?.rating || 0,
  };
}

publicTeacherRoutes.get('/', async (req, res, next) => {
  try {
    const query = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const filter: Record<string, unknown> = { role: 'teacher', verified: true, status: 'active' };
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { headline: { $regex: escaped, $options: 'i' } }, { bio: { $regex: escaped, $options: 'i' } }];
    }
    const [total, teachers] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select('name headline bio createdAt').sort({ createdAt: -1, _id: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    ]);
    const summaries = await teacherSummaries(teachers.map(teacher => teacher._id));
    res.json({ success: true, data: teachers.map(teacher => teacherDto(teacher, summaries.get(String(teacher._id)))), pagination: { page: query.page, limit: query.limit, total } });
  } catch (error) { next(error); }
});

publicTeacherRoutes.get('/:teacherId', async (req, res, next) => {
  try {
    const parsed = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.teacherId);
    if (!parsed.success) throw new AppError(404, 'TEACHER_NOT_FOUND');
    const teacher = await User.findOne({ _id: parsed.data, role: 'teacher', verified: true, status: 'active' }).select('name headline bio createdAt');
    if (!teacher) throw new AppError(404, 'TEACHER_NOT_FOUND');
    const courses = await Course.find({ teacherId: teacher._id, ...PUBLIC_COURSE_FILTER }).sort({ createdAt: -1 }).populate('teacherId', 'name').lean();
    const summaries = await teacherSummaries([teacher._id]);
    res.json({ success: true, data: { ...teacherDto(teacher.toObject(), summaries.get(String(teacher._id))), courses: courses.map(toPublicCourse) } });
  } catch (error) { next(error); }
});
