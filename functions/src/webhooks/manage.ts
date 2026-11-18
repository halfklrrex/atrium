import {
  WEBHOOK_DELIVERY_ERROR_MAX,
  WEBHOOK_DELIVERY_LIST_DEFAULT,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_MAX_PER_BOARD,
  canManageBoard,
  resolveBoardRole,
  type CreateWebhookRequest,
  type CreateWebhookResult,
  type DeleteWebhookRequest,
  type DeleteWebhookResult,
  type ListWebhookDeliveriesRequest,
  type ListWebhookDeliveriesResult,
  type RotateWebhookSecretRequest,
  type RotateWebhookSecretResult,
  type TestWebhookRequest,
  type TestWebhookResult,
  type UpdateWebhookRequest,
  type UpdateWebhookResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { buildPingPayload } from './payload';
import { newWebhookSecret } from './signature';
import { prepareDelivery, type Resolver } from './ssrf';
import type { WebhookStore } from './store';

/**
 * The five board-owner callables (P8 PR 6), as plain functions over the store so they are unit
 * tested without Firebase. Every one checks the kill switch first, then that the caller owns the
 * board. The signing secret is returned by create and rotate only; nothing else ever reads it back.
 */

export interface ManageDeps {
  store: WebhookStore;
  now: () => number;
  /** The `WEBHOOKS_ENABLED` flag. */
  enabled: () => boolean;
  /** DNS resolver for the save-time SSRF check (injectable for tests). */
  resolver?: Resolver;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DISABLED_MESSAGE = 'Webhooks are not switched on for this site yet.';

export function assertEnabled(deps: Pick<ManageDeps, 'enabled'>): void {
  if (!deps.enabled()) throw new HttpsError('failed-precondition', DISABLED_MESSAGE);
}

/** Board owners only. A board the caller can't read answers `not-found`, like the sharing callables. */
export async function requireBoardOwner(
  store: Pick<WebhookStore, 'getBoardAccess'>,
  boardId: string,
  uid: string,
): Promise<void> {
  const record = await store.getBoardAccess(boardId);
  if (!record?.roles) throw new HttpsError('not-found', 'Board not found.');
  const role = resolveBoardRole(record.board, uid, record.roles[uid]);
  if (!role) throw new HttpsError('not-found', 'Board not found.');
  if (!canManageBoard(role)) {
    throw new HttpsError('permission-denied', 'Only board owners can manage webhooks.');
  }
}

/** The SSRF guard on save, with a clear message. */
async function assertDeliverableUrl(deps: ManageDeps, url: string): Promise<void> {
  const prepared = await prepareDelivery(url, deps.resolver);
  if (!prepared.ok) throw new HttpsError('invalid-argument', prepared.reason);
}

async function requireWebhook(deps: ManageDeps, boardId: string, webhookId: string) {
  const webhook = await deps.store.getWebhook(boardId, webhookId);
  if (!webhook) throw new HttpsError('not-found', 'No such webhook.');
  return webhook;
}

export async function createWebhook(
  deps: ManageDeps,
  uid: string,
  input: CreateWebhookRequest,
): Promise<CreateWebhookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  await assertDeliverableUrl(deps, input.url);
  const now = deps.now();
  const webhookId = deps.store.newId();
  const secret = newWebhookSecret();
  const created = await deps.store.createWebhookIfRoom({
    boardId: input.boardId,
    webhookId,
    doc: {
      name: input.name,
      url: input.url,
      events: [...input.events],
      enabled: true,
      createdBy: uid,
      createdAt: now,
      consecutiveFailures: 0,
      disabledReason: null,
      lastDeliveryAt: null,
    },
    secret,
    now,
    max: WEBHOOK_MAX_PER_BOARD,
  });
  if (!created) {
    throw new HttpsError(
      'resource-exhausted',
      `A board can have at most ${WEBHOOK_MAX_PER_BOARD} webhooks. Delete one first.`,
    );
  }
  return { webhookId, secret };
}

export async function updateWebhook(
  deps: ManageDeps,
  uid: string,
  input: UpdateWebhookRequest,
): Promise<UpdateWebhookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  const current = await requireWebhook(deps, input.boardId, input.webhookId);
  if (input.url !== undefined && input.url !== current.url) {
    await assertDeliverableUrl(deps, input.url);
  }
  const patch: Parameters<WebhookStore['updateWebhook']>[2] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.events !== undefined) patch.events = [...input.events];
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
    // Turning a webhook back on starts it clean; turning it off by hand leaves no failure reason.
    if (input.enabled && !current.enabled) {
      patch.consecutiveFailures = 0;
      patch.disabledReason = null;
    }
  }
  await deps.store.updateWebhook(input.boardId, input.webhookId, patch);
  return { webhookId: input.webhookId, enabled: patch.enabled ?? current.enabled };
}

export async function deleteWebhook(
  deps: ManageDeps,
  uid: string,
  input: DeleteWebhookRequest,
): Promise<DeleteWebhookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  const deleted = await deps.store.deleteWebhook(input.boardId, input.webhookId);
  return { webhookId: input.webhookId, deleted };
}

export async function rotateWebhookSecret(
  deps: ManageDeps,
  uid: string,
  input: RotateWebhookSecretRequest,
): Promise<RotateWebhookSecretResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  await requireWebhook(deps, input.boardId, input.webhookId);
  const secret = newWebhookSecret();
  await deps.store.setSecret(input.boardId, input.webhookId, secret, deps.now());
  return { webhookId: input.webhookId, secret };
}

/** Queues a `ping` delivery; the next minute's sweep sends it. */
export async function testWebhook(
  deps: ManageDeps,
  uid: string,
  actorName: string,
  input: TestWebhookRequest,
): Promise<TestWebhookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  const webhook = await requireWebhook(deps, input.boardId, input.webhookId);
  if (!webhook.enabled) {
    throw new HttpsError('failed-precondition', 'Turn the webhook on before sending a test.');
  }
  const now = deps.now();
  const eventId = `ping_${deps.store.newId()}`;
  const { body } = buildPingPayload({
    eventId,
    boardId: input.boardId,
    webhookId: input.webhookId,
    actorId: uid,
    actorName,
    nowMs: now,
  });
  const deliveryId = `${input.webhookId}_${eventId}`;
  await deps.store.createDelivery(deliveryId, {
    boardId: input.boardId,
    webhookId: input.webhookId,
    eventId,
    eventType: 'ping',
    payload: body,
    attempt: 0,
    nextAttemptAt: now,
    status: 'pending',
    lastStatus: null,
    lastError: null,
    createdAt: now,
    expiresAt: now + WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS,
  });
  return { webhookId: input.webhookId, deliveryId };
}

/**
 * The most recent deliveries of one webhook, for the board owner's delivery log. The queue is
 * Functions-only, so this is the only way to see it. Rows carry no payload, no secret and no response
 * body; a webhook that belongs to another board is `not-found`.
 */
export async function listWebhookDeliveries(
  deps: ManageDeps,
  uid: string,
  input: ListWebhookDeliveriesRequest,
): Promise<ListWebhookDeliveriesResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  await requireWebhook(deps, input.boardId, input.webhookId);
  const rows = await deps.store.listDeliveries(
    input.webhookId,
    input.limit ?? WEBHOOK_DELIVERY_LIST_DEFAULT,
  );
  return {
    deliveries: rows
      // The webhook id is unique to its board, but check the delivery's own board as well.
      .filter(({ doc }) => doc.boardId === input.boardId)
      .map(({ id, doc }) => ({
        id,
        eventType: doc.eventType,
        status: doc.status,
        attempt: doc.attempt,
        lastStatus: doc.lastStatus,
        lastError:
          doc.lastError === null ? null : doc.lastError.slice(0, WEBHOOK_DELIVERY_ERROR_MAX),
        createdAt: doc.createdAt,
        nextAttemptAt: doc.nextAttemptAt,
      })),
  };
}
