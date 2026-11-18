import {
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
} from '@atrium/shared';
import { notifyWebhookDisabled } from './notify';
import { deliveryHeaders } from './signature';
import { prepareDelivery, type Resolver, type Transport } from './ssrf';
import type { DeliveryFinish, DeliveryRecord, WebhookStore } from './store';
import type { NotificationStore } from '../lib/notifications';

/**
 * The consumer (P8 PR 6): one sweep claims the due deliveries and sends them. The rules:
 * - 2xx: `sent`; the webhook's failure count resets.
 * - 4xx except 408 and 429, and any 3xx (redirects are never followed): `failed`, no retry, but it
 *   counts toward the webhook's consecutive failures.
 * - 408, 429, 5xx, network errors, timeouts and DNS failures: retried after 1 minute, 5 minutes,
 *   30 minutes and 3 hours (five attempts in all), then `dead`. Every failed attempt counts.
 * - A host that resolves to a private address, or breaks the URL rules, is `failed` at once.
 * - 20 failures in a row switch the webhook off and tell its creator.
 * Never logs a payload, a secret or a URL: webhook id and status only.
 */

/** Deliveries taken per sweep. */
export const SWEEP_LIMIT = 50;
/** How long a claim holds a delivery: longer than a whole sweep can take. */
export const LEASE_MS = 3 * 60 * 1000;
/** Deliveries sent at the same time within one sweep. */
export const PARALLEL = 10;

export interface DeliverDeps {
  store: WebhookStore;
  transport: Transport;
  resolver?: Resolver;
  notifications: Pick<NotificationStore, 'getBoard' | 'createNotification'>;
  now: () => number;
  enabled: () => boolean;
  /** Logs ids and counts only. */
  log: (message: string, meta: Record<string, unknown>) => void;
}

export interface SweepSummary {
  skipped: boolean;
  due: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  dead: number;
  disabledWebhooks: number;
}

type Verdict =
  | { kind: 'sent'; status: number }
  | { kind: 'retry'; status: number | null; error: string }
  | { kind: 'failed'; status: number | null; error: string };

const emptySummary = (skipped: boolean): SweepSummary => ({
  skipped,
  due: 0,
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  dead: 0,
  disabledWebhooks: 0,
});

/** Maps an HTTP status to what happens next (spec 5.1). */
export function verdictForStatus(status: number, bodyText: string): Verdict {
  if (status >= 200 && status < 300) return { kind: 'sent', status };
  const error = `HTTP ${status}${bodyText ? `: ${bodyText}` : ''}`.slice(0, 500);
  if (status === 408 || status === 429 || status >= 500) return { kind: 'retry', status, error };
  // 4xx and 3xx: the receiver answered, and asking again will not change it.
  return { kind: 'failed', status, error };
}

/** Wait before the next attempt, given how many attempts have been made (1 to 4). */
export const retryDelayMs = (attemptsMade: number): number =>
  WEBHOOK_RETRY_DELAYS_MS[Math.min(attemptsMade, WEBHOOK_RETRY_DELAYS_MS.length) - 1] ??
  WEBHOOK_RETRY_DELAYS_MS[WEBHOOK_RETRY_DELAYS_MS.length - 1]!;

const networkError = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{3,40}$/.test(code)) return code;
  const message = (error as { message?: unknown } | null)?.message;
  return message === 'timeout' ? 'timeout' : 'network-error';
};

export async function runDeliverySweep(deps: DeliverDeps): Promise<SweepSummary> {
  if (!deps.enabled()) return emptySummary(true);
  const summary = emptySummary(false);
  const dueIds = await deps.store.listDueDeliveries(deps.now(), SWEEP_LIMIT);
  summary.due = dueIds.length;
  const claimed: Array<{ id: string; doc: DeliveryRecord }> = [];
  for (const id of dueIds) {
    const doc = await deps.store.claimDelivery(id, deps.now(), LEASE_MS);
    if (doc) claimed.push({ id, doc });
  }
  summary.claimed = claimed.length;
  for (let i = 0; i < claimed.length; i += PARALLEL) {
    await Promise.all(
      claimed.slice(i, i + PARALLEL).map(async ({ id, doc }) => {
        try {
          await deliverOne(deps, summary, id, doc);
        } catch (error) {
          // The lease expires and the delivery is tried again; nothing is lost.
          deps.log('Webhook delivery crashed', { deliveryId: id, error: networkError(error) });
        }
      }),
    );
  }
  return summary;
}

async function deliverOne(
  deps: DeliverDeps,
  summary: SweepSummary,
  id: string,
  doc: DeliveryRecord,
): Promise<void> {
  const { store } = deps;
  const stop = async (reason: string) => {
    summary.dead += 1;
    await store.finishDelivery(id, {
      status: 'dead',
      attempt: doc.attempt,
      nextAttemptAt: doc.nextAttemptAt,
      lastStatus: null,
      lastError: reason,
    });
  };
  const webhook = await store.getWebhook(doc.boardId, doc.webhookId);
  if (!webhook) return await stop('webhook-deleted');
  if (!webhook.enabled) return await stop('webhook-disabled');
  const secret = await store.getSecret(doc.boardId, doc.webhookId);
  if (!secret) return await stop('no-secret');

  let verdict: Verdict;
  const prepared = await prepareDelivery(webhook.url, deps.resolver);
  if (!prepared.ok) {
    verdict =
      prepared.kind === 'dns'
        ? { kind: 'retry', status: null, error: 'dns-lookup-failed' }
        : { kind: 'failed', status: null, error: prepared.reason };
  } else {
    try {
      const response = await deps.transport({
        target: prepared.target,
        headers: deliveryHeaders({
          eventId: doc.eventId,
          eventType: doc.eventType,
          secret,
          body: doc.payload,
          nowMs: deps.now(),
        }),
        body: doc.payload,
      });
      verdict = verdictForStatus(response.status, response.bodyText);
    } catch (error) {
      verdict = { kind: 'retry', status: null, error: networkError(error) };
    }
  }

  const now = deps.now();
  const attempt = doc.attempt + 1;
  let finish: DeliveryFinish;
  if (verdict.kind === 'sent') {
    summary.sent += 1;
    finish = {
      status: 'sent',
      attempt,
      nextAttemptAt: doc.nextAttemptAt,
      lastStatus: verdict.status,
      lastError: null,
    };
  } else if (verdict.kind === 'failed') {
    summary.failed += 1;
    finish = {
      status: 'failed',
      attempt,
      nextAttemptAt: doc.nextAttemptAt,
      lastStatus: verdict.status,
      lastError: verdict.error,
    };
  } else if (attempt >= WEBHOOK_MAX_ATTEMPTS) {
    summary.dead += 1;
    finish = {
      status: 'dead',
      attempt,
      nextAttemptAt: doc.nextAttemptAt,
      lastStatus: verdict.status,
      lastError: verdict.error,
    };
  } else {
    summary.retried += 1;
    finish = {
      status: 'pending',
      attempt,
      nextAttemptAt: now + retryDelayMs(attempt),
      lastStatus: verdict.status,
      lastError: verdict.error,
    };
  }
  await store.finishDelivery(id, finish);

  const outcome = await store.recordOutcome(doc.boardId, doc.webhookId, {
    ok: verdict.kind === 'sent',
    now,
    disableAfter: WEBHOOK_DISABLE_AFTER_FAILURES,
    disabledReason: `Switched off after ${WEBHOOK_DISABLE_AFTER_FAILURES} failed deliveries in a row.`,
  });
  if (outcome.disabled) {
    summary.disabledWebhooks += 1;
    deps.log('Webhook switched off after repeated failures', {
      boardId: doc.boardId,
      webhookId: doc.webhookId,
    });
    await notifyWebhookDisabled(deps.notifications, {
      boardId: doc.boardId,
      webhookId: doc.webhookId,
      webhookName: webhook.name,
      ownerUid: webhook.createdBy,
      reason: `Switched off after ${WEBHOOK_DISABLE_AFTER_FAILURES} failed deliveries in a row.`,
      at: now,
    });
  }
}
