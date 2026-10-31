import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteField,
  doc,
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
  createTestEnv,
  itemDoc,
  seedFixture,
  workspaceDoc,
} from './helpers';

/**
 * P3 My Work and global search: `assigneeUids` and `nameTokens` are index fields only Cloud
 * Functions write (the Admin SDK bypasses rules). They are in neither item key list, so clients
 * can't create, change or remove them. Reads are the per-board queries the existing
 * `canReadBoard` rule already authorises; there is no collection-group `items` match.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const indexed = (overrides: Record<string, unknown> = {}) =>
  itemDoc({
    name: 'Plan Q3',
    assigneeUids: [USERS.member],
    nameTokens: ['pl', 'pla', 'plan', 'q3'],
    ...overrides,
  });

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'indexed'), indexed());
    await setDoc(doc(db, 'boards', PRIVATE_BOARD, 'items', 'indexed'), indexed());
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const itemRef = (uid: string, id: string, board = MAIN_BOARD) =>
  doc(as(uid), 'boards', board, 'items', id);

const newItem = (uid: string, overrides: Record<string, unknown> = {}) =>
  itemDoc({
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

const audit = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

describe('assigneeUids and nameTokens are server-maintained', () => {
  it('lets an editor create an item without them', async () => {
    await assertSucceeds(setDoc(itemRef(USERS.member, 'plain'), newItem(USERS.member)));
  });

  it('denies creating an item with either field', async () => {
    for (const [id, extra] of [
      ['a', { assigneeUids: [USERS.member] }],
      ['b', { nameTokens: ['it'] }],
      ['c', { assigneeUids: [], nameTokens: [] }],
    ] as const) {
      await assertFails(setDoc(itemRef(USERS.member, id), newItem(USERS.member, extra)));
    }
  });

  it('denies changing or removing either field, even for the board owner', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      for (const field of ['assigneeUids', 'nameTokens']) {
        await assertFails(updateDoc(itemRef(uid, 'indexed'), { [field]: ['x1'], ...audit(uid) }));
        await assertFails(
          updateDoc(itemRef(uid, 'indexed'), { [field]: deleteField(), ...audit(uid) }),
        );
      }
    }
  });

  it('denies adding them to an item that has none', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'i1'), {
        assigneeUids: [USERS.member],
        ...audit(USERS.member),
      }),
    );
    await assertFails(
      updateDoc(itemRef(USERS.member, 'i1'), { nameTokens: ['it'], ...audit(USERS.member) }),
    );
  });

  it('denies smuggling them in with a legitimate edit', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'indexed'), {
        name: 'Renamed',
        nameTokens: ['re'],
        ...audit(USERS.member),
      }),
    );
  });

  it('still allows a normal rename of an indexed item', async () => {
    await assertSucceeds(
      updateDoc(itemRef(USERS.member, 'indexed'), { name: 'Renamed', ...audit(USERS.member) }),
    );
  });
});

describe('per-board index queries follow board access', () => {
  const byAssignee = (uid: string, board: string) =>
    query(
      collection(as(uid), 'boards', board, 'items'),
      where('assigneeUids', 'array-contains', uid),
      where('state', '==', 'active'),
    );
  const byToken = (uid: string, board: string) =>
    query(
      collection(as(uid), 'boards', board, 'items'),
      where('nameTokens', 'array-contains', 'plan'),
      where('state', '==', 'active'),
    );

  it('lets a workspace member run both queries on a main board', async () => {
    const mine = await assertSucceeds(getDocs(byAssignee(USERS.member, MAIN_BOARD)));
    expect(mine.docs.map((d) => d.id)).toEqual(['indexed']);
    const found = await assertSucceeds(getDocs(byToken(USERS.viewer, MAIN_BOARD)));
    expect(found.docs.map((d) => d.id)).toEqual(['indexed']);
  });

  it('lets a member of a private board run them there', async () => {
    await assertSucceeds(getDocs(byAssignee(USERS.member, PRIVATE_BOARD)));
    await assertSucceeds(getDocs(byToken(USERS.member, PRIVATE_BOARD)));
  });

  it('denies both on a private board the user is not on, even a workspace admin', async () => {
    for (const uid of [USERS.admin, USERS.viewer, USERS.outsider]) {
      await assertFails(getDocs(byAssignee(uid, PRIVATE_BOARD)));
      await assertFails(getDocs(byToken(uid, PRIVATE_BOARD)));
    }
  });

  it('denies both on a main board to someone outside the workspace', async () => {
    await assertFails(getDocs(byAssignee(USERS.outsider, MAIN_BOARD)));
    await assertFails(getDocs(byToken(USERS.outsider, MAIN_BOARD)));
  });

  it('denies both after the user is removed from the workspace', async () => {
    await assertSucceeds(getDocs(byAssignee(USERS.member, MAIN_BOARD)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'workspaces', WS),
        workspaceDoc({
          memberIds: [USERS.owner, USERS.admin, USERS.viewer],
          roles: { [USERS.owner]: 'owner', [USERS.admin]: 'admin', [USERS.viewer]: 'viewer' },
        }),
      );
    });
    await assertFails(getDocs(byAssignee(USERS.member, MAIN_BOARD)));
    await assertFails(getDocs(byToken(USERS.member, MAIN_BOARD)));
  });

  it('denies both on a private board after the user is removed from its access list', async () => {
    await assertSucceeds(getDocs(byAssignee(USERS.member, PRIVATE_BOARD)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'boards', PRIVATE_BOARD), {
        access: { [USERS.owner]: 'owner' },
        accessUids: [USERS.owner],
      });
    });
    await assertFails(getDocs(byAssignee(USERS.member, PRIVATE_BOARD)));
    await assertFails(getDocs(byToken(USERS.member, PRIVATE_BOARD)));
  });
});

describe('collection-group items queries stay denied', () => {
  it('denies assigneeUids and nameTokens collection-group queries', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      await assertFails(
        getDocs(
          query(collectionGroup(as(uid), 'items'), where('assigneeUids', 'array-contains', uid)),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collectionGroup(as(uid), 'items'),
            where('nameTokens', 'array-contains', 'plan'),
            where('state', '==', 'active'),
          ),
        ),
      );
    }
  });
});
