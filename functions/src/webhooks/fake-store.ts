import type {
  BoardAccessRecord,
  BoardSummary,
  DeliveryRecord,
  WebhookRecord,
  WebhookStore,
} from './store';

/** In-memory `WebhookStore` for unit tests. Same semantics as the Firestore adapter. */
export interface FakeWebhookStore extends WebhookStore {
  boards: Map<string, BoardAccessRecord & BoardSummary>;
  webhooks: Map<string, WebhookRecord>;
  secrets: Map<string, string>;
  deliveries: Map<string, DeliveryRecord>;
}

const key = (boardId: string, webhookId: string) => `${boardId}/${webhookId}`;

export function fakeWebhookStore(): FakeWebhookStore {
  let seq = 0;
  const boards = new Map<string, BoardAccessRecord & BoardSummary>();
  const webhooks = new Map<string, WebhookRecord>();
  const secrets = new Map<string, string>();
  const deliveries = new Map<string, DeliveryRecord>();
  const inBoard = (boardId: string) =>
    [...webhooks.entries()].filter(([k]) => k.startsWith(`${boardId}/`));

  return {
    boards,
    webhooks,
    secrets,
    deliveries,
    newId: () => `id${++seq}`,
    async getBoardAccess(boardId) {
      return boards.get(boardId) ?? null;
    },
    async getBoardSummary(boardId) {
      return boards.get(boardId) ?? null;
    },
    async getWebhook(boardId, webhookId) {
      const w = webhooks.get(key(boardId, webhookId));
      return w ? { ...w, events: [...w.events] } : null;
    },
    async listEnabledWebhooks(boardId) {
      return inBoard(boardId)
        .filter(([, w]) => w.enabled)
        .map(([k, w]) => ({ id: k.split('/')[1]!, doc: { ...w, events: [...w.events] } }));
    },
    async createWebhookIfRoom({ boardId, webhookId, doc, secret, max }) {
      if (inBoard(boardId).length >= max) return false;
      webhooks.set(key(boardId, webhookId), { ...doc });
      secrets.set(key(boardId, webhookId), secret);
      return true;
    },
    async updateWebhook(boardId, webhookId, patch) {
      const k = key(boardId, webhookId);
      const current = webhooks.get(k);
      if (!current) throw new Error('NOT_FOUND');
      webhooks.set(k, { ...current, ...patch });
    },
    async deleteWebhook(boardId, webhookId) {
      const k = key(boardId, webhookId);
      secrets.delete(k);
      return webhooks.delete(k);
    },
    async setSecret(boardId, webhookId, secret) {
      secrets.set(key(boardId, webhookId), secret);
    },
    async getSecret(boardId, webhookId) {
      return secrets.get(key(boardId, webhookId)) ?? null;
    },
    async recordOutcome(boardId, webhookId, input) {
      const k = key(boardId, webhookId);
      const w = webhooks.get(k);
      if (!w) return { disabled: false };
      if (input.ok) {
        webhooks.set(k, { ...w, consecutiveFailures: 0, lastDeliveryAt: input.now });
        return { disabled: false };
      }
      const next = w.consecutiveFailures + 1;
      const disable = next >= input.disableAfter && w.enabled;
      webhooks.set(k, {
        ...w,
        consecutiveFailures: next,
        lastDeliveryAt: input.now,
        ...(disable ? { enabled: false, disabledReason: input.disabledReason } : {}),
      });
      return { disabled: disable };
    },
    async createDelivery(id, doc) {
      if (deliveries.has(id)) return false;
      deliveries.set(id, { ...doc });
      return true;
    },
    async listDueDeliveries(now, limit) {
      return [...deliveries.entries()]
        .filter(([, d]) => d.status === 'pending' && d.nextAttemptAt <= now)
        .sort((a, b) => a[1].nextAttemptAt - b[1].nextAttemptAt)
        .slice(0, limit)
        .map(([id]) => id);
    },
    async claimDelivery(id, now, leaseMs) {
      const d = deliveries.get(id);
      if (!d || d.status !== 'pending' || d.nextAttemptAt > now) return null;
      const before = { ...d };
      deliveries.set(id, { ...d, nextAttemptAt: now + leaseMs });
      return before;
    },
    async finishDelivery(id, result) {
      const d = deliveries.get(id);
      if (!d) throw new Error('NOT_FOUND');
      deliveries.set(id, { ...d, ...result });
    },
  };
}
