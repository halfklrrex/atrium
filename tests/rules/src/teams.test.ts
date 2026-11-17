import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, WS, createTestEnv, seedFixture } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const path = (id: string) => `workspaces/${WS}/teams/${id}`;

/** A client-side create payload. */
function newTeam(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Kids',
    color: '#579bfc',
    memberUids: [USERS.member, USERS.viewer],
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

async function seedTeam(id: string, overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    await setDoc(doc(ctx.firestore(), path(id)), {
      ...newTeam(USERS.owner),
      createdAt: ts,
      updatedAt: ts,
      ...overrides,
    });
  });
}

describe('teams: read', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])('%s can read', async (uid) => {
    await seedTeam('t1');
    await assertSucceeds(getDoc(doc(as(uid), path('t1'))));
    await assertSucceeds(getDocs(collection(as(uid), `workspaces/${WS}/teams`)));
  });

  it('refuses outsiders and signed-out visitors', async () => {
    await seedTeam('t1');
    await assertFails(getDoc(doc(as(USERS.outsider), path('t1'))));
    await assertFails(getDocs(collection(as(USERS.outsider), `workspaces/${WS}/teams`)));
    await assertFails(getDoc(doc(anon(), path('t1'))));
  });
});

describe('teams: create', () => {
  it.each([USERS.owner, USERS.admin])('%s can create', async (uid) => {
    await assertSucceeds(setDoc(doc(as(uid), path('t1')), newTeam(uid)));
  });

  it('allows an empty team', async () => {
    await assertSucceeds(
      setDoc(doc(as(USERS.admin), path('t1')), newTeam(USERS.admin, { memberUids: [] })),
    );
  });

  it.each([USERS.member, USERS.viewer, USERS.outsider])('%s cannot create', async (uid) => {
    await assertFails(setDoc(doc(as(uid), path('t1')), newTeam(uid)));
  });

  it('refuses signed-out visitors', async () => {
    await assertFails(setDoc(doc(anon(), path('t1')), newTeam(USERS.admin)));
  });

  it('refuses forged authors and timestamps', async () => {
    const db = as(USERS.admin);
    await assertFails(setDoc(doc(db, path('a')), newTeam(USERS.admin, { createdBy: USERS.owner })));
    await assertFails(setDoc(doc(db, path('b')), newTeam(USERS.admin, { updatedBy: USERS.owner })));
    await assertFails(
      setDoc(
        doc(db, path('c')),
        newTeam(USERS.admin, { createdAt: Timestamp.fromMillis(1_700_000_000_000) }),
      ),
    );
  });

  it('refuses a non-member, duplicates, 101 members, a bad name, a bad color and extra keys', async () => {
    const db = as(USERS.admin);
    const refused = (overrides: Record<string, unknown>) =>
      assertFails(setDoc(doc(db, path('x')), newTeam(USERS.admin, overrides)));
    await refused({ memberUids: [USERS.outsider] });
    await refused({ memberUids: [USERS.member, USERS.member] });
    await refused({ memberUids: Array.from({ length: 101 }, (_, i) => `u${i}`) });
    await refused({ name: '' });
    await refused({ name: 'x'.repeat(61) });
    await refused({ color: 'blue' });
    await refused({ color: '#12345' });
    await refused({ extra: true });
    await refused({ memberUids: 'member' });
  });

  it('allows a 60-character name', async () => {
    await assertSucceeds(
      setDoc(doc(as(USERS.admin), path('t1')), newTeam(USERS.admin, { name: 'x'.repeat(60) })),
    );
  });
});

describe('teams: update and delete', () => {
  it.each([USERS.owner, USERS.admin])('%s can edit and delete', async (uid) => {
    await seedTeam('t1');
    await assertSucceeds(
      updateDoc(doc(as(uid), path('t1')), {
        name: 'Children',
        color: '#037f4c',
        memberUids: [USERS.member],
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    await assertSucceeds(deleteDoc(doc(as(uid), path('t1'))));
  });

  it.each([USERS.member, USERS.viewer, USERS.outsider])('%s cannot edit or delete', async (uid) => {
    await seedTeam('t1');
    await assertFails(
      updateDoc(doc(as(uid), path('t1')), {
        name: 'Nope',
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    await assertFails(deleteDoc(doc(as(uid), path('t1'))));
  });

  it('refuses changing createdBy, extra keys, forged updatedBy and a stale updatedAt', async () => {
    await seedTeam('t1');
    const db = as(USERS.admin);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: USERS.admin };
    await assertFails(updateDoc(doc(db, path('t1')), { ...stamp, createdBy: USERS.admin }));
    await assertFails(updateDoc(doc(db, path('t1')), { ...stamp, extra: 1 }));
    await assertFails(
      updateDoc(doc(db, path('t1')), { name: 'Y', updatedAt: serverTimestamp(), updatedBy: 'x' }),
    );
    await assertFails(
      updateDoc(doc(db, path('t1')), {
        name: 'Y',
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedBy: USERS.admin,
      }),
    );
  });

  it('refuses a non-member, duplicates and too many members on update', async () => {
    await seedTeam('t1');
    const db = as(USERS.admin);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: USERS.admin };
    await assertFails(
      updateDoc(doc(db, path('t1')), { ...stamp, memberUids: [USERS.member, USERS.outsider] }),
    );
    await assertFails(
      updateDoc(doc(db, path('t1')), { ...stamp, memberUids: [USERS.member, USERS.member] }),
    );
    await assertFails(
      updateDoc(doc(db, path('t1')), {
        ...stamp,
        memberUids: Array.from({ length: 101 }, (_, i) => `u${i}`),
      }),
    );
  });

  it('refuses a rename while the team still lists someone who left the workspace', async () => {
    await seedTeam('t1', { memberUids: [USERS.member, 'gone'] });
    await assertFails(
      updateDoc(doc(as(USERS.admin), path('t1')), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.admin,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(as(USERS.admin), path('t1')), {
        memberUids: [USERS.member],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.admin,
      }),
    );
  });
});
