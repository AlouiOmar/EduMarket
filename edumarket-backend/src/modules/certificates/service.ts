import { randomBytes } from 'node:crypto';
import { Certificate } from './model.js';
import { createNotification } from '../notifications/service.js';

export async function issueCompletionCertificate(studentId: string, courseId: string) {
  const alreadyIssued = await Certificate.exists({ studentId, courseId });
  const code = randomBytes(12).toString('hex').toUpperCase();
  try {
    const certificate = await Certificate.findOneAndUpdate({ studentId, courseId }, { $setOnInsert: { code, issuedAt: new Date() } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    if (!alreadyIssued) void createNotification({ userId: studentId, type: 'certificate', title: 'Certificate issued', message: 'You completed an eligible course and earned a certificate.', link: '/student/certificates', template: { key: 'certificateIssued' } }).catch(() => undefined);
    return certificate;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return Certificate.findOne({ studentId, courseId });
    throw error;
  }
}
