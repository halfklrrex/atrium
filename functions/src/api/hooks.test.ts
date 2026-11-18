import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { createFakeClient } from '@atrium/mcp-core/fake-client';
import { INCOMING_HOOK_BASE_URL } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinuteLimiter, type UsageStore, type UsageVerdict } from '../mcp/limits';
import { createHooksRouter } from './hooks';
import {
  createIncomingHook,
  hashIncomingHookToken,
  rotateIncomingHookSecret,
  deleteIncomingHook,
  updateIncomingHook,
} from '../webhooks/incoming';
import { fakeIncomingHookStore } from '../webhooks/incoming-fake-store';
import type { ApiAuditEntry } from './audit';
import { createApiApp } from './app';
import { FakeIdempotencyStore } from './idempotency';

/** The incoming-webhook route (P8 PR 7a): the real service over the fake client, through the Express app. */

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const ME = 'u-me';

const col = (id: string, type: string, title: string, position: string, settings = {}) => ({
  id,
  type,
  title,
  position,
  settings,
});

const seed = () => ({
  'workspaces/w1': {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', 'u-ed': 'member' },
    memberIds: [ME, 'u-ed'],
  },
  'users/u-me': { displayName: 'Avery Quinn', email: 'avery@example.com' },
  'workspaces/w1/members/u-me': { displayName: 'Avery Quinn', email: 'avery@example.com' },
  'boards/b1': {
    workspaceId: 'w1',
    state: 'active',
    kind: 'main',
    access: {},
    accessUids: [],
    position: 'a0',
    folderId: null,
    name: 'Orders',
    description: '',
    columns: [
      col('note', 'text', 'Note', 'a0'),
      col('num', 'numbers', 'Hours', 'a1'),
      col('lock', 'text', 'Locked note', 'a3'),
      col('calc', 'formula', 'Calc', 'a4', { formula: '{note}' }),
    ],
    subitemColumns: [],
    columnLocks: ['lock'],
    requiredColumnIds: [],
    groups: [
      { id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' },
      { id: 'g2', title: 'Done', color: '#00c875', position: 'a1' },
    ],
  },
});

class CountingUsage implements UsageStore {
  seen: string[] = [];
  verdict: UsageVerdict = 'ok';
  async consume(key: string): Promise<UsageVerdict> {
    this.seen.push(key);
    return this.verdict;
  }
}

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(
  options: { hooksOn?: boolean; apiOn?: boolean; perMinute?: number; failItems?: boolean } = {},
) {
  const clock = { now: T0 };
  const store = fakeIncomingHookStore();
  store.boards.set('b1', {
    board: { workspaceId: 'w1', kind: 'main', access: {} },
    roles: { [ME]: 'owner', 'u-ed': 'member' },
    state: 'active',
    groupIds: ['g1', 'g2'],
  });
  store.accounts.set(ME, 'approved');
  const client = createFakeClient(seed());
  const audit: ApiAuditEntry[] = [];
  const usage = new CountingUsage();
  const idempotency = new FakeIdempotencyStore();
  const flags = { hooks: options.hooksOn ?? true };
  const hooks = createHooksRouter({
    isEnabled: () => flags.hooks,
    store,
    createService: (uid, via) => {
      const service = createService({
        client,
        actor: { uid, via },
        hideEmails: true,
        now: () => new Date(clock.now),
      });
      if (!options.failItems) return service;
      return new Proxy(service, {
        get(target, key, receiver) {
          if (key !== 'createItems') return Reflect.get(target, key, receiver) as unknown;
          return async () => {
            throw new Error('boom with secret detail');
          };
        },
      });
    },
    limiter: new MinuteLimiter(options.perMinute ?? 60, () => clock.now),
    usage,
    audit: { append: async (entry) => void audit.push(entry) },
    idempotency,
    now: () => clock.now,
  });
  const app = createApiApp({
    isEnabled: () => options.apiOn ?? true,
    verify: async () => {
      throw new Error('the hook route must not reach bearer auth');
    },
    createService: () => {
      throw new Error('the hook route must not reach the API service');
    },
    usage: new CountingUsage(),
    limiter: new MinuteLimiter(120, () => clock.now),
    ipFailures: new MinuteLimiter(300, () => clock.now, 60 * 60_000),
    audit: { append: async () => undefined },
    idempotency: new FakeIdempotencyStore(),
    hooks,
    now: () => clock.now,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const deps = { store, now: () => clock.now, enabled: () => true };
  const create = async (name = 'Order form', defaultGroupId?: string) => {
    const r = await createIncomingHook(deps, ME, {
      boardId: 'b1',
      name,
      ...(defaultGroupId ? { defaultGroupId } : {}),
    });
    return { hookId: r.hookId, token: r.url.slice(INCOMING_HOOK_BASE_URL.length), url: r.url };
  };
  const post = async (
    token: string,
    body?: unknown,
    headers: Record<string, string> = {},
    raw?: string,
  ) => {
    const res = await fetch(`${origin}/api/hooks/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    return { res, status: res.status, text, body: text ? JSON.parse(text) : null };
  };
  const items = () =>
    [...client.docs.entries()].filter(([path]) => /^boards\/b1\/items\/[^/]+$/.test(path));
  return { clock, store, client, audit, usage, flags, deps, create, post, items, origin };
}

describe('POST /api/hooks/:token: a good call', () => {
  it('creates exactly one item as the creator, marked as made by the hook', async () => {
    const h = await start();
    const { hookId, token } = await h.create();
    const r = await h.post(token, {
      name: ' Big order ',
      values: { Note: 'rush', num: 3 },
      group: 'Done',
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: expect.any(String), boardId: 'b1' });
    expect(h.items()).toHaveLength(1);
    const [path, doc] = h.items()[0]!;
    expect(path).toBe(`boards/b1/items/${r.body.id}`);
    expect(doc.data).toMatchObject({
      name: 'Big order',
      groupId: 'g2',
      createdBy: ME,
      updatedBy: ME,
      updatedVia: `webhook:${hookId}`,
      state: 'active',
      values: { note: 'rush', num: 3 },
    });
    expect(r.res.headers.get('cache-control')).toBe('no-store');
  });

  it('uses the default group, then the first group, when the call names none', async () => {
    const h = await start();
    const withDefault = await h.create('Default Done', 'g2');
    const plain = await h.create('Plain');
    const a = await h.post(withDefault.token, { name: 'A' });
    const b = await h.post(plain.token, { name: 'B' });
    const group = (id: string) => h.client.docs.get(`boards/b1/items/${id}`)!.data.groupId;
    expect(group(a.body.id)).toBe('g2');
    expect(group(b.body.id)).toBe('g1');
  });

  it('records the hook id and board in the audit, and nothing of the token or the body', async () => {
    const h = await start();
    const { hookId, token } = await h.create();
    await h.post(token, { name: 'Secret customer name', values: { Note: 'private note' } });
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({
      kind: 'call',
      method: 'POST',
      route: '/api/hooks/:token',
      hookId,
      boardId: 'b1',
      ok: true,
      status: 201,
    });
    expect(h.audit[0]!.ms).toBeGreaterThanOrEqual(0);
    const text = JSON.stringify(h.audit);
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.split('.')[1]!);
    expect(text).not.toContain('Secret customer name');
    expect(text).not.toContain('private note');
    expect(h.audit[0]).not.toHaveProperty('uid');
  });

  it('counts the call against the hook key and updates lastUsedAt at most once a minute', async () => {
    const h = await start();
    const { hookId, token } = await h.create();
    const touched = vi.spyOn(h.store, 'touchLastUsed');
    await h.post(token, { name: 'One' });
    await h.post(token, { name: 'Two' });
    await vi.waitFor(() => expect(touched).toHaveBeenCalledTimes(1));
    expect(h.usage.seen).toEqual([`hook_${hookId}`, `hook_${hookId}`]);
    h.clock.now += 61_000;
    await h.post(token, { name: 'Three' });
    await vi.waitFor(() => expect(touched).toHaveBeenCalledTimes(2));
    expect(h.store.hooks.get(`b1/${hookId}`)!.lastUsedAt).toBe(h.clock.now);
  });
});

describe('POST /api/hooks/:token: one answer for every wrong token', () => {
  it('gives the same 404 for unknown, malformed, disabled, rotated, deleted and cross-board tokens', async () => {
    const h = await start();
    const good = await h.create('Good');
    const off = await h.create('Off');
    await updateIncomingHook(h.deps, ME, { boardId: 'b1', hookId: off.hookId, enabled: false });
    const rotated = await h.create('Rotated');
    await rotateIncomingHookSecret(h.deps, ME, { boardId: 'b1', hookId: rotated.hookId });
    const gone = await h.create('Gone');
    await deleteIncomingHook(h.deps, ME, { boardId: 'b1', hookId: gone.hookId });
    const [id, secret] = good.token.split('.');
    const wrongSecret = `${id}.${secret!.slice(0, -1)}${secret!.endsWith('A') ? 'B' : 'A'}`;
    const tokens = [
      'nonsense',
      '',
      `${id}.short`,
      wrongSecret,
      `otherhookid1234.${secret}`,
      off.token,
      rotated.token,
      gone.token,
      `${id}.${secret}.extra`,
    ];
    const answers = [];
    for (const token of tokens.filter(Boolean)) {
      const r = await h.post(token, { name: 'X' });
      answers.push({ token, status: r.status, text: r.text });
    }
    for (const a of answers) expect(a.status, a.token).toBe(404);
    expect(new Set(answers.map((a) => a.text)).size).toBe(1);
    expect(h.items()).toHaveLength(0);
    // A guess at a token (or a call to a disabled hook) leaves no audit entry and costs no usage.
    expect(h.audit).toHaveLength(0);
    expect(h.usage.seen).toHaveLength(0);
    // The real one still works.
    expect((await h.post(good.token, { name: 'Y' })).status).toBe(201);
  });

  it('answers a wrong method and a bare path with the same plain 404', async () => {
    const h = await start();
    const { token } = await h.create();
    const get = await fetch(`${h.origin}/api/hooks/${token}`);
    expect(get.status).toBe(404);
    const bare = await fetch(`${h.origin}/api/hooks/`, { method: 'POST' });
    expect(bare.status).toBe(404);
    expect(await get.text()).not.toContain(token);
  });

  it('is a 404 when the creator is no longer a board owner', async () => {
    const h = await start();
    const { token } = await h.create();
    h.store.boards.get('b1')!.roles = { [ME]: 'member' };
    const r = await h.post(token, { name: 'X' });
    expect(r.status).toBe(404);
    expect(h.items()).toHaveLength(0);
    h.store.boards.get('b1')!.roles = { [ME]: 'owner' };
    expect((await h.post(token, { name: 'X' })).status).toBe(201);
  });

  it('is a 404 when the creator was removed, blocked or the board is archived or gone', async () => {
    const h = await start();
    const { token } = await h.create();
    h.store.accounts.set(ME, 'blocked');
    expect((await h.post(token, { name: 'X' })).status).toBe(404);
    h.store.accounts.set(ME, 'approved');
    h.store.boards.get('b1')!.roles = {};
    expect((await h.post(token, { name: 'X' })).status).toBe(404);
    h.store.boards.get('b1')!.roles = { [ME]: 'owner' };
    h.store.boards.get('b1')!.state = 'archived';
    expect((await h.post(token, { name: 'X' })).status).toBe(404);
    h.store.boards.delete('b1');
    expect((await h.post(token, { name: 'X' })).status).toBe(404);
    expect(h.items()).toHaveLength(0);
  });
});

describe('POST /api/hooks/:token: validation creates nothing', () => {
  it.each([
    ['an unknown column', { name: 'X', values: { Nope: 'x' } }],
    ['a derived column', { name: 'X', values: { Calc: 'x' } }],
    ['a locked column (even for an owner creator)', { name: 'X', values: { 'Locked note': 'x' } }],
    ['a bad value', { name: 'X', values: { Hours: 'not a number' } }],
    ['an unknown group', { name: 'X', group: 'Nowhere' }],
    ['a missing name', { values: { Note: 'x' } }],
    ['an empty name', { name: '   ' }],
    ['a name over 255 characters', { name: 'x'.repeat(256) }],
    ['an unknown field', { name: 'X', extra: true }],
    ['a values array', { name: 'X', values: ['a'] }],
  ])('refuses %s with 400 and writes no item', async (_label, body) => {
    const h = await start();
    const { token } = await h.create();
    const r = await h.post(token, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid');
    expect(h.items()).toHaveLength(0);
  });

  it('refuses a bad value even when another column in the same call is fine', async () => {
    const h = await start();
    const { token } = await h.create();
    const r = await h.post(token, { name: 'X', values: { Note: 'fine', Hours: 'bad' } });
    expect(r.status).toBe(400);
    expect(h.items()).toHaveLength(0);
  });

  it('refuses invalid JSON with 400 and an empty body', async () => {
    const h = await start();
    const { token } = await h.create();
    expect((await h.post(token, undefined, {}, '{not json')).status).toBe(400);
    expect((await h.post(token, undefined, {}, '')).status).toBe(400);
    expect(h.items()).toHaveLength(0);
  });

  it('caps the body at 64 KB with 413', async () => {
    const h = await start();
    const { token } = await h.create();
    const big = await h.post(token, { name: 'X', values: { Note: 'y'.repeat(70 * 1024) } });
    expect(big.status).toBe(413);
    const unknown = await h.post('nope.nope', {
      name: 'X',
      values: { Note: 'y'.repeat(70 * 1024) },
    });
    expect(unknown.status).toBe(413);
    expect(h.items()).toHaveLength(0);
    const ok = await h.post(token, { name: 'X', values: { Note: 'y'.repeat(60 * 1024) } });
    expect(ok.status).toBe(201);
  });
});

describe('POST /api/hooks/:token: switches and limits', () => {
  it('answers 503 while WEBHOOKS_ENABLED is off, and while the API switch is off', async () => {
    const off = await start({ hooksOn: false });
    const { token } = await off.create();
    const r = await off.post(token, { name: 'X' });
    expect(r.status).toBe(503);
    expect(off.items()).toHaveLength(0);
    expect(off.usage.seen).toHaveLength(0);
    off.flags.hooks = true;
    expect((await off.post(token, { name: 'X' })).status).toBe(201);

    const apiOff = await start({ apiOn: false });
    const made = await apiOff.create();
    expect((await apiOff.post(made.token, { name: 'X' })).status).toBe(503);
  });

  it('allows 60 calls a minute per hook, then 429 with Retry-After; another hook is unaffected', async () => {
    const h = await start({ perMinute: 3 });
    const a = await h.create('A');
    const b = await h.create('B');
    for (let i = 0; i < 3; i++) expect((await h.post(a.token, { name: `n${i}` })).status).toBe(201);
    const limited = await h.post(a.token, { name: 'over' });
    expect(limited.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBe('60');
    expect(limited.body.error.code).toBe('rate_limited');
    expect((await h.post(b.token, { name: 'other hook' })).status).toBe(201);
    h.clock.now += 61_000;
    expect((await h.post(a.token, { name: 'again' })).status).toBe(201);
    expect(h.items()).toHaveLength(5);
  });

  it('answers 429 with a Retry-After to the next UTC day when the daily cap is reached', async () => {
    const h = await start();
    const { token } = await h.create();
    h.usage.verdict = 'calls';
    const r = await h.post(token, { name: 'X' });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get('retry-after'))).toBe(14 * 3600);
    expect(h.items()).toHaveLength(0);
  });
});

describe('POST /api/hooks/:token: Idempotency-Key', () => {
  it('replays the first answer and creates one item', async () => {
    const h = await start();
    const { token } = await h.create();
    const first = await h.post(token, { name: 'Once' }, { 'Idempotency-Key': 'abc-1' });
    const second = await h.post(token, { name: 'Once' }, { 'Idempotency-Key': 'abc-1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.res.headers.get('idempotency-replayed')).toBe('true');
    expect(h.items()).toHaveLength(1);
  });

  it('refuses the same key with a different body (422) and a bad key (400)', async () => {
    const h = await start();
    const { token } = await h.create();
    await h.post(token, { name: 'Once' }, { 'Idempotency-Key': 'k1' });
    const other = await h.post(token, { name: 'Different' }, { 'Idempotency-Key': 'k1' });
    expect(other.status).toBe(422);
    const bad = await h.post(token, { name: 'X' }, { 'Idempotency-Key': 'has spaces!' });
    expect(bad.status).toBe(400);
    expect(h.items()).toHaveLength(1);
  });

  it('does not keep a failed call: the key can be used again with a fixed body', async () => {
    const h = await start();
    const { token } = await h.create();
    const bad = await h.post(
      token,
      { name: 'X', values: { Nope: 1 } },
      { 'Idempotency-Key': 'k2' },
    );
    expect(bad.status).toBe(400);
    const fixed = await h.post(token, { name: 'X' }, { 'Idempotency-Key': 'k2' });
    expect(fixed.status).toBe(201);
    const again = await h.post(token, { name: 'X' }, { 'Idempotency-Key': 'k2' });
    expect(again.res.headers.get('idempotency-replayed')).toBe('true');
    expect(h.items()).toHaveLength(1);
  });

  it('namespaces the key by hook: two hooks with the same key each create an item', async () => {
    const h = await start();
    const a = await h.create('A');
    const b = await h.create('B');
    await h.post(a.token, { name: 'Same' }, { 'Idempotency-Key': 'shared' });
    const second = await h.post(b.token, { name: 'Same' }, { 'Idempotency-Key': 'shared' });
    expect(second.status).toBe(201);
    expect(second.res.headers.get('idempotency-replayed')).toBeNull();
    expect(h.items()).toHaveLength(2);
  });
});

describe('POST /api/hooks/:token: logs', () => {
  it('never logs the token, the path, the body or the error message of a failure', async () => {
    const h = await start({ failItems: true });
    const { token, hookId } = await h.create();
    const spies = (['error', 'warn', 'info', 'log', 'debug', 'write'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(() => undefined),
    );
    const r = await h.post(token, { name: 'Private customer' });
    expect(r.status).toBe(500);
    expect(r.body.error.message).toBe('Unexpected error');
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).toContain(hookId);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split('.')[1]!);
    expect(logged).not.toContain('/api/hooks');
    expect(logged).not.toContain('Private customer');
    expect(logged).not.toContain('secret detail');
    // The audit has the failure by hook and board only.
    expect(h.audit[0]).toMatchObject({ hookId, boardId: 'b1', ok: false, status: 500 });
    expect(JSON.stringify(h.audit)).not.toContain(token.split('.')[1]!);
  });
});

describe('the token hash', () => {
  it('is the SHA-256 of the whole token string', async () => {
    const h = await start();
    const { token } = await h.create();
    expect(h.store.index.has(hashIncomingHookToken(token))).toBe(true);
    expect(hashIncomingHookToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
