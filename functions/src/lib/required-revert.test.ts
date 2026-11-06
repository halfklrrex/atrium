import { activityEventSchema, type ColumnDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_REVERT_ACTOR_ID,
  revertDoneWithEmptyRequired,
  type RequiredRevertBoard,
  type RequiredRevertEvent,
  type RequiredRevertPlan,
  type RequiredRevertStore,
} from './required-revert';

const labels = [
  { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
  { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
  { id: 's', index: 2, label: 'Stuck', color: '#df2f4a' },
];
const col = (id: string, type: string, title: string, required = false): ColumnDef => ({
  id,
  type,
  title,
  position: 'a0',
  settings: type === 'status' ? { labels } : {},
  ...(required ? { required: true } : {}),
});
const BOARD: RequiredRevertBoard = {
  columns: [
    col('st', 'status', 'Status'),
    col('owner', 'people', 'Owner', true),
    col('notes', 'text', 'Notes', true),
  ],
  subitemColumns: [col('sst', 'status', 'Sub status'), col('sn', 'text', 'Sub note', true)],
  requiredColumnIds: ['owner', 'notes', 'sn'],
};
const FILLED = { owner: { personsAndTeams: [{ id: 'u1', kind: 'person' }] }, notes: 'x' };

/** In-memory store with one item; records every applied plan. */
function memoryStore(board: RequiredRevertBoard | null, values: Record<string, unknown>) {
  const state = { values: { ...values }, entries: [] as Array<{ id: string; doc: unknown }> };
  let applied = 0;
  const store: RequiredRevertStore = {
    async getBoard() {
      return board;
    },
    async revert(_b, _i, entryId, decide) {
      const plan: RequiredRevertPlan | null = decide({ state: 'active', values: state.values });
      if (!plan) return null;
      for (const r of plan.restore) {
        if (r.previous === undefined) delete state.values[r.columnId];
        else state.values[r.columnId] = r.previous;
      }
      state.entries.push({ id: entryId, doc: plan.entry });
      applied++;
      return plan;
    },
  };
  return {
    store,
    state,
    get applied() {
      return applied;
    },
  };
}

const event = (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  extra: Partial<RequiredRevertEvent['after']> = {},
): RequiredRevertEvent => ({
  eventId: 'ev1',
  boardId: 'b1',
  itemId: 'i1',
  ...(before ? { before: { values: before } } : {}),
  after: { name: 'Write spec', values: after, ...extra },
});

describe('revertDoneWithEmptyRequired', () => {
  it('puts the Status back and logs why when Done is reached with a required cell empty', async () => {
    const after = { st: { index: 1 }, notes: 'x' };
    const mem = memoryStore(BOARD, after);
    const out = await revertDoneWithEmptyRequired(
      mem.store,
      event({ st: { index: 0 }, notes: 'x' }, after),
    );
    expect(out).toEqual({ reverted: true, columnIds: ['st'] });
    expect(mem.state.values.st).toEqual({ index: 0 });
    expect(mem.state.entries).toHaveLength(1);
    const { id, doc } = mem.state.entries[0]!;
    expect(id).toBe('ev1-required');
    expect(doc).toMatchObject({
      kind: 'required_reverted',
      actorId: REQUIRED_REVERT_ACTOR_ID,
      actorName: 'Atrium',
      itemId: 'i1',
      itemName: 'Write spec',
      columnId: 'st',
      columnTitle: 'Status',
      data: { fromText: 'Done', toText: 'Working on it', missingTitles: ['Owner'] },
    });
    // The entry fits the activity schema (minus the adapter's timestamps).
    expect(
      activityEventSchema.omit({ createdAt: true, expiresAt: true }).safeParse(doc).success,
    ).toBe(true);
  });

  it('deletes the cell when the Status had no value before', async () => {
    const after = { st: { index: 1 } };
    const mem = memoryStore(BOARD, after);
    const out = await revertDoneWithEmptyRequired(mem.store, event({}, after));
    expect(out.reverted).toBe(true);
    expect('st' in mem.state.values).toBe(false);
    expect(mem.state.entries[0]!.doc).toMatchObject({ data: { toText: '' } });
  });

  it('leaves Done alone when every other required cell is filled', async () => {
    const after = { ...FILLED, st: { index: 1 } };
    const mem = memoryStore(BOARD, after);
    const out = await revertDoneWithEmptyRequired(
      mem.store,
      event({ ...FILLED, st: { index: 0 } }, after),
    );
    expect(out).toEqual({ reverted: false, reason: 'allowed' });
    expect(mem.applied).toBe(0);
    expect(mem.state.values.st).toEqual({ index: 1 });
  });

  it('does not revert an item that was already Done before an unrelated write', async () => {
    const before = { st: { index: 1 } };
    const after = { st: { index: 1 }, notes: '' };
    const mem = memoryStore(BOARD, after);
    const out = await revertDoneWithEmptyRequired(mem.store, event(before, after));
    expect(out).toEqual({ reverted: false, reason: 'allowed' });
    expect(mem.applied).toBe(0);
  });

  it('does not clobber a newer write: the cell no longer holds what was just written', async () => {
    const after = { st: { index: 1 } };
    // By the time the transaction runs, someone moved the Status to Stuck.
    const newer = memoryStore(BOARD, { st: { index: 2 } });
    expect(
      await revertDoneWithEmptyRequired(newer.store, event({ st: { index: 0 } }, after)),
    ).toEqual({
      reverted: false,
      reason: 'superseded',
    });
    expect(newer.state.values.st).toEqual({ index: 2 });
    expect(newer.state.entries).toEqual([]);
    // ...or filled the required cells in the meantime.
    const filled = memoryStore(BOARD, { ...FILLED, st: { index: 1 } });
    expect(
      await revertDoneWithEmptyRequired(filled.store, event({ st: { index: 0 } }, after)),
    ).toEqual({
      reverted: false,
      reason: 'superseded',
    });
    expect(filled.state.values.st).toEqual({ index: 1 });
  });

  it('is loop safe: the revert event (Done to not-Done) and a re-delivered event do nothing', async () => {
    const mem = memoryStore(BOARD, { st: { index: 1 } });
    const first = await revertDoneWithEmptyRequired(
      mem.store,
      event({ st: { index: 0 } }, { st: { index: 1 } }),
    );
    expect(first.reverted).toBe(true);
    // The revert's own write event: Done before, back to Working after.
    const own = await revertDoneWithEmptyRequired(
      mem.store,
      event({ st: { index: 1 } }, { st: { index: 0 } }),
    );
    expect(own).toEqual({ reverted: false, reason: 'allowed' });
    // The first event delivered again: the cell is already reverted, so nothing more is written.
    const again = await revertDoneWithEmptyRequired(
      mem.store,
      event({ st: { index: 0 } }, { st: { index: 1 } }),
    );
    expect(again).toEqual({ reverted: false, reason: 'superseded' });
    expect(mem.applied).toBe(1);
    expect(mem.state.entries).toHaveLength(1);
  });

  it('never touches boards without requiredColumnIds, and ignores creates and missing boards', async () => {
    const after = { st: { index: 1 } };
    for (const requiredColumnIds of [[], undefined, null] as const) {
      const mem = memoryStore({ ...BOARD, requiredColumnIds }, after);
      const out = await revertDoneWithEmptyRequired(mem.store, event({ st: { index: 0 } }, after));
      expect(out).toEqual({ reverted: false, reason: 'no-required' });
      expect(mem.applied).toBe(0);
    }
    const mem = memoryStore(BOARD, after);
    expect(await revertDoneWithEmptyRequired(mem.store, event(undefined, after))).toEqual({
      reverted: false,
      reason: 'create',
    });
    const gone = memoryStore(null, after);
    expect(await revertDoneWithEmptyRequired(gone.store, event({}, after))).toEqual({
      reverted: false,
      reason: 'gone',
    });
  });

  it('uses the subitem columns for a subitem', async () => {
    const after = { sst: { index: 1 } };
    const mem = memoryStore(BOARD, after);
    const out = await revertDoneWithEmptyRequired(
      mem.store,
      event({ sst: { index: 0 } }, after, { parentItemId: 'p1' }),
    );
    expect(out).toEqual({ reverted: true, columnIds: ['sst'] });
    expect(mem.state.entries[0]!.doc).toMatchObject({
      data: { missingTitles: ['Sub note'] },
      parentItemId: 'p1',
    });
  });
});
