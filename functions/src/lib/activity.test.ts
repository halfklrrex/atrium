import { ACTIVITY_LIMITS, activityEventSchema } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  activityDoc,
  actorOf,
  diffBoardActivity,
  diffItemActivity,
  expiresAt,
  expiresAtMs,
  rawValue,
  recordBoardActivity,
  recordItemActivity,
  recordUpdatePosted,
  valueText,
  type ActivityBoard,
  type ActivityStore,
  type MemberProfile,
  type NewActivityEntry,
} from './activity';

const BOARD: ActivityBoard = {
  workspaceId: 'ws1',
  columns: [
    { id: 'status', title: 'Stage', type: 'text', settings: {} },
    { id: 'owner', title: 'Owner', type: 'people', settings: {} },
    { id: 'calc', title: 'Calc', type: 'formula', settings: {} },
    { id: 'n', title: 'Budget', type: 'numbers', settings: {} },
  ],
  subitemColumns: [{ id: 'sub', title: 'Sub text', type: 'text', settings: {} }],
  groups: [
    { id: 'g1', title: 'To do' },
    { id: 'g2', title: 'Done' },
  ],
};

const ts = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});
const base = {
  name: 'Write spec',
  groupId: 'g1',
  state: 'active',
  parentItemId: null,
  values: {} as Record<string, unknown>,
  createdBy: 'u1',
  updatedBy: 'u1',
  updatedAt: ts(1),
};
const edit = (patch: Record<string, unknown>, by = 'u1') => ({
  ...base,
  ...patch,
  updatedBy: by,
  updatedAt: ts(2),
});
const profiles = new Map<string, MemberProfile>([
  ['u1', { name: 'Avery Quinn', photoURL: 'https://example.com/a.png' }],
  ['u2', { name: 'Sam Rivera', photoURL: null }],
]);
const kinds = (plans: Array<{ kind: string }>) => plans.map((p) => p.kind);

describe('diffItemActivity', () => {
  it('logs item_created with the group on create', () => {
    const plan = diffItemActivity({ after: base }, BOARD, profiles);
    expect(plan).toEqual([
      {
        kind: 'item_created',
        fields: { itemName: 'Write spec', parentItemId: null, groupId: 'g1', groupTitle: 'To do' },
      },
    ]);
  });

  it('logs rename, move, archive, delete and restore', () => {
    const rename = diffItemActivity(
      { before: base, after: edit({ name: 'Write the spec' }) },
      BOARD,
      profiles,
    );
    expect(rename).toHaveLength(1);
    expect(rename[0]).toMatchObject({
      kind: 'item_renamed',
      fields: {
        itemName: 'Write the spec',
        data: { fromText: 'Write spec', toText: 'Write the spec' },
      },
    });

    const move = diffItemActivity(
      { before: base, after: edit({ groupId: 'g2' }) },
      BOARD,
      profiles,
    );
    expect(move[0]).toMatchObject({
      kind: 'item_moved',
      fields: {
        groupId: 'g2',
        groupTitle: 'Done',
        data: { fromGroupId: 'g1', fromGroupTitle: 'To do' },
      },
    });

    const states = (from: string, to: string) =>
      kinds(
        diffItemActivity(
          { before: { ...base, state: from }, after: edit({ state: to }) },
          BOARD,
          profiles,
        ),
      );
    expect(states('active', 'archived')).toEqual(['item_archived']);
    expect(states('active', 'deleted')).toEqual(['item_deleted']);
    expect(states('archived', 'active')).toEqual(['item_restored']);
    expect(states('deleted', 'active')).toEqual(['item_restored']);
    expect(states('archived', 'deleted')).toEqual(['item_deleted']);
    expect(states('active', 'active')).toEqual([]);
  });

  it('logs one value_changed per changed column with texts and raw values', () => {
    const plan = diffItemActivity(
      {
        before: { ...base, values: { status: 'Open', n: 1 } },
        after: edit({ values: { status: 'Closed', n: 1 } }),
      },
      BOARD,
      profiles,
    );
    expect(plan).toEqual([
      {
        kind: 'value_changed',
        fields: {
          itemName: 'Write spec',
          parentItemId: null,
          columnId: 'status',
          columnTitle: 'Stage',
          columnType: 'text',
          data: { fromText: 'Open', toText: 'Closed', fromValue: 'Open', toValue: 'Closed' },
        },
      },
    ]);
  });

  it('treats a cleared or newly set cell as a change from/to empty', () => {
    const set = diffItemActivity(
      { before: base, after: edit({ values: { status: 'Open' } }) },
      BOARD,
      profiles,
    );
    expect(set[0]?.fields.data).toMatchObject({ fromText: '', toText: 'Open', fromValue: null });
    const cleared = diffItemActivity(
      { before: { ...base, values: { status: 'Open' } }, after: edit({ values: {} }) },
      BOARD,
      profiles,
    );
    expect(cleared[0]?.fields.data).toMatchObject({ fromText: 'Open', toText: '', toValue: null });
  });

  it('resolves People names, with +n past three', () => {
    const person = (id: string) => ({ id, kind: 'person' as const });
    const many = new Map(profiles);
    for (const id of ['u3', 'u4', 'u5']) many.set(id, { name: `Person ${id}`, photoURL: null });
    const plan = diffItemActivity(
      {
        before: { ...base, values: { owner: { personsAndTeams: [person('u1')] } } },
        after: edit({
          values: { owner: { personsAndTeams: ['u2', 'u3', 'u4', 'u5'].map(person) } },
        }),
      },
      BOARD,
      many,
    );
    expect(plan[0]?.fields.data).toMatchObject({
      fromText: 'Avery Quinn',
      toText: 'Sam Rivera, Person u3, Person u4 +1',
    });
  });

  it('ignores derived columns, unknown columns and unchanged values', () => {
    const plan = diffItemActivity(
      {
        before: { ...base, values: { calc: 1, ghost: 'a', status: 'Same' } },
        after: edit({ values: { calc: 2, ghost: 'b', status: 'Same' } }),
      },
      BOARD,
      profiles,
    );
    expect(plan).toEqual([]);
  });

  it('uses the subitem columns for a subitem', () => {
    const sub = { ...base, parentItemId: 'p1' };
    const plan = diffItemActivity(
      {
        before: { ...sub, values: { sub: 'a' } },
        after: { ...edit({ values: { sub: 'b' } }), parentItemId: 'p1' },
      },
      BOARD,
      profiles,
    );
    expect(plan[0]).toMatchObject({
      kind: 'value_changed',
      fields: { parentItemId: 'p1', columnId: 'sub', columnTitle: 'Sub text' },
    });
  });

  it('logs nothing for server-side writes that do not move updatedAt', () => {
    const noTouch = (patch: Record<string, unknown>) =>
      diffItemActivity({ before: base, after: { ...base, ...patch } }, BOARD, profiles);
    expect(noTouch({ seq: 5, boardSeq: 3 })).toEqual([]);
    expect(noTouch({ descriptionImages: { f1: {} } })).toEqual([]);
    expect(noTouch({ assigneeUids: ['u1'], nameTokens: ['write'] })).toEqual([]);
    // The type-change migration writes values.<id> without touching updatedAt.
    expect(noTouch({ values: { status: 'converted' } })).toEqual([]);
  });

  it('logs nothing for description, position and updatesCount edits', () => {
    const touched = (patch: Record<string, unknown>) =>
      diffItemActivity({ before: base, after: edit(patch) }, BOARD, profiles);
    expect(touched({ description: { doc: {}, text: 'hello' } })).toEqual([]);
    expect(touched({ position: 'a1' })).toEqual([]);
    expect(touched({ updatesCount: 3 })).toEqual([]);
  });

  it('caps one write at 20 entries and summarises the rest', () => {
    const columns = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      title: `Col ${i}`,
      type: 'text',
      settings: {},
    }));
    const values = Object.fromEntries(columns.map((c) => [c.id, 'x']));
    const plan = diffItemActivity(
      { before: base, after: edit({ values }) },
      { ...BOARD, columns },
      profiles,
    );
    expect(plan).toHaveLength(ACTIVITY_LIMITS.perEvent);
    expect(plan.slice(0, 19).every((p) => p.fields.columnId)).toBe(true);
    expect(plan[19]).toMatchObject({ kind: 'value_changed', fields: { data: { more: 11 } } });
    expect(plan[19]?.fields.columnId).toBeUndefined();
  });

  it('omits a raw value over 2 KB but keeps the text, capped at 200 characters', () => {
    const big = 'y'.repeat(5000);
    const plan = diffItemActivity(
      { before: base, after: edit({ values: { status: big } }) },
      BOARD,
      profiles,
    );
    const data = plan[0]?.fields.data;
    expect(data?.toText).toHaveLength(ACTIVITY_LIMITS.text);
    expect(data).not.toHaveProperty('toValue');
    expect(data).toHaveProperty('fromValue', null);
  });
});

describe('text helpers', () => {
  it('rawValue keeps small values and drops large ones', () => {
    expect(rawValue({ a: 1 })).toEqual({ a: 1 });
    expect(rawValue(undefined)).toBeUndefined();
    expect(rawValue('z'.repeat(ACTIVITY_LIMITS.rawBytes))).toBeUndefined();
  });

  it('valueText never throws on bad or unknown input', () => {
    expect(valueText('nope', 'x', {}, profiles)).toBe('');
    expect(valueText('numbers', 'not a number', {}, profiles)).toBe('');
    expect(
      valueText('people', { personsAndTeams: [{ id: 'ghost', kind: 'person' }] }, {}, profiles),
    ).toBe('Someone');
  });

  it('expiresAt is 90 days out', () => {
    expect(expiresAtMs(0)).toBe(90 * 24 * 60 * 60 * 1000);
    expect(expiresAt(1000).getTime()).toBe(1000 + 90 * 24 * 60 * 60 * 1000);
  });

  it('activityDoc produces a doc the shared schema accepts (with the server fields added)', () => {
    const doc = activityDoc(actorOf('u1', profiles.get('u1')), 'value_changed', {
      itemId: 'i1',
      itemName: 'Write spec',
      columnId: 'status',
      columnTitle: 'Stage',
      columnType: 'text',
      data: { fromText: 'a', toText: 'b', fromValue: undefined },
    });
    expect(doc.data).toEqual({ fromText: 'a', toText: 'b' });
    expect(doc.actorName).toBe('Avery Quinn');
    const full = { ...doc, createdAt: ts(1), expiresAt: ts(2) };
    expect(activityEventSchema.safeParse(full).success).toBe(true);
  });

  it('falls back to "Someone" without a member profile', () => {
    expect(actorOf('ghost').name).toBe('Someone');
  });
});

describe('diffBoardActivity', () => {
  const board = {
    name: 'Roadmap',
    columns: [
      { id: 'a', title: 'A', type: 'text' },
      { id: 'b', title: 'B', type: 'text' },
    ],
    groups: [
      { id: 'g1', title: 'To do' },
      { id: 'g2', title: 'Done' },
    ],
  };

  it('logs a board rename', () => {
    const plan = diffBoardActivity(board, { ...board, name: 'Plan' });
    expect(plan).toEqual([
      { kind: 'board_renamed', fields: { data: { fromText: 'Roadmap', toText: 'Plan' } } },
    ]);
  });

  it('logs column add, rename and delete', () => {
    const after = {
      ...board,
      columns: [
        { id: 'a', title: 'A2', type: 'text' },
        { id: 'c', title: 'C', type: 'numbers' },
      ],
    };
    const plan = diffBoardActivity(board, after);
    expect(kinds(plan).sort()).toEqual(['column_added', 'column_deleted', 'column_renamed']);
    expect(plan.find((p) => p.kind === 'column_renamed')?.fields).toMatchObject({
      columnId: 'a',
      data: { fromText: 'A', toText: 'A2' },
    });
    expect(plan.find((p) => p.kind === 'column_added')?.fields).toMatchObject({
      columnId: 'c',
      columnType: 'numbers',
    });
    expect(plan.find((p) => p.kind === 'column_deleted')?.fields).toMatchObject({ columnId: 'b' });
  });

  it('logs group add, rename and delete', () => {
    const after = {
      ...board,
      groups: [
        { id: 'g1', title: 'Backlog' },
        { id: 'g3', title: 'New' },
      ],
    };
    const plan = diffBoardActivity(board, after);
    expect(kinds(plan).sort()).toEqual(['group_added', 'group_deleted', 'group_renamed']);
    expect(plan.find((p) => p.kind === 'group_renamed')?.fields.data).toEqual({
      fromText: 'To do',
      toText: 'Backlog',
    });
  });

  it('ignores type and settings changes, migrating marks, kind, access and derived ids', () => {
    const after = {
      ...board,
      columns: [
        {
          id: 'a',
          title: 'A',
          type: 'numbers',
          settings: { x: 1 },
          migrating: { snapshotId: 's' },
        },
        { id: 'b', title: 'B', type: 'text' },
      ],
      kind: 'private',
      access: { u1: 'owner' },
      accessUids: ['u1'],
      derivedColumnIds: ['a'],
      serverManagedColumnIds: [],
      updatedBy: 'u9',
    };
    expect(diffBoardActivity({ ...board, kind: 'main' } as never, after as never)).toEqual([]);
  });
});

/** In-memory store; `createMany` mimics the adapter (atomic batch, ALREADY_EXISTS means 0). */
class FakeStore implements ActivityStore {
  docs = new Map<string, NewActivityEntry['doc']>();
  reads = { board: 0, profiles: 0 };
  board: ActivityBoard | null = BOARD;
  members = new Map(profiles);
  async getBoard() {
    this.reads.board += 1;
    return this.board;
  }
  async getMemberProfiles(_ws: string, uids: readonly string[]) {
    this.reads.profiles += 1;
    const out = new Map<string, MemberProfile>();
    for (const uid of uids) {
      const p = this.members.get(uid);
      if (p) out.set(uid, p);
    }
    return out;
  }
  async getItemName() {
    return 'Write spec';
  }
  async createMany(_b: string, entries: readonly NewActivityEntry[]) {
    if (entries.some((e) => this.docs.has(e.id))) return 0;
    for (const e of entries) this.docs.set(e.id, e.doc);
    return entries.length;
  }
}

describe('recordItemActivity', () => {
  const event = (change: Parameters<typeof recordItemActivity>[1]) => change;

  it('writes deterministic ids and the actor from updatedBy', async () => {
    const store = new FakeStore();
    const created = await recordItemActivity(
      store,
      event({
        eventId: 'ev1',
        boardId: 'b1',
        itemId: 'i1',
        before: { ...base, values: { status: 'a', n: 1 } },
        after: edit({ values: { status: 'b', n: 2 } }, 'u2'),
      }),
    );
    expect(created).toBe(2);
    expect([...store.docs.keys()]).toEqual(['ev1-0', 'ev1-1']);
    expect(store.docs.get('ev1-0')).toMatchObject({
      kind: 'value_changed',
      actorId: 'u2',
      actorName: 'Sam Rivera',
      itemId: 'i1',
      columnId: 'status',
    });
  });

  it('is idempotent on a retried event', async () => {
    const store = new FakeStore();
    const change = event({
      eventId: 'ev2',
      boardId: 'b1',
      itemId: 'i1',
      before: base,
      after: edit({ name: 'New' }),
    });
    expect(await recordItemActivity(store, change)).toBe(1);
    expect(await recordItemActivity(store, change)).toBe(0);
    expect(store.docs.size).toBe(1);
  });

  it('writes nothing, and reads no profiles, when the write changed nothing tracked', async () => {
    const store = new FakeStore();
    const created = await recordItemActivity(
      store,
      event({
        eventId: 'ev3',
        boardId: 'b1',
        itemId: 'i1',
        before: base,
        after: { ...base, seq: 4 } as never,
      }),
    );
    expect(created).toBe(0);
    expect(store.reads.profiles).toBe(0);
    expect(store.docs.size).toBe(0);
  });

  it('logs item_created on create and tolerates a missing board or member', async () => {
    const store = new FakeStore();
    store.members.clear();
    expect(
      await recordItemActivity(store, { eventId: 'ev4', boardId: 'b1', itemId: 'i1', after: base }),
    ).toBe(1);
    expect(store.docs.get('ev4-0')).toMatchObject({ kind: 'item_created', actorName: 'Someone' });

    store.board = null;
    expect(
      await recordItemActivity(store, { eventId: 'ev5', boardId: 'b1', itemId: 'i1', after: base }),
    ).toBe(0);
  });

  it('validates against the shared schema once the server fields are added', async () => {
    const store = new FakeStore();
    await recordItemActivity(store, {
      eventId: 'ev6',
      boardId: 'b1',
      itemId: 'i1',
      before: base,
      after: edit({ groupId: 'g2' }),
    });
    const doc = store.docs.get('ev6-0')!;
    expect(
      activityEventSchema.safeParse({ ...doc, createdAt: ts(1), expiresAt: ts(2) }).success,
    ).toBe(true);
  });
});

describe('recordBoardActivity', () => {
  const before = { name: 'A', columns: [], groups: [], createdBy: 'u1' };

  it('attributes to updatedBy, falling back to createdBy', async () => {
    const store = new FakeStore();
    await recordBoardActivity(store, {
      eventId: 'e1',
      boardId: 'b1',
      before,
      after: { ...before, name: 'B', updatedBy: 'u2' },
    });
    expect(store.docs.get('e1-0')).toMatchObject({ kind: 'board_renamed', actorId: 'u2' });
    await recordBoardActivity(store, {
      eventId: 'e2',
      boardId: 'b1',
      before,
      after: { ...before, name: 'C' },
    });
    expect(store.docs.get('e2-0')).toMatchObject({ actorId: 'u1' });
  });

  it('writes nothing on create, delete or an untracked change', async () => {
    const store = new FakeStore();
    expect(await recordBoardActivity(store, { eventId: 'e3', boardId: 'b1', after: before })).toBe(
      0,
    );
    expect(await recordBoardActivity(store, { eventId: 'e4', boardId: 'b1', before })).toBe(0);
    expect(
      await recordBoardActivity(store, {
        eventId: 'e5',
        boardId: 'b1',
        before,
        after: { ...before, derivedColumnIds: ['x'] } as never,
      }),
    ).toBe(0);
    expect(store.reads.board).toBe(0);
  });
});

describe('recordUpdatePosted', () => {
  it('logs update_posted with a 120-character snippet and the item name', async () => {
    const store = new FakeStore();
    const created = await recordUpdatePosted(store, {
      eventId: 'u1',
      boardId: 'b1',
      itemId: 'i1',
      update: { authorId: 'u2', content: `<p>${'word '.repeat(60)}</p>` },
    });
    expect(created).toBe(1);
    const doc = store.docs.get('u1-0')!;
    expect(doc).toMatchObject({
      kind: 'update_posted',
      actorId: 'u2',
      itemId: 'i1',
      itemName: 'Write spec',
    });
    expect(doc.data.snippet).toHaveLength(ACTIVITY_LIMITS.snippet);
    expect(doc.data.snippet).not.toContain('<');
  });

  it('falls back to the update author fields when there is no member document', async () => {
    const store = new FakeStore();
    store.members.clear();
    await recordUpdatePosted(store, {
      eventId: 'u2',
      boardId: 'b1',
      itemId: 'i1',
      update: {
        authorId: 'ux',
        authorName: 'Taylor Lee',
        authorPhotoUrl: 'https://example.com/t.png',
        content: 'Hi',
      },
    });
    expect(store.docs.get('u2-0')).toMatchObject({
      actorName: 'Taylor Lee',
      actorPhotoUrl: 'https://example.com/t.png',
    });
  });
});
