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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
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
const ref = (db: ReturnType<typeof as>, id: string) => doc(db, 'docs', id);
const bodyRef = (db: ReturnType<typeof as>, id: string, part = 'body') =>
  doc(db, 'docs', id, 'content', part);

const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const sharedAccess = {
  [USERS.owner]: 'owner',
  [USERS.member]: 'editor',
  [USERS.viewer]: 'viewer',
};

/** A stored doc (server side). */
function docMeta(overrides: Record<string, unknown> = {}) {
  const access = (overrides.access as Record<string, string> | undefined) ?? {
    [USERS.owner]: 'owner',
  };
  return {
    workspaceId: WS,
    folderId: null,
    name: 'Packing list',
    kind: 'main',
    access,
    accessUids: Object.keys(access),
    position: 'a0',
    icon: null,
    state: 'active',
    deletedAt: null,
    createdAt: seedTs,
    createdBy: USERS.owner,
    updatedAt: seedTs,
    ...overrides,
  };
}

/** A client-side create payload. */
function newDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    folderId: null,
    name: 'Mine',
    kind: 'main',
    access: { [uid]: 'owner' },
    accessUids: [uid],
    position: 'a0',
    icon: null,
    state: 'active',
    deletedAt: null,
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const stored = (rev: number) => ({
  doc: { type: 'doc', content: [] },
  text: '',
  rev,
  updatedAt: seedTs,
  updatedBy: USERS.owner,
});

/** A client-side body save. */
const save = (uid: string, rev: number, overrides: Record<string, unknown> = {}) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: 'Hello',
  rev,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...overrides,
});

async function seed(id: string, overrides: Record<string, unknown> = {}, bodyRev?: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(ref(db, id), docMeta(overrides));
    if (bodyRev !== undefined) await setDoc(bodyRef(db, id), stored(bodyRev));
  });
}

const touch = (uid: string, extra: Record<string, unknown>) => ({
  ...extra,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});

describe('docs: read and list', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    '%s reads a main doc',
    async (uid) => {
      await seed('d1');
      await assertSucceeds(getDoc(ref(as(uid), 'd1')));
    },
  );

  it('refuses non-members and signed-out users', async () => {
    await seed('d1');
    await assertFails(getDoc(ref(as(USERS.outsider), 'd1')));
    await assertFails(getDoc(ref(anon(), 'd1')));
  });

  it('a private doc is invisible to a member not in access', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    await assertSucceeds(getDoc(ref(as(USERS.member), 'd1')));
    await assertFails(getDoc(ref(as(USERS.admin), 'd1')));
    await assertFails(getDoc(ref(as(USERS.outsider), 'd1')));
  });

  it('lists with the two board shapes and refuses an unfiltered list', async () => {
    await seed('d1');
    await seed('d2', { kind: 'private', access: sharedAccess });
    await seed('d3', { kind: 'private' });
    const col = collection(as(USERS.member), 'docs');
    const main = await assertSucceeds(
      getDocs(query(col, where('workspaceId', '==', WS), where('kind', '==', 'main'))),
    );
    if (main.size !== 1) throw new Error(`expected 1 main doc, got ${main.size}`);
    const mine = await assertSucceeds(
      getDocs(
        query(col, where('workspaceId', '==', WS), where('accessUids', 'array-contains', 'member')),
      ),
    );
    if (mine.size !== 1) throw new Error(`expected 1 shared doc, got ${mine.size}`);
    await assertFails(getDocs(col));
  });

  it('refuses listing by a non-member', async () => {
    await seed('d1');
    await assertFails(
      getDocs(
        query(
          collection(as(USERS.outsider), 'docs'),
          where('workspaceId', '==', WS),
          where('kind', '==', 'main'),
        ),
      ),
    );
  });
});

describe('docs: create', () => {
  it.each([USERS.owner, USERS.admin, USERS.member])('%s can create', async (uid) => {
    await assertSucceeds(setDoc(ref(as(uid), 'new'), newDoc(uid)));
  });

  it.each([USERS.viewer, USERS.outsider])('%s cannot create', async (uid) => {
    await assertFails(setDoc(ref(as(uid), 'new'), newDoc(uid)));
  });

  it('refuses signed-out creates', async () => {
    await assertFails(setDoc(ref(anon(), 'new'), newDoc(USERS.member)));
  });

  let n = 0;
  const create = (overrides: Record<string, unknown>) =>
    setDoc(ref(as(USERS.member), `c${++n}`), newDoc(USERS.member, overrides));

  it('accepts private and shareable kinds, rejects others', async () => {
    await assertSucceeds(create({ kind: 'private' }));
    await assertSucceeds(create({ kind: 'shareable' }));
    await assertFails(create({ kind: 'secret' }));
  });

  it('refuses forged access, createdBy, state, timestamps and extra fields', async () => {
    await assertFails(create({ access: { [USERS.member]: 'owner', [USERS.owner]: 'owner' } }));
    await assertFails(create({ access: { [USERS.member]: 'editor' } }));
    await assertFails(create({ accessUids: [USERS.member, USERS.owner] }));
    await assertFails(create({ createdBy: USERS.owner }));
    await assertFails(create({ state: 'deleted', deletedAt: serverTimestamp() }));
    await assertFails(create({ createdAt: Timestamp.fromMillis(1) }));
    await assertFails(create({ icon: 'x' }));
    await assertFails(create({ extra: true }));
    await assertFails(create({ widgets: [] }));
  });

  it('refuses a missing workspace or a folder from another place', async () => {
    await assertFails(create({ workspaceId: 'nope' }));
    await assertFails(create({ folderId: 'missing' }));
    await assertSucceeds(create({ folderId: 'f1' }));
  });

  it('enforces the name limits', async () => {
    await assertFails(create({ name: '' }));
    await assertFails(create({ name: 'x'.repeat(81) }));
    await assertSucceeds(create({ name: 'x'.repeat(80) }));
  });
});

describe('docs: update', () => {
  it('owner and editors rename and move; viewers cannot', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    const p = (uid: string) => touch(uid, { name: 'Renamed', folderId: 'f1', position: 'a1' });
    await assertSucceeds(updateDoc(ref(as(USERS.owner), 'd1'), p(USERS.owner)));
    await assertSucceeds(updateDoc(ref(as(USERS.member), 'd1'), p(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), p(USERS.viewer)));
    await assertFails(updateDoc(ref(as(USERS.outsider), 'd1'), p(USERS.outsider)));
    await assertFails(updateDoc(ref(anon(), 'd1'), p(USERS.member)));
  });

  it('refuses a move into a missing folder and an empty position', async () => {
    await seed('d1');
    const db = as(USERS.member);
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { folderId: 'missing' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { position: '' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { name: '' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { name: 'x'.repeat(81) })));
  });

  it('requires updatedBy and a server updatedAt', async () => {
    await seed('d1');
    await assertFails(
      updateDoc(ref(as(USERS.member), 'd1'), { name: 'X', updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(ref(as(USERS.member), 'd1'), touch(USERS.owner, { name: 'X' })));
    await assertFails(
      updateDoc(ref(as(USERS.member), 'd1'), {
        name: 'X',
        updatedBy: USERS.member,
        updatedAt: Timestamp.fromMillis(5),
      }),
    );
  });

  it('keeps workspaceId, icon and audit fields immutable', async () => {
    await seed('d1');
    const db = as(USERS.owner);
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { workspaceId: 'ws2' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { icon: 'x' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { createdBy: USERS.member })));
  });

  it.each([USERS.owner, USERS.member, USERS.viewer])(
    'refuses %s writing kind, access or accessUids directly',
    async (uid) => {
      await seed('d1', { kind: 'shareable', access: sharedAccess });
      const shared = { ...sharedAccess, [USERS.admin]: 'owner' };
      const payloads: Record<string, unknown>[] = [
        { kind: 'main' },
        { access: shared, accessUids: Object.keys(shared) },
        { access: shared },
        { accessUids: Object.keys(shared) },
        { access: { ...sharedAccess, [USERS.member]: 'owner' } },
      ];
      for (const extra of payloads) {
        await assertFails(updateDoc(ref(as(uid), 'd1'), touch(uid, extra)));
      }
    },
  );

  it('soft delete and restore are owner-only', async () => {
    await seed('d1', { kind: 'shareable', access: sharedAccess });
    const del = (uid: string) => touch(uid, { state: 'deleted', deletedAt: serverTimestamp() });
    await assertFails(updateDoc(ref(as(USERS.member), 'd1'), del(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), del(USERS.viewer)));
    await assertSucceeds(updateDoc(ref(as(USERS.owner), 'd1'), del(USERS.owner)));
    await assertFails(
      updateDoc(
        ref(as(USERS.member), 'd1'),
        touch(USERS.member, { state: 'active', deletedAt: null }),
      ),
    );
    await assertSucceeds(
      updateDoc(
        ref(as(USERS.owner), 'd1'),
        touch(USERS.owner, { state: 'active', deletedAt: null }),
      ),
    );
  });

  it('refuses inconsistent state and deletedAt', async () => {
    await seed('d1');
    const db = as(USERS.owner);
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { state: 'archived' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { state: 'deleted' })));
    await assertFails(
      updateDoc(
        ref(db, 'd1'),
        touch(USERS.owner, { state: 'deleted', deletedAt: Timestamp.fromMillis(1) }),
      ),
    );
  });

  it('nobody deletes a doc', async () => {
    await seed('d1', { access: sharedAccess });
    await assertFails(deleteDoc(ref(as(USERS.owner), 'd1')));
    await assertFails(deleteDoc(ref(as(USERS.admin), 'd1')));
  });
});

describe('docs: body read', () => {
  it('members with a role read the body; others do not', async () => {
    await seed('d1', {}, 3);
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(bodyRef(as(uid), 'd1')));
    }
    await assertFails(getDoc(bodyRef(as(USERS.outsider), 'd1')));
    await assertFails(getDoc(bodyRef(anon(), 'd1')));
  });

  it('a private doc body follows access', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess }, 1);
    await assertSucceeds(getDoc(bodyRef(as(USERS.viewer), 'd1')));
    await assertFails(getDoc(bodyRef(as(USERS.admin), 'd1')));
  });

  it('refuses other parts and listing the content collection', async () => {
    await seed('d1');
    await assertFails(getDoc(bodyRef(as(USERS.owner), 'd1', 'secrets')));
    await assertFails(getDocs(collection(as(USERS.owner), 'docs', 'd1', 'content')));
  });

  it('a missing parent doc denies', async () => {
    await assertFails(getDoc(bodyRef(as(USERS.owner), 'nope')));
  });
});

describe('docs: body create', () => {
  it('owner and editor create the first body with rev 1', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    await assertSucceeds(setDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 1)));
    await seed('d2');
    await assertSucceeds(setDoc(bodyRef(as(USERS.admin), 'd2'), save(USERS.admin, 1)));
  });

  it('refuses viewers, outsiders and signed-out users', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    await assertFails(setDoc(bodyRef(as(USERS.viewer), 'd1'), save(USERS.viewer, 1)));
    await assertFails(setDoc(bodyRef(as(USERS.outsider), 'd1'), save(USERS.outsider, 1)));
    await assertFails(setDoc(bodyRef(anon(), 'd1'), save(USERS.member, 1)));
  });

  it('needs rev == 1', async () => {
    await seed('d1');
    await assertFails(setDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 2)));
    await assertFails(setDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 0)));
  });

  it('refuses a forged author, client time, extra keys and a non-doc root', async () => {
    await seed('d1');
    const db = as(USERS.member);
    await assertFails(setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { updatedBy: USERS.owner })));
    await assertFails(
      setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { updatedAt: Timestamp.fromMillis(5) })),
    );
    await assertFails(setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { extra: true })));
    await assertFails(
      setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { doc: { type: 'paragraph' } })),
    );
    await assertFails(setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { doc: 'text' })));
    await assertFails(setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { text: 5 })));
  });

  it('enforces the text cap', async () => {
    await seed('d1');
    const db = as(USERS.member);
    await assertSucceeds(
      setDoc(bodyRef(db, 'd1'), save(USERS.member, 1, { text: 'x'.repeat(50_000) })),
    );
    await seed('d2');
    await assertFails(
      setDoc(bodyRef(as(USERS.member), 'd2'), save(USERS.member, 1, { text: 'x'.repeat(50_001) })),
    );
  });

  it('refuses a body write on a deleted doc', async () => {
    await seed('d1', { state: 'deleted', deletedAt: seedTs });
    await assertFails(setDoc(bodyRef(as(USERS.owner), 'd1'), save(USERS.owner, 1)));
  });

  it('refuses writing the images part or an unknown part', async () => {
    await seed('d1');
    await assertFails(setDoc(bodyRef(as(USERS.owner), 'd1', 'images'), { a: 1 }));
    await assertFails(setDoc(bodyRef(as(USERS.owner), 'd1', 'other'), save(USERS.owner, 1)));
  });
});

describe('docs: body update is revision-checked', () => {
  it('accepts exactly stored rev + 1', async () => {
    await seed('d1', {}, 4);
    await assertSucceeds(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 5)));
    await assertSucceeds(updateDoc(bodyRef(as(USERS.owner), 'd1'), save(USERS.owner, 6)));
  });

  it('refuses a stale rev (the same as stored)', async () => {
    await seed('d1', {}, 4);
    await assertFails(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 4)));
  });

  it('refuses an older rev and a skipped rev (+2)', async () => {
    await seed('d1', {}, 4);
    await assertFails(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 3)));
    await assertFails(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 6)));
  });

  it('the second of two concurrent saves from the same base is refused', async () => {
    await seed('d1', {}, 1);
    await assertSucceeds(updateDoc(bodyRef(as(USERS.owner), 'd1'), save(USERS.owner, 2)));
    await assertFails(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 2)));
    // After loading rev 2 the other editor saves rev 3.
    await assertSucceeds(updateDoc(bodyRef(as(USERS.member), 'd1'), save(USERS.member, 3)));
  });

  it('refuses viewers and outsiders even with the right rev', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess }, 1);
    await assertFails(updateDoc(bodyRef(as(USERS.viewer), 'd1'), save(USERS.viewer, 2)));
    await assertFails(updateDoc(bodyRef(as(USERS.outsider), 'd1'), save(USERS.outsider, 2)));
  });

  it('refuses a text over the cap, a non-doc root, a forged author and a client time', async () => {
    await seed('d1', {}, 1);
    const db = as(USERS.member);
    await assertFails(
      updateDoc(bodyRef(db, 'd1'), save(USERS.member, 2, { text: 'x'.repeat(50_001) })),
    );
    await assertFails(
      updateDoc(bodyRef(db, 'd1'), save(USERS.member, 2, { doc: { type: 'paragraph' } })),
    );
    await assertFails(updateDoc(bodyRef(db, 'd1'), save(USERS.member, 2, { updatedBy: 'owner' })));
    await assertFails(
      updateDoc(bodyRef(db, 'd1'), save(USERS.member, 2, { updatedAt: Timestamp.fromMillis(9) })),
    );
  });

  it('refuses a body update on a deleted doc and any delete of the body', async () => {
    await seed('d1', { state: 'deleted', deletedAt: seedTs }, 1);
    await assertFails(updateDoc(bodyRef(as(USERS.owner), 'd1'), save(USERS.owner, 2)));
    await seed('d2', {}, 1);
    await assertFails(deleteDoc(bodyRef(as(USERS.owner), 'd2')));
  });

  it('the images part is read-only for clients', async () => {
    await seed('d1');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(bodyRef(ctx.firestore(), 'd1', 'images'), { f1: { name: 'a.png' } });
    });
    await assertSucceeds(getDoc(bodyRef(as(USERS.viewer), 'd1', 'images')));
    await assertFails(updateDoc(bodyRef(as(USERS.owner), 'd1', 'images'), { f2: {} }));
    await assertFails(deleteDoc(bodyRef(as(USERS.owner), 'd1', 'images')));
  });
});
