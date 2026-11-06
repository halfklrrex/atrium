import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  MAIN_BOARD,
  USERS,
  createTestEnv,
  replyDocData,
  seedFixture,
  updateDocData,
} from './helpers';

/**
 * Update attachments (spec P4): `attachments` on an update or reply is written only by the
 * finalizeUpdateAttachment Function (Admin SDK bypasses rules). It is in neither the create nor the
 * update key list, so no client role can forge, change or remove it. Existing writes keep working.
 */

let env: RulesTestEnvironment;

const attachment = {
  id: 'f1',
  name: 'plan.pdf',
  storagePath: 'boards/boardMain/items/i1/updates/u1/f1',
  size: 10,
  mimeType: 'application/pdf',
  uploadedAt: '2026-11-05T00:00:00.000Z',
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
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const updateRef = (uid: string, id = 'u1') =>
  doc(as(uid), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', id);
const replyRef = (uid: string, id = 'r1') =>
  doc(as(uid), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1', 'replies', id);

/** Seeds (rules off) an update and a reply that already carry attachments, authored by the member. */
const seedWithAttachments = async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = ['boards', MAIN_BOARD, 'items', 'i1', 'updates'] as const;
    await setDoc(
      doc(db, ...base, 'u1'),
      updateDocData({ authorId: USERS.member, attachments: [attachment] }),
    );
    await setDoc(
      doc(db, ...base, 'u1', 'replies', 'r1'),
      replyDocData({ authorId: USERS.member, attachments: [attachment] }),
    );
  });
};

/** Differs from the seeded entry, so a write of it is a real change. */
const forged = { ...attachment, id: 'f2', storagePath: 'boards/boardMain/items/i1/updates/u1/f2' };

const writers = [USERS.member, USERS.admin, USERS.owner] as const;

describe('clients cannot write attachments on updates', () => {
  it('refuses a create carrying attachments, for the author, an editor and an owner', async () => {
    for (const uid of writers) {
      await assertFails(
        setDoc(
          updateRef(uid, `new-${uid}`),
          updateDocData({
            authorId: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            attachments: [attachment],
          }),
        ),
      );
      await assertFails(
        setDoc(
          updateRef(uid, `empty-${uid}`),
          updateDocData({
            authorId: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            attachments: [],
          }),
        ),
      );
    }
  });

  it('refuses setting, appending, replacing and clearing attachments on an update', async () => {
    for (const uid of writers) {
      await assertFails(
        updateDoc(updateRef(uid), { attachments: [attachment], updatedAt: serverTimestamp() }),
      );
      await assertFails(updateDoc(updateRef(uid), { attachments: arrayUnion(attachment) }));
    }
    await seedWithAttachments();
    for (const uid of writers) {
      await assertFails(updateDoc(updateRef(uid), { attachments: [] }));
      await assertFails(updateDoc(updateRef(uid), { attachments: deleteField() }));
      await assertFails(
        updateDoc(updateRef(uid), {
          attachments: [{ ...attachment, uploadedBy: USERS.owner }],
        }),
      );
      // Smuggled in beside an allowed change.
      await assertFails(updateDoc(updateRef(uid), { likes: [uid], attachments: [forged] }));
    }
  });
});

describe('clients cannot write attachments on replies', () => {
  it('refuses a create carrying attachments', async () => {
    for (const uid of writers) {
      await assertFails(
        setDoc(
          replyRef(uid, `new-${uid}`),
          replyDocData({
            authorId: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            attachments: [attachment],
          }),
        ),
      );
    }
  });

  it('refuses setting, replacing and clearing attachments on a reply', async () => {
    for (const uid of writers) {
      await assertFails(updateDoc(replyRef(uid), { attachments: [attachment] }));
    }
    await seedWithAttachments();
    for (const uid of writers) {
      await assertFails(updateDoc(replyRef(uid), { attachments: [] }));
      await assertFails(updateDoc(replyRef(uid), { attachments: deleteField() }));
      await assertFails(updateDoc(replyRef(uid), { likes: [uid], attachments: [forged] }));
    }
  });
});

describe('existing update and reply writes still work, also on posts that carry attachments', () => {
  it('creates, edits, likes and deletes updates and replies without attachments', async () => {
    const uid = USERS.member;
    await assertSucceeds(
      setDoc(
        updateRef(uid, 'fresh'),
        updateDocData({
          authorId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      ),
    );
    await assertSucceeds(
      updateDoc(updateRef(uid, 'fresh'), { content: 'Edited', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(updateRef(uid, 'fresh'), { likes: [uid] }));
    await assertSucceeds(deleteDoc(updateRef(uid, 'fresh')));

    await assertSucceeds(
      setDoc(
        replyRef(uid, 'fresh'),
        replyDocData({
          authorId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      ),
    );
    await assertSucceeds(
      updateDoc(replyRef(uid, 'fresh'), { content: 'Edited', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(replyRef(uid, 'fresh'), { likes: [uid] }));
    await assertSucceeds(deleteDoc(replyRef(uid, 'fresh')));
  });

  it('lets the author edit, anyone with edit access like, and the author or an owner delete a post that has attachments', async () => {
    await seedWithAttachments();
    const member = USERS.member;
    await assertSucceeds(
      updateDoc(updateRef(member), { content: 'Edited', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(updateRef(USERS.admin), { likes: [USERS.admin] }));
    await assertSucceeds(
      updateDoc(replyRef(member), { content: 'Edited', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(replyRef(USERS.admin), { likes: [USERS.admin] }));
    await assertFails(deleteDoc(updateRef(USERS.viewer)));
    await assertSucceeds(deleteDoc(replyRef(USERS.owner)));
    await assertSucceeds(deleteDoc(updateRef(member)));
  });
});
