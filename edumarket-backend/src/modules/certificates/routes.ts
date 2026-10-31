import { Router } from 'express';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { Certificate } from './model.js';
export const certificateRoutes = Router();
certificateRoutes.get('/verify/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code).trim().toUpperCase().slice(0, 64);
    const certificate = await Certificate.findOne({ code }).populate('studentId', 'name').populate('courseId', 'title teacherId').populate({ path: 'courseId', populate: { path: 'teacherId', select: 'name' } }).lean();
    if (!certificate) throw new AppError(404, 'CERTIFICATE_NOT_FOUND');
    const student = certificate.studentId as unknown as { name: string };
    const course = certificate.courseId as unknown as { title: string; teacherId: { name: string } };
    res.json({ success: true, data: { code: certificate.code, studentName: student.name, courseTitle: course.title, instructorName: course.teacherId?.name || '', issueDate: certificate.issuedAt, status: certificate.revokedAt ? 'revoked' : 'valid', revokedAt: certificate.revokedAt || null } });
  } catch (error) { next(error); }
});
certificateRoutes.get('/mine', authenticate, allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const certificates = await Certificate.find({ studentId: req.auth!.userId }).sort({ issuedAt: -1 }).populate('studentId', 'name').populate({ path: 'courseId', select: 'title teacherId', populate: { path: 'teacherId', select: 'name' } }).lean();
    res.json({ success: true, data: certificates.map(certificate => {
      const student = certificate.studentId as unknown as { _id: unknown; name: string };
      const course = certificate.courseId as unknown as { _id: unknown; title: string; teacherId: { name: string } };
      return { id: String(certificate._id), code: certificate.code, userId: String(student._id), userName: student.name, courseId: String(course._id), courseTitle: course.title, issueDate: certificate.issuedAt, grade: 'Completed', instructorName: course.teacherId?.name || '', verificationUrl: `/certifications?code=${certificate.code}`, status: certificate.revokedAt ? 'revoked' : 'valid' };
    }) });
  } catch (error) { next(error); }
});
