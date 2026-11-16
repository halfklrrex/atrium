import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * Vote integrity: a write to a vote column's cell may only add or remove the writer's own uid in
 * `values.<id>.votersIds`. The vote columns are `boards.voteColumnIds`, maintained by the
 * onBoardColumnsWritten function (never a client). The Admin SDK (MCP connector) bypasses rules.
 */

let env: RulesTestEnvironment;

const BOARD = 'boardVote';
/** A board from before voteColumnIds: the field is missing, so nothing is protected (as before). */
const LEGACY = 'boardVoteLegacy';
const MANY = 'boardVoteMany';

const columns = [
  { id: 'vote', type: 'vote', title: 'Vote', position: 'a0', settings: {} },
  { id: 'note', type: 'text', title: 'Note', position: 'a1', settings: {} },
];
const subitemColumns = [{ id: 'svote', type: 'vote', title: 'Vote', position: 'a0', settings: {} }];

// 11 vote columns: the rules check the first 10 and refuse writes to the 11th (fail closed).
const manyColumns = Array.from({ length: 11 }, (_, i) => ({
  id: `v${String(i).padStart(2, '0')}`,
  type: 'vote',
  title: `V${i}`,
  position: `a${i}`,
  settings: {},
}));

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({ columns, subitemColumns, voteColumnIds: ['svote', 'vote'] }),
    );
    await setDoc(
      doc(db, 'boards', BOARD, 'items', 'i1'),
      itemDoc({
        values: { vote: { votersIds: [USERS.owner, USERS.admin] }, note: 'hello' },
      }),
    );
    await setDoc(doc(db, 'boards', BOARD, 'items', 'empty'), itemDoc({ values: {} }));
    await setDoc(
      doc(db, 'boards', BOARD, 'items', 'sub1'),
      itemDoc({ parentItemId: 'i1', values: { svote: { votersIds: [USERS.owner] } } }),
    );
    const legacy = boardDoc({ columns }); // the helper has no voteColumnIds
    await setDoc(doc(db, 'boards', LEGACY), legacy);
    await setDoc(
      doc(db, 'boards', LEGACY, 'items', 'i1'),
      itemDoc({ values: { vote: { votersIds: [USERS.owner] } } }),
    );
    await setDoc(
      doc(db, 'boards', MANY),
      boardDoc({ columns: manyColumns, voteColumnIds: manyColumns.map((c) => c.id) }),
    );
    await setDoc(doc(db, 'boards', MANY, 'items', 'i1'), itemDoc({ values: {} }));
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const itemRef = (uid: string, boardId = BOARD, id = 'i1') =>
  doc(as(uid), 'boards', boardId, 'items', id);
const boardRef = (uid: string, id = BOARD) => doc(as(uid), 'boards', id);

/** The audit fields every item update must carry. */
const audit = (uid: string) => ['updatedAt', serverTimestamp(), 'updatedBy', uid] as const;

/** Field-path write of a whole cell, as the board table sends it. */
const writeCell = (uid: string, id: string, value: unknown, boardId = BOARD, itemId = 'i1') =>
  updateDoc(itemRef(uid, boardId, itemId), new FieldPath('values', id), value, ...audit(uid));

/** The web's toggleVote: arrayUnion / arrayRemove on `values.<id>.votersIds`. */
const toggle = (uid: string, voteId: string, add: boolean, boardId = BOARD, itemId = 'i1') =>
  updateDoc(
    itemRef(uid, boardId, itemId),
    new FieldPath('values', voteId, 'votersIds'),
    add ? arrayUnion(uid) : arrayRemove(uid),
    ...audit(uid),
  );

describe('adding and removing your own vote', () => {
  it('lets an editor add and remove their own uid (the web toggleVote)', async () => {
    await assertSucceeds(toggle(USERS.member, 'vote', true));
    await assertSucceeds(toggle(USERS.admin, 'vote', false));
  });

  it('lets an editor write the whole cell when only their own uid changes', async () => {
    await assertSucceeds(
      writeCell(USERS.member, 'vote', { votersIds: [USERS.owner, USERS.admin, USERS.member] }),
    );
  });

  it('lets an editor remove their own uid by writing the whole cell', async () => {
    await assertSucceeds(writeCell(USERS.admin, 'vote', { votersIds: [USERS.owner] }));
  });

  it('lets an editor cast the first vote on an item with no cell, and remove it again', async () => {
    await assertSucceeds(toggle(USERS.member, 'vote', true, BOARD, 'empty'));
    await assertSucceeds(toggle(USERS.member, 'vote', false, BOARD, 'empty'));
  });

  it('lets the last voter remove their vote by deleting the cell', async () => {
    await assertSucceeds(writeCell(USERS.owner, 'svote', deleteField(), BOARD, 'sub1'));
  });

  it('is a no-op to vote twice or unvote without a vote', async () => {
    await assertSucceeds(toggle(USERS.owner, 'vote', true));
    await assertSucceeds(toggle(USERS.member, 'vote', false));
  });
});

describe('what is refused', () => {
  it('refuses voting as someone else', async () => {
    await assertFails(
      writeCell(USERS.member, 'vote', { votersIds: [USERS.owner, USERS.admin, 'someoneElse'] }),
    );
    await assertFails(
      updateDoc(
        itemRef(USERS.member),
        new FieldPath('values', 'vote', 'votersIds'),
        arrayUnion(USERS.admin, 'someoneElse'),
        ...audit(USERS.member),
      ),
    );
  });

  it('refuses removing someone else, and clearing all votes', async () => {
    await assertFails(writeCell(USERS.member, 'vote', { votersIds: [USERS.owner] }));
    await assertFails(writeCell(USERS.member, 'vote', { votersIds: [] }));
    await assertFails(writeCell(USERS.member, 'vote', deleteField()));
    await assertFails(writeCell(USERS.member, 'vote', null));
  });

  it('refuses replacing the whole list, even with the writer included', async () => {
    await assertFails(writeCell(USERS.member, 'vote', { votersIds: [USERS.member] }));
    await assertFails(writeCell(USERS.admin, 'vote', { votersIds: ['x', 'y'] }));
  });

  it('refuses adding and removing in the same write', async () => {
    // admin removes their own uid and adds member's: two changes in one write.
    await assertFails(writeCell(USERS.admin, 'vote', { votersIds: [USERS.owner, USERS.member] }));
  });

  it('refuses duplicates, extra keys and the wrong shape', async () => {
    await assertFails(
      writeCell(USERS.member, 'vote', {
        votersIds: [USERS.owner, USERS.admin, USERS.member, USERS.member],
      }),
    );
    await assertFails(
      writeCell(USERS.member, 'vote', {
        votersIds: [USERS.owner, USERS.admin, USERS.member],
        extra: 1,
      }),
    );
    await assertFails(writeCell(USERS.member, 'vote', 'nope'));
    await assertFails(writeCell(USERS.member, 'vote', [USERS.owner, USERS.admin, USERS.member]));
    await assertFails(writeCell(USERS.member, 'vote', { votersIds: 'member' }, BOARD, 'empty'));
  });

  it('refuses a viewer and an outsider voting', async () => {
    await assertFails(toggle(USERS.viewer, 'vote', true));
    await assertFails(toggle(USERS.outsider, 'vote', true));
  });

  it('refuses a sub-item vote cell rewrite, and allows the own vote there', async () => {
    await assertFails(
      writeCell(USERS.member, 'svote', { votersIds: [USERS.member] }, BOARD, 'sub1'),
    );
    await assertFails(writeCell(USERS.member, 'svote', { votersIds: [] }, BOARD, 'sub1'));
    await assertSucceeds(toggle(USERS.member, 'svote', true, BOARD, 'sub1'));
    await assertSucceeds(toggle(USERS.owner, 'svote', false, BOARD, 'sub1'));
  });

  it('refuses a write touching a vote column beyond the 10 the rules check (fail closed)', async () => {
    await assertSucceeds(toggle(USERS.member, 'v09', true, MANY));
    await assertFails(toggle(USERS.member, 'v10', true, MANY));
  });

  it('refuses a vote change bundled with an ordinary cell edit', async () => {
    await assertFails(
      updateDoc(
        itemRef(USERS.member),
        new FieldPath('values', 'note'),
        'edited',
        new FieldPath('values', 'vote'),
        { votersIds: [] },
        ...audit(USERS.member),
      ),
    );
    await assertSucceeds(
      updateDoc(
        itemRef(USERS.member),
        new FieldPath('values', 'note'),
        'edited',
        new FieldPath('values', 'vote', 'votersIds'),
        arrayUnion(USERS.member),
        ...audit(USERS.member),
      ),
    );
  });
});

describe('everything else is unaffected', () => {
  it('lets an editor change non-vote columns, rename, move and archive', async () => {
    await assertSucceeds(writeCell(USERS.member, 'note', 'new text'));
    await assertSucceeds(
      updateDoc(itemRef(USERS.member), 'name', 'Renamed', ...audit(USERS.member)),
    );
    await assertSucceeds(
      updateDoc(itemRef(USERS.admin), 'state', 'archived', ...audit(USERS.admin)),
    );
  });

  it('does not protect boards without voteColumnIds (as before the backfill)', async () => {
    await assertSucceeds(writeCell(USERS.member, 'vote', { votersIds: [] }, LEGACY));
  });

  it('keeps voteColumnIds server-maintained: clients cannot write it', async () => {
    await assertFails(
      updateDoc(boardRef(USERS.owner), 'voteColumnIds', [], 'updatedBy', USERS.owner),
    );
    await assertFails(
      updateDoc(boardRef(USERS.owner), 'voteColumnIds', ['note'], 'updatedBy', USERS.owner),
    );
  });
});

describe('item and board create', () => {
  const newItem = (uid: string, values: Record<string, unknown>) =>
    itemDoc({
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      values,
    });

  it('accepts an item with no vote, an empty vote or only the creator', async () => {
    await assertSucceeds(setDoc(itemRef(USERS.member, BOARD, 'n1'), newItem(USERS.member, {})));
    await assertSucceeds(
      setDoc(
        itemRef(USERS.member, BOARD, 'n2'),
        newItem(USERS.member, { vote: { votersIds: [] } }),
      ),
    );
    await assertSucceeds(
      setDoc(
        itemRef(USERS.member, BOARD, 'n3'),
        newItem(USERS.member, { vote: { votersIds: [USERS.member] } }),
      ),
    );
  });

  it('refuses an item created with other voters (a duplicate must start with none)', async () => {
    await assertFails(
      setDoc(
        itemRef(USERS.member, BOARD, 'n4'),
        newItem(USERS.member, { vote: { votersIds: [USERS.owner] } }),
      ),
    );
    await assertFails(
      setDoc(
        itemRef(USERS.member, BOARD, 'n5'),
        newItem(USERS.member, { vote: { votersIds: [USERS.member, USERS.owner] } }),
      ),
    );
    await assertFails(
      setDoc(itemRef(USERS.member, BOARD, 'n6'), newItem(USERS.member, { vote: 'x' })),
    );
  });

  it('accepts a sub-item with its own vote and refuses one with others', async () => {
    await assertSucceeds(
      setDoc(itemRef(USERS.member, BOARD, 's1'), {
        ...newItem(USERS.member, { svote: { votersIds: [USERS.member] } }),
        parentItemId: 'i1',
      }),
    );
    await assertFails(
      setDoc(itemRef(USERS.member, BOARD, 's2'), {
        ...newItem(USERS.member, { svote: { votersIds: [USERS.owner] } }),
        parentItemId: 'i1',
      }),
    );
  });

  it('lets a client create a board with voteColumnIds [] or without it, never filled', async () => {
    const board = (extra: Record<string, unknown>) => {
      const rest = boardDoc({
        access: { [USERS.member]: 'owner' },
        createdBy: USERS.member,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { ...rest, ...extra };
    };
    await assertSucceeds(setDoc(boardRef(USERS.member, 'nb1'), board({})));
    await assertSucceeds(setDoc(boardRef(USERS.member, 'nb2'), board({ voteColumnIds: [] })));
    await assertFails(setDoc(boardRef(USERS.member, 'nb3'), board({ voteColumnIds: ['vote'] })));
  });
});
