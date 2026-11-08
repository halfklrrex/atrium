import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { adminInboxAuth, adminInboxPurgeStore, adminInboxStore } from '../lib/admin-inbox';
import { adminNotificationPurgeStore } from '../lib/admin-notifications';
import { purgeInbox } from '../lib/inbox-purge';
import { purgeExpiredNotifications } from '../lib/notifications';

/**
 * Daily purge: old notifications and closed Inbox threads.
 * Bell notifications older than 180 days go first; then the Inbox purge deletes threads closed
 * more than 365 days ago (at most 200 per run) and stale `inboxLimits`. Each step is isolated, so
 * one failing never skips the other; the run is marked failed afterwards so it shows in the logs.
 */
export const purgeOldNotifications = onSchedule(
  {
    schedule: 'every day 04:00',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 300,
  },
  async () => {
    let failed = false;
    try {
      const deleted = await purgeExpiredNotifications(
        adminNotificationPurgeStore(db()),
        Date.now(),
      );
      logger.info(`Notification purge finished: deleted ${deleted} old notifications.`, {
        deleted,
      });
    } catch (error) {
      failed = true;
      logger.error('Notification purge failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const firestore = db();
    const inbox = await purgeInbox({
      purgeStore: adminInboxPurgeStore(firestore),
      store: adminInboxStore(firestore),
      auth: adminInboxAuth(),
      now: () => new Date(),
      logger,
    });
    if (failed || inbox.failed) throw new Error('Daily purge finished with a failed step.');
  },
);
