import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as LogicModule from '../../../functions/src/lib/board-sharing';

/**
 * End to end against the Firestore emulator: the real Admin SDK adapter of the board sharing
 * callables (functions/src/lib/admin.ts) with the real logic. The callable wrappers only add auth and
 * request parsing. Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let logic: typeof LogicModule;
let admin: typeof AdminModule;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  logic = await import('../../../functions/src/lib/board-sharing');
});

async function seed() {
  const firestore = admin.db();
  const id = randomUUID().slice(0, 8);
  const workspaceId = `ws-${id}`;
  const boardId = `board-${id}`;
  await firestore
    .collection('workspaces')
    .doc(workspaceId)
    .set({
      roles: { boss: 'admin', pal: 'member', guest: 'viewer' },
      memberIds: ['boss', 'pal', 'guest'],
    });
  await firestore.collection('boards').doc(boardId).set({
    workspaceId,
    kind: 'main',
    access: {},
    accessUids: [],
    state: 'active',
  });
  return { firestore, boardId };
}

describe('board sharing against the emulator', () => {
  it('writes kind, access, accessUids and updatedAt together and enforces the rules of the logic', async () => {
    const { firestore, boardId } = await seed();
    const run = <T>(fn: (tx: ReturnType<typeof admin.adminBoardSharingTx>) => Promise<T>) =>
      firestore.runTransaction((tx) => fn(admin.adminBoardSharingTx(firestore, tx)));
    const read = async () => (await firestore.collection('boards').doc(boardId).get()).data()!;

    const priv = await run((tx) =>
      logic.setBoardKindInTransaction(tx, 'boss', { boardId, kind: 'private' }),
    );
    expect(priv).toEqual({ kind: 'private', access: { boss: 'owner' } });
    let board = await read();
    expect(board).toMatchObject({
      kind: 'private',
      access: { boss: 'owner' },
      accessUids: ['boss'],
    });
    expect(board.updatedAt).toBeDefined();

    await run((tx) =>
      logic.setBoardAccessInTransaction(tx, 'boss', { boardId, uid: 'pal', role: 'editor' }),
    );
    board = await read();
    expect(board.access).toEqual({ boss: 'owner', pal: 'editor' });
    expect([...board.accessUids].sort()).toEqual(['boss', 'pal']);

    // the role cap and the last-owner rule hold through the real store
    await expect(
      run((tx) =>
        logic.setBoardAccessInTransaction(tx, 'boss', { boardId, uid: 'guest', role: 'editor' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      run((tx) => logic.leaveBoardInTransaction(tx, 'boss', { boardId })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const left = await run((tx) => logic.leaveBoardInTransaction(tx, 'pal', { boardId }));
    expect(left.access).toEqual({ boss: 'owner' });
    board = await read();
    expect(board.accessUids).toEqual(['boss']);
  });
});
