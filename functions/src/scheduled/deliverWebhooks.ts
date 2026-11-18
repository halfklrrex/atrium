import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { adminNotificationStore } from '../lib/admin-notifications';
import { adminWebhookStore } from '../webhooks/admin-store';
import { runDeliverySweep } from '../webhooks/deliver';
import { webhooksEnabled } from '../webhooks/flag';
import { httpsTransport } from '../webhooks/ssrf';

/**
 * The outgoing webhook sweep (P8 PR 6): every minute it claims the due deliveries (50 at most) and
 * sends them through the SSRF-guarded transport. Returns at once while `WEBHOOKS_ENABLED` is off. The
 * logic is in `webhooks/deliver.ts`. Region, CPU and concurrency come from the global options; the
 * named database through `db()`. Logs webhook ids and counts only, never payloads or URLs.
 */
export const deliverWebhooks = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 120,
  },
  async () => {
    const firestore = db();
    const summary = await runDeliverySweep({
      store: adminWebhookStore(firestore),
      transport: httpsTransport,
      notifications: adminNotificationStore(firestore),
      now: Date.now,
      enabled: webhooksEnabled,
      log: (message, meta) => logger.error(message, meta),
    });
    if (!summary.skipped && summary.claimed > 0) logger.info('Webhook sweep', summary);
  },
);
