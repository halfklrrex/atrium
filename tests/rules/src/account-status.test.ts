import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_OWNED_USER_FIELDS } from '@atrium/shared';
import { USERS, createTestEnv, seedFixture } from './helpers';

/**
 * ADMIN-1a: `accountStatus`, `statusChangedAt` and `statusChangedBy` on `users/{uid}` belong to
 * Cloud Functions and scripts. A client can neither create the document with them nor change them,
 * and reading its own document still works. (No gate yet: `signedIn()` is unchanged.)
 */

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
const own = () => doc(as(USERS.member), 'users', USERS.member);

describe('users/{uid} server-owned account fields', () => {
  it('lists the three fields the rules protect', () => {
    // Keeps the shared constant and this suite in step.
    expect([...SERVER_OWNED_USER_FIELDS]).toEqual([
      'accountStatus',
      'statusChangedAt',
      'statusChangedBy',
    ]);
  });

  it('still lets a user read their own document, with or without a status', async () => {
    await assertSucceeds(getDoc(own()));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'users', USERS.member),
        { accountStatus: 'approved', statusChangedBy: 'system:backfill' },
        { merge: true },
      );
    });
    await assertSucceeds(getDoc(own()));
  });

  it('refuses a client update of accountStatus, statusChangedAt or statusChangedBy', async () => {
    await assertFails(updateDoc(own(), { accountStatus: 'approved' }));
    await assertFails(updateDoc(own(), { accountStatus: 'blocked' }));
    await assertFails(updateDoc(own(), { statusChangedAt: serverTimestamp() }));
    await assertFails(updateDoc(own(), { statusChangedBy: USERS.member }));
  });

  it('refuses them even next to an allowed field', async () => {
    await assertSucceeds(updateDoc(own(), { theme: 'dark' }));
    await assertFails(updateDoc(own(), { theme: 'dark', accountStatus: 'approved' }));
  });

  it('refuses changing or removing them once the server has set them', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'users', USERS.member),
        { accountStatus: 'blocked', statusChangedBy: USERS.owner },
        { merge: true },
      );
    });
    await assertFails(updateDoc(own(), { accountStatus: 'approved' }));
    await assertFails(updateDoc(own(), { accountStatus: deleteField() }));
    await assertFails(updateDoc(own(), { statusChangedBy: deleteField() }));
  });

  it('refuses a client creating its own document with them (or at all)', async () => {
    const fresh = doc(as('newcomer'), 'users', 'newcomer');
    await assertFails(
      setDoc(fresh, {
        displayName: 'Avery Quinn',
        email: 'avery@example.com',
        photoURL: null,
        timezone: 'UTC',
        locale: 'en',
        lastWorkspaceId: null,
        theme: 'light',
        createdAt: serverTimestamp(),
        accountStatus: 'approved',
        statusChangedAt: serverTimestamp(),
        statusChangedBy: 'newcomer',
      }),
    );
    await assertFails(setDoc(fresh, { displayName: 'Avery Quinn', accountStatus: 'approved' }));
  });

  it('refuses another user writing them, and a set that replaces the document', async () => {
    await assertFails(
      updateDoc(doc(as(USERS.owner), 'users', USERS.member), { accountStatus: 'approved' }),
    );
    await assertFails(setDoc(own(), { accountStatus: 'approved' }));
  });
});
