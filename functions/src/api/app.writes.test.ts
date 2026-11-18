import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { createFakeClient } from '@atrium/mcp-core/fake-client';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MinuteLimiter, type UsageStore, type UsageVerdict } from '../mcp/limits';
import type { ApiAuditEntry } from './audit';
import { createApiApp } from './app';
import { verifyApiToken, type ApiAuthDeps } from './auth';
import { FakeApiTokenStore } from './fake-token-store';
import { FakeIdempotencyStore, decideBegin, requestHash } from './idempotency';
import { createApiToken } from './tokens';

/** Write routes (P8 PR 4): the real service over the fake client, driven through the Express app. */

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const NOW = new Date(T0);
const ME = 'u-me';
const EDITOR = 'u-editor';
const VIEWER = 'u-viewer';
const STRANGER = 'u-stranger';

const col = (id: string, type: string, title: string, position: string, settings = {}) => ({
  id,
  type,
  title,
  position,
  settings,
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
  columns: [
    col('note', 'text', 'Note', 'a0'),
    col('num', 'numbers', 'Hours', 'a1'),
    col('req', 'text', 'Owner note', 'a2'),
    col('lock', 'text', 'Locked note', 'a3'),
    col('calc', 'formula', 'Calc', 'a4', { formula: '{note}' }),
  ],
  subitemColumns: [],
  columnLocks: ['lock'],
  requiredColumnIds: ['req'],
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
  values: { note: `note of ${name}`, req: 'must stay' },
  seq: 1,
  createdAt: NOW,
  createdBy: ME,
  updatedAt: NOW,
  updatedBy: ME,
  ...more,
});

const seed = () => ({
  'workspaces/w1': {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', [EDITOR]: 'member', [VIEWER]: 'viewer' },
    memberIds: [ME, EDITOR, VIEWER],
  },
  'workspaces/w2': { name: 'Work', ownerId: ME, roles: { [ME]: 'owner' }, memberIds: [ME] },
  'users/u-me': { displayName: 'Avery Quinn', email: 'avery@example.com' },
  'workspaces/w1/members/u-me': { displayName: 'Avery Quinn', email: 'avery@example.com' },
  'workspaces/w1/members/u-editor': { displayName: 'Eli Park', email: 'eli@example.com' },
  'workspaces/w1/members/u-viewer': { displayName: 'Vic Reed', email: 'vic@example.com' },
  'boards/b1': board('w1', 'Chores'),
  'boards/b2': board('w2', 'Projects'),
  'boards/b1/items/i1': item('Item 1', 'a1', { seq: 1 }),
  'boards/b2/items/j1': item('Work item', 'a1'),
});

class CountingUsage implements UsageStore {
  seen: { key: string; write: boolean }[] = [];
  async consume(key: string, _day: string, write: boolean): Promise<UsageVerdict> {
    this.seen.push({ key, write });
    return 'ok';
  }
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(options: { gate?: Promise<void> } = {}) {
  const clock = { now: T0 };
  const store = new FakeApiTokenStore();
  for (const uid of [ME, EDITOR, VIEWER, STRANGER]) store.accounts.set(uid, 'approved');
  store.memberships.set(ME, new Set(['w1', 'w2']));
  store.memberships.set(EDITOR, new Set(['w1']));
  store.memberships.set(VIEWER, new Set(['w1']));
  store.memberships.set(STRANGER, new Set());
  const client = createFakeClient(seed());
  const audit: ApiAuditEntry[] = [];
  const usage = new CountingUsage();
  const idempotency = new FakeIdempotencyStore();
  const authDeps: ApiAuthDeps = {
    store,
    verifyOAuthToken: async () => {
      throw new InvalidTokenError('not an OAuth token');
    },
    now: () => clock.now,
  };
  let entered: (() => void) | undefined;
  const reachedService = new Promise<void>((resolve) => (entered = resolve));
  const app = createApiApp({
    isEnabled: () => true,
    verify: (header) => verifyApiToken(header, authDeps),
    createService: (auth) => {
      const service = createService({
        client,
        actor: { uid: auth.uid, workspaceFilter: auth.workspaceIds },
        hideEmails: true,
        now: () => new Date(clock.now),
      });
      if (!options.gate) return service;
      // Holds createItems until the test lets it go (to make two requests overlap).
      return new Proxy(service, {
        get(target, key, receiver) {
          if (key !== 'createItems') return Reflect.get(target, key, receiver) as unknown;
          return async (args: Parameters<typeof target.createItems>[0]) => {
            entered?.();
            await options.gate;
            return target.createItems(args);
          };
        },
      });
    },
    usage,
    limiter: new MinuteLimiter(120, () => clock.now),
    ipFailures: new MinuteLimiter(300, () => clock.now, 60 * 60_000),
    audit: { append: async (entry) => void audit.push(entry) },
    idempotency,
    now: () => clock.now,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const make = (
    uid: string,
    input: { scopes?: ('read' | 'write')[]; workspaceIds?: string[] } = {},
  ) =>
    createApiToken(store, clock.now, uid, {
      name: 'Test',
      scopes: input.scopes ?? ['read', 'write'],
      ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
      expiresInDays: 90,
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
    const text = await res.text();
    return { res, status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  return { clock, store, usage, audit, idempotency, make, call, client, reachedService };
}

const errorOf = (r: { body: { error: { code: string; message: string } } }) => r.body.error;

describe('POST /boards/:id/items', () => {
  it('creates one item and returns it as GET /items/:id does', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/boards/b1/items', token, {
      name: 'New one',
      group: 'Done',
      values: { Note: 'hello', Hours: '3' },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      name: 'New one',
      boardId: 'b1',
      group: { id: 'g2', title: 'Done' },
      values: { note: 'hello', num: '3' },
      valuesByTitle: { Note: 'hello', Hours: '3' },
    });
    const again = await h.call('GET', `/items/${r.body.id}`, token);
    expect(again.body).toEqual(r.body);
  });

  it('creates a batch and answers { boardId, items }', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/boards/b1/items', token, {
      items: [{ name: 'A' }, { name: 'B', values: { note: 'x' } }],
    });
    expect(r.status).toBe(201);
    expect(r.body.boardId).toBe('b1');
    expect(r.body.items.map((i: { name: string }) => i.name)).toEqual(['A', 'B']);
  });

  it('accepts 50 items and refuses 51 with a path in the message', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const items = (n: number) => Array.from({ length: n }, (_v, i) => ({ name: `n${i}` }));
    expect((await h.call('POST', '/boards/b1/items', token, { items: items(50) })).status).toBe(
      201,
    );
    const over = await h.call('POST', '/boards/b1/items', token, { items: items(51) });
    expect(over.status).toBe(400);
    expect(errorOf(over).code).toBe('invalid');
  });

  it.each([
    ['an empty body', {}],
    ['a missing name', { group: 'Todo' }],
    ['an empty name', { name: '  ' }],
    ['a name that is too long', { name: 'x'.repeat(501) }],
    ['an unknown field', { name: 'A', color: 'red' }],
    ['values that are not an object', { name: 'A', values: 'x' }],
    ['an empty batch', { items: [] }],
    ['a batch with a bad entry', { items: [{ name: 'ok' }, { nom: 'bad' }] }],
  ])('400 invalid for %s', async (_label, body) => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/boards/b1/items', token, body);
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe('invalid');
    expect(errorOf(r).message.length).toBeGreaterThan(5);
  });

  it('names the offending path inside a batch', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/boards/b1/items', token, {
      items: [{ name: 'ok' }, { name: '' }],
    });
    expect(errorOf(r).message).toMatch(/items\.1\.name|name/);
  });

  it('refuses derived, locked and unknown columns, with the service message', async () => {
    const h = await start();
    const editor = await h.make(EDITOR);
    const derived = await h.call('POST', '/boards/b1/items', editor.token, {
      name: 'A',
      values: { Calc: 'x' },
    });
    expect(derived.status).toBe(400);
    expect(errorOf(derived).message).toMatch(/calculated/);
    const locked = await h.call('POST', '/boards/b1/items', editor.token, {
      name: 'A',
      values: { 'Locked note': 'x' },
    });
    expect(locked.status).toBe(403);
    expect(errorOf(locked)).toMatchObject({ code: 'forbidden' });
    expect(errorOf(locked).message).toMatch(/locked/);
    // The board owner may write the locked column.
    const owner = await h.make(ME);
    expect(
      (
        await h.call('POST', '/boards/b1/items', owner.token, {
          name: 'A',
          values: { 'Locked note': 'x' },
        })
      ).status,
    ).toBe(201);
  });
});

describe('PATCH /items/:id', () => {
  it('changes the name, the group and values by title, and null clears', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('PATCH', '/items/i1', token, {
      name: 'Renamed',
      group: 'Done',
      values: { Hours: 5, Note: null },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: 'i1',
      name: 'Renamed',
      group: { title: 'Done' },
      values: { num: '5' },
    });
    expect(r.body.values.note).toBeUndefined();
    expect(r.body.values.req).toBe('must stay');
  });

  it('supports the ?board= hint', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    expect((await h.call('PATCH', '/items/i1?board=b1', token, { name: 'Hinted' })).status).toBe(
      200,
    );
    // A wrong hint is "not found", like a wrong board for GET.
    expect((await h.call('PATCH', '/items/i1?board=b2', token, { name: 'X' })).status).toBe(404);
  });

  it('refuses to empty a required column and an empty change', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const required = await h.call('PATCH', '/items/i1', token, { values: { 'Owner note': null } });
    expect(required.status).toBe(400);
    expect(errorOf(required).message).toMatch(/required/);
    const nothing = await h.call('PATCH', '/items/i1', token, {});
    expect(nothing.status).toBe(400);
    expect(errorOf(nothing).message).toMatch(/Nothing to change/);
  });

  it('refuses derived and locked columns for an editor', async () => {
    const h = await start();
    const { token } = await h.make(EDITOR);
    expect((await h.call('PATCH', '/items/i1', token, { values: { Calc: 1 } })).status).toBe(400);
    expect((await h.call('PATCH', '/items/i1', token, { values: { lock: 'x' } })).status).toBe(403);
  });
});

describe('subitems, duplicate, archive, updates', () => {
  it('creates subitems under an item and nests them in GET /items/:id', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/items/i1/subitems', token, {
      items: [{ name: 'Step 1' }, { name: 'Step 2' }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ boardId: 'b1', parentItemId: 'i1' });
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toMatchObject({ name: 'Step 1', parentItemId: 'i1' });
    const parent = await h.call('GET', '/items/i1', token);
    expect(parent.body.subitems.map((s: { name: string }) => s.name)).toEqual(['Step 1', 'Step 2']);
    const over = await h.call('POST', '/items/i1/subitems', token, {
      items: Array.from({ length: 51 }, () => ({ name: 's' })),
    });
    expect(over.status).toBe(400);
    const bad = await h.call('POST', '/items/i1/subitems', token, { items: [] });
    expect(bad.status).toBe(400);
  });

  it('duplicates an item and returns the copy', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/items/i1/duplicate', token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Item 1 (copy)', boardId: 'b1' });
    expect(r.body.id).not.toBe('i1');
    expect((await h.call('GET', `/items/${r.body.id}`, token)).status).toBe(200);
  });

  it('archives an item: it is gone from GET afterwards', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/items/i1/archive', token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'i1', state: 'archived', boardId: 'b1' });
    expect((await h.call('GET', '/items/i1', token)).status).toBe(404);
    expect((await h.call('POST', '/items/i1/archive', token)).status).toBe(404);
  });

  it('posts an update with a mention and returns it as the updates list does', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/items/i1/updates', token, {
      text: 'Ping @[Eli Park], see **this**',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      author: { uid: ME, name: 'Avery Quinn' },
      mine: true,
      mentions: [EDITOR],
    });
    expect(r.text).not.toContain('@example.com');
    const list = await h.call('GET', '/items/i1/updates', token);
    expect(list.body.updates.map((u: { id: string }) => u.id)).toContain(r.body.id);
  });

  it.each([
    ['empty text', { text: '' }],
    ['no text', {}],
    ['text that is too long', { text: 'x'.repeat(50001) }],
    ['another field', { text: 'ok', extra: 1 }],
  ])('400 invalid for an update with %s', async (_label, body) => {
    const h = await start();
    const { token } = await h.make(ME);
    const r = await h.call('POST', '/items/i1/updates', token, body);
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe('invalid');
  });

  it('does not offer a hard delete or structure changes', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    expect((await h.call('DELETE', '/items/i1', token)).status).toBe(404);
    expect((await h.call('POST', '/boards/b1/columns', token, { title: 'x' })).status).toBe(404);
    expect((await h.call('PATCH', '/boards/b1', token, { name: 'x' })).status).toBe(404);
  });
});

describe('who may write', () => {
  const requests: [string, string, unknown][] = [
    ['POST', '/boards/b1/items', { name: 'A' }],
    ['PATCH', '/items/i1', { name: 'A' }],
    ['POST', '/items/i1/subitems', { items: [{ name: 'A' }] }],
    ['POST', '/items/i1/duplicate', undefined],
    ['POST', '/items/i1/archive', undefined],
    ['POST', '/items/i1/updates', { text: 'hi' }],
  ];

  it.each(requests)('a read-only token gets 403 read_only on %s %s', async (method, path, body) => {
    const h = await start();
    const { token } = await h.make(ME, { scopes: ['read'] });
    const r = await h.call(method, path, token, body);
    expect(r.status).toBe(403);
    expect(errorOf(r).code).toBe('read_only');
    // Nothing was written.
    expect((await h.call('GET', '/items/i1', token)).body.name).toBe('Item 1');
  });

  it.each(requests)('a viewer gets 403 on %s %s', async (method, path, body) => {
    const h = await start();
    const { token } = await h.make(VIEWER);
    const r = await h.call(method, path, token, body);
    expect(r.status).toBe(403);
    expect(errorOf(r).code).toBe('forbidden');
  });

  it.each(requests)('a non-member gets 404 on %s %s', async (method, path, body) => {
    const h = await start();
    const { token } = await h.make(STRANGER);
    const r = await h.call(method, path, token, body);
    expect(r.status).toBe(404);
    expect(errorOf(r).code).toBe('not_found');
  });

  it.each(requests)(
    'a token restricted to another workspace gets 404 on %s %s',
    async (method, path, body) => {
      const h = await start();
      const { token } = await h.make(ME, { workspaceIds: ['w2'] });
      const r = await h.call(method, path, token, body);
      expect(r.status).toBe(404);
    },
  );

  it('a workspace-restricted token writes inside its workspace only', async () => {
    const h = await start();
    const { token } = await h.make(ME, { workspaceIds: ['w2'] });
    expect((await h.call('POST', '/boards/b2/items', token, { name: 'ok' })).status).toBe(201);
    expect((await h.call('PATCH', '/items/j1', token, { name: 'ok' })).status).toBe(200);
    expect((await h.call('PATCH', '/items/i1', token, { name: 'no' })).status).toBe(404);
  });
});

describe('limits and audit', () => {
  it('counts a write against the daily write cap and a read as a call', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    await h.call('POST', '/boards/b1/items', token, { name: 'A' });
    await h.call('GET', '/items/i1', token);
    expect(h.usage.seen).toEqual([
      { key: tokenId, write: true },
      { key: tokenId, write: false },
    ]);
  });

  it('audits a write with the route pattern and board id but never the body', async () => {
    const h = await start();
    const { token, tokenId } = await h.make(ME);
    await h.call('PATCH', '/items/i1', token, { name: 'Secret-looking text 12345' });
    const entry = h.audit.at(-1)!;
    expect(entry).toMatchObject({
      kind: 'call',
      method: 'PATCH',
      route: '/api/v1/items/:id',
      boardId: 'b1',
      ok: true,
      status: 200,
      uid: ME,
      tokenId,
    });
    expect(JSON.stringify(h.audit)).not.toContain('Secret-looking');
    await h.call('POST', '/boards/b1/items', token, { name: 'Another body text' });
    expect(JSON.stringify(h.audit)).not.toContain('Another body text');
    expect(h.audit.at(-1)).toMatchObject({ route: '/api/v1/boards/:id/items', boardId: 'b1' });
  });
});

describe('Idempotency-Key', () => {
  const key = { 'Idempotency-Key': 'create-1' };

  it('returns the stored response for a repeat and creates the item once', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const body = { name: 'Once' };
    const first = await h.call('POST', '/boards/b1/items', token, body, key);
    expect(first.status).toBe(201);
    expect(first.res.headers.get('idempotency-replayed')).toBeNull();
    const second = await h.call('POST', '/boards/b1/items', token, { name: 'Once' }, key);
    expect(second.status).toBe(201);
    expect(second.res.headers.get('idempotency-replayed')).toBe('true');
    expect(second.body).toEqual(first.body);
    const list = await h.call('GET', '/boards/b1/items?limit=200', token);
    expect(list.body.items.filter((i: { name: string }) => i.name === 'Once')).toHaveLength(1);
    const stored = h.idempotency.records.get(`${ME}_create-1`);
    expect(stored).toMatchObject({ state: 'done', status: 201 });
    expect(stored!.expiresAt - T0).toBe(24 * 60 * 60 * 1000);
  });

  it('ignores the order of keys in the body', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const a = await h.call('POST', '/boards/b1/items', token, { name: 'K', group: 'Todo' }, key);
    const b = await h.call('POST', '/boards/b1/items', token, { group: 'Todo', name: 'K' }, key);
    expect(b.res.headers.get('idempotency-replayed')).toBe('true');
    expect(b.body.id).toBe(a.body.id);
  });

  it('422 invalid when the key is reused with a different request', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    await h.call('POST', '/boards/b1/items', token, { name: 'One' }, key);
    const other = await h.call('POST', '/boards/b1/items', token, { name: 'Two' }, key);
    expect(other.status).toBe(422);
    expect(errorOf(other)).toEqual({
      code: 'invalid',
      message: 'This Idempotency-Key was used with a different request.',
    });
    const elsewhere = await h.call('POST', '/boards/b2/items', token, { name: 'One' }, key);
    expect(elsewhere.status).toBe(422);
  });

  it('keys are per user', async () => {
    const h = await start();
    const me = await h.make(ME);
    const editor = await h.make(EDITOR);
    const a = await h.call('POST', '/boards/b1/items', me.token, { name: 'Same' }, key);
    const b = await h.call('POST', '/boards/b1/items', editor.token, { name: 'Same' }, key);
    expect(b.res.headers.get('idempotency-replayed')).toBeNull();
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('does not store errors: the same key can be used again after a 4xx', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const bad = await h.call('POST', '/boards/b1/items', token, { name: '' }, key);
    expect(bad.status).toBe(400);
    expect(h.idempotency.records.size).toBe(0);
    const forbidden = await h.call(
      'POST',
      '/boards/b1/items',
      token,
      {
        name: 'x',
        values: { Calc: 1 },
      },
      { 'Idempotency-Key': 'k2' },
    );
    expect(forbidden.status).toBe(400);
    expect(h.idempotency.records.size).toBe(0);
    const ok = await h.call('POST', '/boards/b1/items', token, { name: '' }, key);
    expect(ok.status).toBe(400);
    expect(ok.res.headers.get('idempotency-replayed')).toBeNull();
  });

  it('refuses a malformed key with 400', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    for (const bad of ['a'.repeat(65), 'has space', 'semi;colon', 'ünï']) {
      const r = await h.call(
        'POST',
        '/boards/b1/items',
        token,
        { name: 'A' },
        {
          'Idempotency-Key': bad,
        },
      );
      expect(r.status).toBe(400);
      expect(errorOf(r).code).toBe('invalid');
    }
    const ok = await h.call(
      'POST',
      '/boards/b1/items',
      token,
      { name: 'A' },
      {
        'Idempotency-Key': 'a'.repeat(64),
      },
    );
    expect(ok.status).toBe(201);
  });

  it('409 conflict for a twin that arrives while the first is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = await start({ gate });
    const { token } = await h.make(ME);
    const first = h.call('POST', '/boards/b1/items', token, { name: 'Slow' }, key);
    await h.reachedService;
    const twin = await h.call('POST', '/boards/b1/items', token, { name: 'Slow' }, key);
    expect(twin.status).toBe(409);
    expect(errorOf(twin)).toEqual({
      code: 'conflict',
      message: 'A request with this Idempotency-Key is still running.',
    });
    release();
    const done = await first;
    expect(done.status).toBe(201);
    const replay = await h.call('POST', '/boards/b1/items', token, { name: 'Slow' }, key);
    expect(replay.res.headers.get('idempotency-replayed')).toBe('true');
    expect(replay.body.id).toBe(done.body.id);
  });

  it('a crashed first request frees the key after the lease', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    const hash = requestHash('POST', '/api/v1/boards/b1/items', {}, { name: 'Lost' });
    await h.idempotency.begin(`${ME}_create-1`, hash, T0); // never completed
    const early = await h.call('POST', '/boards/b1/items', token, { name: 'Lost' }, key);
    expect(early.status).toBe(409);
    h.clock.now += 61_000;
    const later = await h.call('POST', '/boards/b1/items', token, { name: 'Lost' }, key);
    expect(later.status).toBe(201);
  });

  it('is ignored on a PATCH and without the header', async () => {
    const h = await start();
    const { token } = await h.make(ME);
    await h.call('PATCH', '/items/i1', token, { name: 'P' }, key);
    expect(h.idempotency.records.size).toBe(0);
    await h.call('POST', '/boards/b1/items', token, { name: 'N' });
    expect(h.idempotency.records.size).toBe(0);
  });
});

describe('decideBegin', () => {
  const fresh = { hash: 'h', state: 'pending' as const, leaseUntil: 100, expiresAt: 1000 };
  it('runs when absent, expired, or after the lease; refuses otherwise', () => {
    expect(decideBegin(undefined, 'h', 0).result.kind).toBe('run');
    expect(decideBegin(fresh, 'h', 1000).result.kind).toBe('run');
    expect(decideBegin(fresh, 'h', 100).result.kind).toBe('run');
    expect(decideBegin(fresh, 'h', 50).result.kind).toBe('running');
    expect(decideBegin(fresh, 'other', 50).result.kind).toBe('mismatch');
    expect(
      decideBegin({ ...fresh, state: 'done', status: 201, body: '{"a":1}' }, 'h', 50).result,
    ).toEqual({ kind: 'replay', status: 201, body: '{"a":1}' });
  });
});
