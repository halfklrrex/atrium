import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { adminAutomationStore } from '../lib/admin-automations';
import { adminNotificationStore } from '../lib/admin-notifications';
import { adminSchedulerStore } from '../lib/admin-scheduler';
import { runTick } from '../lib/automations/schedule';

/**
 * The time-based automations scheduler (P5d): every 5 minutes it runs the due `recurring` recipes and
 * the `date_arrives` recipes whose time has come, through the same runner as event triggers. The
 * logic and its rules are in `lib/automations/schedule.ts`. Region, CPU and concurrency come from the
 * global options (docs/specs/BUG-deploy-cpu-quota.md); the named database through `db()`.
 */
export const runTimeAutomations = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 300,
  },
  async () => {
    const firestore = db();
    const summary = await runTick(
      {
        store: adminSchedulerStore(firestore),
        automations: adminAutomationStore(firestore),
        notifications: adminNotificationStore(firestore),
        serverTimestamp: FieldValue.serverTimestamp(),
        log: (message, meta) => logger.error(message, meta),
      },
      Date.now(),
    );
    logger.info('Time-based automations tick', {
      ...summary,
      windowStart: new Date(summary.windowStartMs).toISOString(),
    });
    // A failed recipe was logged and left `lastTickAt` alone; fail the run so it shows in the logs.
    if (summary.hadErrors) throw new Error('Some time-based automations failed; see the logs');
  },
);
