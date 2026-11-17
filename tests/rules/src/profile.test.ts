import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp, deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, WS, createTestEnv, seedFixture } from './helpers';

/**
 * TEAMS PR 4: `users/{uid}.profile` and `workspaces/{ws}/members/{uid}.profile` are written only by
 * the `setMyProfile` callable (Admin SDK). A client can write neither; only the person reads their
 * own user doc, and workspace members read the shared copy on the member doc.
 */

let env: RulesTestEnvironment;
const ts = Timestamp.fromMillis(1_700_000_000_000);
const profile = {
  title: 'Mom',
  about: 'Hello',
  location: 'Lyon',
  birthday: { month: 3, day: 12 },
  showLocalTime: true,
  updatedAt: ts,
};
const shared = {
  title: 'Mom',
  about: 'Hello',
  location: 'Lyon',
  birthday: { month: 3, day: 12 },
  timeZone: 'Europe/Paris',
  updatedAt: ts,
};

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
    await setDoc(doc(db, 'users', USERS.member), { profile }, { merge: true });
    await setDoc(doc(db, 'workspaces', WS, 'members', USERS.member), {
      displayName: 'Member',
      photoURL: null,
      email: 'member@example.com',
      role: 'member',
      joinedAt: ts,
      updatedAt: ts,
      profile: shared,
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const userRef = (uid: string, target: string) => doc(as(uid), 'users', target);
const memberRef = (uid: string, target: string) =>
  doc(as(uid), 'workspaces', WS, 'members', target);

describe('users/{uid}.profile', () => {
  it('lets only the person read it', async () => {
    await assertSucceeds(getDoc(userRef(USERS.member, USERS.member)));
    await assertFails(getDoc(userRef(USERS.owner, USERS.member)));
    await assertFails(getDoc(userRef(USERS.admin, USERS.member)));
  });

  it('refuses the person writing their own profile, alone or next to an allowed field', async () => {
    await assertFails(updateDoc(userRef(USERS.member, USERS.member), { profile: shared }));
    await assertFails(updateDoc(userRef(USERS.member, USERS.member), { 'profile.title': 'Boss' }));
    await assertFails(updateDoc(userRef(USERS.member, USERS.member), { profile: deleteField() }));
    await assertSucceeds(updateDoc(userRef(USERS.member, USERS.member), { theme: 'dark' }));
    await assertFails(
      updateDoc(userRef(USERS.member, USERS.member), { theme: 'dark', profile: shared }),
    );
  });

  it('refuses writing somebody else profile', async () => {
    await assertFails(updateDoc(userRef(USERS.owner, USERS.member), { profile: shared }));
    await assertFails(updateDoc(userRef(USERS.outsider, USERS.member), { profile: shared }));
  });
});

describe('members/{uid}.profile', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    'lets %s read the shared profile',
    async (uid) => {
      await assertSucceeds(getDoc(memberRef(uid, USERS.member)));
    },
  );

  it('refuses people outside the workspace reading it', async () => {
    await assertFails(getDoc(memberRef(USERS.outsider, USERS.member)));
  });

  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider])(
    'refuses a client write of profile from %s',
    async (uid) => {
      await assertFails(updateDoc(memberRef(uid, USERS.member), { profile: shared }));
      await assertFails(updateDoc(memberRef(uid, USERS.member), { 'profile.title': 'Boss' }));
      await assertFails(updateDoc(memberRef(uid, USERS.member), { profile: deleteField() }));
    },
  );
});
