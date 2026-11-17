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

const seedTs = Timestamp.fromMillis(1_700_000_000_000);
const as = (uid: string) =>
  env
    .authenticatedContext(uid, { name: `User ${uid}`, picture: `https://example.com/${uid}.png` })
    .firestore();
const anon = () => env.unauthenticatedContext().firestore();
const presenceRef = (db: ReturnType<typeof as>, docId: string, uid: string) =>
  doc(db, 'docs', docId, 'presence', uid);

const payload = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid,
  displayName: `User ${uid}`,
  photoURL: `https://example.com/${uid}.png`,
  lastActiveAt: serverTimestamp(),
  expiresAt: new Date(Date.now() + 3600 * 1000),
  ...overrides,
});

async function seedDoc(id: string, kind: 'main' | 'private', access: Record<string, string>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'docs', id), {
      workspaceId: WS,
      folderId: null,
      name: 'Packing list',
      kind,
      access,
      accessUids: Object.keys(access),
      position: 'a0',
      icon: null,
      state: 'active',
      deletedAt: null,
      createdAt: seedTs,
      createdBy: USERS.owner,
      updatedAt: seedTs,
    });
  });
}

async function seedPresence(id: string, uid: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(presenceRef(ctx.firestore(), id, uid), {
      uid,
      displayName: `User ${uid}`,
      photoURL: null,
      lastActiveAt: seedTs,
      expiresAt: seedTs,
    });
  });
}

describe('doc presence: read', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    '%s reads and lists presence on a main doc',
    async (uid) => {
      await seedDoc('d1', 'main', { [USERS.owner]: 'owner' });
      await seedPresence('d1', USERS.owner);
      await assertSucceeds(getDoc(presenceRef(as(uid), 'd1', USERS.owner)));
      await assertSucceeds(getDocs(collection(as(uid), 'docs', 'd1', 'presence')));
    },
  );

  it('refuses outsiders and signed-out users', async () => {
    await seedDoc('d1', 'main', { [USERS.owner]: 'owner' });
    await seedPresence('d1', USERS.owner);
    await assertFails(getDoc(presenceRef(as(USERS.outsider), 'd1', USERS.owner)));
    await assertFails(getDocs(collection(as(USERS.outsider), 'docs', 'd1', 'presence')));
    await assertFails(getDoc(presenceRef(anon(), 'd1', USERS.owner)));
  });

  it('limits a private doc to the people on its access list', async () => {
    await seedDoc('d1', 'private', { [USERS.owner]: 'owner', [USERS.member]: 'viewer' });
    await seedPresence('d1', USERS.owner);
    await assertSucceeds(getDoc(presenceRef(as(USERS.member), 'd1', USERS.owner)));
    await assertFails(getDoc(presenceRef(as(USERS.admin), 'd1', USERS.owner)));
    await assertFails(getDocs(collection(as(USERS.viewer), 'docs', 'd1', 'presence')));
  });
});

describe('doc presence: write', () => {
  beforeEach(async () => {
    await seedDoc('d1', 'main', { [USERS.owner]: 'owner' });
  });

  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    '%s writes, heartbeats and deletes their own record',
    async (uid) => {
      const ref = presenceRef(as(uid), 'd1', uid);
      await assertSucceeds(setDoc(ref, payload(uid)));
      await assertSucceeds(updateDoc(ref, { lastActiveAt: serverTimestamp() }));
      await assertSucceeds(deleteDoc(ref));
    },
  );

  it("refuses writing or deleting somebody else's record", async () => {
    await seedPresence('d1', USERS.owner);
    await assertFails(
      setDoc(presenceRef(as(USERS.member), 'd1', USERS.owner), payload(USERS.owner)),
    );
    await assertFails(
      setDoc(presenceRef(as(USERS.member), 'd1', USERS.member), payload(USERS.owner)),
    );
    await assertFails(deleteDoc(presenceRef(as(USERS.member), 'd1', USERS.owner)));
  });

  it('refuses outsiders and signed-out users', async () => {
    await assertFails(
      setDoc(presenceRef(as(USERS.outsider), 'd1', USERS.outsider), payload(USERS.outsider)),
    );
    await assertFails(setDoc(presenceRef(anon(), 'd1', USERS.owner), payload(USERS.owner)));
  });

  it('refuses presence on a doc that does not exist', async () => {
    await assertFails(
      setDoc(presenceRef(as(USERS.member), 'missing', USERS.member), payload(USERS.member)),
    );
    await assertFails(getDoc(presenceRef(as(USERS.member), 'missing', USERS.member)));
  });

  it('refuses a member without access to a private doc', async () => {
    await seedDoc('d2', 'private', { [USERS.owner]: 'owner' });
    await assertFails(
      setDoc(presenceRef(as(USERS.member), 'd2', USERS.member), payload(USERS.member)),
    );
  });

  it('refuses a forged name, photo, uid, timestamp, expiry or extra field', async () => {
    const ref = presenceRef(as(USERS.member), 'd1', USERS.member);
    await assertFails(setDoc(ref, payload(USERS.member, { displayName: 'Somebody else' })));
    await assertFails(
      setDoc(ref, payload(USERS.member, { photoURL: 'https://example.com/x.png' })),
    );
    await assertFails(setDoc(ref, payload(USERS.member, { uid: USERS.owner })));
    await assertFails(setDoc(ref, payload(USERS.member, { lastActiveAt: new Date(0) })));
    await assertFails(
      setDoc(ref, payload(USERS.member, { expiresAt: new Date(Date.now() + 3 * 3600 * 1000) })),
    );
    await assertFails(setDoc(ref, payload(USERS.member, { role: 'owner' })));
    await assertSucceeds(setDoc(ref, payload(USERS.member)));
  });
});
