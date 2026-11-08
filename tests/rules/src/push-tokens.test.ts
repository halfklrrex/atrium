import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, createTestEnv, seedFixture } from './helpers';

/**
 * PWA-2: `users/{uid}/pushTokens/{tokenId}` (one doc per device, id = sha-256 hex of the FCM token)
 * is owner-only, and `users/{uid}.notificationPrefs.push` is an optional map of six booleans.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const ME = USERS.member;
const ID = 'a'.repeat(64);
const OTHER_ID = 'b'.repeat(64);

const tokenData = (overrides: Record<string, unknown> = {}) => ({
  token: 'fcm-token-for-tests',
  userAgent: 'Mozilla/5.0 (Test) Safari',
  platform: 'ios',
  createdAt: serverTimestamp(),
  lastSeenAt: serverTimestamp(),
  ...overrides,
});

const seededTokenData = () => ({
  ...tokenData(),
  createdAt: Timestamp.fromMillis(1_000),
  lastSeenAt: Timestamp.fromMillis(1_000),
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ME, 'pushTokens', ID), seededTokenData());
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const tokenRef = (db: ReturnType<typeof anon>, id = ID, owner: string = ME) =>
  doc(db, 'users', owner, 'pushTokens', id);

describe('users/{uid}/pushTokens: the owner', () => {
  it('reads and lists their own tokens', async () => {
    await assertSucceeds(getDoc(tokenRef(as(ME))));
    await assertSucceeds(getDocs(collection(as(ME), 'users', ME, 'pushTokens')));
  });

  it('creates a valid token doc on every platform', async () => {
    for (const platform of ['ios', 'android', 'desktop']) {
      await assertSucceeds(setDoc(tokenRef(as(ME), OTHER_ID), tokenData({ platform })));
      await deleteDoc(tokenRef(as(ME), OTHER_ID));
    }
  });

  it('accepts a token at the size limits', async () => {
    await assertSucceeds(
      setDoc(
        tokenRef(as(ME), OTHER_ID),
        tokenData({ token: 'x'.repeat(4096), userAgent: 'u'.repeat(200) }),
      ),
    );
  });

  it('refreshes lastSeenAt to the server time', async () => {
    await assertSucceeds(updateDoc(tokenRef(as(ME)), { lastSeenAt: serverTimestamp() }));
  });

  it('deletes their own token', async () => {
    await assertSucceeds(deleteDoc(tokenRef(as(ME))));
  });
});

describe('users/{uid}/pushTokens: shape and limits on create', () => {
  const create = (data: Record<string, unknown>, id = OTHER_ID) =>
    setDoc(tokenRef(as(ME), id), data);

  it('refuses an id that is not 64 lowercase hex chars', async () => {
    for (const id of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 'device-1']) {
      await assertFails(create(tokenData(), id));
    }
  });

  it('refuses an extra key and a missing key', async () => {
    await assertFails(create(tokenData({ extra: true })));
    for (const key of ['token', 'userAgent', 'platform', 'createdAt', 'lastSeenAt']) {
      const data: Record<string, unknown> = tokenData();
      delete data[key];
      await assertFails(create(data));
    }
  });

  it('refuses an empty, oversized or non-string token and userAgent', async () => {
    await assertFails(create(tokenData({ token: '' })));
    await assertFails(create(tokenData({ token: 'x'.repeat(4097) })));
    await assertFails(create(tokenData({ token: 42 })));
    await assertFails(create(tokenData({ userAgent: 'u'.repeat(201) })));
    await assertFails(create(tokenData({ userAgent: 42 })));
  });

  it('refuses a bad platform', async () => {
    await assertFails(create(tokenData({ platform: 'tv' })));
    await assertFails(create(tokenData({ platform: 'IOS' })));
    await assertFails(create(tokenData({ platform: 1 })));
  });

  it('refuses client-supplied timestamps that are not the server time', async () => {
    const past = Timestamp.fromMillis(1_000);
    await assertFails(create(tokenData({ createdAt: past })));
    await assertFails(create(tokenData({ lastSeenAt: past })));
    await assertFails(create(tokenData({ createdAt: 'now' })));
  });
});

describe('users/{uid}/pushTokens: updates change lastSeenAt only', () => {
  const update = (data: Record<string, unknown>) => updateDoc(tokenRef(as(ME)), data);

  it('refuses changing the token, userAgent, platform or createdAt', async () => {
    await assertFails(update({ token: 'another-token' }));
    await assertFails(update({ userAgent: 'other' }));
    await assertFails(update({ platform: 'android' }));
    await assertFails(update({ createdAt: serverTimestamp() }));
  });

  it('refuses a lastSeenAt that is not the server time', async () => {
    await assertFails(update({ lastSeenAt: Timestamp.fromMillis(5_000) }));
  });

  it('refuses lastSeenAt together with another change, or an extra key', async () => {
    await assertFails(update({ lastSeenAt: serverTimestamp(), token: 'another-token' }));
    await assertFails(update({ lastSeenAt: serverTimestamp(), extra: true }));
  });
});

describe('users/{uid}/pushTokens: nobody else', () => {
  const callers: Array<[string, () => ReturnType<typeof anon>]> = [
    ['another approved user', () => as(USERS.owner)],
    ['a workspace admin', () => as(USERS.admin)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a blocked account', () => as(ME, { acct: 'blocked' })],
    ['a pending account', () => as(ME, { acct: 'pending' })],
    ['a signed-in account without a status', () => as(ME, { acct: undefined })],
    ['an anonymous caller', () => anon()],
  ];

  for (const [label, db] of callers) {
    it(`refuses ${label}: get, list, create, update, delete`, async () => {
      // `as(ME, ...)` callers above are the owner with a bad account state; the others use their own
      // uid, so both are checked against the owner's path.
      await assertFails(getDoc(tokenRef(db())));
      await assertFails(getDocs(collection(db(), 'users', ME, 'pushTokens')));
      await assertFails(setDoc(tokenRef(db(), OTHER_ID), tokenData()));
      await assertFails(updateDoc(tokenRef(db()), { lastSeenAt: serverTimestamp() }));
      await assertFails(deleteDoc(tokenRef(db())));
    });
  }

  it('refuses a collection-group query, for the owner too', async () => {
    await assertFails(getDocs(collectionGroup(as(ME), 'pushTokens')));
    await assertFails(getDocs(collectionGroup(as(USERS.owner), 'pushTokens')));
    await assertFails(getDocs(collectionGroup(anon(), 'pushTokens')));
  });

  it('keeps the doc after every refused delete', async () => {
    await assertFails(deleteDoc(tokenRef(as(USERS.owner))));
    await assertSucceeds(getDoc(tokenRef(as(ME))));
  });
});

describe('users/{uid}.notificationPrefs.push', () => {
  const ref = () => doc(as(ME), 'users', ME);
  const base = { assigned: true, reply: true, mention: true };
  const push = {
    assigned: true,
    reply: true,
    mention: true,
    button: true,
    automation: false,
    account: true,
    inbox: true,
  };

  it('accepts a push map of exactly the seven booleans', async () => {
    await assertSucceeds(updateDoc(ref(), { notificationPrefs: { ...base, push } }));
  });

  it('still accepts prefs without push', async () => {
    await assertSucceeds(updateDoc(ref(), { notificationPrefs: base }));
    await assertSucceeds(
      updateDoc(ref(), { notificationPrefs: { ...base, button: true, automation: false } }),
    );
  });

  it('refuses an unknown push key', async () => {
    await assertFails(
      updateDoc(ref(), { notificationPrefs: { ...base, push: { ...push, email: true } } }),
    );
  });

  it('refuses a non-boolean push value', async () => {
    await assertFails(
      updateDoc(ref(), { notificationPrefs: { ...base, push: { ...push, account: 'yes' } } }),
    );
  });

  it('refuses a push map with a missing key, an empty map or a non-map', async () => {
    const { account: _account, ...missing } = push;
    await assertFails(updateDoc(ref(), { notificationPrefs: { ...base, push: missing } }));
    // The old six-key map (no `inbox`) is refused.
    const { inbox: _inbox, ...sixKeys } = push;
    await assertFails(updateDoc(ref(), { notificationPrefs: { ...base, push: sixKeys } }));
    await assertFails(
      updateDoc(ref(), { notificationPrefs: { ...base, push: { ...push, inbox: 'yes' } } }),
    );
    await assertFails(updateDoc(ref(), { notificationPrefs: { ...base, push: {} } }));
    await assertFails(updateDoc(ref(), { notificationPrefs: { ...base, push: true } }));
  });

  it("refuses another user's push prefs", async () => {
    await assertFails(
      updateDoc(doc(as(USERS.owner), 'users', ME), { notificationPrefs: { ...base, push } }),
    );
  });
});
