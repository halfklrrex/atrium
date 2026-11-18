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
import type * as LimitsModule from '../../../functions/src/api/limits';
import type * as McpLimitsModule from '../../../functions/src/mcp/limits';
import type * as StoreModule from '../../../functions/src/api/admin-token-store';
import type * as TokensModule from '../../../functions/src/api/tokens';

/**
 * End to end against the Firestore emulator (P8 PR 3): the real Express app of the `api` function over
 * the real token store, Admin SDK client, usage counters and audit store, driven over HTTP. A personal
 * access token is created through the real token logic, used on `/me`, `/workspaces` and an items
 * page against seeded data, and stops working after it is revoked. Runs through `pnpm test:rules`.
 */

let admin: typeof AdminModule;
let adminClient: typeof AdminClientModule;
let app: typeof AppModule;
let audit: typeof AuditModule;
let auth: typeof AuthModule;
let limits: typeof LimitsModule;
let mcpLimits: typeof McpLimitsModule;
let stores: typeof StoreModule;
let tokens: typeof TokensModule;
let server: Server | undefined;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  adminClient = await import('../../../functions/src/mcp/admin-client');
  app = await import('../../../functions/src/api/app');
  audit = await import('../../../functions/src/api/audit');
  auth = await import('../../../functions/src/api/auth');
  limits = await import('../../../functions/src/api/limits');
  mcpLimits = await import('../../../functions/src/mcp/limits');
  stores = await import('../../../functions/src/api/admin-token-store');
  tokens = await import('../../../functions/src/api/tokens');
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('the api function against the emulator', () => {
  it('creates a token, reads with it, and gets 401 after revoking it', async () => {
    const firestore = admin.db();
    const suffix = randomUUID().slice(0, 8);
    const uid = `apife-${suffix}`;
    const workspaceId = `apiws-${suffix}`;
    const otherWorkspaceId = `apiws2-${suffix}`;
    const boardId = `apib-${suffix}`;
    const now = Timestamp.now();

    await firestore
      .doc(`users/${uid}`)
      .set({ accountStatus: 'approved', displayName: 'Avery Quinn' });
    for (const [id, name] of [
      [workspaceId, 'Home'],
      [otherWorkspaceId, 'Other'],
    ] as const) {
      await firestore.doc(`workspaces/${id}`).set({
        name,
        ownerId: uid,
        roles: { [uid]: 'owner' },
        memberIds: [uid],
      });
    }
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
    for (let n = 1; n <= 3; n += 1) {
      await firestore.doc(`boards/${boardId}/items/it${n}`).set({
        name: `Item ${n}`,
        groupId: 'g1',
        position: `a${n}`,
        parentItemId: null,
        state: 'active',
        values: { note: `note ${n}` },
        seq: n,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      });
    }

    const tokenStore = stores.adminApiTokenStore(firestore);
    const newDeps = (): AuthModule.ApiAuthDeps => ({
      store: tokenStore,
      verifyOAuthToken: async () => {
        throw new Error('not an OAuth token');
      },
    });
    /** One app instance: each has its own verifier caches, like a Cloud Run instance. */
    const serve = async () => {
      const authDeps = newDeps();
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
        now: Date.now,
      });
      server = createServer(api);
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
      return async (path: string, token?: string) => {
        const res = await fetch(`${base}${path}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        return { status: res.status, body: (await res.json()) as Record<string, any> };
      };
    };
    const get = await serve();

    // A token restricted to the first workspace, created through the real token logic.
    const created = await tokens.createApiToken(tokenStore, Date.now(), uid, {
      name: 'E2E',
      scopes: ['read'],
      workspaceIds: [workspaceId],
      expiresInDays: 30,
    });

    const me = await get('/me', created.token);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      uid,
      auth: { kind: 'pat', scopes: ['read'], workspaceIds: [workspaceId] },
    });

    const workspaces = await get('/workspaces', created.token);
    expect(workspaces.body.workspaces.map((w: { id: string }) => w.id)).toEqual([workspaceId]);

    const page = await get(`/boards/${boardId}/items?limit=2`, created.token);
    expect(page.status).toBe(200);
    expect(page.body.items.map((i: { name: string }) => i.name)).toEqual(['Item 1', 'Item 2']);
    expect(page.body.total).toBe(3);
    const next = await get(
      `/boards/${boardId}/items?limit=2&cursor=${encodeURIComponent(page.body.nextCursor)}`,
      created.token,
    );
    expect(next.body.items.map((i: { name: string }) => i.name)).toEqual(['Item 3']);
    expect(next.body.nextCursor).toBeNull();

    const one = await get('/items/it2', created.token);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: 'it2', boardId, values: { note: 'note 2' } });
    // The workspace restriction hides the other workspace.
    expect((await get(`/workspaces/${otherWorkspaceId}/boards`, created.token)).status).toBe(404);

    // Bookkeeping: the daily counter carries a TTL field and the audit trail has the calls.
    const usage = await firestore.doc(`${limits.API_USAGE}/${created.tokenId}`).get();
    expect(usage.get('calls')).toBeGreaterThanOrEqual(5);
    expect(usage.get('expiresAt')).toBeInstanceOf(Timestamp);
    const entries = await firestore
      .collection('system')
      .doc('apiAudit')
      .collection('entries')
      .where('tokenId', '==', created.tokenId)
      .get();
    expect(entries.size).toBeGreaterThanOrEqual(5);
    expect(entries.docs[0]!.get('expiresAt')).toBeInstanceOf(Timestamp);
    expect(JSON.stringify(entries.docs.map((d) => d.data()))).not.toContain(created.token);

    // Revoke through the real logic. The verifier caches a token for up to 60 s per instance, so
    // a fresh instance (new caches) is the one that must refuse it at once.
    await tokens.revokeApiToken(tokenStore, Date.now(), uid, { tokenId: created.tokenId });
    const afterRevoke = await serve();
    expect((await afterRevoke('/me', created.token)).status).toBe(401);
    expect((await get('/me')).status).toBe(401);
    const failed = await firestore
      .collection('system')
      .doc('apiAudit')
      .collection('entries')
      .where('kind', '==', 'auth_failed')
      .get();
    expect(failed.size).toBeGreaterThanOrEqual(1);
  });
});
