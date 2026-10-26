import {
  columnRegistry,
  defineColumnType,
  textColumn,
  type BoardColumnsData,
  type ColumnIdLists,
} from '@atrium/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncColumnIdLists, type ColumnIdListsStore } from './derived-column-ids';

// No production column type is derived yet, so the shared registry gets a test-only one. `button`
// is the production server-managed type (FW2).
beforeAll(() => {
  columnRegistry.register(
    defineColumnType({
      ...textColumn,
      type: 'test_derived',
      label: 'Test derived',
      derived: true,
      compute: () => 'x',
    }),
  );
});

const col = (id: string, type: string) => ({
  id,
  type,
  title: id,
  position: 'a0',
  settings: {},
});

/** In-memory store: one board document, counting writes. */
function memoryStore(initial: BoardColumnsData | null) {
  let data = initial;
  let writes = 0;
  const store: ColumnIdListsStore = {
    async update(_boardId, decide) {
      if (!data) return null;
      const next = decide(data);
      if (next === null) return null;
      data = { ...data, ...next };
      writes++;
      return next;
    },
  };
  return {
    store,
    get data() {
      return data;
    },
    /** A client edit of the board (columns change, ids untouched). */
    edit(patch: BoardColumnsData) {
      data = { ...data, ...patch };
      return data;
    },
    get writes() {
      return writes;
    },
  };
}

const lists = (derivedColumnIds: string[], serverManagedColumnIds: string[]): ColumnIdLists => ({
  derivedColumnIds,
  serverManagedColumnIds,
});

describe('syncColumnIdLists', () => {
  it('writes the recomputed lists once, then not again (no trigger loop)', async () => {
    const board: BoardColumnsData = {
      columns: [col('d', 'test_derived'), col('b', 'button'), col('t', 'text')],
      derivedColumnIds: [],
      serverManagedColumnIds: [],
    };
    const mem = memoryStore(board);

    expect(await syncColumnIdLists(mem.store, 'b1', board)).toEqual({
      written: lists(['d'], ['b']),
    });
    expect(mem.writes).toBe(1);

    // The trigger fires again for its own write: the event data is now consistent.
    expect(await syncColumnIdLists(mem.store, 'b1', mem.data!)).toEqual({ written: null });
    expect(mem.writes).toBe(1);
  });

  it('does not touch the store when the event data is already consistent', async () => {
    let calls = 0;
    const store: ColumnIdListsStore = {
      async update() {
        calls++;
        return null;
      },
    };
    const board = {
      columns: [col('d', 'test_derived'), col('b', 'button')],
      derivedColumnIds: ['d'],
      serverManagedColumnIds: ['b'],
    };
    expect(await syncColumnIdLists(store, 'b1', board)).toEqual({ written: null });
    expect(calls).toBe(0);
  });

  it('writes when only the server-managed list is wrong, and fixes both in one write', async () => {
    const board: BoardColumnsData = {
      columns: [col('d', 'test_derived'), col('b', 'button')],
      derivedColumnIds: ['d'],
      serverManagedColumnIds: [],
    };
    const mem = memoryStore(board);
    expect(await syncColumnIdLists(mem.store, 'b1', board)).toEqual({
      written: lists(['d'], ['b']),
    });
    expect(mem.writes).toBe(1);
  });

  it('backfills a board that has neither field, or only the FW1 one', async () => {
    const legacy: BoardColumnsData = { columns: [col('d', 'test_derived'), col('b', 'button')] };
    const mem = memoryStore(legacy);
    expect(await syncColumnIdLists(mem.store, 'b1', legacy)).toEqual({
      written: lists(['d'], ['b']),
    });
    expect(mem.data?.derivedColumnIds).toEqual(['d']);
    expect(mem.data?.serverManagedColumnIds).toEqual(['b']);

    // A board from before FW2: derivedColumnIds present, serverManagedColumnIds missing.
    const fw1: BoardColumnsData = { columns: [col('b', 'button')], derivedColumnIds: [] };
    const mem2 = memoryStore(fw1);
    expect(await syncColumnIdLists(mem2.store, 'b2', fw1)).toEqual({ written: lists([], ['b']) });
    expect(mem2.data?.serverManagedColumnIds).toEqual(['b']);
  });

  it('writes no field at all for a board with no such columns that already has both', async () => {
    const board: BoardColumnsData = {
      columns: [col('t', 'text')],
      derivedColumnIds: [],
      serverManagedColumnIds: [],
    };
    const mem = memoryStore(board);
    expect(await syncColumnIdLists(mem.store, 'b1', board)).toEqual({ written: null });
    expect(mem.writes).toBe(0);
  });

  it('repairs forged lists and follows column changes in both directions', async () => {
    const mem = memoryStore({
      columns: [col('t', 'text')],
      derivedColumnIds: ['t'],
      serverManagedColumnIds: ['t'],
    });
    await syncColumnIdLists(mem.store, 'b1', mem.data!);
    expect(mem.data?.derivedColumnIds).toEqual([]);
    expect(mem.data?.serverManagedColumnIds).toEqual([]);

    const added = mem.edit({
      columns: [col('t', 'text'), col('d', 'test_derived'), col('b', 'button')],
    });
    expect((await syncColumnIdLists(mem.store, 'b1', added)).written).toEqual(lists(['d'], ['b']));

    const removed = mem.edit({ columns: [col('t', 'text')] });
    expect((await syncColumnIdLists(mem.store, 'b1', removed)).written).toEqual(lists([], []));
  });

  it('counts sub-item columns too', async () => {
    const board: BoardColumnsData = {
      columns: [col('t', 'text')],
      subitemColumns: [col('sb', 'button')],
      derivedColumnIds: [],
      serverManagedColumnIds: [],
    };
    const mem = memoryStore(board);
    expect((await syncColumnIdLists(mem.store, 'b1', board)).written).toEqual(lists([], ['sb']));
  });

  it('recomputes against the current document, not a stale event snapshot', async () => {
    // The event says the board has one derived and one server-managed column, but by the time the
    // transaction reads it those columns are gone: the stale snapshot must not be written back.
    const stale: BoardColumnsData = {
      columns: [col('d', 'test_derived'), col('b', 'button')],
      derivedColumnIds: [],
      serverManagedColumnIds: [],
    };
    const mem = memoryStore({
      columns: [col('t', 'text')],
      derivedColumnIds: ['d'],
      serverManagedColumnIds: ['b'],
    });
    const result = await syncColumnIdLists(mem.store, 'b1', stale);
    expect(result.written).toEqual(lists([], []));
    expect(mem.data?.derivedColumnIds).toEqual([]);
    expect(mem.data?.serverManagedColumnIds).toEqual([]);
  });

  it('does nothing for a deleted board', async () => {
    const mem = memoryStore(null);
    expect(await syncColumnIdLists(mem.store, 'b1', undefined)).toEqual({ written: null });
    expect(mem.writes).toBe(0);
  });
});
