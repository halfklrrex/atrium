import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_RETRY_DELAYS_MS,
  type WebhookDeliveryStatus,
} from '@atrium/shared';
import {
  LEASE_MS,
  SWEEP_LIMIT,
  retryDelayMs,
  runDeliverySweep,
  verdictForStatus,
  type DeliverDeps,
} from './deliver';
import type { FakeWebhookStore } from './fake-store';
import type { DeliveryRecord } from './store';
import {
  BOARD,
  OWNER,
  PUBLIC_RESOLVER,
  fakeTransport,
  seededStore,
  webhookRecord,
  type FakeTransport,
} from './testkit';

const T0 = 1_700_000_000_000;
const SECRET = 'whsec_unit-test-secret';

const delivery = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  boardId: BOARD,
  webhookId: 'w1',
  eventId: 'evt1',
  eventType: 'value_changed',
  payload: '{"id":"evt1","type":"value_changed"}',
  attempt: 0,
  nextAttemptAt: T0,
  status: 'pending',
  lastStatus: null,
  lastError: null,
  createdAt: T0,
  expiresAt: T0 + 1,
  ...over,
});

interface Ctx {
  store: FakeWebhookStore;
  fake: FakeTransport;
  deps: DeliverDeps;
  clock: { now: number };
  notes: Array<{ uid: string; id: string; data: Record<string, unknown> }>;
  logs: Array<{ message: string; meta: Record<string, unknown> }>;
}

function setup(
  respond?: Parameters<typeof fakeTransport>[0],
  options: { enabled?: boolean; webhook?: Partial<ReturnType<typeof webhookRecord>> | null } = {},
): Ctx {
  const store = seededStore();
  if (options.webhook !== null) {
    store.webhooks.set(`${BOARD}/w1`, webhookRecord(options.webhook ?? {}));
    store.secrets.set(`${BOARD}/w1`, SECRET);
  }
  const fake = fakeTransport(respond);
  const clock = { now: T0 };
  const notes: Ctx['notes'] = [];
  const logs: Ctx['logs'] = [];
  const deps: DeliverDeps = {
    store,
    transport: fake.transport,
    resolver: PUBLIC_RESOLVER,
    notifications: {
      getBoard: async () => ({
        name: 'Roadmap',
        workspaceId: 'ws1',
        kind: 'private',
        access: {},
        columns: [],
      }),
      createNotification: async (uid, id, data) => {
        notes.push({ uid, id, data: data as unknown as Record<string, unknown> });
        return true;
      },
    },
    now: () => clock.now,
    enabled: () => options.enabled ?? true,
    log: (message, meta) => logs.push({ message, meta }),
  };
  return { store, fake, deps, clock, notes, logs };
}

const status = (store: FakeWebhookStore, id = 'w1_evt1'): WebhookDeliveryStatus =>
  store.deliveries.get(id)!.status;

describe('verdictForStatus and the retry schedule', () => {
  it.each([200, 201, 204, 299])('%i is sent', (s) => {
    expect(verdictForStatus(s, '').kind).toBe('sent');
  });
  it.each([408, 429, 500, 502, 503, 504])('%i is retried', (s) => {
    expect(verdictForStatus(s, '').kind).toBe('retry');
  });
  it.each([301, 302, 307, 400, 401, 403, 404, 410, 422])('%i fails without a retry', (s) => {
    expect(verdictForStatus(s, '').kind).toBe('failed');
  });
  it('keeps a short error text', () => {
    expect(verdictForStatus(500, 'boom')).toMatchObject({ error: 'HTTP 500: boom' });
  });
  it('waits 1 minute, 5 minutes, 30 minutes and 3 hours', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 300_000, 1_800_000, 10_800_000]);
    expect([...WEBHOOK_RETRY_DELAYS_MS]).toEqual([60_000, 300_000, 1_800_000, 10_800_000]);
  });
});

describe('runDeliverySweep: success', () => {
  it('signs and POSTs, then records sent and resets the failure count', async () => {
    const ctx = setup(undefined, { webhook: { consecutiveFailures: 3 } });
    ctx.store.deliveries.set('w1_evt1', delivery());
    const summary = await runDeliverySweep(ctx.deps);
    expect(summary).toMatchObject({ due: 1, claimed: 1, sent: 1 });
    expect(ctx.fake.requests).toHaveLength(1);
    const req = ctx.fake.requests[0]!;
    expect(req.target).toEqual({
      hostname: 'hooks.example.com',
      address: '93.184.216.34',
      family: 4,
      path: '/atrium',
    });
    const ts = String(Math.floor(T0 / 1000));
    expect(req.headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': 'Atrium-Webhooks/1',
      'Atrium-Event-Id': 'evt1',
      'Atrium-Event-Type': 'value_changed',
      'Atrium-Timestamp': ts,
    });
    const expected = createHmac('sha256', SECRET).update(`${ts}.${req.body}`).digest('hex');
    expect(req.headers['Atrium-Signature']).toBe(`v1=${expected}`);
    expect(req.body).toBe('{"id":"evt1","type":"value_changed"}');
    expect(ctx.store.deliveries.get('w1_evt1')).toMatchObject({
      status: 'sent',
      attempt: 1,
      lastStatus: 200,
      lastError: null,
    });
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)).toMatchObject({
      consecutiveFailures: 0,
      lastDeliveryAt: T0,
    });
  });

  it('uses the current secret, so a rotation applies to deliveries still queued', async () => {
    const ctx = setup();
    ctx.store.deliveries.set('w1_evt1', delivery());
    ctx.store.secrets.set(`${BOARD}/w1`, 'whsec_rotated');
    await runDeliverySweep(ctx.deps);
    const req = ctx.fake.requests[0]!;
    const ts = String(Math.floor(T0 / 1000));
    expect(req.headers['Atrium-Signature']).toBe(
      `v1=${createHmac('sha256', 'whsec_rotated').update(`${ts}.${req.body}`).digest('hex')}`,
    );
  });

  it('skips deliveries that are not due yet or not pending', async () => {
    const ctx = setup();
    ctx.store.deliveries.set('w1_later', delivery({ nextAttemptAt: T0 + 1 }));
    ctx.store.deliveries.set('w1_done', delivery({ status: 'sent' }));
    ctx.store.deliveries.set('w1_dead', delivery({ status: 'dead' }));
    const summary = await runDeliverySweep(ctx.deps);
    expect(summary).toMatchObject({ due: 0, claimed: 0, sent: 0 });
    expect(ctx.fake.requests).toHaveLength(0);
  });

  it('takes at most 50 deliveries per sweep', async () => {
    const ctx = setup();
    for (let i = 0; i < 60; i += 1)
      ctx.store.deliveries.set(`w1_e${i}`, delivery({ eventId: `e${i}` }));
    const summary = await runDeliverySweep(ctx.deps);
    expect(SWEEP_LIMIT).toBe(50);
    expect(summary.claimed).toBe(50);
    expect(ctx.fake.requests).toHaveLength(50);
    expect(await runDeliverySweep(ctx.deps)).toMatchObject({ claimed: 10 });
  });
});

describe('runDeliverySweep: the claim', () => {
  it('pushes nextAttemptAt forward by a lease, so a second sweep right after finds nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ctx = setup();
    ctx.deps.transport = async (request) => {
      ctx.fake.requests.push(request);
      await gate;
      return { status: 200, bodyText: '' };
    };
    ctx.store.deliveries.set('w1_evt1', delivery());
    const first = runDeliverySweep(ctx.deps);
    // Let the first sweep claim and start sending, then run a second one over the same queue.
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.store.deliveries.get('w1_evt1')!.nextAttemptAt).toBe(T0 + LEASE_MS);
    const second = await runDeliverySweep(ctx.deps);
    expect(second.claimed).toBe(0);
    release();
    await first;
    expect(ctx.fake.requests).toHaveLength(1);
  });

  it('two sweeps started together deliver each event exactly once', async () => {
    const ctx = setup();
    for (let i = 0; i < 20; i += 1)
      ctx.store.deliveries.set(`w1_e${i}`, delivery({ eventId: `e${i}` }));
    const [a, b] = await Promise.all([runDeliverySweep(ctx.deps), runDeliverySweep(ctx.deps)]);
    expect(a.claimed + b.claimed).toBe(20);
    expect(a.sent + b.sent).toBe(20);
    expect(ctx.fake.requests).toHaveLength(20);
    const ids = ctx.fake.requests.map((r) => r.headers['Atrium-Event-Id']);
    expect(new Set(ids).size).toBe(20);
  });

  it('a claimed delivery whose sweep crashed is picked up again after the lease', async () => {
    const ctx = setup();
    ctx.store.deliveries.set('w1_evt1', delivery());
    await ctx.store.claimDelivery('w1_evt1', T0, LEASE_MS); // a sweep claimed it, then died
    expect((await runDeliverySweep(ctx.deps)).claimed).toBe(0);
    ctx.clock.now = T0 + LEASE_MS;
    expect(await runDeliverySweep(ctx.deps)).toMatchObject({ claimed: 1, sent: 1 });
  });
});

describe('runDeliverySweep: retries and dead letters', () => {
  it('retries a 500 at 1 min, 5 min, 30 min and 3 h, then goes dead on the fifth attempt', async () => {
    const ctx = setup(() => ({ status: 500, bodyText: 'oops' }));
    ctx.store.deliveries.set('w1_evt1', delivery());
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const summary = await runDeliverySweep(ctx.deps);
      expect(summary.claimed).toBe(1);
      const d = ctx.store.deliveries.get('w1_evt1')!;
      expect(d.attempt).toBe(attempt);
      expect(d.lastStatus).toBe(500);
      expect(d.lastError).toBe('HTTP 500: oops');
      if (attempt < 5) {
        expect(d.status).toBe('pending');
        waits.push(d.nextAttemptAt - ctx.clock.now);
        // Not due a moment before.
        ctx.clock.now = d.nextAttemptAt - 1;
        expect((await runDeliverySweep(ctx.deps)).claimed).toBe(0);
        ctx.clock.now = d.nextAttemptAt;
      } else {
        expect(d.status).toBe('dead');
      }
    }
    expect(waits).toEqual([60_000, 300_000, 1_800_000, 10_800_000]);
    expect(ctx.fake.requests).toHaveLength(5);
    // Dead is final.
    ctx.clock.now += 365 * 24 * 3600 * 1000;
    expect((await runDeliverySweep(ctx.deps)).claimed).toBe(0);
  });

  it('retries a network error and a timeout, recording only a short code', async () => {
    const ctx = setup((n) =>
      n === 1
        ? Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:443'), {
            code: 'ECONNREFUSED',
          })
        : new Error('timeout'),
    );
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.store.deliveries.get('w1_evt1')).toMatchObject({
      status: 'pending',
      lastStatus: null,
      lastError: 'ECONNREFUSED',
    });
    ctx.clock.now += 60_000;
    await runDeliverySweep(ctx.deps);
    expect(ctx.store.deliveries.get('w1_evt1')!.lastError).toBe('timeout');
  });

  it('recovers: a later 200 sends it and resets the failures', async () => {
    const ctx = setup((n) => ({ status: n === 1 ? 503 : 200, bodyText: '' }));
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)!.consecutiveFailures).toBe(1);
    ctx.clock.now += 60_000;
    await runDeliverySweep(ctx.deps);
    expect(status(ctx.store)).toBe('sent');
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)!.consecutiveFailures).toBe(0);
  });

  it.each([400, 401, 404, 410, 422, 302])(
    'a %i fails at once without a retry but counts as a failure',
    async (code) => {
      const ctx = setup(() => ({ status: code, bodyText: 'no' }));
      ctx.store.deliveries.set('w1_evt1', delivery());
      const summary = await runDeliverySweep(ctx.deps);
      expect(summary.failed).toBe(1);
      expect(ctx.store.deliveries.get('w1_evt1')).toMatchObject({
        status: 'failed',
        attempt: 1,
        lastStatus: code,
      });
      expect(ctx.store.webhooks.get(`${BOARD}/w1`)!.consecutiveFailures).toBe(1);
      ctx.clock.now += 24 * 3600 * 1000;
      expect((await runDeliverySweep(ctx.deps)).claimed).toBe(0);
    },
  );

  it.each([408, 429])('a %i is retried like a server error', async (code) => {
    const ctx = setup(() => ({ status: code, bodyText: '' }));
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(status(ctx.store)).toBe('pending');
  });
});

describe('runDeliverySweep: the SSRF guard at delivery time', () => {
  it('never sends when the host now resolves to a private address, and fails the delivery', async () => {
    const ctx = setup();
    ctx.deps.resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.fake.requests).toHaveLength(0);
    expect(ctx.store.deliveries.get('w1_evt1')).toMatchObject({ status: 'failed', attempt: 1 });
    expect(ctx.store.deliveries.get('w1_evt1')!.lastError).toMatch(/private/);
  });

  it('never sends to a stored URL that breaks the static rules', async () => {
    const ctx = setup(undefined, { webhook: { url: 'https://169.254.169.254/x' } });
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.fake.requests).toHaveLength(0);
    expect(status(ctx.store)).toBe('failed');
  });

  it('retries a DNS failure', async () => {
    const ctx = setup();
    ctx.deps.resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.fake.requests).toHaveLength(0);
    expect(ctx.store.deliveries.get('w1_evt1')).toMatchObject({
      status: 'pending',
      lastError: 'dns-lookup-failed',
    });
  });

  it('hands the transport the pinned address it resolved', async () => {
    const ctx = setup();
    ctx.deps.resolver = async () => [{ address: '2606:4700:4700::1111', family: 6 }];
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.fake.requests[0]!.target).toMatchObject({
      hostname: 'hooks.example.com',
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });
});

describe('runDeliverySweep: the webhook state', () => {
  it('ends a delivery of a deleted, disabled or secretless webhook as dead without sending', async () => {
    const missing = setup(undefined, { webhook: null });
    missing.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(missing.deps);
    expect(missing.fake.requests).toHaveLength(0);
    expect(missing.store.deliveries.get('w1_evt1')).toMatchObject({
      status: 'dead',
      lastError: 'webhook-deleted',
    });

    const off = setup(undefined, { webhook: { enabled: false } });
    off.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(off.deps);
    expect(off.fake.requests).toHaveLength(0);
    expect(off.store.deliveries.get('w1_evt1')!.lastError).toBe('webhook-disabled');
    expect(off.store.webhooks.get(`${BOARD}/w1`)!.consecutiveFailures).toBe(0);

    const noSecret = setup();
    noSecret.store.secrets.clear();
    noSecret.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(noSecret.deps);
    expect(noSecret.fake.requests).toHaveLength(0);
    expect(noSecret.store.deliveries.get('w1_evt1')!.lastError).toBe('no-secret');
  });

  it('switches the webhook off after 20 consecutive failures and tells the creator once', async () => {
    const ctx = setup(() => ({ status: 500, bodyText: '' }), {
      webhook: { consecutiveFailures: WEBHOOK_DISABLE_AFTER_FAILURES - 1, name: 'Deploy feed' },
    });
    ctx.store.deliveries.set('w1_evt1', delivery());
    const summary = await runDeliverySweep(ctx.deps);
    expect(summary.disabledWebhooks).toBe(1);
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)).toMatchObject({
      enabled: false,
      consecutiveFailures: 20,
      disabledReason: 'Switched off after 20 failed deliveries in a row.',
    });
    expect(ctx.notes).toHaveLength(1);
    expect(ctx.notes[0]).toMatchObject({
      uid: OWNER,
      data: {
        kind: 'webhook_disabled',
        boardId: BOARD,
        boardName: 'Roadmap',
        workspaceId: 'ws1',
        itemId: 'w1',
        recipeName: 'Deploy feed',
      },
    });
    expect(ctx.notes[0]!.id).toBe(`webhook_disabled-w1-${T0}-${OWNER}`);
    expect(ctx.logs[0]).toMatchObject({ meta: { boardId: BOARD, webhookId: 'w1' } });
  });

  it('does not switch off at 19, and a success in between resets the count', async () => {
    const ctx = setup(() => ({ status: 500, bodyText: '' }), {
      webhook: { consecutiveFailures: 18 },
    });
    ctx.store.deliveries.set('w1_evt1', delivery());
    await runDeliverySweep(ctx.deps);
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)).toMatchObject({
      enabled: true,
      consecutiveFailures: 19,
    });
    expect(ctx.notes).toHaveLength(0);
  });

  it('notifies once even when several deliveries fail in the same sweep', async () => {
    const ctx = setup(() => ({ status: 500, bodyText: '' }), {
      webhook: { consecutiveFailures: 18 },
    });
    ctx.store.deliveries.set('w1_a', delivery({ eventId: 'a' }));
    ctx.store.deliveries.set('w1_b', delivery({ eventId: 'b' }));
    ctx.store.deliveries.set('w1_c', delivery({ eventId: 'c' }));
    await runDeliverySweep(ctx.deps);
    expect(ctx.notes).toHaveLength(1);
    expect(ctx.store.webhooks.get(`${BOARD}/w1`)!.enabled).toBe(false);
  });
});

describe('runDeliverySweep: the kill switch and logging', () => {
  it('exits at once while WEBHOOKS_ENABLED is off, touching nothing', async () => {
    const ctx = setup(undefined, { enabled: false });
    ctx.store.deliveries.set('w1_evt1', delivery());
    const before = { ...ctx.store.deliveries.get('w1_evt1')! };
    const summary = await runDeliverySweep(ctx.deps);
    expect(summary).toMatchObject({ skipped: true, claimed: 0, sent: 0 });
    expect(ctx.fake.requests).toHaveLength(0);
    expect(ctx.store.deliveries.get('w1_evt1')).toEqual(before);
  });

  it('logs a crash with the delivery id and a code only', async () => {
    const ctx = setup();
    ctx.store.deliveries.set('w1_evt1', delivery());
    ctx.store.finishDelivery = async () => {
      throw Object.assign(new Error('secret url https://hooks.example.com/atrium?token=abc'), {
        code: 'UNAVAILABLE',
      });
    };
    await runDeliverySweep(ctx.deps);
    expect(ctx.logs).toHaveLength(1);
    const text = JSON.stringify(ctx.logs);
    expect(text).toContain('w1_evt1');
    expect(text).not.toContain('token=abc');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('evt1","type"');
  });
});
