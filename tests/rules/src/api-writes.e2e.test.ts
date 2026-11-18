import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as AppModule from '../../../functions/src/api/app';
import type * as AuditModule from '../../../functions/src/api/audit';
import type * as AuthModule from '../../../functions/src/api/auth';
import type * as IdempotencyModule from '../../../functions/src/api/idempotency';
import type * as LimitsModule from '../../../functions/src/api/limits';
import type * as McpLimitsModule from '../../../functions/src/mcp/limits';
import type * as StoreModule from '../../../functions/src/api/admin-token-store';
import type * as TokensModule from '../../../functions/src/api/tokens';

/**
 * End to end against the Firestore emulator (P8 PR 4): the real Express app of the `api` function over
 * the real token store, Admin SDK client, counters, audit store and idempotency store. A write token
 * creates an item, reads it back, changes it and archives it; a repeated `POST` with the same
 * `Idempotency-Key` returns the same item id and creates nothing twice. Runs through `pnpm test:rules`.
 */

let admin: typeof AdminModule;
let adminClient: typeof AdminClientModule;
let app: typeof AppModule;
let audit: typeof AuditModule;
let auth: typeof AuthModule;
let idempotency: typeof IdempotencyModule;
let limits: typeof LimitsModule;
let mcpLimits: typeof McpLimitsModule;
let stores: typeof StoreModule;
let tokens: typeof TokensModule;
let server: Server | undefined;

interface ApiBody {
  id?: string;
  name?: string;
  state?: string;
  values?: Record<string, unknown>;
  items?: { name: string }[];
  error?: { code: string; message: string };
  [key: string]: unknown;
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  adminClient = await import('../../../functions/src/mcp/admin-client');
  app = await import('../../../functions/src/api/app');
  audit = await import('../../../functions/src/api/audit');
  auth = await import('../../../functions/src/api/auth');
  idempotency = await import('../../../functions/src/api/idempotency');
  limits = await import('../../../functions/src/api/limits');
  mcpLimits = await import('../../../functions/src/mcp/limits');
  stores = await import('../../../functions/src/api/admin-token-store');
  tokens = await import('../../../functions/src/api/tokens');
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('the api write routes against the emulator', () => {
  it('creates, reads, changes and archives an item, and replays an idempotent POST', async () => {
    const firestore = admin.db();
    const suffix = randomUUID().slice(0, 8);
    const uid = `apiw-${suffix}`;
    const workspaceId = `apiwws-${suffix}`;
    const boardId = `apiwb-${suffix}`;

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
      name: 'Chores',
      description: '',
      columns: [{ id: 'note', type: 'text', title: 'Note', position: 'a0', settings: {} }],
      subitemColumns: [],
      groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
    });

    const tokenStore = stores.adminApiTokenStore(firestore);
    const authDeps: AuthModule.ApiAuthDeps = {
      store: tokenStore,
      verifyOAuthToken: async () => {
        throw new Error('not an OAuth token');
      },
    };
    const api = app.createApiApp({
      isEnabled: () => true,
      verify: (header) => auth.verifyApiToken(header, authDeps),
      createService: (info) =>
        createService({
          client: adminClient.createAdminClient(firestore),
          actor: { uid: info.uid, workspaceFilter: info.workspaceIds },
        }),
      usage: limits.adminApiUsageStore(firestore),
      limiter: new mcpLimits.MinuteLimiter(120),
      ipFailures: new mcpLimits.MinuteLimiter(300, Date.now, limits.API_FAILED_AUTH_WINDOW_MS),
      audit: audit.adminApiAuditStore(firestore),
      idempotency: idempotency.adminIdempotencyStore(firestore),
      now: Date.now,
    });
    server = createServer(api);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

    const writer = await tokens.createApiToken(tokenStore, Date.now(), uid, {
      name: 'E2E writer',
      scopes: ['read', 'write'],
      expiresInDays: 30,
    });
    const reader = await tokens.createApiToken(tokenStore, Date.now(), uid, {
      name: 'E2E reader',
      scopes: ['read'],
      expiresInDays: 30,
    });
    const call = async (
      method: string,
      path: string,
      token: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { res, status: res.status, body: (await res.json()) as ApiBody };
    };

    // A read-only token cannot write.
    const denied = await call('POST', `/boards/${boardId}/items`, reader.token, { name: 'No' });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('read_only');

    // Create, read back, change.
    const created = await call('POST', `/boards/${boardId}/items`, writer.token, {
      name: 'From the API',
      values: { Note: 'first' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'From the API', values: { note: 'first' } });
    const itemId = String(created.body.id);
    const read = await call('GET', `/items/${itemId}`, writer.token);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);

    const patched = await call('PATCH', `/items/${itemId}`, writer.token, {
      name: 'Changed',
      values: { note: 'second' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ id: itemId, name: 'Changed', values: { note: 'second' } });

    // An idempotent POST: the repeat returns the same item and creates nothing.
    const key = { 'Idempotency-Key': `e2e-${suffix}` };
    const first = await call(
      'POST',
      `/boards/${boardId}/items`,
      writer.token,
      { name: 'Once' },
      key,
    );
    const again = await call(
      'POST',
      `/boards/${boardId}/items`,
      writer.token,
      { name: 'Once' },
      key,
    );
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.res.headers.get('idempotency-replayed')).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    const mismatch = await call(
      'POST',
      `/boards/${boardId}/items`,
      writer.token,
      { name: 'Twice' },
      key,
    );
    expect(mismatch.status).toBe(422);
    const record = await firestore.doc(`apiIdempotency/${uid}_e2e-${suffix}`).get();
    expect(record.get('state')).toBe('done');
    expect(record.get('expiresAt')).toBeInstanceOf(Timestamp);
    const onceItems = await firestore
      .collection(`boards/${boardId}/items`)
      .where('name', '==', 'Once')
      .get();
    expect(onceItems.size).toBe(1);

    // Archive: gone from GET afterwards.
    const archived = await call('POST', `/items/${itemId}/archive`, writer.token);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ id: itemId, state: 'archived' });
    expect((await call('GET', `/items/${itemId}`, writer.token)).status).toBe(404);
    const stored = await firestore.doc(`boards/${boardId}/items/${itemId}`).get();
    expect(stored.get('state')).toBe('archived');

    // The audit trail has the writes with the route and the board, never the body.
    const entries = await firestore
      .collection('system')
      .doc('apiAudit')
      .collection('entries')
      .where('tokenId', '==', writer.tokenId)
      .get();
    const posts = entries.docs.map((d) => d.data()).filter((d) => d.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(posts.some((d) => d.route === '/api/v1/boards/:id/items' && d.boardId === boardId)).toBe(
      true,
    );
    expect(JSON.stringify(entries.docs.map((d) => d.data()))).not.toContain('From the API');
    const usage = await firestore.doc(`${limits.API_USAGE}/${writer.tokenId}`).get();
    expect(usage.get('writes')).toBeGreaterThanOrEqual(5);
  });
});
