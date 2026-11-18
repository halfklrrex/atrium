import { describe, expect, it } from 'vitest';
import { enqueueWebhooks, deliveryId, type EnqueueDeps } from './enqueue';
import type { ActivityInput } from './payload';
import { BOARD, seededStore, webhookRecord } from './testkit';

const NOW = 1_700_000_000_000;
const activity = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  kind: 'value_changed',
  actorId: 'u1',
  actorName: 'Avery Quinn',
  itemId: 'i1',
  itemName: 'Ship it',
  columnId: 'status',
  data: { toValue: 'Done' },
  createdAtMs: NOW,
  ...over,
});

const setup = (enabled = true) => {
  const store = seededStore();
  const deps: EnqueueDeps = { store, now: () => NOW, enabled: () => enabled };
  return { store, deps };
};

describe('enqueueWebhooks', () => {
  it('writes one pending delivery per matching enabled webhook', async () => {
    const { store, deps } = setup();
    store.webhooks.set(`${BOARD}/all`, webhookRecord({ events: ['*'] }));
    store.webhooks.set(
      `${BOARD}/some`,
      webhookRecord({ events: ['value_changed', 'item_created'] }),
    );
    store.webhooks.set(`${BOARD}/other`, webhookRecord({ events: ['item_created'] }));
    store.webhooks.set(`${BOARD}/off`, webhookRecord({ events: ['*'], enabled: false }));
    const created = await enqueueWebhooks(deps, {
      boardId: BOARD,
      activityId: 'act1',
      activity: activity(),
    });
    expect(created).toBe(2);
    expect([...store.deliveries.keys()].sort()).toEqual(['all_act1', 'some_act1']);
    const d = store.deliveries.get('all_act1')!;
    expect(d).toMatchObject({
      boardId: BOARD,
      webhookId: 'all',
      eventId: 'act1',
      eventType: 'value_changed',
      attempt: 0,
      status: 'pending',
      nextAttemptAt: NOW,
      createdAt: NOW,
      expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
      lastStatus: null,
      lastError: null,
    });
    expect(JSON.parse(d.payload)).toMatchObject({
      id: 'act1',
      type: 'value_changed',
      boardId: BOARD,
    });
    expect(deliveryId('all', 'act1')).toBe('all_act1');
  });

  it('is idempotent: a retried trigger queues nothing new and resets nothing', async () => {
    const { store, deps } = setup();
    store.webhooks.set(`${BOARD}/w`, webhookRecord());
    const args = { boardId: BOARD, activityId: 'act1', activity: activity() };
    expect(await enqueueWebhooks(deps, args)).toBe(1);
    store.deliveries.set('w_act1', {
      ...store.deliveries.get('w_act1')!,
      status: 'sent',
      attempt: 1,
    });
    expect(await enqueueWebhooks(deps, args)).toBe(0);
    expect(store.deliveries.size).toBe(1);
    expect(store.deliveries.get('w_act1')).toMatchObject({ status: 'sent', attempt: 1 });
  });

  it('does nothing at all while the kill switch is off', async () => {
    const { store, deps } = setup(false);
    store.webhooks.set(`${BOARD}/w`, webhookRecord());
    let reads = 0;
    const original = store.listEnabledWebhooks;
    store.listEnabledWebhooks = async (b) => {
      reads += 1;
      return original(b);
    };
    expect(
      await enqueueWebhooks(deps, { boardId: BOARD, activityId: 'a', activity: activity() }),
    ).toBe(0);
    expect(store.deliveries.size).toBe(0);
    expect(reads).toBe(0);
  });

  it('queues nothing, and builds nothing, when no webhook matches', async () => {
    const { store, deps } = setup();
    store.webhooks.set(`${BOARD}/w`, webhookRecord({ events: ['item_created'] }));
    expect(
      await enqueueWebhooks(deps, { boardId: BOARD, activityId: 'a', activity: activity() }),
    ).toBe(0);
    expect(store.deliveries.size).toBe(0);
  });

  it('keeps every queued body at or under 64 KB and free of email addresses', async () => {
    const { store, deps } = setup();
    store.webhooks.set(`${BOARD}/w`, webhookRecord());
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1)
      wide[`k${i}`] = Array.from({ length: 50 }, () => 'y'.repeat(200));
    await enqueueWebhooks(deps, {
      boardId: BOARD,
      activityId: 'big',
      activity: activity({ actorName: 'avery@example.com', data: { toValue: wide } }),
    });
    const body = store.deliveries.get('w_big')!.payload;
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(body).not.toContain('@');
  });
});
