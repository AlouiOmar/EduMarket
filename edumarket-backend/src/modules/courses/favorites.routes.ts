import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { Course } from './model.js';
import { toPublicCourse } from './dto.js';
import { PUBLIC_COURSE_FILTER } from '../classes/service.js';

export const favoriteRoutes = Router();
favoriteRoutes.use(authenticate, allowRoles('student'));
const courseId = z.string().regex(/^[a-f\d]{24}$/i);

favoriteRoutes.get('/', async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).select('favoriteCourseIds').lean();
    if (!user) throw new AppError(401, 'USER_NOT_FOUND');
    const courses = await Course.find({ _id: { $in: user.favoriteCourseIds }, ...PUBLIC_COURSE_FILTER }).populate('teacherId', 'name').lean();
    const byId = new Map(courses.map(course => [String(course._id), course]));
    res.json({ success: true, data: user.favoriteCourseIds.map(id => byId.get(String(id))).filter(Boolean).map(course => toPublicCourse(course)) });
  } catch (error) { next(error); }
});

favoriteRoutes.put('/:courseId', async (req: AuthRequest, res, next) => {
  try {
    const parsed = courseId.safeParse(req.params.courseId);
    if (!parsed.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    const id = new mongoose.Types.ObjectId(parsed.data);
    if (!await Course.exists({ _id: id, ...PUBLIC_COURSE_FILTER })) throw new AppError(404, 'COURSE_NOT_FOUND');
    await User.updateOne({ _id: req.auth!.userId }, { $addToSet: { favoriteCourseIds: id } });
    res.json({ success: true, data: { courseId: parsed.data, favorited: true } });
  } catch (error) { next(error); }
});

favoriteRoutes.delete('/:courseId', async (req: AuthRequest, res, next) => {
  try {
    const parsed = courseId.safeParse(req.params.courseId);
    if (!parsed.success) throw new AppError(404, 'COURSE_NOT_FOUND');
    await User.updateOne({ _id: req.auth!.userId }, { $pull: { favoriteCourseIds: new mongoose.Types.ObjectId(parsed.data) } });
    res.json({ success: true, data: { courseId: parsed.data, favorited: false } });
  } catch (error) { next(error); }
});
