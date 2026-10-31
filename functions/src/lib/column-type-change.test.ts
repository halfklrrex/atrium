import type {
  BoardRole,
  ColumnDef,
  ColumnScope,
  RevertColumnTypeRequest,
  WorkspaceRole,
} from '@atrium/shared';
import {
  COLUMN_MIGRATION_CHUNK_SIZE,
  COLUMN_MIGRATION_STALE_MS,
  COLUMN_SNAPSHOT_TTL_MS,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  DELETE_VALUE,
  chunkEntries,
  changeColumnTypeLogic,
  revertColumnTypeLogic,
  type ChangeBoardData,
  type ColumnTypeChangeStore,
  type MigrationItem,
  type SnapshotEntry,
  type ColumnWrite,
  type SnapshotMeta,
  type ValueWrite,
} from './column-type-change';

const OWNER = 'u_owner';
const EDITOR = 'u_editor';
const VIEWER = 'u_viewer';
const NOBODY = 'u_nobody';

class CrashError extends Error {}

/** In-memory store. `crashAt` throws on the n-th call of an operation to simulate a dying run. */
class FakeStore implements ColumnTypeChangeStore {
  board: ChangeBoardData;
  items = new Map<string, MigrationItem>();
  snapshots = new Map<string, SnapshotMeta>();
  chunks = new Map<string, Map<number, SnapshotEntry[]>>();
  roles: Record<string, WorkspaceRole> = {
    [OWNER]: 'owner',
    [EDITOR]: 'member',
    [VIEWER]: 'viewer',
  };
  names: Record<string, string> = {};
  clock = 1_000_000;
  ids = 0;
  ledger: string[] = [];
  boardWrites: Array<{ updatedBy: string }> = [];
  activity: Array<ColumnWrite['activity'] & { actor: string }> = [];
  counts: Record<string, number> = {};
  crashAt: { op: string; nth: number } | null = null;
  /** When set, `writeSnapshotChunk` silently drops its data (a failed backup the code must notice). */
  dropChunks = false;
  writeBatches: number[] = [];

  constructor(columns: ColumnDef[], subitemColumns: ColumnDef[] = []) {
    this.board = {
      kind: 'main',
      workspaceId: 'ws1',
      access: { [OWNER]: 'owner' as BoardRole, [EDITOR]: 'editor', [VIEWER]: 'viewer' },
      columns,
      subitemColumns,
      columnLocks: [],
    };
  }

  addItem(id: string, values: Record<string, unknown>, parentItemId: string | null = null) {
    this.items.set(id, { id, parentItemId, values: { ...values }, meta: {} });
  }

  private tick(op: string) {
    this.counts[op] = (this.counts[op] ?? 0) + 1;
    this.ledger.push(op);
    if (this.crashAt && this.crashAt.op === op && this.crashAt.nth === this.counts[op]) {
      throw new CrashError(`crash at ${op} #${this.counts[op]}`);
    }
  }

  async getBoard(): Promise<ChangeBoardData | null> {
    return structuredClone(this.board);
  }
  async getWorkspaceMemberRole(_ws: string, uid: string) {
    return this.roles[uid] ?? null;
  }
  async getMemberNames() {
    return this.names;
  }
  async listItems() {
    return structuredClone([...this.items.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }
  async getSnapshot(_b: string, id: string) {
    const meta = this.snapshots.get(id);
    return meta ? structuredClone(meta) : null;
  }
  async setSnapshot(_b: string, id: string, meta: SnapshotMeta) {
    this.tick('setSnapshot');
    this.snapshots.set(id, structuredClone(meta));
  }
  async deleteSnapshotChunks(_b: string, id: string) {
    this.chunks.delete(id);
  }
  async writeSnapshotChunk(
    _b: string,
    id: string,
    index: number,
    entries: readonly SnapshotEntry[],
  ) {
    this.tick('writeChunk');
    if (this.dropChunks) return;
    const map = this.chunks.get(id) ?? new Map<number, SnapshotEntry[]>();
    map.set(index, structuredClone([...entries]));
    this.chunks.set(id, map);
  }
  async readSnapshotChunks(_b: string, id: string) {
    const map = this.chunks.get(id) ?? new Map<number, SnapshotEntry[]>();
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, entries]) => structuredClone(entries));
  }
  async updateColumn(
    _b: string,
    scope: ColumnScope,
    columnId: string,
    decide: (current: ColumnDef | null, board: ChangeBoardData) => ColumnDef,
    snapshotPatch: { snapshotId: string; patch: Partial<SnapshotMeta> } | undefined,
    write: ColumnWrite,
  ) {
    this.tick('updateColumn');
    const list = this.board[scope];
    const current = structuredClone(list.find((c) => c.id === columnId) ?? null);
    const next = decide(current, structuredClone(this.board));
    // Like the real transaction: returning the current def unchanged writes nothing, logs nothing.
    if (next === current) return;
    this.boardWrites.push({ updatedBy: write.updatedBy });
    if (write.activity) this.activity.push({ ...write.activity, actor: write.updatedBy });
    this.board[scope] = list.map((c) => (c.id === columnId ? structuredClone(next) : c));
    if (snapshotPatch) {
      const meta = this.snapshots.get(snapshotPatch.snapshotId)!;
      this.snapshots.set(snapshotPatch.snapshotId, { ...meta, ...snapshotPatch.patch });
    }
  }
  async writeValues(_b: string, columnId: string, writes: readonly ValueWrite[]) {
    this.tick('writeValues');
    this.writeBatches.push(writes.length);
    for (const write of writes) {
      const item = this.items.get(write.itemId);
      if (!item) continue;
      if (write.value === DELETE_VALUE) delete item.values[columnId];
      else item.values[columnId] = structuredClone(write.value);
    }
  }
  nowMs() {
    return this.clock;
  }
  newId() {
    this.ids += 1;
    return `snap${this.ids}`;
  }

  column(scope: ColumnScope = 'columns', id = 'budget') {
    return this.board[scope].find((c) => c.id === id)!;
  }
  valuesOf(columnId = 'budget') {
    return Object.fromEntries(
      [...this.items.values()].map((i) => [i.id, i.values[columnId]]).sort(),
    );
  }
}

const textColumn = (id = 'budget'): ColumnDef => ({
  id,
  type: 'text',
  title: 'Budget',
  position: 'a0',
  settings: {},
});

function numbersBoard(count = 6) {
  const store = new FakeStore([textColumn(), { ...textColumn('notes'), title: 'Notes' }]);
  for (let i = 0; i < count; i += 1) {
    const id = `item${String(i).padStart(4, '0')}`;
    store.addItem(id, { budget: i % 3 === 2 ? 'n/a' : String(i), notes: `note ${i}` });
  }
  store.addItem('empty', { notes: 'no budget' });
  return store;
}

const toNumbers = (overrides: Record<string, unknown> = {}) => ({
  boardId: 'b1',
  columnId: 'budget',
  scope: 'columns' as const,
  toType: 'numbers',
  toSettings: { unit: null, decimals: null },
  ...overrides,
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe(code);
    return error as HttpsError;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe('changeColumnType: happy path', () => {
  it('snapshots, converts, clears and finishes in order', async () => {
    const store = numbersBoard(6);
    const result = await changeColumnTypeLogic(store, EDITOR, toNumbers());

    expect(result).toMatchObject({ converted: 4, cleared: 2, toType: 'numbers' });
    expect(store.column()).toMatchObject({
      type: 'numbers',
      settings: { unit: null, decimals: null },
    });
    expect(store.column().migrating).toBeUndefined();
    expect(store.column().lastTypeChange).toEqual({
      snapshotId: result.snapshotId,
      fromType: 'text',
      expiresAt: 1_000_000 + COLUMN_SNAPSHOT_TTL_MS,
    });
    expect(store.valuesOf()).toEqual({
      item0000: 0,
      item0001: 1,
      item0002: undefined,
      item0003: 3,
      item0004: 4,
      item0005: undefined,
      empty: undefined,
    });
    // Other columns are untouched.
    expect(store.valuesOf('notes').item0002).toBe('note 2');
    const meta = store.snapshots.get(result.snapshotId)!;
    expect(meta).toMatchObject({
      status: 'applied',
      valueCount: 6,
      chunkCount: 1,
      createdBy: EDITOR,
    });
    expect(meta.fromColumn).toMatchObject({ id: 'budget', type: 'text', settings: {} });
  });

  it('never writes a value before the snapshot is complete and marked ready', async () => {
    const store = numbersBoard(6);
    await changeColumnTypeLogic(store, EDITOR, toNumbers());
    const firstValueWrite = store.ledger.indexOf('writeValues');
    const lastChunk = store.ledger.lastIndexOf('writeChunk');
    const readySet = store.ledger.lastIndexOf('setSnapshot', firstValueWrite);
    expect(lastChunk).toBeLessThan(readySet);
    expect(readySet).toBeLessThan(store.ledger.indexOf('updateColumn'));
    expect(store.ledger.indexOf('updateColumn')).toBeLessThan(firstValueWrite);
  });

  it('creates the labels a status target needs and stores the grown settings', async () => {
    const store = new FakeStore([textColumn()]);
    store.addItem('a', { budget: 'Open' });
    store.addItem('b', { budget: 'Closed' });
    store.addItem('c', { budget: 'Open' });
    const result = await changeColumnTypeLogic(store, EDITOR, {
      ...toNumbers(),
      toType: 'status',
      toSettings: { labels: [{ id: 'open', index: 0, label: 'Open', color: '#fdab3d' }] },
    });
    expect(result).toMatchObject({ converted: 3, cleared: 0 });
    const labels = (store.column().settings as { labels: Array<{ label: string }> }).labels;
    expect(labels.map((l) => l.label)).toEqual(['Open', 'Closed']);
    expect(store.valuesOf()).toEqual({ a: { index: 0 }, b: { index: 1 }, c: { index: 0 } });
  });

  it('converts a People column to text with the names it knows', async () => {
    const store = new FakeStore([
      { ...textColumn(), type: 'people', settings: { singlePerson: false } },
    ]);
    store.names = { uid1: 'Avery Quinn' };
    store.addItem('a', { budget: { personsAndTeams: [{ id: 'uid1', kind: 'person' }] } });
    store.addItem('b', { budget: { personsAndTeams: [{ id: 'uid-gone', kind: 'person' }] } });
    const result = await changeColumnTypeLogic(store, EDITOR, {
      ...toNumbers(),
      toType: 'text',
      toSettings: {},
    });
    expect(result).toMatchObject({ converted: 1, cleared: 1 });
    expect(store.valuesOf()).toEqual({ a: 'Avery Quinn', b: undefined });
  });

  it('drops every value for a derived target and keeps the snapshot to undo it', async () => {
    const store = numbersBoard(3);
    const result = await changeColumnTypeLogic(store, EDITOR, {
      ...toNumbers(),
      toType: 'formula',
      toSettings: { expression: '', outputType: 'text' },
    });
    expect(result.converted).toBe(0);
    expect(store.column().type).toBe('formula');
    expect(Object.values(store.valuesOf()).every((v) => v === undefined)).toBe(true);
    await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId: result.snapshotId });
    expect(store.valuesOf().item0000).toBe('0');
  });

  it('converts and drops the column default value', async () => {
    const store = numbersBoard(2);
    store.board.columns[0] = { ...textColumn(), defaultValue: '5' };
    await changeColumnTypeLogic(store, EDITOR, toNumbers());
    expect(store.column().defaultValue).toBe(5);
    const store2 = numbersBoard(2);
    store2.board.columns[0] = { ...textColumn(), defaultValue: 'soon' };
    await changeColumnTypeLogic(store2, EDITOR, toNumbers());
    expect(store2.column().defaultValue).toBeUndefined();
  });

  it('works on the subitem columns and only touches subitems', async () => {
    const store = new FakeStore([], [textColumn('sub')]);
    store.addItem('parent', { sub: 'parent value' });
    store.addItem('child', { sub: '7' }, 'parent');
    const result = await changeColumnTypeLogic(store, EDITOR, {
      ...toNumbers(),
      columnId: 'sub',
      scope: 'subitemColumns',
    });
    expect(result.converted).toBe(1);
    expect(store.column('subitemColumns', 'sub').type).toBe('numbers');
    expect(store.valuesOf('sub')).toEqual({ child: 7, parent: 'parent value' });
  });
});

describe('changeColumnType: activity and updatedBy', () => {
  it('logs one column_type_changed entry with the final write, and sets updatedBy on every board write', async () => {
    const store = numbersBoard(3);
    await changeColumnTypeLogic(store, EDITOR, toNumbers());
    expect(store.activity).toEqual([
      {
        kind: 'column_type_changed',
        actor: EDITOR,
        fields: {
          columnId: 'budget',
          columnTitle: 'Budget',
          columnType: 'numbers',
          data: { fromText: 'Text', toText: 'Numbers' },
        },
      },
    ]);
    // "Mark busy" and "finish" both stamp the caller.
    expect(store.boardWrites).toEqual([{ updatedBy: EDITOR }, { updatedBy: EDITOR }]);
  });

  it('logs nothing when the change is refused', async () => {
    const store = numbersBoard(3);
    await expectCode(changeColumnTypeLogic(store, 'stranger', toNumbers()), 'permission-denied');
    expect(store.activity).toEqual([]);
    expect(store.boardWrites).toEqual([]);
  });

  it('logs a column_type_reverted entry for an undo', async () => {
    const store = numbersBoard(3);
    const { snapshotId } = await changeColumnTypeLogic(store, EDITOR, toNumbers());
    await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId });
    expect(store.activity.map((a) => a?.kind)).toEqual([
      'column_type_changed',
      'column_type_reverted',
    ]);
    expect(store.activity[1]).toMatchObject({
      actor: EDITOR,
      fields: { columnType: 'text', data: { fromText: 'Numbers', toText: 'Text' } },
    });
  });
});

describe('changeColumnType: chunking', () => {
  it('splits more than 400 items into snapshot chunks and write batches of at most 400', async () => {
    const store = new FakeStore([textColumn()]);
    for (let i = 0; i < 1000; i += 1)
      store.addItem(`i${String(i).padStart(5, '0')}`, { budget: String(i) });
    const result = await changeColumnTypeLogic(store, EDITOR, toNumbers());
    expect(result).toMatchObject({ converted: 1000, cleared: 0 });
    const meta = store.snapshots.get(result.snapshotId)!;
    expect(meta).toMatchObject({ valueCount: 1000, chunkCount: 3 });
    const sizes = [...store.chunks.get(result.snapshotId)!.values()].map((c) => c.length);
    expect(sizes).toEqual([400, 400, 200]);
    expect(store.writeBatches).toEqual([400, 400, 200]);
    expect(Math.max(...store.writeBatches)).toBeLessThanOrEqual(COLUMN_MIGRATION_CHUNK_SIZE);
    expect(store.valuesOf().i00999).toBe(999);
  });

  it('chunkEntries also caps a chunk by its size', () => {
    const big = 'x'.repeat(100_000);
    const chunks = chunkEntries(
      Array.from({ length: 20 }, (_, i) => ({ itemId: `i${i}`, value: big })),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 6)).toBe(true);
    expect(chunks.flat()).toHaveLength(20);
  });

  it('reverts a large board in batches too', async () => {
    const store = new FakeStore([textColumn()]);
    for (let i = 0; i < 900; i += 1)
      store.addItem(`i${String(i).padStart(5, '0')}`, { budget: String(i) });
    const { snapshotId } = await changeColumnTypeLogic(store, EDITOR, toNumbers());
    store.writeBatches = [];
    const result = await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId });
    expect(result).toMatchObject({ restored: 900, removed: 0 });
    expect(store.writeBatches).toEqual([400, 400, 100]);
    expect(store.valuesOf().i00899).toBe('899');
  });
});

describe('changeColumnType: permissions, locks and refusals', () => {
  it('refuses viewers, strangers and unknown boards or columns', async () => {
    const store = numbersBoard();
    await expectCode(changeColumnTypeLogic(store, VIEWER, toNumbers()), 'permission-denied');
    await expectCode(changeColumnTypeLogic(store, NOBODY, toNumbers()), 'permission-denied');
    await expectCode(
      changeColumnTypeLogic(store, EDITOR, toNumbers({ columnId: 'nope' })),
      'not-found',
    );
    const gone = new FakeStore([]);
    gone.getBoard = async () => null;
    await expectCode(changeColumnTypeLogic(gone, EDITOR, toNumbers()), 'not-found');
    expect(store.snapshots.size).toBe(0);
    expect(store.column().type).toBe('text');
  });

  it('lets only board owners change a locked column', async () => {
    const store = numbersBoard();
    store.board.columnLocks = ['budget'];
    await expectCode(changeColumnTypeLogic(store, EDITOR, toNumbers()), 'permission-denied');
    expect(store.snapshots.size).toBe(0);
    const result = await changeColumnTypeLogic(store, OWNER, toNumbers());
    expect(result.toType).toBe('numbers');
  });

  it('refuses a server-managed target, the same type, an unknown type and bad settings', async () => {
    const store = numbersBoard();
    await expectCode(
      changeColumnTypeLogic(store, OWNER, toNumbers({ toType: 'files', toSettings: {} })),
      'failed-precondition',
    );
    await expectCode(
      changeColumnTypeLogic(store, OWNER, toNumbers({ toType: 'text', toSettings: {} })),
      'failed-precondition',
    );
    await expectCode(
      changeColumnTypeLogic(store, OWNER, toNumbers({ toType: 'nonsense', toSettings: {} })),
      'failed-precondition',
    );
    await expectCode(
      changeColumnTypeLogic(store, OWNER, toNumbers({ toSettings: { decimals: 99 } })),
      'invalid-argument',
    );
    expect(store.snapshots.size).toBe(0);
    expect(store.ledger).toEqual([]);
  });

  it('lets a server-managed or derived source become text for owners only', async () => {
    const files = new FakeStore([{ ...textColumn(), type: 'button', settings: { label: 'Go' } }]);
    files.addItem('a', { budget: {} });
    await expectCode(
      changeColumnTypeLogic(files, EDITOR, toNumbers({ toType: 'text', toSettings: {} })),
      'permission-denied',
    );
    await expectCode(changeColumnTypeLogic(files, OWNER, toNumbers()), 'failed-precondition');
    expect(files.snapshots.size).toBe(0);
    const result = await changeColumnTypeLogic(
      files,
      OWNER,
      toNumbers({ toType: 'text', toSettings: {} }),
    );
    expect(result.toType).toBe('text');
    expect(files.column().type).toBe('text');

    const derived = new FakeStore([
      textColumn('base'),
      {
        ...textColumn('calc'),
        id: 'calc',
        type: 'progress',
        settings: { related_columns: { isNormalized: true, columns: {} } },
      },
    ]);
    derived.addItem('a', { base: 'x' });
    await expectCode(
      changeColumnTypeLogic(
        derived,
        EDITOR,
        toNumbers({ columnId: 'calc', toType: 'text', toSettings: {} }),
      ),
      'permission-denied',
    );
    await expectCode(
      changeColumnTypeLogic(
        derived,
        OWNER,
        toNumbers({ columnId: 'calc', toType: 'formula', toSettings: { expression: '1' } }),
      ),
      'failed-precondition',
    );
    const toText = await changeColumnTypeLogic(
      derived,
      OWNER,
      toNumbers({ columnId: 'calc', toType: 'text', toSettings: {} }),
    );
    // A derived source has nothing stored to snapshot; its old type is restored from the definition.
    expect(derived.snapshots.get(toText.snapshotId)).toMatchObject({
      valueCount: 0,
      chunkCount: 0,
    });
    await revertColumnTypeLogic(derived, OWNER, { boardId: 'b1', snapshotId: toText.snapshotId });
    expect(derived.column('columns', 'calc').type).toBe('progress');
    expect(derived.valuesOf('calc').a).toBeUndefined();
  });

  it('aborts with data-loss and changes nothing when the backup cannot be read back', async () => {
    const store = numbersBoard();
    store.dropChunks = true;
    await expectCode(changeColumnTypeLogic(store, EDITOR, toNumbers()), 'data-loss');
    expect(store.ledger).not.toContain('writeValues');
    expect(store.ledger).not.toContain('updateColumn');
    expect(store.column().type).toBe('text');
    expect(store.column().migrating).toBeUndefined();
    expect(store.valuesOf().item0000).toBe('0');
  });
});

describe('changeColumnType: crash and resume', () => {
  const crashPoints: Array<{ name: string; op: string; nth: number }> = [
    { name: 'before the snapshot document exists', op: 'setSnapshot', nth: 1 },
    { name: 'in the middle of the snapshot chunks', op: 'writeChunk', nth: 2 },
    { name: 'after the chunks, before the snapshot is ready', op: 'setSnapshot', nth: 2 },
    { name: 'before the column is marked busy', op: 'updateColumn', nth: 1 },
    { name: 'in the middle of the conversion', op: 'writeValues', nth: 2 },
    { name: 'after the conversion, before finishing', op: 'updateColumn', nth: 2 },
  ];

  function bigBoard() {
    const store = new FakeStore([textColumn()]);
    for (let i = 0; i < 900; i += 1) {
      store.addItem(`i${String(i).padStart(5, '0')}`, { budget: i % 10 === 0 ? 'n/a' : String(i) });
    }
    return store;
  }

  const clean = async () => {
    const store = bigBoard();
    const result = await changeColumnTypeLogic(store, EDITOR, toNumbers({ snapshotId: 'run1' }));
    return { store, result };
  };

  for (const point of crashPoints) {
    it(`a retry with the same snapshot id finishes after a crash ${point.name}`, async () => {
      const { store: expected, result: expectedResult } = await clean();
      const store = bigBoard();
      store.crashAt = { op: point.op, nth: point.nth };
      await expect(
        changeColumnTypeLogic(store, EDITOR, toNumbers({ snapshotId: 'run1' })),
      ).rejects.toBeInstanceOf(CrashError);
      store.crashAt = null;
      // Values are only ever touched once the snapshot is ready.
      if (store.ledger.includes('writeValues'))
        expect(store.snapshots.get('run1')?.status).toBe('ready');

      const result = await changeColumnTypeLogic(store, EDITOR, toNumbers({ snapshotId: 'run1' }));
      expect(result).toEqual(expectedResult);
      expect(store.snapshots.size).toBe(1);
      expect(store.valuesOf()).toEqual(expected.valuesOf());
      expect(store.column()).toEqual({
        ...expected.column(),
        lastTypeChange: {
          ...expected.column().lastTypeChange,
          expiresAt: store.column().lastTypeChange!.expiresAt,
        },
      });
      expect(store.column().migrating).toBeUndefined();
      expect(store.snapshots.get('run1')?.status).toBe('applied');

      // The old values are all still recoverable.
      await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId: 'run1' });
      expect(store.valuesOf().i00001).toBe('1');
      expect(store.valuesOf().i00010).toBe('n/a');
      expect(store.column().type).toBe('text');
    });
  }

  it('refuses a different call while a fresh run is in progress, then lets a stale one be taken over', async () => {
    const store = bigBoard();
    store.crashAt = { op: 'writeValues', nth: 2 };
    await expect(changeColumnTypeLogic(store, EDITOR, toNumbers())).rejects.toBeInstanceOf(
      CrashError,
    );
    store.crashAt = null;
    expect(store.column().migrating).toMatchObject({ kind: 'change', startedAt: 1_000_000 });
    const snapshotId = store.column().migrating!.snapshotId;

    // Fresh (under 10 minutes): a call from somewhere else, and an undo, are refused.
    store.clock += COLUMN_MIGRATION_STALE_MS - 1;
    await expectCode(changeColumnTypeLogic(store, OWNER, toNumbers()), 'failed-precondition');
    await expectCode(
      changeColumnTypeLogic(store, OWNER, toNumbers({ snapshotId: 'other' })),
      'failed-precondition',
    );
    await expectCode(
      revertColumnTypeLogic(store, OWNER, { boardId: 'b1', snapshotId }),
      'failed-precondition',
    );
    expect(store.snapshots.size).toBe(1);

    // Stale: it resumes the same snapshot (never a second one).
    store.clock += 1;
    const result = await changeColumnTypeLogic(store, OWNER, toNumbers());
    expect(result.snapshotId).toBe(snapshotId);
    expect(store.snapshots.size).toBe(1);
    expect(store.column()).toMatchObject({ type: 'numbers' });
    expect(store.column().migrating).toBeUndefined();
    expect(store.valuesOf().i00001).toBe(1);
  });

  it('a stale run can be undone instead of resumed', async () => {
    const store = bigBoard();
    store.crashAt = { op: 'writeValues', nth: 2 };
    await expect(changeColumnTypeLogic(store, EDITOR, toNumbers())).rejects.toBeInstanceOf(
      CrashError,
    );
    store.crashAt = null;
    const snapshotId = store.column().migrating!.snapshotId;
    // Half converted: the first 400 are numbers already.
    expect(store.valuesOf().i00001).toBe(1);
    store.clock += COLUMN_MIGRATION_STALE_MS;
    const result = await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId });
    expect(result.restored).toBe(900);
    expect(store.column()).toMatchObject({ type: 'text' });
    expect(store.column().migrating).toBeUndefined();
    expect(store.column().lastTypeChange).toBeUndefined();
    expect(store.valuesOf().i00001).toBe('1');
    expect(store.valuesOf().i00010).toBe('n/a');
    expect(store.snapshots.get(snapshotId)?.status).toBe('reverted');
  });

  it('a repeated finished call with the same snapshot id is a no-op', async () => {
    const { store, result } = await clean();
    const writes = store.counts.writeValues;
    const again = await changeColumnTypeLogic(store, EDITOR, toNumbers({ snapshotId: 'run1' }));
    expect(again).toEqual(result);
    expect(store.counts.writeValues).toBe(writes);
    expect(store.snapshots.size).toBe(1);
  });

  it('never re-applies a snapshot after the column changed again or was undone', async () => {
    const { store } = await clean();
    await revertColumnTypeLogic(store, EDITOR, { boardId: 'b1', snapshotId: 'run1' });
    await expectCode(
      changeColumnTypeLogic(store, EDITOR, toNumbers({ snapshotId: 'run1' })),
      'invalid-argument',
    );
    expect(store.column().type).toBe('text');
  });
});

describe('revertColumnType', () => {
  async function applied() {
    const store = numbersBoard(6);
    const { snapshotId } = await changeColumnTypeLogic(store, EDITOR, toNumbers());
    return { store, snapshotId };
  }
  const revert = (snapshotId: string): RevertColumnTypeRequest => ({ boardId: 'b1', snapshotId });

  it('restores the values and the column definition', async () => {
    const { store, snapshotId } = await applied();
    store.items.get('empty')!.values.budget = 5; // typed after the change: no old value to restore
    const result = await revertColumnTypeLogic(store, EDITOR, revert(snapshotId));
    expect(result).toEqual({ restored: 6, removed: 1, snapshotId, columnId: 'budget' });
    expect(store.column()).toMatchObject({ type: 'text', settings: {} });
    expect(store.column().lastTypeChange).toBeUndefined();
    expect(store.valuesOf()).toMatchObject({ item0000: '0', item0002: 'n/a', item0005: 'n/a' });
    expect(store.valuesOf().empty).toBeUndefined();
    expect(store.snapshots.get(snapshotId)?.status).toBe('reverted');
  });

  it('keeps edits to other fields of the column made after the change', async () => {
    const { store, snapshotId } = await applied();
    store.board.columns[0] = { ...store.column(), title: 'Renamed', width: 300 };
    await revertColumnTypeLogic(store, EDITOR, revert(snapshotId));
    expect(store.column()).toMatchObject({ title: 'Renamed', width: 300, type: 'text' });
  });

  it('is idempotent and refuses a second undo of a later change', async () => {
    const { store, snapshotId } = await applied();
    const first = await revertColumnTypeLogic(store, EDITOR, revert(snapshotId));
    const second = await revertColumnTypeLogic(store, EDITOR, revert(snapshotId));
    expect(second.snapshotId).toBe(first.snapshotId);

    const change2 = await changeColumnTypeLogic(store, EDITOR, toNumbers());
    const change3 = await changeColumnTypeLogic(store, EDITOR, {
      ...toNumbers(),
      toType: 'text',
      toSettings: {},
    });
    // The undo of the older change is refused: the column has been changed again since.
    await expectCode(
      revertColumnTypeLogic(store, EDITOR, revert(change2.snapshotId)),
      'failed-precondition',
    );
    await revertColumnTypeLogic(store, EDITOR, revert(change3.snapshotId));
    expect(store.column().type).toBe('numbers');
  });

  it('refuses unknown or expired snapshots, viewers and locked columns', async () => {
    const { store, snapshotId } = await applied();
    await expectCode(revertColumnTypeLogic(store, EDITOR, revert('missing')), 'not-found');
    await expectCode(revertColumnTypeLogic(store, VIEWER, revert(snapshotId)), 'permission-denied');
    store.board.columnLocks = ['budget'];
    await expectCode(revertColumnTypeLogic(store, EDITOR, revert(snapshotId)), 'permission-denied');
    store.clock += COLUMN_SNAPSHOT_TTL_MS;
    await expectCode(revertColumnTypeLogic(store, OWNER, revert(snapshotId)), 'not-found');
    expect(store.column().type).toBe('numbers');
  });

  it('refuses when the backup is incomplete, before touching anything', async () => {
    const { store, snapshotId } = await applied();
    store.chunks.get(snapshotId)!.clear();
    await expectCode(revertColumnTypeLogic(store, EDITOR, revert(snapshotId)), 'data-loss');
    expect(store.column().type).toBe('numbers');
    expect(store.column().migrating).toBeUndefined();
  });

  const revertCrashes = [
    { name: 'before the column is marked busy', op: 'updateColumn', nth: 3 },
    { name: 'in the middle of the restore', op: 'writeValues', nth: 2 },
    { name: 'before finishing', op: 'updateColumn', nth: 4 },
  ];
  for (const point of revertCrashes) {
    it(`finishes the undo after a crash ${point.name}`, async () => {
      const store = new FakeStore([textColumn()]);
      for (let i = 0; i < 900; i += 1)
        store.addItem(`i${String(i).padStart(5, '0')}`, { budget: String(i) });
      const { snapshotId } = await changeColumnTypeLogic(store, EDITOR, toNumbers());
      store.counts = {};
      store.crashAt = { op: point.op, nth: point.nth - (point.op === 'updateColumn' ? 2 : 0) };
      await expect(revertColumnTypeLogic(store, EDITOR, revert(snapshotId))).rejects.toBeInstanceOf(
        CrashError,
      );
      store.crashAt = null;
      // The same caller retrying is allowed straight away; a stranger waits for staleness.
      const result = await revertColumnTypeLogic(store, EDITOR, revert(snapshotId));
      expect(result.restored).toBe(900);
      expect(store.column()).toMatchObject({ type: 'text' });
      expect(store.column().migrating).toBeUndefined();
      expect(store.valuesOf().i00007).toBe('7');
    });
  }
});
