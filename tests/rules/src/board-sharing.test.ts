import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAIN_BOARD,
  PRIVATE_BOARD,
  USERS,
  WS,
  boardDoc,
  createTestEnv,
  seedFixture,
} from './helpers';

/**
 * P4b board sharing: `access`, `accessUids` and `kind` are written only by the setBoardAccess,
 * setBoardKind and leaveBoard callables, and the callables rely on the read rules pinned here.
 * In the fixture PRIVATE_BOARD lists the owner (owner) and the member (viewer); admin and viewer
 * are workspace members who are not on it.
 */

let env: RulesTestEnvironment;
const VIEWER_RESTRICTED = 'boardMainViewerEntry';

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
    // A main board whose explicit entry restricts a workspace member to read-only.
    await setDoc(
      doc(ctx.firestore(), 'boards', VIEWER_RESTRICTED),
      boardDoc({ access: { [USERS.owner]: 'owner', [USERS.member]: 'viewer' } }),
    );
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('clients cannot write sharing fields on an existing board', () => {
  it('denies access, accessUids and kind changes, owners included', async () => {
    for (const [boardId, currentKind] of [
      [MAIN_BOARD, 'main'],
      [PRIVATE_BOARD, 'private'],
    ] as const) {
      const ref = doc(as(USERS.owner), 'boards', boardId);
      await assertFails(
        updateDoc(ref, {
          access: { [USERS.owner]: 'owner', [USERS.viewer]: 'editor' },
          accessUids: [USERS.owner, USERS.viewer],
          updatedAt: serverTimestamp(),
        }),
      );
      for (const kind of ['main', 'private', 'shareable'].filter((k) => k !== currentKind)) {
        await assertFails(updateDoc(ref, { kind, updatedAt: serverTimestamp() }));
      }
      await assertFails(
        updateDoc(ref, {
          accessUids: [USERS.owner, USERS.outsider],
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('denies workspace owners and admins changing a main board kind', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertFails(
        updateDoc(doc(as(uid), 'boards', MAIN_BOARD), {
          kind: 'private',
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('still lets an owner change ordinary fields', async () => {
    await assertSucceeds(
      updateDoc(doc(as(USERS.owner), 'boards', PRIVATE_BOARD), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('a private board stays hidden from workspace members who are not on it', () => {
  it('denies reading it, for admins and viewers too', async () => {
    for (const uid of [USERS.admin, USERS.viewer, USERS.outsider]) {
      await assertFails(getDoc(doc(as(uid), 'boards', PRIVATE_BOARD)));
    }
    await assertSucceeds(getDoc(doc(as(USERS.member), 'boards', PRIVATE_BOARD)));
  });

  it('keeps it out of both listable query shapes', async () => {
    for (const uid of [USERS.admin, USERS.viewer]) {
      const main = await assertSucceeds(
        getDocs(
          query(
            collection(as(uid), 'boards'),
            where('workspaceId', '==', WS),
            where('kind', '==', 'main'),
          ),
        ),
      );
      expect(main.docs.map((d) => d.id)).not.toContain(PRIVATE_BOARD);
      const mine = await assertSucceeds(
        getDocs(
          query(
            collection(as(uid), 'boards'),
            where('workspaceId', '==', WS),
            where('accessUids', 'array-contains', uid),
          ),
        ),
      );
      expect(mine.docs.map((d) => d.id)).not.toContain(PRIVATE_BOARD);
    }
    // asking for private boards without being on them is refused outright
    await assertFails(
      getDocs(
        query(
          collection(as(USERS.admin), 'boards'),
          where('workspaceId', '==', WS),
          where('kind', '==', 'private'),
        ),
      ),
    );
  });

  it('denies items of a private board to members who are not on it', async () => {
    await assertFails(getDoc(doc(as(USERS.admin), 'boards', PRIVATE_BOARD, 'items', 'i1')));
    await assertSucceeds(getDoc(doc(as(USERS.member), 'boards', PRIVATE_BOARD, 'items', 'i1')));
  });
});

describe('an explicit viewer entry on a main board stays read-only', () => {
  it('lets the restricted workspace member read but not edit the board', async () => {
    const db = as(USERS.member);
    await assertSucceeds(getDoc(doc(db, 'boards', VIEWER_RESTRICTED)));
    await assertFails(
      updateDoc(doc(db, 'boards', VIEWER_RESTRICTED), {
        name: 'Nope',
        updatedAt: serverTimestamp(),
      }),
    );
    // the same member is still an editor of the other main board
    await assertSucceeds(
      updateDoc(doc(db, 'boards', MAIN_BOARD), { name: 'Fine', updatedAt: serverTimestamp() }),
    );
  });
});
