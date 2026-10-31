import { expireAbandonedCheckouts } from '../modules/payments/service.js';
import { sendRenewalReminders, settleEndedSubscriptionPeriods } from '../modules/subscriptions/service.js';
import { publishDueItems } from '../modules/courses/publication.service.js';
import { finalizeExpiredAttempts } from '../modules/assessments/service.js';
import { deliverDueAnnouncements } from '../modules/participation/service.js';
import { purgeExpiredTranscripts } from '../modules/ai/routes.js';
import { purgeQuarantinedFiles, runScheduledLinkChecks } from '../modules/courses/files.routes.js';
import { notifyPublication } from '../modules/courses/structure.routes.js';
import { sendDueEventReminders } from '../modules/calendar/events.service.js';
import { runCalendarSyncJob } from '../modules/calendar/sync.service.js';
import { purgeExpiredApplications } from '../modules/teacher-applications/routes.js';

/** In-process maintenance jobs. Running several API instances is safe: each job is an idempotent conditional update. */
export function startBackgroundJobs() {
  const timer = setInterval(() => {
    expireAbandonedCheckouts().catch(error => console.error('Checkout expiry job failed', { name: (error as Error).name }));
    settleEndedSubscriptionPeriods().catch(error => console.error('Subscription settlement job failed', { name: (error as Error).name }));
    sendRenewalReminders().catch(error => console.error('Subscription reminder job failed', { name: (error as Error).name }));
    purgeQuarantinedFiles().catch(error => console.error('File purge job failed', { name: (error as Error).name }));
    runScheduledLinkChecks().catch(error => console.error('Link check job failed', { name: (error as Error).name }));
    purgeExpiredTranscripts().catch(error => console.error('Transcript retention job failed', { name: (error as Error).name }));
    deliverDueAnnouncements().catch(error => console.error('Announcement delivery job failed', { name: (error as Error).name }));
    finalizeExpiredAttempts().catch(error => console.error('Attempt finalization job failed', { name: (error as Error).name }));
    sendDueEventReminders().catch(error => console.error('Calendar reminder job failed', { name: (error as Error).name }));
    purgeExpiredApplications().catch(error => console.error('Teacher application retention job failed', { name: (error as Error).name }));
    runCalendarSyncJob().catch(error => console.error('Calendar sync job failed', { name: (error as Error).name }));
    publishDueItems(new Date(), (course, title) => notifyPublication(course, { title })).catch(error => console.error('Scheduled publication job failed', { name: (error as Error).name }));
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
