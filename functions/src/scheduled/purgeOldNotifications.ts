import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { adminNotificationPurgeStore } from '../lib/admin-notifications';
import { purgeExpiredNotifications } from '../lib/notifications';

/** Deletes bell notifications older than the retention window (180 days), daily. */
export const purgeOldNotifications = onSchedule(
  {
    schedule: 'every day 04:00',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 300,
  },
  async () => {
    const deleted = await purgeExpiredNotifications(adminNotificationPurgeStore(db()), Date.now());
    logger.info(`Notification purge finished: deleted ${deleted} old notifications.`, { deleted });
  },
);
