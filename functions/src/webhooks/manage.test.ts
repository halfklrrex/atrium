import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { WEBHOOK_MAX_PER_BOARD } from '@atrium/shared';
import {
  createWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
  type ManageDeps,
} from './manage';
import { BOARD, OWNER, PUBLIC_RESOLVER, seededStore, webhookRecord } from './testkit';

const make = (over: Partial<ManageDeps> = {}) => {
  const store = seededStore();
  const deps: ManageDeps = {
    store,
    now: () => 1_700_000_000_000,
    enabled: () => true,
    resolver: PUBLIC_RESOLVER,
    ...over,
  };
  return { store, deps };
};
const create = {
  boardId: BOARD,
  name: 'Deploys',
  url: 'https://hooks.example.com/a',
  events: ['*'],
};
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as HttpsError).code;
  }
  return 'none';
};

describe('createWebhook', () => {
  it('lets a board owner create one and returns the secret once, storing it only in the secret doc', async () => {
    const { store, deps } = make();
    const result = await createWebhook(deps, OWNER, create as never);
    expect(result.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(store.secrets.get(`${BOARD}/${result.webhookId}`)).toBe(result.secret);
    const doc = store.webhooks.get(`${BOARD}/${result.webhookId}`)!;
    expect(JSON.stringify(doc)).not.toContain('whsec_');
    expect(doc).toMatchObject({
      name: 'Deploys',
      enabled: true,
      createdBy: OWNER,
      consecutiveFailures: 0,
      disabledReason: null,
      lastDeliveryAt: null,
    });
  });

  it.each([
    ['an editor', 'ed', 'permission-denied'],
    ['a viewer', 'vw', 'permission-denied'],
    ['a workspace member without board access', 'other', 'not-found'],
    ['a stranger', 'nobody', 'not-found'],
  ])('refuses %s', async (_label, uid, expected) => {
    const { store, deps } = make();
    expect(await code(createWebhook(deps, uid, create as never))).toBe(expected);
    expect(store.webhooks.size).toBe(0);
  });

  it('answers not-found for a board that does not exist', async () => {
    const { deps } = make();
    expect(await code(createWebhook(deps, OWNER, { ...create, boardId: 'nope' } as never))).toBe(
      'not-found',
    );
  });

  it('allows five webhooks per board and refuses the sixth', async () => {
    const { store, deps } = make();
    for (let i = 0; i < WEBHOOK_MAX_PER_BOARD; i += 1) {
      await createWebhook(deps, OWNER, create as never);
    }
    expect(await code(createWebhook(deps, OWNER, create as never))).toBe('resource-exhausted');
    expect(store.webhooks.size).toBe(5);
    expect(store.secrets.size).toBe(5);
  });

  it('refuses unsafe addresses with a clear message', async () => {
    const { store, deps } = make();
    for (const url of [
      'https://localhost/x',
      'https://169.254.169.254/latest',
      'https://db.internal/x',
      'https://hooks.example.com:8443/x',
    ]) {
      const error = await createWebhook(deps, OWNER, { ...create, url } as never).catch(
        (e: HttpsError) => e,
      );
      expect(error).toBeInstanceOf(HttpsError);
      expect((error as HttpsError).code).toBe('invalid-argument');
      expect((error as HttpsError).message.length).toBeGreaterThan(10);
    }
    expect(store.webhooks.size).toBe(0);
  });

  it('refuses a host that resolves to a private address', async () => {
    const { deps } = make({ resolver: async () => [{ address: '10.0.0.4', family: 4 }] });
    const error = (await createWebhook(deps, OWNER, create as never).catch((e) => e)) as HttpsError;
    expect(error.code).toBe('invalid-argument');
    expect(error.message).toMatch(/private/);
  });

  it('refuses everything with failed-precondition while the kill switch is off', async () => {
    const { store, deps } = make({ enabled: () => false });
    expect(await code(createWebhook(deps, OWNER, create as never))).toBe('failed-precondition');
    expect(store.webhooks.size).toBe(0);
  });
});

describe('updateWebhook', () => {
  const seed = (over = {}) => {
    const ctx = make();
    ctx.store.webhooks.set(`${BOARD}/w1`, webhookRecord(over));
    return ctx;
  };

  it('changes name, url, events and enabled', async () => {
    const { store, deps } = seed();
    const result = await updateWebhook(deps, OWNER, {
      boardId: BOARD,
      webhookId: 'w1',
      name: 'Renamed',
      url: 'https://other.example.com/x',
      events: ['item_created'],
      enabled: false,
    });
    expect(result).toEqual({ webhookId: 'w1', enabled: false });
    expect(store.webhooks.get(`${BOARD}/w1`)).toMatchObject({
      name: 'Renamed',
      url: 'https://other.example.com/x',
      events: ['item_created'],
      enabled: false,
    });
  });

  it('re-enabling resets the failure count and the reason', async () => {
    const { store, deps } = seed({
      enabled: false,
      consecutiveFailures: 20,
      disabledReason: 'Switched off after 20 failed deliveries in a row.',
    });
    await updateWebhook(deps, OWNER, { boardId: BOARD, webhookId: 'w1', enabled: true });
    expect(store.webhooks.get(`${BOARD}/w1`)).toMatchObject({
      enabled: true,
      consecutiveFailures: 0,
      disabledReason: null,
    });
  });

  it('leaves the failure count alone when the webhook is already on', async () => {
    const { store, deps } = seed({ consecutiveFailures: 7 });
    await updateWebhook(deps, OWNER, { boardId: BOARD, webhookId: 'w1', enabled: true });
    expect(store.webhooks.get(`${BOARD}/w1`)!.consecutiveFailures).toBe(7);
  });

  it('checks a changed url with the SSRF guard but not an unchanged one', async () => {
    const { deps } = seed();
    expect(
      await code(
        updateWebhook(deps, OWNER, { boardId: BOARD, webhookId: 'w1', url: 'https://localhost/x' }),
      ),
    ).toBe('invalid-argument');
    const blocked = make({ resolver: async () => [{ address: '10.0.0.4', family: 4 }] });
    blocked.store.webhooks.set(`${BOARD}/w1`, webhookRecord());
    await updateWebhook(blocked.deps, OWNER, {
      boardId: BOARD,
      webhookId: 'w1',
      url: webhookRecord().url,
      name: 'Same url',
    });
  });

  it.each([
    ['an editor', 'ed'],
    ['a viewer', 'vw'],
  ])('refuses %s', async (_label, uid) => {
    const { store, deps } = seed();
    expect(
      await code(updateWebhook(deps, uid, { boardId: BOARD, webhookId: 'w1', enabled: false })),
    ).toBe('permission-denied');
    expect(store.webhooks.get(`${BOARD}/w1`)!.enabled).toBe(true);
  });

  it('answers not-found for an unknown webhook, and refuses when the switch is off', async () => {
    const { deps } = seed();
    expect(
      await code(updateWebhook(deps, OWNER, { boardId: BOARD, webhookId: 'zz', enabled: false })),
    ).toBe('not-found');
    const off = make({ enabled: () => false });
    expect(
      await code(
        updateWebhook(off.deps, OWNER, { boardId: BOARD, webhookId: 'w1', enabled: false }),
      ),
    ).toBe('failed-precondition');
  });
});

describe('deleteWebhook', () => {
  it('deletes the webhook and its secret, and is a no-op the second time', async () => {
    const { store, deps } = make();
    const { webhookId } = await createWebhook(deps, OWNER, create as never);
    expect(await deleteWebhook(deps, OWNER, { boardId: BOARD, webhookId })).toEqual({
      webhookId,
      deleted: true,
    });
    expect(store.webhooks.size).toBe(0);
    expect(store.secrets.size).toBe(0);
    expect((await deleteWebhook(deps, OWNER, { boardId: BOARD, webhookId })).deleted).toBe(false);
  });

  it.each(['ed', 'vw', 'other', 'nobody'])('refuses %s', async (uid) => {
    const { store, deps } = make();
    store.webhooks.set(`${BOARD}/w1`, webhookRecord());
    expect(await code(deleteWebhook(deps, uid, { boardId: BOARD, webhookId: 'w1' }))).not.toBe(
      'none',
    );
    expect(store.webhooks.size).toBe(1);
  });
});

describe('rotateWebhookSecret', () => {
  it('returns a new secret once and replaces the stored one', async () => {
    const { store, deps } = make();
    const created = await createWebhook(deps, OWNER, create as never);
    const rotated = await rotateWebhookSecret(deps, OWNER, {
      boardId: BOARD,
      webhookId: created.webhookId,
    });
    expect(rotated.secret).not.toBe(created.secret);
    expect(store.secrets.get(`${BOARD}/${created.webhookId}`)).toBe(rotated.secret);
    expect(JSON.stringify(store.webhooks.get(`${BOARD}/${created.webhookId}`))).not.toContain(
      'whsec_',
    );
  });

  it('refuses non-owners and unknown webhooks', async () => {
    const { store, deps } = make();
    store.webhooks.set(`${BOARD}/w1`, webhookRecord());
    expect(await code(rotateWebhookSecret(deps, 'ed', { boardId: BOARD, webhookId: 'w1' }))).toBe(
      'permission-denied',
    );
    expect(await code(rotateWebhookSecret(deps, OWNER, { boardId: BOARD, webhookId: 'zz' }))).toBe(
      'not-found',
    );
    expect(store.secrets.size).toBe(0);
  });
});

describe('testWebhook', () => {
  it('queues a pending ping delivery', async () => {
    const { store, deps } = make();
    store.webhooks.set(`${BOARD}/w1`, webhookRecord());
    const result = await testWebhook(deps, OWNER, 'Avery Quinn', {
      boardId: BOARD,
      webhookId: 'w1',
    });
    const delivery = store.deliveries.get(result.deliveryId)!;
    expect(delivery).toMatchObject({
      boardId: BOARD,
      webhookId: 'w1',
      eventType: 'ping',
      status: 'pending',
      attempt: 0,
      nextAttemptAt: 1_700_000_000_000,
    });
    expect(JSON.parse(delivery.payload)).toMatchObject({ type: 'ping', actor: { id: OWNER } });
  });

  it('refuses non-owners, an unknown webhook and a disabled webhook', async () => {
    const { store, deps } = make();
    store.webhooks.set(`${BOARD}/w1`, webhookRecord());
    store.webhooks.set(`${BOARD}/w2`, webhookRecord({ enabled: false }));
    expect(await code(testWebhook(deps, 'vw', 'V', { boardId: BOARD, webhookId: 'w1' }))).toBe(
      'permission-denied',
    );
    expect(await code(testWebhook(deps, OWNER, 'O', { boardId: BOARD, webhookId: 'zz' }))).toBe(
      'not-found',
    );
    expect(await code(testWebhook(deps, OWNER, 'O', { boardId: BOARD, webhookId: 'w2' }))).toBe(
      'failed-precondition',
    );
    expect(store.deliveries.size).toBe(0);
  });
});
