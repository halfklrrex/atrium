import { createHmac } from 'node:crypto';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase-admin/firestore';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as NotificationsModule from '../../../functions/src/lib/admin-notifications';
import type * as StoreModule from '../../../functions/src/webhooks/admin-store';
import type * as DeliverModule from '../../../functions/src/webhooks/deliver';
import type * as EnqueueModule from '../../../functions/src/webhooks/enqueue';
import type * as ManageModule from '../../../functions/src/webhooks/manage';
import type * as SsrfModule from '../../../functions/src/webhooks/ssrf';
import { USERS, WS, boardDoc, createTestEnv, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator (P8 PR 6): the real `adminWebhookStore` with the real
 * callable logic, producer and delivery sweep. A fake transport stands in for the network. Checks the
 * transactions (the 5-per-board limit, the claim), the create-if-absent enqueue, Timestamp storage,
 * the signature and the disable-and-notify path. Cloud Functions trigger delivery itself is simulated
 * (the emulator run by `pnpm test:rules` has no Functions emulator): the test hands the activity
 * entry to `enqueueWebhooks`, which is exactly what `onActivityCreated` does.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let storeMod: typeof StoreModule;
let manage: typeof ManageModule;
let enqueue: typeof EnqueueModule;
let deliver: typeof DeliverModule;
let notifications: typeof NotificationsModule;

const BOARD = 'boardWebhookE2e';
const OWNER = USERS.owner;
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  storeMod = await import('../../../functions/src/webhooks/admin-store');
  manage = await import('../../../functions/src/webhooks/manage');
  enqueue = await import('../../../functions/src/webhooks/enqueue');
  deliver = await import('../../../functions/src/webhooks/deliver');
  notifications = await import('../../../functions/src/lib/admin-notifications');
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  // Seeded through the web SDK (the helpers build web Timestamps); the code under test reads it with the Admin SDK.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'boards', BOARD), boardDoc({ name: 'Webhook board' }));
  });
});

const store = () => storeMod.adminWebhookStore(admin.db());
const manageDeps = (enabled = true) => ({
  store: store(),
  now: Date.now,
  enabled: () => enabled,
  resolver: publicResolver,
});
const createInput = (over: Record<string, unknown> = {}) =>
  ({
    boardId: BOARD,
    name: 'Deploys',
    url: 'https://hooks.example.com/atrium',
    events: ['*'],
    ...over,
  }) as Parameters<typeof manage.createWebhook>[2];

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'none';
};

const activity = {
  kind: 'value_changed',
  actorId: USERS.member,
  actorName: 'Avery Quinn',
  itemId: 'i1',
  itemName: 'Write spec',
  columnId: 'status',
  data: { fromText: 'Open', toText: 'Done', fromValue: 'Open', toValue: 'Done' },
  createdAtMs: 1_700_000_000_000,
};

function sweepDeps(requests: SsrfModule.TransportRequest[], status = 200, enabled = true) {
  const transport: SsrfModule.Transport = async (request) => {
    requests.push(request);
    // A little latency so two concurrent sweeps genuinely overlap.
    await new Promise((r) => setTimeout(r, 25));
    return { status, bodyText: '' };
  };
  return {
    store: store(),
    transport,
    resolver: publicResolver,
    notifications: notifications.adminNotificationStore(admin.db()),
    now: Date.now,
    enabled: () => enabled,
    log: () => undefined,
  };
}

describe('create, update, rotate and delete against Firestore', () => {
  it('stores the webhook without the secret and the secret in its own document', async () => {
    const result = await manage.createWebhook(manageDeps(), OWNER, createInput());
    const doc = await admin.db().doc(`boards/${BOARD}/webhooks/${result.webhookId}`).get();
    expect(doc.get('createdAt')).toBeInstanceOf(Timestamp);
    expect(doc.data()).toMatchObject({
      name: 'Deploys',
      events: ['*'],
      enabled: true,
      createdBy: OWNER,
      consecutiveFailures: 0,
      disabledReason: null,
      lastDeliveryAt: null,
    });
    expect(JSON.stringify(doc.data())).not.toContain('whsec_');
    const secret = await admin.db().doc(`boards/${BOARD}/webhookSecrets/${result.webhookId}`).get();
    expect(secret.get('secret')).toBe(result.secret);
  });

  it('allows exactly five webhooks per board even when seven are created at once', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => manage.createWebhook(manageDeps(), OWNER, createInput())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.map((r) => (r.reason as { code: string }).code)).toEqual([
      'resource-exhausted',
      'resource-exhausted',
    ]);
    expect((await admin.db().collection(`boards/${BOARD}/webhooks`).get()).size).toBe(5);
    expect((await admin.db().collection(`boards/${BOARD}/webhookSecrets`).get()).size).toBe(5);
  });

  it('refuses an editor, a viewer and an outsider with the real board and workspace documents', async () => {
    expect(await code(manage.createWebhook(manageDeps(), USERS.member, createInput()))).toBe(
      'permission-denied',
    );
    expect(await code(manage.createWebhook(manageDeps(), USERS.viewer, createInput()))).toBe(
      'permission-denied',
    );
    expect(await code(manage.createWebhook(manageDeps(), USERS.outsider, createInput()))).toBe(
      'not-found',
    );
    expect(await code(manage.createWebhook(manageDeps(false), OWNER, createInput()))).toBe(
      'failed-precondition',
    );
    expect((await admin.db().collection(`boards/${BOARD}/webhooks`).get()).size).toBe(0);
  });

  it('rotates the secret, re-enables with a clean slate, and deletes both documents', async () => {
    const created = await manage.createWebhook(manageDeps(), OWNER, createInput());
    const rotated = await manage.rotateWebhookSecret(manageDeps(), OWNER, {
      boardId: BOARD,
      webhookId: created.webhookId,
    });
    expect(rotated.secret).not.toBe(created.secret);
    expect(await store().getSecret(BOARD, created.webhookId)).toBe(rotated.secret);

    const ref = admin.db().doc(`boards/${BOARD}/webhooks/${created.webhookId}`);
    await ref.update({ enabled: false, consecutiveFailures: 20, disabledReason: 'x' });
    await manage.updateWebhook(manageDeps(), OWNER, {
      boardId: BOARD,
      webhookId: created.webhookId,
      enabled: true,
    });
    expect((await ref.get()).data()).toMatchObject({
      enabled: true,
      consecutiveFailures: 0,
      disabledReason: null,
    });

    await manage.deleteWebhook(manageDeps(), OWNER, {
      boardId: BOARD,
      webhookId: created.webhookId,
    });
    expect((await ref.get()).exists).toBe(false);
    expect(await store().getSecret(BOARD, created.webhookId)).toBeNull();
  });
});

describe('an activity entry produces a delivery, and the sweep sends it exactly once', () => {
  async function setup(events: string[] = ['*']) {
    const { webhookId } = await manage.createWebhook(manageDeps(), OWNER, createInput({ events }));
    return webhookId;
  }

  it('queues a pending delivery with Timestamp fields, once, however often the trigger retries', async () => {
    const webhookId = await setup(['value_changed']);
    const deps = { store: store(), now: Date.now, enabled: () => true };
    const args = { boardId: BOARD, activityId: 'act1', activity };
    expect(await enqueue.enqueueWebhooks(deps, args)).toBe(1);
    expect(await enqueue.enqueueWebhooks(deps, args)).toBe(0);
    expect(await enqueue.enqueueWebhooks(deps, args)).toBe(0);
    const snap = await admin.db().doc(`webhookDeliveries/${webhookId}_act1`).get();
    expect(snap.get('nextAttemptAt')).toBeInstanceOf(Timestamp);
    expect(snap.get('expiresAt')).toBeInstanceOf(Timestamp);
    expect(snap.get('expiresAt').toMillis() - snap.get('createdAt').toMillis()).toBe(
      14 * 24 * 3600 * 1000,
    );
    expect(snap.data()).toMatchObject({
      boardId: BOARD,
      webhookId,
      eventId: 'act1',
      eventType: 'value_changed',
      status: 'pending',
      attempt: 0,
    });
    expect((await admin.db().collection('webhookDeliveries').get()).size).toBe(1);
  });

  it('does not queue an event the webhook did not subscribe to, or any while the switch is off', async () => {
    await setup(['item_created']);
    const on = { store: store(), now: Date.now, enabled: () => true };
    expect(await enqueue.enqueueWebhooks(on, { boardId: BOARD, activityId: 'a', activity })).toBe(
      0,
    );
    await setup(['*']);
    const off = { store: store(), now: Date.now, enabled: () => false };
    expect(await enqueue.enqueueWebhooks(off, { boardId: BOARD, activityId: 'b', activity })).toBe(
      0,
    );
    expect((await admin.db().collection('webhookDeliveries').get()).size).toBe(0);
  });

  it('delivers once under two concurrent sweeps, with a signature that verifies', async () => {
    const webhookId = await setup();
    await enqueue.enqueueWebhooks(
      { store: store(), now: Date.now, enabled: () => true },
      { boardId: BOARD, activityId: 'act1', activity },
    );
    const requests: SsrfModule.TransportRequest[] = [];
    const [a, b] = await Promise.all([
      deliver.runDeliverySweep(sweepDeps(requests)),
      deliver.runDeliverySweep(sweepDeps(requests)),
    ]);
    expect(requests).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.claimed + b.claimed).toBe(1);

    const req = requests[0]!;
    const secret = (await store().getSecret(BOARD, webhookId))!;
    const timestamp = req.headers['Atrium-Timestamp']!;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${req.body}`).digest('hex');
    expect(req.headers['Atrium-Signature']).toBe(`v1=${expected}`);
    expect(req.headers['Atrium-Event-Id']).toBe('act1');
    expect(req.headers['Atrium-Event-Type']).toBe('value_changed');
    expect(JSON.parse(req.body)).toMatchObject({
      id: 'act1',
      type: 'value_changed',
      boardId: BOARD,
      itemId: 'i1',
      actor: { id: USERS.member, name: 'Avery Quinn' },
      data: { from: 'Open', to: 'Done' },
    });
    expect(req.target).toMatchObject({ hostname: 'hooks.example.com', address: '93.184.216.34' });

    const delivery = await admin.db().doc(`webhookDeliveries/${webhookId}_act1`).get();
    expect(delivery.data()).toMatchObject({ status: 'sent', attempt: 1, lastStatus: 200 });
    const hook = await admin.db().doc(`boards/${BOARD}/webhooks/${webhookId}`).get();
    expect(hook.get('lastDeliveryAt')).toBeInstanceOf(Timestamp);
    // A third sweep finds nothing left.
    expect((await deliver.runDeliverySweep(sweepDeps(requests))).claimed).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it('a Test ping is delivered like any other event', async () => {
    const webhookId = await setup();
    const { deliveryId } = await manage.testWebhook(manageDeps(), OWNER, 'Avery Quinn', {
      boardId: BOARD,
      webhookId,
    });
    const requests: SsrfModule.TransportRequest[] = [];
    await deliver.runDeliverySweep(sweepDeps(requests));
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ type: 'ping', boardId: BOARD });
    expect((await admin.db().doc(`webhookDeliveries/${deliveryId}`).get()).get('status')).toBe(
      'sent',
    );
  });

  it('retries a failing receiver later and leaves the delivery pending with a future time', async () => {
    const webhookId = await setup();
    await enqueue.enqueueWebhooks(
      { store: store(), now: Date.now, enabled: () => true },
      { boardId: BOARD, activityId: 'act1', activity },
    );
    const requests: SsrfModule.TransportRequest[] = [];
    const before = Date.now();
    await deliver.runDeliverySweep(sweepDeps(requests, 503));
    const delivery = await admin.db().doc(`webhookDeliveries/${webhookId}_act1`).get();
    expect(delivery.data()).toMatchObject({ status: 'pending', attempt: 1, lastStatus: 503 });
    expect(delivery.get('nextAttemptAt').toMillis()).toBeGreaterThanOrEqual(before + 60_000);
    expect((await deliver.runDeliverySweep(sweepDeps(requests, 503))).claimed).toBe(0);
  });

  it('switches the webhook off at 20 failures and writes the bell notification once', async () => {
    const webhookId = await setup();
    await admin
      .db()
      .doc(`boards/${BOARD}/webhooks/${webhookId}`)
      .update({ consecutiveFailures: 19 });
    await enqueue.enqueueWebhooks(
      { store: store(), now: Date.now, enabled: () => true },
      { boardId: BOARD, activityId: 'act1', activity },
    );
    const requests: SsrfModule.TransportRequest[] = [];
    const summary = await deliver.runDeliverySweep(sweepDeps(requests, 500));
    expect(summary.disabledWebhooks).toBe(1);
    const hook = await admin.db().doc(`boards/${BOARD}/webhooks/${webhookId}`).get();
    expect(hook.data()).toMatchObject({
      enabled: false,
      consecutiveFailures: 20,
      disabledReason: 'Switched off after 20 failed deliveries in a row.',
    });
    const notes = await admin.db().collection(`users/${OWNER}/notifications`).get();
    expect(notes.size).toBe(1);
    expect(notes.docs[0]!.data()).toMatchObject({
      kind: 'webhook_disabled',
      boardId: BOARD,
      boardName: 'Webhook board',
      workspaceId: WS,
      itemId: webhookId,
      recipeName: 'Deploys',
      readAt: null,
    });
    // A disabled webhook queues nothing more.
    expect(
      await enqueue.enqueueWebhooks(
        { store: store(), now: Date.now, enabled: () => true },
        { boardId: BOARD, activityId: 'act2', activity },
      ),
    ).toBe(0);
  });

  it('the sweep does nothing while the kill switch is off', async () => {
    const webhookId = await setup();
    await enqueue.enqueueWebhooks(
      { store: store(), now: Date.now, enabled: () => true },
      { boardId: BOARD, activityId: 'act1', activity },
    );
    const requests: SsrfModule.TransportRequest[] = [];
    const summary = await deliver.runDeliverySweep(sweepDeps(requests, 200, false));
    expect(summary.skipped).toBe(true);
    expect(requests).toHaveLength(0);
    expect((await admin.db().doc(`webhookDeliveries/${webhookId}_act1`).get()).get('status')).toBe(
      'pending',
    );
  });
});
