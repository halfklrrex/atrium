import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createService, ts, type FirestoreClient } from '@atrium/mcp-core';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as AdminModule from '../../../functions/src/lib/admin';
import { USERS, WS, createTestEnv, seedFixture, workspaceDoc } from './helpers';

/**
 * End to end against the Firestore emulator (OPS4 PR C): the real Admin SDK adapter of the MCP
 * connector (functions/src/mcp/admin-client.ts) has to behave exactly like the REST client the stdio
 * server uses, because `@atrium/mcp-core`'s service relies on those semantics (preconditions that
 * reject with 409 so `mutateBoard` retries, field-path updates, timestamps as Dates). Nothing here is
 * faked: the writes go to the emulator and are read back through the Admin SDK and the client SDK.
 * Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;

const COL = 'mcpAdminClientE2e';
const path = (id: string) => `${COL}/${id}`;

/** The rejection of `promise`, so its `status` can be checked. */
async function rejection(promise: Promise<unknown>): Promise<{ status?: number; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { status?: number; message: string };
  }
  throw new Error('expected the commit to be refused');
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  const adapter: typeof AdminClientModule = await import('../../../functions/src/mcp/admin-client');
  client = adapter.createAdminClient(admin.db());
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('preconditions', () => {
  it('create (set with exists: false) refuses an existing document with status 409', async () => {
    await client.commit([
      { op: 'set', path: path('a'), data: { n: 1 }, precondition: { exists: false } },
    ]);
    const error = await rejection(
      client.commit([
        { op: 'set', path: path('a'), data: { n: 2 }, precondition: { exists: false } },
      ]),
    );
    expect(error.status).toBe(409);
    expect(await client.getDoc(path('a'))).toEqual({ n: 1 });
  });

  it('a commit is atomic: one failed create rolls back the whole batch', async () => {
    await client.commit([
      { op: 'set', path: path('a'), data: { n: 1 }, precondition: { exists: false } },
    ]);
    const error = await rejection(
      client.commit([
        { op: 'set', path: path('b'), data: { n: 1 }, precondition: { exists: false } },
        { op: 'set', path: path('a'), data: { n: 2 }, precondition: { exists: false } },
      ]),
    );
    expect(error.status).toBe(409);
    expect(await client.getDoc(path('b'))).toBeNull();
  });

  it('patch with the current updateTime succeeds and with a stale one fails with 409', async () => {
    await client.commit([{ op: 'set', path: path('a'), data: { n: 1, keep: 'yes' } }]);
    const first = await client.getDocMeta(path('a'));
    expect(first).not.toBeNull();
    expect(first!.updateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/);

    await client.commit([
      {
        op: 'patch',
        path: path('a'),
        data: { n: 2 },
        precondition: { updateTime: first!.updateTime },
      },
    ]);
    const second = await client.getDocMeta(path('a'));
    expect(second!.data).toEqual({ n: 2, keep: 'yes' });
    expect(second!.updateTime).not.toBe(first!.updateTime);

    const error = await rejection(
      client.commit([
        {
          op: 'patch',
          path: path('a'),
          data: { n: 3 },
          precondition: { updateTime: first!.updateTime },
        },
      ]),
    );
    expect(error.status).toBe(409);
    expect(await client.getDoc(path('a'))).toEqual({ n: 2, keep: 'yes' });
  });

  it('patch and update of a missing document fail with 404; delete with a stale time fails with 409', async () => {
    expect(
      (await rejection(client.commit([{ op: 'patch', path: path('x'), data: { n: 1 } }]))).status,
    ).toBe(404);
    expect(
      (await rejection(client.commit([{ op: 'update', path: path('x'), set: { n: 1 } }]))).status,
    ).toBe(404);

    await client.commit([{ op: 'set', path: path('a'), data: { n: 1 } }]);
    const meta = await client.getDocMeta(path('a'));
    await client.commit([{ op: 'patch', path: path('a'), data: { n: 2 } }]);
    const error = await rejection(
      client.commit([
        { op: 'delete', path: path('a'), precondition: { updateTime: meta!.updateTime } },
      ]),
    );
    expect(error.status).toBe(409);
    const fresh = await client.getDocMeta(path('a'));
    await client.commit([
      { op: 'delete', path: path('a'), precondition: { updateTime: fresh!.updateTime } },
    ]);
    expect(await client.getDoc(path('a'))).toBeNull();
  });
});

describe('field-path updates', () => {
  it('sets dotted paths (odd segments included), removes, increments and server-stamps', async () => {
    await client.commit([
      {
        op: 'set',
        path: path('item'),
        data: { values: { 'abc-1': 'old', gone: true, nested: { keep: 1 } }, count: 1, name: 'A' },
      },
    ]);
    await client.commit([
      {
        op: 'update',
        path: path('item'),
        set: { 'values.abc-1': 'new', 'values.nested.added': 2, name: 'B' },
        remove: ['values.gone'],
        increment: { count: 2, 'values.hits': 1 },
        serverTimestamp: ['touchedAt'],
      },
    ]);
    const data = await client.getDoc(path('item'));
    expect(data!.values).toEqual({ 'abc-1': 'new', nested: { keep: 1, added: 2 }, hits: 1 });
    expect(data!.count).toBe(3);
    expect(data!.name).toBe('B');
    expect(data!.touchedAt).toBeInstanceOf(Date);
    expect(Math.abs((data!.touchedAt as Date).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('patch replaces whole top-level fields and leaves the rest alone', async () => {
    await client.commit([
      {
        op: 'set',
        path: path('b'),
        data: { columns: [{ id: 'c1' }], groups: [{ id: 'g1' }], name: 'A' },
      },
    ]);
    await client.commit([{ op: 'patch', path: path('b'), data: { columns: [{ id: 'c2' }] } }]);
    expect(await client.getDoc(path('b'))).toEqual({
      columns: [{ id: 'c2' }],
      groups: [{ id: 'g1' }],
      name: 'A',
    });
  });

  it('delete removes the document', async () => {
    await client.commit([{ op: 'set', path: path('d'), data: { n: 1 } }]);
    await client.commit([{ op: 'delete', path: path('d') }]);
    expect(await client.getDoc(path('d'))).toBeNull();
    expect(await client.getDocMeta(path('d'))).toBeNull();
  });
});

describe('values', () => {
  it('stores Dates and toMillis() values as timestamps and reads them back as Dates', async () => {
    const when = new Date('2026-11-01T10:00:00.123Z');
    await client.commit([
      {
        op: 'set',
        path: path('t'),
        data: {
          when,
          stamp: ts(when),
          gone: undefined,
          nested: { when, list: [when, { deep: when }], gone: undefined },
          count: 2,
          ratio: 0.5,
          flag: false,
          nothing: null,
        },
      },
    ]);
    const data = await client.getDoc(path('t'));
    expect(data).toEqual({
      when,
      stamp: when,
      nested: { when, list: [when, { deep: when }] },
      count: 2,
      ratio: 0.5,
      flag: false,
      nothing: null,
    });
    expect(data!.when).toBeInstanceOf(Date);
    expect((data!.nested as { list: unknown[] }).list[0]).toBeInstanceOf(Date);

    // The client SDK sees a real timestamp, not a map.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), path('t')));
      expect(snap.get('when')).toBeInstanceOf(Timestamp);
      expect((snap.get('stamp') as Timestamp).toMillis()).toBe(when.getTime());
    });
  });

  it('reads documents the client SDK wrote (seed data) with Dates', async () => {
    await seedFixture(env);
    const ws = await client.getDoc(`workspaces/${WS}`);
    expect(ws!.name).toBe('Team');
    expect(ws!.createdAt).toBeInstanceOf(Date);
    expect(ws!.memberIds).toEqual([USERS.owner, USERS.admin, USERS.member, USERS.viewer]);
    expect(await client.getDoc('workspaces/nope')).toBeNull();
  });
});

describe('queries', () => {
  beforeEach(async () => {
    await client.commit([
      { op: 'set', path: path('p1'), data: { workspaceId: 'w1', tags: ['a', 'b'], n: 1 } },
      { op: 'set', path: path('p2'), data: { workspaceId: 'w1', tags: ['b'], n: 2 } },
      { op: 'set', path: path('p3'), data: { workspaceId: 'w2', tags: ['a'], n: 3 } },
      { op: 'set', path: `${COL}/p1/sub/s1`, data: { n: 9 } },
    ]);
  });

  it('runQuery filters by equality and arrayContains (AND), with ids and updateTime', async () => {
    const byWs = await client.runQuery(COL, { workspaceId: 'w1' });
    expect(byWs.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(byWs[0]!.updateTime).toMatch(/Z$/);
    const withA = await client.runQuery(COL, { tags: { arrayContains: 'a' } });
    expect(withA.map((r) => r.id).sort()).toEqual(['p1', 'p3']);
    const both = await client.runQuery(COL, { workspaceId: 'w1', tags: { arrayContains: 'a' } });
    expect(both.map((r) => r.id)).toEqual(['p1']);
    expect(both[0]!.data).toEqual({ workspaceId: 'w1', tags: ['a', 'b'], n: 1 });
    expect(await client.runQuery(COL, { workspaceId: 'w3' })).toEqual([]);
    expect((await client.runQuery(COL)).length).toBe(3);
  });

  it('listAllDocs returns the direct documents, and only the selected fields when asked', async () => {
    const all = await client.listAllDocs(COL);
    expect(all.map((r) => r.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(all.find((r) => r.id === 'p1')!.data).toEqual({
      workspaceId: 'w1',
      tags: ['a', 'b'],
      n: 1,
    });

    const some = await client.listAllDocs(COL, { fields: ['n'] });
    expect(some.map((r) => r.data)).toEqual(expect.arrayContaining([{ n: 1 }, { n: 2 }, { n: 3 }]));
    expect(some.every((r) => typeof r.updateTime === 'string' && r.updateTime.endsWith('Z'))).toBe(
      true,
    );

    expect((await client.listAllDocs(`${COL}/p1/sub`)).map((r) => r.data)).toEqual([{ n: 9 }]);
    expect(await client.listAllDocs(`${COL}/p2/sub`)).toEqual([]);
  });
});

describe('@atrium/mcp-core on the Admin SDK client', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'workspaces', WS), workspaceDoc());
      await setDoc(doc(db, 'users', USERS.owner), {
        displayName: 'Avery Quinn',
        email: 'avery@example.com',
        photoURL: null,
      });
    });
  });

  it('reads the memberships and writes a board, a group and an item through the service', async () => {
    const service = createService({ client, actor: { uid: USERS.owner } });

    const { workspaces } = await service.listWorkspaces();
    expect(workspaces).toEqual([{ id: WS, name: 'Team', role: 'owner' }]);

    const board = await service.createBoard({ name: 'Launch plan', description: 'Q4' });
    expect(board.workspaceId).toBe(WS);
    const stored = await client.getDoc(`boards/${board.id as string}`);
    expect(stored!.name).toBe('Launch plan');
    expect(stored!.createdAt).toBeInstanceOf(Date);
    expect(stored!.access).toEqual({ [USERS.owner]: 'owner' });

    // mutateBoard: a patch with the updateTime precondition.
    const group = (await service.addGroup({ boardId: board.id as string, title: 'Later' })) as {
      id: string;
    };
    const after = await client.getDoc(`boards/${board.id as string}`);
    expect((after!.groups as { id: string }[]).map((g) => g.id)).toContain(group.id);

    // addColumn: another mutateBoard, on the updateTime the first one produced.
    const column = (await service.addColumn({
      boardId: board.id as string,
      title: 'Note',
      type: 'text',
    })) as { id: string };

    // createItems: a create, then updateItem: a field-path update of one cell.
    const { created } = await service.createItems({
      boardId: board.id as string,
      items: [{ name: 'Write spec', group: 'Later' }],
    });
    expect(created).toHaveLength(1);
    await service.updateItem({
      boardId: board.id as string,
      itemId: created[0]!.id,
      values: { Note: 'hello' },
    });
    const item = await client.getDoc(`boards/${board.id as string}/items/${created[0]!.id}`);
    expect(item!.groupId).toBe(group.id);
    expect((item!.values as Record<string, unknown>)[column.id]).toBe('hello');
    expect(item!.updatedAt).toBeInstanceOf(Date);

    const read = await service.getBoard({ boardId: board.id as string, includeItems: true });
    expect((read.items as { name: string }[]).map((i) => i.name)).toEqual(['Write spec']);
  });

  it('keeps boards outside the memberships invisible', async () => {
    const service = createService({ client, actor: { uid: USERS.outsider } });
    await expect(service.listWorkspaces()).resolves.toEqual({ workspaces: [] });
    await expect(service.createBoard({ name: 'Nope' })).rejects.toThrow();
  });
});
