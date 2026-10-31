import { User } from '../auth/model.js';
import { createNotification } from '../notifications/service.js';
import { sendNotificationEmail } from '../../integrations/email.js';

/**
 * Candidate-facing messages (English fallback; the client shows the translated template). They never contain an identity
 * number nor a document: only the application reference and the kind of document concerned.
 */
const MESSAGES: Record<string, { title: string; message: string }> = {
  teacherApplicationCreated: { title: 'Teacher application started', message: 'Your account is created. Verify your e-mail address, then complete your application.' },
  teacherApplicationSubmitted: { title: 'Application received', message: 'Your teacher application has been received.' },
  teacherApplicationUnderReview: { title: 'Application under review', message: 'Your file is being reviewed by the EduMarket team.' },
  teacherDocumentVerified: { title: 'Document verified', message: 'One of your documents has been verified.' },
  teacherDocumentRejected: { title: 'Document refused', message: 'One of your documents was refused. See the reason and upload a new version.' },
  teacherDocumentReplacement: { title: 'New document needed', message: 'A new version of one of your documents is needed.' },
  teacherApplicationInfoRequired: { title: 'Information requested', message: 'The EduMarket team needs additional information or documents.' },
  teacherApplicationResubmitted: { title: 'Application resubmitted', message: 'Your corrected application has been received.' },
  teacherApplicationApproved: { title: 'Application approved', message: 'Your application has been approved. Welcome to EduMarket!' },
  teacherApplicationRejected: { title: 'Application not accepted', message: 'Your application was not accepted. See the reason given by our team.' },
  teacherAccountSuspended: { title: 'Teacher account suspended', message: 'Your independent teacher account has been suspended. See the reason in your application space.' },
  teacherApplicationNew: { title: 'New teacher application', message: 'A new independent teacher application is waiting for review.' },
  teacherApplicationResubmittedAdmin: { title: 'Teacher application resubmitted', message: 'A corrected independent teacher application is waiting for review.' },
};

export async function notifyCandidate(userId: string, key: string, params: Record<string, string>, options: { email?: boolean; link?: string } = {}) {
  const text = MESSAGES[key];
  const link = options.link || '/teacher/application';
  try {
    await createNotification({ userId, type: 'account', title: text.title, message: text.message, link, template: { key, params } });
    // Decisions are transactional e-mails (when an e-mail provider is configured), whatever the notification preference.
    if (options.email) {
      const user = await User.findById(userId).select('email notificationPreferences').lean();
      if (user?.email && !user.notificationPreferences?.email) await sendNotificationEmail({ to: user.email, title: text.title, message: text.message, link, transactional: true });
    }
  } catch (error) { console.error('Teacher application notification failed', { key, code: (error as { code?: string }).code }); }
}

export async function notifyAdmins(key: string, params: Record<string, string>, link: string) {
  const text = MESSAGES[key];
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').limit(50).lean();
  await Promise.all(admins.map(admin => createNotification({ userId: String(admin._id), type: 'account', title: text.title, message: text.message, link, template: { key, params } }).catch(() => undefined)));
}
