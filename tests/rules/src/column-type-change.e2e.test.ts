import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * End to end against the Firestore emulator: the real Admin SDK adapter of `changeColumnType` and
 * `revertColumnType` (functions/src/lib/admin.ts) with the real logic, on a board of 1000 items. The
 * callable wrappers only add auth and request parsing; everything below them runs here. Runs through
 * `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

type Logic = typeof import('../../../functions/src/lib/column-type-change');
type Admin = typeof import('../../../functions/src/lib/admin');

let logic: Logic;
let admin: Admin;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  logic = await import('../../../functions/src/lib/column-type-change');
});

async function seedBoard(itemCount: number) {
  const firestore = admin.db();
  const boardId = `e2e-${randomUUID().slice(0, 8)}`;
  const workspaceId = `ws-${boardId}`;
  await firestore
    .collection('workspaces')
    .doc(workspaceId)
    .set({ roles: { u1: 'owner' }, memberIds: ['u1'] });
  await firestore
    .collection('boards')
    .doc(boardId)
    .set({
      workspaceId,
      kind: 'main',
      access: { u1: 'owner' },
      accessUids: ['u1'],
      columnLocks: [],
      columns: [
        {
          id: 'budget',
          type: 'text',
          title: 'Budget',
          position: 'a0',
          settings: {},
          defaultValue: '5',
        },
      ],
      subitemColumns: [],
    });
  let batch = firestore.batch();
  for (let i = 0; i < itemCount; i += 1) {
    const values = i % 50 === 0 ? { budget: 'n/a' } : i % 7 === 0 ? {} : { budget: String(i) };
    const id = `item${String(i).padStart(4, '0')}`;
    batch.set(firestore.collection('boards').doc(boardId).collection('items').doc(id), {
      name: `Item ${i}`,
      parentItemId: null,
      values,
      state: 'active',
    });
    if ((i + 1) % 400 === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  await batch.commit();
  return { firestore, boardId };
}

describe('changeColumnType against the emulator', () => {
  it('snapshots, converts, finishes and then restores 1000 items', async () => {
    const { firestore, boardId } = await seedBoard(1000);
    const store = admin.adminColumnTypeChangeStore(firestore);

    const result = await logic.changeColumnTypeLogic(store, 'u1', {
      boardId,
      columnId: 'budget',
      scope: 'columns',
      toType: 'numbers',
      toSettings: { unit: null, decimals: null },
    });

    const board = (await firestore.collection('boards').doc(boardId).get()).data()!;
    const column = (board.columns as Array<Record<string, unknown>>)[0]!;
    expect(column).toMatchObject({
      type: 'numbers',
      settings: { unit: null, decimals: null },
      defaultValue: 5,
    });
    expect(column.migrating).toBeUndefined();
    expect(column.lastTypeChange).toMatchObject({
      snapshotId: result.snapshotId,
      fromType: 'text',
    });

    const snapshotRef = firestore
      .collection('boards')
      .doc(boardId)
      .collection('columnSnapshots')
      .doc(result.snapshotId);
    const snapshot = (await snapshotRef.get()).data()!;
    expect(snapshot).toMatchObject({ status: 'applied', chunkCount: 3 });
    expect(snapshot.valueCount).toBe(result.converted + result.cleared);
    const chunks = await snapshotRef.collection('chunks').orderBy('index').get();
    expect(chunks.docs.map((d) => (d.get('entries') as unknown[]).length)).toEqual([
      400,
      400,
      snapshot.valueCount - 800,
    ]);

    const items = await firestore.collection('boards').doc(boardId).collection('items').get();
    const values = new Map(
      items.docs.map((d) => [d.id, (d.get('values') as Record<string, unknown>).budget]),
    );
    expect(values.get('item0001')).toBe(1);
    expect(values.get('item0050')).toBeUndefined(); // 'n/a' could not be converted
    expect(values.get('item0007')).toBeUndefined(); // never had a value

    const undone = await logic.revertColumnTypeLogic(store, 'u1', {
      boardId,
      snapshotId: result.snapshotId,
    });
    expect(undone.restored).toBe(snapshot.valueCount);
    const restoredBoard = (await firestore.collection('boards').doc(boardId).get()).data()!;
    const restoredColumn = (restoredBoard.columns as Array<Record<string, unknown>>)[0]!;
    expect(restoredColumn).toMatchObject({ type: 'text', settings: {}, defaultValue: '5' });
    expect(restoredColumn.lastTypeChange).toBeUndefined();
    expect(restoredColumn.migrating).toBeUndefined();
    const after = await firestore.collection('boards').doc(boardId).collection('items').get();
    const restored = new Map(
      after.docs.map((d) => [d.id, (d.get('values') as Record<string, unknown>).budget]),
    );
    expect(restored.get('item0001')).toBe('1');
    expect(restored.get('item0050')).toBe('n/a');
    expect(restored.get('item0007')).toBeUndefined();
    expect((await snapshotRef.get()).get('status')).toBe('reverted');
  });
});
