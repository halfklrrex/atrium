import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  MAIN_BOARD,
  PRIVATE_BOARD,
  USERS,
  WS,
  createTestEnv,
  seedFixture,
  workspaceDoc,
} from './helpers';

/** P4a: workspace member profiles and invites are readable by role and never writable by clients. */

let env: RulesTestEnvironment;
const ts = Timestamp.fromMillis(1_700_000_000_000);
const REMOVED = 'removed';

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
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await setDoc(doc(db, 'workspaces', WS, 'members', uid), {
        displayName: `Name ${uid}`,
        photoURL: null,
        email: `${uid}@example.com`,
        role: uid,
        joinedAt: ts,
        updatedAt: ts,
      });
    }
    await setDoc(doc(db, 'workspaces', WS, 'invites', 'inv1'), {
      email: 'friend@example.com',
      role: 'member',
      invitedBy: USERS.owner,
      invitedByName: 'Name owner',
      workspaceName: 'Team',
      createdAt: ts,
      expiresAt: Timestamp.fromMillis(1_800_000_000_000),
      status: 'pending',
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const memberRef = (uid: string, target: string) =>
  doc(as(uid), 'workspaces', WS, 'members', target);
const inviteRef = (uid: string, id = 'inv1') => doc(as(uid), 'workspaces', WS, 'invites', id);

describe('workspace members (profiles)', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    'lets %s read member profiles',
    async (uid) => {
      await assertSucceeds(getDoc(memberRef(uid, USERS.member)));
      await assertSucceeds(getDocs(collection(as(uid), 'workspaces', WS, 'members')));
    },
  );

  it('refuses non-members and signed-out users', async () => {
    await assertFails(getDoc(memberRef(USERS.outsider, USERS.member)));
    await assertFails(getDocs(collection(as(USERS.outsider), 'workspaces', WS, 'members')));
    await assertFails(
      getDoc(
        doc(env.unauthenticatedContext().firestore(), 'workspaces', WS, 'members', USERS.member),
      ),
    );
  });

  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider])(
    'refuses client writes from %s',
    async (uid) => {
      const data = {
        displayName: 'X',
        photoURL: null,
        email: 'x@example.com',
        role: 'owner',
        joinedAt: ts,
        updatedAt: ts,
      };
      await assertFails(setDoc(memberRef(uid, 'new'), data));
      await assertFails(setDoc(memberRef(uid, uid), data));
      await assertFails(updateDoc(memberRef(uid, USERS.member), { displayName: 'Hacked' }));
      await assertFails(deleteDoc(memberRef(uid, USERS.member)));
    },
  );
});

describe('workspace invites', () => {
  it.each([USERS.owner, USERS.admin])('lets %s read invites', async (uid) => {
    await assertSucceeds(getDoc(inviteRef(uid)));
    await assertSucceeds(getDocs(collection(as(uid), 'workspaces', WS, 'invites')));
  });

  it.each([USERS.member, USERS.viewer, USERS.outsider])(
    'refuses %s reading invites',
    async (uid) => {
      await assertFails(getDoc(inviteRef(uid)));
      await assertFails(getDocs(collection(as(uid), 'workspaces', WS, 'invites')));
    },
  );

  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider])(
    'refuses client writes from %s',
    async (uid) => {
      const data = {
        email: 'a@example.com',
        role: 'admin',
        invitedBy: uid,
        invitedByName: 'X',
        workspaceName: 'Team',
        createdAt: ts,
        expiresAt: ts,
        status: 'pending',
      };
      await assertFails(setDoc(inviteRef(uid, 'new'), data));
      await assertFails(updateDoc(inviteRef(uid), { status: 'accepted' }));
      await assertFails(deleteDoc(inviteRef(uid)));
    },
  );
});

describe('after a member is removed', () => {
  beforeEach(async () => {
    // The state the removeMember callable leaves behind: gone from roles, memberIds and members, but
    // with stale board access entries (the cleanup there is housekeeping, rules already cut access).
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(
        doc(db, 'workspaces', WS),
        workspaceDoc({
          memberIds: [USERS.owner, USERS.admin, USERS.viewer],
          roles: { [USERS.owner]: 'owner', [USERS.admin]: 'admin', [USERS.viewer]: 'viewer' },
        }),
      );
      await deleteDoc(doc(db, 'workspaces', WS, 'members', USERS.member));
    });
  });

  it('cuts off the workspace, its boards and the members list', async () => {
    await assertFails(getDoc(doc(as(USERS.member), 'workspaces', WS)));
    await assertFails(getDoc(doc(as(USERS.member), 'boards', MAIN_BOARD)));
    await assertFails(getDoc(doc(as(USERS.member), 'boards', PRIVATE_BOARD)));
    await assertFails(getDoc(doc(as(USERS.member), 'boards', MAIN_BOARD, 'items', 'i1')));
    await assertFails(getDocs(collection(as(USERS.member), 'workspaces', WS, 'members')));
    await assertFails(getDoc(memberRef(USERS.member, USERS.owner)));
  });

  it('still lets the remaining members read the list', async () => {
    await assertSucceeds(getDocs(collection(as(USERS.viewer), 'workspaces', WS, 'members')));
  });

  it('refuses a REMOVED user id that was never a member', async () => {
    await assertFails(getDoc(memberRef(REMOVED, USERS.owner)));
  });
});
