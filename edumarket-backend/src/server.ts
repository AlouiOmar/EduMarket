import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './database/connect.js';
import { closeUserEventStreams } from './integrations/userEvents.js';
import { startBackgroundJobs } from './jobs/scheduler.js';

try {
  await connectDatabase();
  const stopJobs = startBackgroundJobs();
  const server = app.listen(env.PORT, () => console.info(`EduMarket API listening on ${env.PORT}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    stopJobs();
    closeUserEventStreams();
    server.close(() => process.exit(0));
  });
} catch (error) {
  console.error('API startup failed', error);
  process.exit(1);
}
