import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as AppModule from '../../../functions/src/api/app';
import type * as AuditModule from '../../../functions/src/api/audit';
import type * as HooksModule from '../../../functions/src/api/hooks';
import type * as IdempotencyModule from '../../../functions/src/api/idempotency';
import type * as IncomingModule from '../../../functions/src/webhooks/incoming';
import type * as IncomingStoreModule from '../../../functions/src/webhooks/incoming-admin-store';
import type * as LimitsModule from '../../../functions/src/api/limits';
import type * as McpLimitsModule from '../../../functions/src/mcp/limits';

/**
 * End to end against the Firestore emulator (P8 PR 7a): the real hook callables' logic and the real
 * `POST /api/hooks/{token}` route over the Admin SDK store, counters, audit and idempotency stores.
 * Creates a hook, posts twice with the same Idempotency-Key (one item), posts a bad body (no item),
 * rotates the secret (the old URL answers 404, the new one works), and deletes the hook. Runs through
 * `pnpm test:rules`.
 */

let admin: typeof AdminModule;
let adminClient: typeof AdminClientModule;
let app: typeof AppModule;
let audit: typeof AuditModule;
let hooksModule: typeof HooksModule;
let idempotency: typeof IdempotencyModule;
let incoming: typeof IncomingModule;
let incomingStore: typeof IncomingStoreModule;
let limits: typeof LimitsModule;
let mcpLimits: typeof McpLimitsModule;
let server: Server | undefined;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  adminClient = await import('../../../functions/src/mcp/admin-client');
  app = await import('../../../functions/src/api/app');
  audit = await import('../../../functions/src/api/audit');
  hooksModule = await import('../../../functions/src/api/hooks');
  idempotency = await import('../../../functions/src/api/idempotency');
  incoming = await import('../../../functions/src/webhooks/incoming');
  incomingStore = await import('../../../functions/src/webhooks/incoming-admin-store');
  limits = await import('../../../functions/src/api/limits');
  mcpLimits = await import('../../../functions/src/mcp/limits');
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('incoming webhooks against the emulator', () => {
  it('creates an item once per Idempotency-Key, refuses a bad body, and a rotated URL replaces the old', async () => {
    const firestore = admin.db();
    const suffix = randomUUID().slice(0, 8);
    const uid = `hook-${suffix}`;
    const workspaceId = `hookws-${suffix}`;
    const boardId = `hookb-${suffix}`;

    await firestore
      .doc(`users/${uid}`)
      .set({ accountStatus: 'approved', displayName: 'Avery Quinn' });
    await firestore.doc(`workspaces/${workspaceId}`).set({
      name: 'Home',
      ownerId: uid,
      roles: { [uid]: 'owner' },
      memberIds: [uid],
    });
    await firestore.doc(`boards/${boardId}`).set({
      workspaceId,
      state: 'active',
      kind: 'main',
      access: {},
      accessUids: [],
      position: 'a0',
      folderId: null,
      name: 'Orders',
      description: '',
      columns: [{ id: 'note', type: 'text', title: 'Note', position: 'a0', settings: {} }],
      subitemColumns: [],
      groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
    });

    const store = incomingStore.adminIncomingHookStore(firestore);
    const manage = { store, now: Date.now, enabled: () => true };
    const hooks = hooksModule.createHooksRouter({
      isEnabled: () => true,
      store,
      createService: (actorUid, via) =>
        createService({
          client: adminClient.createAdminClient(firestore),
          actor: { uid: actorUid, via },
          hideEmails: true,
        }),
      limiter: new mcpLimits.MinuteLimiter(60),
      usage: limits.adminHookUsageStore(firestore),
      audit: audit.adminApiAuditStore(firestore),
      idempotency: idempotency.adminIdempotencyStore(firestore),
      now: Date.now,
    });
    const api = app.createApiApp({
      isEnabled: () => true,
      verify: async () => {
        throw new Error('not used');
      },
      createService: () => {
        throw new Error('not used');
      },
      usage: limits.adminApiUsageStore(firestore),
      limiter: new mcpLimits.MinuteLimiter(120),
      ipFailures: new mcpLimits.MinuteLimiter(300, Date.now, limits.API_FAILED_AUTH_WINDOW_MS),
      audit: audit.adminApiAuditStore(firestore),
      idempotency: idempotency.adminIdempotencyStore(firestore),
      hooks,
      now: Date.now,
    });
    server = createServer(api);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
      const path = new URL(url).pathname;
      const res = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return { res, status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const itemCount = async () =>
      (await firestore.collection(`boards/${boardId}/items`).get()).size;

    const created = await incoming.createIncomingHook(manage, uid, {
      boardId,
      name: 'Orders form',
    });
    const stored = (
      await firestore.doc(`boards/${boardId}/incomingHooks/${created.hookId}`).get()
    ).data();
    expect(stored).toMatchObject({ name: 'Orders form', enabled: true, createdBy: uid });
    const secret = created.url.split('.').pop()!;
    expect(JSON.stringify(stored)).not.toContain(secret);
    const indexSnap = await firestore
      .collection('incomingHookIndex')
      .where('hookId', '==', created.hookId)
      .get();
    expect(indexSnap.size).toBe(1);
    expect(indexSnap.docs[0]!.id).toBe(
      incoming.hashIncomingHookToken(created.url.slice(created.url.lastIndexOf('/') + 1)),
    );
    expect(JSON.stringify(indexSnap.docs[0]!.data())).not.toContain(secret);

    // The same Idempotency-Key twice: one item.
    const key = { 'Idempotency-Key': `e2e-${suffix}` };
    const first = await post(created.url, { name: 'Order 1', values: { Note: 'rush' } }, key);
    const again = await post(created.url, { name: 'Order 1', values: { Note: 'rush' } }, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.res.headers.get('idempotency-replayed')).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    expect(await itemCount()).toBe(1);
    const item = (
      await firestore.doc(`boards/${boardId}/items/${String(first.body.id)}`).get()
    ).data()!;
    expect(item).toMatchObject({
      name: 'Order 1',
      createdBy: uid,
      updatedVia: `webhook:${created.hookId}`,
      values: { note: 'rush' },
    });

    // A bad column or body: 400 and nothing created.
    const bad = await post(created.url, { name: 'Bad', values: { Nope: 'x' } });
    expect(bad.status).toBe(400);
    const empty = await post(created.url, {});
    expect(empty.status).toBe(400);
    expect(await itemCount()).toBe(1);

    // The daily counter and the audit entry exist, without the token.
    const usage = (await firestore.doc(`apiUsage/hook_${created.hookId}`).get()).data();
    expect(usage).toMatchObject({ calls: expect.any(Number) });
    const entries = await firestore
      .collection('system/apiAudit/entries')
      .where('hookId', '==', created.hookId)
      .get();
    expect(entries.size).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(entries.docs.map((d) => d.data()))).not.toContain(secret);

    // Rotate: the old URL is a 404, the new one works.
    const rotated = await incoming.rotateIncomingHookSecret(manage, uid, {
      boardId,
      hookId: created.hookId,
    });
    expect((await post(created.url, { name: 'Old URL' })).status).toBe(404);
    expect((await post(rotated.url, { name: 'New URL' })).status).toBe(201);
    expect(await itemCount()).toBe(2);
    const afterIndex = await firestore
      .collection('incomingHookIndex')
      .where('hookId', '==', created.hookId)
      .get();
    expect(afterIndex.size).toBe(1);

    // Disabled, then deleted: 404, and the index is gone.
    await incoming.updateIncomingHook(manage, uid, {
      boardId,
      hookId: created.hookId,
      enabled: false,
    });
    expect((await post(rotated.url, { name: 'Off' })).status).toBe(404);
    await incoming.deleteIncomingHook(manage, uid, { boardId, hookId: created.hookId });
    expect((await post(rotated.url, { name: 'Gone' })).status).toBe(404);
    expect(
      (await firestore.collection('incomingHookIndex').where('hookId', '==', created.hookId).get())
        .size,
    ).toBe(0);
    expect(await itemCount()).toBe(2);
  });
});
