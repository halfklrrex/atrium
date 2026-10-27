import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * P1 description images: `items/{i}.descriptionImages.<fileId>` is written only by the
 * finalizeDescriptionImage Function (Admin SDK, bypasses rules). Clients, whatever their role,
 * can neither create, change nor remove it.
 */

let env: RulesTestEnvironment;

const image = {
  name: 'photo.png',
  size: 1200,
  mimeType: 'image/png',
  uploadedAt: '2026-10-25T00:00:00.000Z',
  uploadedBy: USERS.member,
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
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'plain'), itemDoc({ name: 'No images' }));
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'pictured'),
      itemDoc({ name: 'Has images', descriptionImages: { img1: image } }),
    );
  });
});

const itemRef = (uid: string, id: string) =>
  doc(env.authenticatedContext(uid).firestore(), 'boards', MAIN_BOARD, 'items', id);
const audit = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

describe('descriptionImages is Functions-only', () => {
  it('denies creating an item that carries it', async () => {
    await assertFails(
      setDoc(
        itemRef(USERS.member, 'new'),
        itemDoc({
          createdBy: USERS.member,
          updatedBy: USERS.member,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          descriptionImages: { img1: image },
        }),
      ),
    );
  });

  it('denies adding to an item, with the whole map or a field path', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertFails(
        updateDoc(itemRef(uid, 'plain'), { descriptionImages: { img1: image }, ...audit(uid) }),
      );
      await assertFails(
        updateDoc(
          itemRef(uid, 'plain'),
          new FieldPath('descriptionImages', 'img1'),
          image,
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        ),
      );
    }
  });

  it('denies changing or removing an entry, even for the board owner', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      await assertFails(
        updateDoc(
          itemRef(uid, 'pictured'),
          new FieldPath('descriptionImages', 'img1', 'name'),
          'renamed.png',
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        ),
      );
      await assertFails(
        updateDoc(itemRef(uid, 'pictured'), {
          descriptionImages: deleteField(),
          ...audit(uid),
        }),
      );
      await assertFails(
        updateDoc(
          itemRef(uid, 'pictured'),
          new FieldPath('descriptionImages', 'img1'),
          deleteField(),
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        ),
      );
    }
  });

  it('denies smuggling it in with a description save', async () => {
    const uid = USERS.member;
    await assertFails(
      updateDoc(itemRef(uid, 'plain'), {
        description: { doc: { type: 'doc' }, text: 'Hi' },
        descriptionImages: { img1: image },
        ...audit(uid),
      }),
    );
  });

  it('still allows editors to save the description of an item that has images', async () => {
    const uid = USERS.member;
    await assertSucceeds(
      updateDoc(itemRef(uid, 'pictured'), {
        description: { doc: { type: 'doc', content: [] }, text: 'Hi' },
        ...audit(uid),
      }),
    );
  });
});
