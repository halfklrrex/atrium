import type { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import type { DeliveryRecord } from './store';
import { listWebhookDeliveries, type ManageDeps } from './manage';
import { BOARD, OWNER, seededStore, webhookRecord } from './testkit';

const delivery = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  boardId: BOARD,
  webhookId: 'w1',
  eventId: 'e1',
  eventType: 'item_created',
  payload: '{"secret":"do-not-leak","itemName":"Private name"}',
  attempt: 1,
  nextAttemptAt: 2_000,
  status: 'sent',
  lastStatus: 200,
  lastError: null,
  createdAt: 1_000,
  expiresAt: 9_000,
  ...over,
});

const make = (over: Partial<ManageDeps> = {}) => {
  const store = seededStore();
  store.webhooks.set(`${BOARD}/w1`, webhookRecord());
  const deps: ManageDeps = { store, now: () => 5_000, enabled: () => true, ...over };
  return { store, deps };
};
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as HttpsError).code;
  }
  return 'none';
};

describe('listWebhookDeliveries', () => {
  it('returns the newest deliveries first, with no payload or secret', async () => {
    const { store, deps } = make();
    store.deliveries.set('w1_e1', delivery({ createdAt: 1_000 }));
    store.deliveries.set(
      'w1_e2',
      delivery({
        eventId: 'e2',
        createdAt: 3_000,
        status: 'pending',
        attempt: 2,
        lastStatus: 503,
        lastError: 'x'.repeat(500),
      }),
    );
    const { deliveries } = await listWebhookDeliveries(deps, OWNER, {
      boardId: BOARD,
      webhookId: 'w1',
    });
    expect(deliveries.map((d) => d.id)).toEqual(['w1_e2', 'w1_e1']);
    expect(deliveries[0]).toEqual({
      id: 'w1_e2',
      eventType: 'item_created',
      status: 'pending',
      attempt: 2,
      lastStatus: 503,
      lastError: 'x'.repeat(200),
      createdAt: 3_000,
      nextAttemptAt: 2_000,
    });
    const text = JSON.stringify(deliveries);
    expect(text).not.toContain('do-not-leak');
    expect(text).not.toContain('Private name');
    expect(text).not.toContain('payload');
    expect(text).not.toContain('secret');
  });

  it('defaults to 20 rows and honors the limit', async () => {
    const { store, deps } = make();
    for (let i = 0; i < 30; i++) {
      store.deliveries.set(`w1_e${i}`, delivery({ eventId: `e${i}`, createdAt: i }));
    }
    const base = { boardId: BOARD, webhookId: 'w1' };
    expect((await listWebhookDeliveries(deps, OWNER, base)).deliveries).toHaveLength(20);
    expect(
      (await listWebhookDeliveries(deps, OWNER, { ...base, limit: 5 })).deliveries,
    ).toHaveLength(5);
    expect(
      (await listWebhookDeliveries(deps, OWNER, { ...base, limit: 50 })).deliveries,
    ).toHaveLength(30);
  });

  it('is owners only', async () => {
    const { deps } = make();
    const input = { boardId: BOARD, webhookId: 'w1' };
    expect(await code(listWebhookDeliveries(deps, 'ed', input))).toBe('permission-denied');
    expect(await code(listWebhookDeliveries(deps, 'vw', input))).toBe('permission-denied');
    expect(await code(listWebhookDeliveries(deps, 'other', input))).toBe('not-found');
    expect(await code(listWebhookDeliveries(deps, 'stranger', input))).toBe('not-found');
  });

  it('refuses a webhook of another board, even for the owner of both', async () => {
    const { store, deps } = make();
    store.boards.set('b2', { ...store.boards.get(BOARD)! });
    store.webhooks.set('b2/w2', webhookRecord());
    store.deliveries.set('w2_e1', delivery({ boardId: 'b2', webhookId: 'w2' }));
    // w2 lives on b2: asking for it through b1 is not-found.
    expect(
      await code(listWebhookDeliveries(deps, OWNER, { boardId: BOARD, webhookId: 'w2' })),
    ).toBe('not-found');
    expect(
      await code(listWebhookDeliveries(deps, OWNER, { boardId: BOARD, webhookId: 'nope' })),
    ).toBe('not-found');
  });

  it('drops a delivery that names another board, and honors the flag', async () => {
    const { store, deps } = make();
    store.deliveries.set('w1_e1', delivery({ boardId: 'b2' }));
    const { deliveries } = await listWebhookDeliveries(deps, OWNER, {
      boardId: BOARD,
      webhookId: 'w1',
    });
    expect(deliveries).toEqual([]);
    expect(
      await code(
        listWebhookDeliveries({ ...deps, enabled: () => false }, OWNER, {
          boardId: BOARD,
          webhookId: 'w1',
        }),
      ),
    ).toBe('failed-precondition');
  });
});
