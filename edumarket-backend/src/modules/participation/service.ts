import crypto from 'node:crypto';
import { User } from '../auth/model.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { sendNotificationEmail } from '../../integrations/email.js';
import { createNotification } from '../notifications/service.js';
import { AnnouncementDelivery, CourseAnnouncement, CourseGroup } from './models.js';

/** Splits students into random groups of at most `size` (sizes differ by one at most). */
export function randomGroups<T>(students: T[], size: number, random: (max: number) => number = max => crypto.randomInt(max)) {
  const shuffled = [...students];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const count = Math.max(1, Math.ceil(shuffled.length / Math.max(1, size)));
  const groups: T[][] = Array.from({ length: count }, () => []);
  shuffled.forEach((student, index) => groups[index % count].push(student));
  return groups;
}

/** Enrolled students with active access, optionally restricted to members of course groups. */
export async function announcementRecipients(courseId: unknown, groupIds: unknown[] = []) {
  const enrolled = new Set((await Enrollment.find(activeAccess({ courseId })).distinct('studentId')).map(String));
  if (!groupIds.length) return [...enrolled];
  const members = (await CourseGroup.find({ courseId, _id: { $in: groupIds } }).select('memberIds').lean()).flatMap(group => group.memberIds.map(String));
  return [...new Set(members)].filter(id => enrolled.has(id));
}

const MAX_EMAIL_ATTEMPTS = 3;
/** A delivery still "sending" after 5 minutes (real clock, not the scheduling time) was interrupted and may be resumed. */
const staleSending = () => new Date(Date.now() - 5 * 60_000);

/**
 * Delivers an announcement whose time has come. The announcement is claimed atomically (scheduled → sending), so concurrent jobs
 * or API instances never deliver it twice; each recipient/channel pair is a unique delivery row, so a resumed delivery (crash,
 * retry) skips what was already sent. E-mail goes only to recipients who enabled e-mail notifications, and only when a provider
 * is configured; otherwise the delivery is recorded as skipped. Failed e-mails are retried up to 3 times by the job.
 */
export async function deliverAnnouncement(announcementId: unknown, now = new Date()) {
  const announcement = await CourseAnnouncement.findOneAndUpdate(
    { _id: announcementId, $or: [{ status: 'scheduled', $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }, { status: 'sending', updatedAt: { $lt: staleSending() } }] },
    { $set: { status: 'sending' } }, { new: true },
  ).lean();
  if (!announcement) return null;
  const recipients = await announcementRecipients(announcement.courseId, announcement.groupIds);
  const users = await User.find({ _id: { $in: recipients } }).select('email notificationPreferences').lean();
  const link = `/student/courses/${announcement.courseId}/announcements`;
  for (const user of users) {
    const userId = String(user._id);
    const claimed = await AnnouncementDelivery.updateOne({ announcementId: announcement._id, userId, channel: 'in_app' }, { $setOnInsert: { status: 'pending' } }, { upsert: true });
    const row = await AnnouncementDelivery.findOne({ announcementId: announcement._id, userId, channel: 'in_app' }).lean();
    if (claimed.upsertedCount || row?.status === 'pending') {
      try {
        // null: the student turned course notifications off (the announcement stays readable in the course).
        const created = await createNotification({ userId, type: 'course', title: announcement.title.slice(0, 160), message: 'A new announcement was posted in your course.', link, template: { key: 'courseAnnouncement', params: { title: announcement.title } } }, { email: false });
        await AnnouncementDelivery.updateOne({ _id: row!._id }, { $set: created ? { status: 'sent' } : { status: 'skipped', error: 'NOTIFICATIONS_OFF' }, $inc: { attempts: 1 } });
      } catch {
        await AnnouncementDelivery.updateOne({ _id: row!._id }, { $set: { status: 'failed', error: 'IN_APP_FAILED' }, $inc: { attempts: 1 } });
      }
    }
    if (announcement.sendEmail) await deliverEmail(announcement, user, link);
  }
  const counts = await AnnouncementDelivery.aggregate<{ _id: { channel: string; status: string }; count: number }>([{ $match: { announcementId: announcement._id } }, { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } }]);
  const count = (channel: string, status: string) => counts.find(row => row._id.channel === channel && row._id.status === status)?.count || 0;
  await CourseAnnouncement.updateOne({ _id: announcement._id }, { $set: { status: 'sent', sentAt: now, stats: { recipients: users.length, emailsSent: count('email', 'sent'), emailsFailed: count('email', 'failed'), emailsSkipped: count('email', 'skipped') } } });
  return CourseAnnouncement.findById(announcement._id).lean();
}

async function deliverEmail(announcement: any, user: any, link: string) {
  const filter = { announcementId: announcement._id, userId: user._id, channel: 'email' as const };
  if (!user.notificationPreferences?.email || !user.email) {
    await AnnouncementDelivery.updateOne(filter, { $setOnInsert: { status: 'skipped', error: 'EMAIL_OPT_OUT' } }, { upsert: true });
    return;
  }
  await AnnouncementDelivery.updateOne(filter, { $setOnInsert: { status: 'pending' } }, { upsert: true });
  // Claim the row: only a pending (or failed, under the retry limit) row is sent, by a single worker.
  const row = await AnnouncementDelivery.findOneAndUpdate({ ...filter, $or: [{ status: 'pending' }, { status: 'failed', attempts: { $lt: MAX_EMAIL_ATTEMPTS } }] }, { $set: { status: 'pending' }, $inc: { attempts: 1 } }, { new: true }).lean();
  if (!row) return;
  try {
    const result = await sendNotificationEmail({ to: user.email, title: announcement.title, message: 'A new announcement was posted in your course.', link });
    await AnnouncementDelivery.updateOne({ _id: row._id }, { $set: result.delivery === 'sent' ? { status: 'sent', error: '' } : { status: 'skipped', error: 'EMAIL_PROVIDER_NOT_CONFIGURED' } });
  } catch (error) {
    await AnnouncementDelivery.updateOne({ _id: row._id }, { $set: { status: 'failed', error: ((error as { code?: string }).code || 'EMAIL_DELIVERY_FAILED').slice(0, 120) } });
  }
}

/** Background job: scheduled announcements that are due, interrupted deliveries, and failed e-mails to retry. */
export async function deliverDueAnnouncements(now = new Date()) {
  const due = await CourseAnnouncement.find({ $or: [{ status: 'scheduled', $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }, { status: 'sending', updatedAt: { $lt: staleSending() } }] }).select('_id').limit(50).lean();
  let delivered = 0;
  for (const announcement of due) if (await deliverAnnouncement(announcement._id, now)) delivered += 1;
  const retries = await AnnouncementDelivery.find({ channel: 'email', status: 'failed', attempts: { $lt: MAX_EMAIL_ATTEMPTS } }).limit(100).lean();
  for (const retry of retries) {
    const [announcement, user] = await Promise.all([CourseAnnouncement.findById(retry.announcementId).lean(), User.findById(retry.userId).select('email notificationPreferences').lean()]);
    if (announcement && user) await deliverEmail(announcement, user, `/student/courses/${announcement.courseId}/announcements`);
  }
  return delivered;
}
