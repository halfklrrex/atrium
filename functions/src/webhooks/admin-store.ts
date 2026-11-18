import { randomUUID } from 'node:crypto';
import type { BoardRole, WorkspaceRole } from '@atrium/shared';
import { Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { DeliveryRecord, WebhookRecord, WebhookStore } from './store';

/**
 * Adapts the Admin SDK (named database via `db()`) to `WebhookStore`. Every `*At` field is stored as
 * a Firestore `Timestamp` (the TTL policy on `webhookDeliveries.expiresAt` needs one) and read back as
 * epoch milliseconds.
 *
 * Index: the sweep's query needs `webhookDeliveries (status, nextAttemptAt)` (`firestore.indexes.json`).
 */

export const WEBHOOKS = 'webhooks';
export const WEBHOOK_SECRETS = 'webhookSecrets';
export const WEBHOOK_DELIVERIES = 'webhookDeliveries';

/** gRPC status `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6;

const TIME_KEYS = new Set(['createdAt', 'expiresAt', 'lastDeliveryAt', 'nextAttemptAt']);

function toFirestore(doc: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] =
      TIME_KEYS.has(key) && typeof value === 'number' ? Timestamp.fromMillis(value) : value;
  }
  return out;
}

function fromFirestore<T>(snap: DocumentSnapshot): T | null {
  const data = snap.data();
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = TIME_KEYS.has(key) && value instanceof Timestamp ? value.toMillis() : value;
  }
  return out as T;
}

export function adminWebhookStore(firestore: Firestore): WebhookStore {
  const boards = firestore.collection('boards');
  const hooks = (boardId: string) => boards.doc(boardId).collection(WEBHOOKS);
  const secrets = (boardId: string) => boards.doc(boardId).collection(WEBHOOK_SECRETS);
  const deliveries = firestore.collection(WEBHOOK_DELIVERIES);

  return {
    newId: () => randomUUID().replace(/-/g, '').slice(0, 20),

    async getBoardAccess(boardId) {
      const board = await boards.doc(boardId).get();
      if (!board.exists) return null;
      const workspaceId = String(board.get('workspaceId') ?? '');
      const ws = workspaceId
        ? await firestore.collection('workspaces').doc(workspaceId).get()
        : null;
      return {
        board: {
          workspaceId,
          kind: board.get('kind'),
          access: (board.get('access') as Record<string, BoardRole> | undefined) ?? {},
        },
        roles: ws?.exists
          ? ((ws.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {})
          : null,
      };
    },

    async getBoardSummary(boardId) {
      const board = await boards.doc(boardId).get();
      if (!board.exists) return null;
      return {
        name: String(board.get('name') ?? ''),
        workspaceId: String(board.get('workspaceId') ?? ''),
      };
    },

    async getWebhook(boardId, webhookId) {
      return fromFirestore<WebhookRecord>(await hooks(boardId).doc(webhookId).get());
    },

    async listEnabledWebhooks(boardId) {
      const snap = await hooks(boardId).where('enabled', '==', true).get();
      return snap.docs.map((d) => ({ id: d.id, doc: fromFirestore<WebhookRecord>(d)! }));
    },

    async createWebhookIfRoom({ boardId, webhookId, doc, secret, now, max }) {
      return await firestore.runTransaction(async (tx) => {
        const existing = await tx.get(hooks(boardId));
        if (existing.size >= max) return false;
        tx.create(hooks(boardId).doc(webhookId), toFirestore(doc));
        tx.create(secrets(boardId).doc(webhookId), {
          secret,
          createdAt: Timestamp.fromMillis(now),
        });
        return true;
      });
    },

    async updateWebhook(boardId, webhookId, patch) {
      await hooks(boardId).doc(webhookId).update(toFirestore(patch));
    },

    async deleteWebhook(boardId, webhookId) {
      const ref = hooks(boardId).doc(webhookId);
      const snap = await ref.get();
      if (!snap.exists) return false;
      const batch = firestore.batch();
      batch.delete(ref);
      batch.delete(secrets(boardId).doc(webhookId));
      await batch.commit();
      return true;
    },

    async setSecret(boardId, webhookId, secret, now) {
      await secrets(boardId)
        .doc(webhookId)
        .set({ secret, createdAt: Timestamp.fromMillis(now) });
    },

    async getSecret(boardId, webhookId) {
      const value: unknown = (await secrets(boardId).doc(webhookId).get()).get('secret');
      return typeof value === 'string' && value ? value : null;
    },

    async recordOutcome(boardId, webhookId, input) {
      const ref = hooks(boardId).doc(webhookId);
      return await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { disabled: false };
        const failures = Number(snap.get('consecutiveFailures') ?? 0);
        const at = Timestamp.fromMillis(input.now);
        if (input.ok) {
          tx.update(ref, { consecutiveFailures: 0, lastDeliveryAt: at });
          return { disabled: false };
        }
        const next = failures + 1;
        const disable = next >= input.disableAfter && snap.get('enabled') === true;
        tx.update(ref, {
          consecutiveFailures: next,
          lastDeliveryAt: at,
          ...(disable ? { enabled: false, disabledReason: input.disabledReason } : {}),
        });
        return { disabled: disable };
      });
    },

    async createDelivery(id, doc) {
      try {
        await deliveries.doc(id).create(toFirestore(doc));
        return true;
      } catch (error) {
        // A retried trigger: the delivery (and anything already recorded on it) stays as it is.
        if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
        throw error;
      }
    },

    async listDueDeliveries(now, limit) {
      const snap = await deliveries
        .where('status', '==', 'pending')
        .where('nextAttemptAt', '<=', Timestamp.fromMillis(now))
        .orderBy('nextAttemptAt', 'asc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.id);
    },

    async claimDelivery(id, now, leaseMs) {
      const ref = deliveries.doc(id);
      return await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const doc = fromFirestore<DeliveryRecord>(snap);
        if (!doc || doc.status !== 'pending' || doc.nextAttemptAt > now) return null;
        tx.update(ref, { nextAttemptAt: Timestamp.fromMillis(now + leaseMs) });
        return doc;
      });
    },

    async listDeliveries(webhookId, limit) {
      // Needs the composite index `webhookDeliveries (webhookId, createdAt desc)`.
      const snap = await deliveries
        .where('webhookId', '==', webhookId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, doc: fromFirestore<DeliveryRecord>(d)! }));
    },

    async finishDelivery(id, result) {
      await deliveries.doc(id).update(toFirestore(result));
    },
  };
}
