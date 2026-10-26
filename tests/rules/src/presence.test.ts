import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, PRIVATE_BOARD, USERS, createTestEnv, seedFixture } from './helpers';

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

const as = (
  uid: string,
  token: { name?: string; picture?: string } = {
    name: `User ${uid}`,
    picture: `https://example.com/${uid}.png`,
  },
) => env.authenticatedContext(uid, token).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('board presence security rules', () => {
  const presencePayload = (
    uid: string,
    name: string = `User ${uid}`,
    picture: string = `https://example.com/${uid}.png`,
    expiresAt: unknown = new Date(Date.now() + 3600 * 1000),
  ) => ({
    uid,
    displayName: name,
    photoURL: picture,
    lastActiveAt: serverTimestamp(),
    expiresAt,
  });

  describe('reading presence', () => {
    it('allows board members and viewers to read presence on a main board', async () => {
      // Seed a presence doc as admin
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), `boards/${MAIN_BOARD}/presence/${USERS.owner}`), {
          uid: USERS.owner,
          displayName: 'Owner',
          photoURL: null,
          lastActiveAt: new Date(),
        });
      });

      const presenceRef = (uid: string) =>
        doc(as(uid), `boards/${MAIN_BOARD}/presence/${USERS.owner}`);

      // All workspace members (including viewers) can read main board presence
      await assertSucceeds(getDoc(presenceRef(USERS.owner)));
      await assertSucceeds(getDoc(presenceRef(USERS.admin)));
      await assertSucceeds(getDoc(presenceRef(USERS.member)));
      await assertSucceeds(getDoc(presenceRef(USERS.viewer)));

      // And can list presence
      await assertSucceeds(getDocs(collection(as(USERS.viewer), `boards/${MAIN_BOARD}/presence`)));
    });

    it('denies outsiders and unauthenticated users from reading presence', async () => {
      await assertFails(
        getDoc(doc(as(USERS.outsider), `boards/${MAIN_BOARD}/presence/${USERS.owner}`)),
      );
      await assertFails(getDocs(collection(as(USERS.outsider), `boards/${MAIN_BOARD}/presence`)));
      await assertFails(getDoc(doc(anon(), `boards/${MAIN_BOARD}/presence/${USERS.owner}`)));
    });

    it('limits reading presence on private boards to authorized board members', async () => {
      // In seedFixture, PRIVATE_BOARD has access for USERS.owner ('owner') and USERS.member ('viewer').
      // USERS.admin and USERS.viewer are not in the access list.
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`), {
          uid: USERS.owner,
          displayName: 'Owner',
          photoURL: null,
          lastActiveAt: new Date(),
        });
      });

      // Users on the board access list can read
      await assertSucceeds(
        getDoc(doc(as(USERS.owner), `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`)),
      );
      await assertSucceeds(
        getDoc(doc(as(USERS.member), `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`)),
      );

      // Other workspace members (admin, viewer) without board access cannot read
      await assertFails(
        getDoc(doc(as(USERS.admin), `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`)),
      );
      await assertFails(
        getDoc(doc(as(USERS.viewer), `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`)),
      );
    });
  });

  describe('writing presence', () => {
    it('allows a user to create, update and delete their own presence doc', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      // Create
      await assertSucceeds(setDoc(myPresenceRef, presencePayload(USERS.member)));

      // Heartbeat update
      await assertSucceeds(
        updateDoc(myPresenceRef, {
          lastActiveAt: serverTimestamp(),
        }),
      );

      // Leave board / delete
      await assertSucceeds(deleteDoc(myPresenceRef));
    });

    it('allows board viewers to write their own presence', async () => {
      const viewerPresenceRef = doc(
        as(USERS.viewer),
        `boards/${MAIN_BOARD}/presence/${USERS.viewer}`,
      );
      await assertSucceeds(setDoc(viewerPresenceRef, presencePayload(USERS.viewer)));
    });

    it('denies writing presence for another user', async () => {
      // USERS.member tries to write presence with USERS.owner id
      const forgedRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.owner}`);
      await assertFails(setDoc(forgedRef, presencePayload(USERS.owner)));
    });

    it('denies outsiders and unauthenticated users from writing presence', async () => {
      const outsiderRef = doc(
        as(USERS.outsider),
        `boards/${MAIN_BOARD}/presence/${USERS.outsider}`,
      );
      await assertFails(setDoc(outsiderRef, presencePayload(USERS.outsider)));

      const anonRef = doc(anon(), `boards/${MAIN_BOARD}/presence/anon123`);
      await assertFails(setDoc(anonRef, presencePayload('anon123')));
    });

    it('denies writing presence on a private board without board access', async () => {
      // In seedFixture, USERS.viewer is not in PRIVATE_BOARD access list
      const viewerOnPrivate = doc(
        as(USERS.viewer),
        `boards/${PRIVATE_BOARD}/presence/${USERS.viewer}`,
      );
      await assertFails(setDoc(viewerOnPrivate, presencePayload(USERS.viewer)));

      // Admin is also not in PRIVATE_BOARD access list
      const adminOnPrivate = doc(
        as(USERS.admin),
        `boards/${PRIVATE_BOARD}/presence/${USERS.admin}`,
      );
      await assertFails(setDoc(adminOnPrivate, presencePayload(USERS.admin)));

      // Owner and Member ARE in PRIVATE_BOARD access list
      const ownerOnPrivate = doc(
        as(USERS.owner),
        `boards/${PRIVATE_BOARD}/presence/${USERS.owner}`,
      );
      await assertSucceeds(setDoc(ownerOnPrivate, presencePayload(USERS.owner)));

      const memberOnPrivate = doc(
        as(USERS.member),
        `boards/${PRIVATE_BOARD}/presence/${USERS.member}`,
      );
      await assertSucceeds(setDoc(memberOnPrivate, presencePayload(USERS.member)));
    });

    it('enforces schema restrictions and payload size bounds', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      // Denies unrecognized fields / payload bloating
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          extraField: 'malicious-data-payload-bloat',
        }),
      );

      // Denies spoofed uid in payload
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          uid: USERS.owner,
        }),
      );

      // Denies non-server timestamp on create
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          lastActiveAt: new Date(2020, 0, 1),
        }),
      );

      // Denies oversized displayName (> 100 characters)
      const longName = 'a'.repeat(101);
      const longNameDb = as(USERS.member, { name: longName });
      await assertFails(
        setDoc(
          doc(longNameDb, `boards/${MAIN_BOARD}/presence/${USERS.member}`),
          presencePayload(USERS.member, longName),
        ),
      );

      // Denies oversized photoURL (> 2000 characters)
      const longPic = 'https://example.com/' + 'x'.repeat(2000);
      const longPicDb = as(USERS.member, { picture: longPic });
      await assertFails(
        setDoc(
          doc(longPicDb, `boards/${MAIN_BOARD}/presence/${USERS.member}`),
          presencePayload(USERS.member, undefined, longPic),
        ),
      );
    });

    it("denies forged update or delete of another user's presence doc", async () => {
      const ownerPresenceRef = doc(as(USERS.owner), `boards/${MAIN_BOARD}/presence/${USERS.owner}`);
      await assertSucceeds(setDoc(ownerPresenceRef, presencePayload(USERS.owner)));

      const memberAttackingOwner = doc(
        as(USERS.member),
        `boards/${MAIN_BOARD}/presence/${USERS.owner}`,
      );
      await assertFails(
        updateDoc(memberAttackingOwner, {
          lastActiveAt: serverTimestamp(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        }),
      );
      await assertFails(deleteDoc(memberAttackingOwner));
    });

    it('denies backdated or non-server timestamp on update', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);
      await assertSucceeds(setDoc(myPresenceRef, presencePayload(USERS.member)));

      await assertFails(
        updateDoc(myPresenceRef, {
          lastActiveAt: new Date(2020, 0, 1),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        }),
      );
    });

    it('denies changing uid on update', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);
      await assertSucceeds(setDoc(myPresenceRef, presencePayload(USERS.member)));

      await assertFails(
        updateDoc(myPresenceRef, {
          uid: USERS.owner,
        }),
      );
    });

    it('denies missing required fields (uid, lastActiveAt, expiresAt)', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      // Missing uid
      await assertFails(
        setDoc(myPresenceRef, {
          displayName: `User ${USERS.member}`,
          photoURL: `https://example.com/${USERS.member}.png`,
          lastActiveAt: serverTimestamp(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        }),
      );

      // Missing lastActiveAt
      await assertFails(
        setDoc(myPresenceRef, {
          uid: USERS.member,
          displayName: `User ${USERS.member}`,
          photoURL: `https://example.com/${USERS.member}.png`,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        }),
      );

      // Missing expiresAt
      await assertFails(
        setDoc(myPresenceRef, {
          uid: USERS.member,
          displayName: `User ${USERS.member}`,
          photoURL: `https://example.com/${USERS.member}.png`,
          lastActiveAt: serverTimestamp(),
        }),
      );
    });

    it('denies non-string displayName or photoURL', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          displayName: 12345,
        }),
      );

      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          photoURL: true,
        }),
      );
    });

    it('denies spoofed identity that does not match auth token', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      // Tries to set displayName to someone else ("Avery Owner")
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          displayName: 'Avery Owner',
        }),
      );

      // Tries to set photoURL to an arbitrary tracking URL
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          photoURL: 'https://malicious-tracking.com/pixel.gif',
        }),
      );
    });

    it('denies expiresAt that is in the past or too far in the future', async () => {
      const myPresenceRef = doc(as(USERS.member), `boards/${MAIN_BOARD}/presence/${USERS.member}`);

      // In the past
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          expiresAt: new Date(Date.now() - 10000),
        }),
      );

      // Far in the future (e.g. 24 hours)
      await assertFails(
        setDoc(myPresenceRef, {
          ...presencePayload(USERS.member),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        }),
      );
    });
  });
});
