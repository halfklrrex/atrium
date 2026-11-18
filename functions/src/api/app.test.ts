import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { createFakeClient } from '@atrium/mcp-core/fake-client';
import { logger } from 'firebase-functions/v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinuteLimiter, usageDay, type UsageStore, type UsageVerdict } from '../mcp/limits';
import type { ApiAuditEntry, ApiAuditStore } from './audit';
import { createApiApp } from './app';
import { verifyApiToken, type ApiAuthDeps } from './auth';
import { FakeApiTokenStore } from './fake-token-store';
import { createApiToken } from './tokens';

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const NOW = new Date(T0);
const ME = 'u-me';
const VIEWER = 'u-viewer';
const BLOCKED = 'u-blocked';
const STRANGER = 'u-stranger';

const column = (id: string, type: string, title: string, position: string) => ({
  id,
  type,
  title,
  position,
  settings: {},
});
const board = (workspaceId: string, name: string, more: Record<string, unknown> = {}) => ({
  workspaceId,
  state: 'active',
  kind: 'main',
  access: {},
  accessUids: [],
  position: 'a0',
  folderId: null,
  name,
  description: '',
  columns: [column('note', 'text', 'Note', 'a0')],
  subitemColumns: [],
  groups: [
    { id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' },
    { id: 'g2', title: 'Done', color: '#00c875', position: 'a1' },
  ],
  ...more,
});
const item = (name: string, position: string, more: Record<string, unknown> = {}) => ({
  name,
  groupId: 'g1',
  position,
  parentItemId: null,
  state: 'active',
  values: { note: `note of ${name}` },
  seq: 1,
  createdAt: NOW,
  createdBy: ME,
  updatedAt: NOW,
  updatedBy: ME,
  ...more,
});
const workspace = (name: string, roles: Record<string, string>) => ({
  name,
  ownerId: ME,
  roles,
  memberIds: Object.keys(roles),
});

function seed() {
  const docs: Record<string, Record<string, unknown>> = {
    'workspaces/w1': workspace('Home', { [ME]: 'owner', [VIEWER]: 'viewer' }),
    'workspaces/w2': workspace('Work', { [ME]: 'owner' }),
    'workspaces/w1/members/u-me': { displayName: 'Avery Quinn', email: 'avery@example.com' },
    'workspaces/w1/members/u-viewer': { displayName: 'Vic Reed', email: 'vic@example.com' },
    'boards/b1': board('w1', 'Chores'),
    'boards/b2': board('w2', 'Projects'),
    'boards/bp': board('w1', 'Private', { kind: 'private', access: { [ME]: 'owner' } }),
    'boards/b1/items/sub1': item('Sub', 'a0', { parentItemId: 'i1' }),
    'boards/b2/items/j1': item('Work item', 'a0'),
    'boards/b1/items/i1/updates/up1': {
      authorId: ME,
      authorName: 'Avery Quinn',
      content: 'Hello\u0007 there',
      createdAt: NOW,
      updatedAt: NOW,
      likes: [],
      mentions: [],
      attachments: [],
      repliesCount: 0,
    },
  };
  for (let n = 1; n <= 7; n += 1) {
    docs[`boards/b1/items/i${n}`] = item(`Item ${n}`, `a${n}`, { seq: n });
  }
  return docs;
}

class FakeUsage implements UsageStore {
  seen: { key: string; day: string; write: boolean }[] = [];
  constructor(private cap = 5000) {}
  async consume(key: string, day: string, write: boolean): Promise<UsageVerdict> {
    if (this.seen.length >= this.cap) return 'calls';
    this.seen.push({ key, day, write });
    return 'ok';
  }
}

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(options: { enabled?: boolean; perMinute?: number; usage?: UsageStore } = {}) {
  const clock = { now: T0 };
  const store = new FakeApiTokenStore();
  for (const uid of [ME, VIEWER, STRANGER]) store.accounts.set(uid, 'approved');
  store.accounts.set(BLOCKED, 'blocked');
  store.memberships.set(ME, new Set(['w1', 'w2']));
  store.memberships.set(VIEWER, new Set(['w1']));
  store.memberships.set(STRANGER, new Set());
  store.memberships.set(BLOCKED, new Set(['w1']));
  const client = createFakeClient(seed());
  const audit: ApiAuditEntry[] = [];
  const auditStore: ApiAuditStore = { append: async (entry) => void audit.push(entry) };
  const authDeps: ApiAuthDeps = {
    store,
    verifyOAuthToken: async () => {
      throw new Error('not an OAuth token');
    },
    now: () => clock.now,
  };
  const state = { enabled: options.enabled ?? true };
  const usage = options.usage ?? new FakeUsage();
  const app = createApiApp({
    isEnabled: () => state.enabled,
    verify: (header) => verifyApiToken(header, authDeps),
    createService: (auth) =>
      createService({
        client,
        actor: { uid: auth.uid, workspaceFilter: auth.workspaceIds },
        now: () => new Date(clock.now),
      }),
    usage,
    limiter: new MinuteLimiter(options.perMinute ?? 120, () => clock.now),
    ipFailures: new MinuteLimiter(3, () => clock.now, 60 * 60_000),
    audit: auditStore,
    now: () => clock.now,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const make = async (
    uid: string,
    input: { scopes?: ('read' | 'write')[]; workspaceIds?: string[] } = {},
  ) =>
    createApiToken(store, clock.now, uid, {
      name: 'Test',
      scopes: input.scopes ?? ['read'],
      ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
      expiresInDays: 90,
    });
  const get = async (path: string, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    return { res, status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  return { base, clock, store, state, usage, audit, make, get };
}

describe('kill switch', () => {
  it('answers 503 api_disabled with no-store and touches nothing', async () => {
    const h = await start({ enabled: false });
    const { res, status, body } = await h.get('/me');
    expect(status).toBe(503);
    expect(body).toEqual({ error: { code: 'api_disabled', message: expect.any(String) } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.store.reads).toEqual({ index: 0, token: 0, account: 0 });
    expect(h.audit).toHaveLength(0);
  });
});

describe('authentication', () => {
  it.each([
    ['no header', undefined],
    ['a token that does not exist', 'atrp_' + 'x'.repeat(43)],
    ['a malformed value', 'not-a-token'],
  ])('401 unauthorized for %s', async (_name, token) => {
    const h = await start();
    const { res, status, body } = await h.get('/me', token);
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.audit.at(-1)).toMatchObject({ kind: 'auth_failed', status: 401, ok: false });
  });

  it('refuses a revoked token', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    expect((await h.get('/me', token)).status).toBe(200);
    await h.store.revokeToken(ME, tokenId, h.clock.now);
    h.clock.now += 61_000; // past the 60 s verifier cache
    expect((await h.get('/me', token)).status).toBe(401);
  });

  it('refuses a blocked account', async () => {
    const h = await start();
    h.store.accounts.set(BLOCKED, 'approved');
    const { token } = await h.make(BLOCKED);
    h.store.accounts.set(BLOCKED, 'blocked');
    const { status, body } = await h.get('/me', token);
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
  });

  it('refuses an expired token', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    h.clock.now += 91 * 24 * 60 * 60_000;
    expect((await h.get('/me', token)).status).toBe(401);
  });

  it('refuses a token without the read scope', async () => {
    const h = await start();
    const { token } = await h.make(ME, { scopes: ['write'] });
    const { status, body } = await h.get('/me', token);
    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });

  it('answers 429 to an IP that keeps failing, even with a valid token afterwards', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    for (let n = 0; n < 3; n += 1) expect((await h.get('/me', 'bad')).status).toBe(401);
    const blocked = await h.get('/me', token);
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get('retry-after')).toBe('3600');
    expect(blocked.body.error.code).toBe('rate_limited');
    h.clock.now += 61 * 60_000;
    expect((await h.get('/me', token)).status).toBe(200);
  });
});

describe('reading', () => {
  it('GET /me and /workspaces', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    const me = await h.get('/me', token);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      uid: ME,
      auth: { kind: 'pat', scopes: ['read'], workspaceIds: null, tokenId },
    });
    expect(me.body.workspaces.map((w: { id: string }) => w.id)).toEqual(['w1', 'w2'].sort());
    const list = await h.get('/workspaces', token);
    expect(list.body.workspaces).toHaveLength(2);
    expect(list.res.headers.get('cache-control')).toBe('no-store');
  });

  it('lists boards, shows one board and its members without emails', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const boards = await h.get('/workspaces/w1/boards', token);
    expect(boards.body.boards.map((b: { id: string }) => b.id).sort()).toEqual(['b1', 'bp']);
    const one = await h.get('/boards/b1', token);
    expect(one.status).toBe(200);
    expect(one.body.columns[0]).toMatchObject({ id: 'note', title: 'Note' });
    expect(one.body.groups.map((g: { id: string }) => g.id)).toEqual(['g1', 'g2']);
    expect(one.body.items).toBeUndefined();
    const members = await h.get('/boards/b1/members', token);
    expect(members.status).toBe(200);
    expect(members.body.members.length).toBeGreaterThan(0);
    expect(members.text).not.toContain('@example.com');
    expect(members.body.members[0].name).toBeTruthy();
  });

  it('returns one item with values by id and title, subitems nested, found without its board', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const { status, body } = await h.get('/items/i1', token);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 'i1',
      boardId: 'b1',
      name: 'Item 1',
      group: { id: 'g1', title: 'Todo' },
      values: { note: 'note of Item 1' },
      valuesByTitle: { Note: 'note of Item 1' },
    });
    expect(body.subitems.map((s: { id: string }) => s.id)).toEqual(['sub1']);
    expect((await h.get('/items/i1?board=b1', token)).status).toBe(200);
    expect((await h.get('/items/i1?board=b2', token)).status).toBe(404);
  });

  it('lists the updates of an item and strips control characters', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const { status, body } = await h.get('/items/i1/updates', token);
    expect(status).toBe(200);
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0].text).toBe('Hello there');
  });

  it('pages items with an opaque cursor and caps the limit', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const first = await h.get('/boards/b1/items?limit=3', token);
    expect(first.status).toBe(200);
    expect(first.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Item 1',
      'Item 2',
      'Item 3',
    ]);
    expect(first.body.total).toBe(7);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await h.get(
      `/boards/b1/items?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      token,
    );
    expect(second.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Item 4',
      'Item 5',
      'Item 6',
    ]);
    const last = await h.get(
      `/boards/b1/items?limit=3&cursor=${encodeURIComponent(second.body.nextCursor)}`,
      token,
    );
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
    // Default 50, cap 200.
    expect((await h.get('/boards/b1/items', token)).body.limit).toBe(50);
    expect((await h.get('/boards/b1/items?limit=9999', token)).body.limit).toBe(200);
    // Group filter by id, and bad input.
    expect((await h.get('/boards/b1/items?group=g2', token)).body.total).toBe(0);
    expect((await h.get('/boards/b1/items?limit=0', token)).status).toBe(400);
    const bad = await h.get('/boards/b1/items?cursor=garbage', token);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid');
  });
});

describe('who can see what', () => {
  it('a non-member gets 404, never 403, for boards, items and workspaces', async () => {
    const h = await start();
    const { token } = await h.make(STRANGER);
    for (const path of ['/boards/b1', '/boards/b1/items', '/boards/b1/members', '/items/i1']) {
      const { status, body } = await h.get(path, token);
      expect(status, path).toBe(404);
      expect(body.error.code, path).toBe('not_found');
    }
    expect((await h.get('/workspaces/w1/boards', token)).status).toBe(404);
    expect((await h.get('/workspaces', token)).body.workspaces).toEqual([]);
    expect((await h.get('/boards/does-not-exist', token)).status).toBe(404);
  });

  it('a private board of the workspace is 404 for a member who is not on it', async () => {
    const h = await start();
    const { token } = await h.make(VIEWER);
    expect((await h.get('/boards/bp', token)).status).toBe(404);
    expect((await h.get('/boards/bp/items', token)).status).toBe(404);
  });

  it('a viewer can read', async () => {
    const h = await start();
    const { token } = await h.make(VIEWER);
    expect((await h.get('/boards/b1', token)).status).toBe(200);
    expect((await h.get('/boards/b1/items', token)).body.items).toHaveLength(7);
    expect((await h.get('/items/i1', token)).status).toBe(200);
    expect((await h.get('/items/i1/updates', token)).status).toBe(200);
  });

  it('a token restricted to one workspace cannot see another workspace or its boards', async () => {
    const h = await start();
    const { token } = await h.make(ME, { workspaceIds: ['w1'] });
    const me = await h.get('/me', token);
    expect(me.body.auth.workspaceIds).toEqual(['w1']);
    expect(me.body.workspaces.map((w: { id: string }) => w.id)).toEqual(['w1']);
    expect((await h.get('/workspaces', token)).body.workspaces).toHaveLength(1);
    expect((await h.get('/boards/b1', token)).status).toBe(200);
    for (const path of ['/boards/b2', '/boards/b2/items', '/workspaces/w2/boards', '/items/j1']) {
      const { status, body } = await h.get(path, token);
      expect(status, path).toBe(404);
      expect(body.error.code, path).toBe('not_found');
    }
  });
});

describe('limits', () => {
  it('429 with Retry-After once a token has used its calls for the minute', async () => {
    const h = await start({ perMinute: 2 });
    const { token } = await h.make(ME);
    expect((await h.get('/me', token)).status).toBe(200);
    expect((await h.get('/me', token)).status).toBe(200);
    const limited = await h.get('/me', token);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.res.headers.get('retry-after')).toBe('60');
    h.clock.now += 61_000;
    expect((await h.get('/me', token)).status).toBe(200);
  });

  it('429 when the daily counter is used up, Retry-After until the next UTC day', async () => {
    const h = await start({ usage: new FakeUsage(1) });
    const { token } = await h.make(ME);
    expect((await h.get('/me', token)).status).toBe(200);
    const limited = await h.get('/me', token);
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get('retry-after'))).toBe(14 * 3600);
  });

  it('counts per token, by UTC day, as a read', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    await h.get('/me', token);
    expect((h.usage as FakeUsage).seen).toEqual([
      { key: tokenId, day: usageDay(T0), write: false },
    ]);
  });
});

describe('errors, logs and audit', () => {
  it('unknown routes are 404 with the error shape, only after authentication', async () => {
    const h = await start();
    expect((await h.get('/nope')).status).toBe(401);
    const { token } = await h.make(ME);
    const { status, body } = await h.get('/nope', token);
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('an unexpected failure is a generic 500 and the token is never logged', async () => {
    const h = await brokenHarness();
    const { token } = await h.make(ME);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const { status, body, text } = await h.get('/boards/b1', token);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'internal', message: 'Unexpected error' } });
    expect(text).not.toContain('secret-detail');
    expect(error).toHaveBeenCalled();
    for (const spy of [error, warn, info, log]) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(token);
      expect(logged).not.toMatch(/authorization|bearer/i);
    }
  });

  it('audits each call without the token, the body or the query', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    await h.get('/boards/b1/items?group=g1&limit=2', token);
    await h.get('/boards/nope', token);
    const [ok, missing] = h.audit;
    expect(ok).toMatchObject({
      kind: 'call',
      method: 'GET',
      route: '/api/v1/boards/:id/items',
      boardId: 'b1',
      ok: true,
      status: 200,
      uid: ME,
      tokenId,
    });
    expect(ok!.expiresAt - ok!.at).toBe(90 * 24 * 60 * 60_000);
    expect(missing).toMatchObject({ ok: false, status: 404, error: 'not_found', boardId: 'nope' });
    const text = JSON.stringify(h.audit);
    expect(text).not.toContain(token);
    expect(text).not.toContain('group=g1');
  });
});

/** An app whose service factory throws, with a cause that must stay private. */
async function brokenHarness() {
  const store = new FakeApiTokenStore();
  store.accounts.set(ME, 'approved');
  store.memberships.set(ME, new Set(['w1']));
  const authDeps: ApiAuthDeps = {
    store,
    verifyOAuthToken: async () => {
      throw new Error('no');
    },
    now: () => T0,
  };
  const app = createApiApp({
    isEnabled: () => true,
    verify: (header) => verifyApiToken(header, authDeps),
    createService: () => {
      throw new Error('secret-detail: connection refused');
    },
    usage: new FakeUsage(),
    limiter: new MinuteLimiter(120, () => T0),
    ipFailures: new MinuteLimiter(300, () => T0, 60 * 60_000),
    audit: { append: async () => undefined },
    now: () => T0,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  return {
    make: (uid: string) =>
      createApiToken(store, T0, uid, { name: 'T', scopes: ['read'], expiresInDays: 90 }),
    get: async (path: string, token: string) => {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      return { status: res.status, body: JSON.parse(text), text };
    },
  };
}
