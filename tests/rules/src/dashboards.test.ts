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
const ref = (db: ReturnType<typeof as>, id: string) => doc(db, 'dashboards', id);

const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const widget = (id: string) => ({
  id,
  type: 'numbers',
  title: 'Count',
  layout: { x: 0, y: 0, w: 3, h: 3 },
  boardIds: [],
  settings: { mode: 'count', columnId: null, filter: null },
});

/** A stored dashboard (server side). */
function dashboardDoc(overrides: Record<string, unknown> = {}) {
  const access = (overrides.access as Record<string, string> | undefined) ?? {
    [USERS.owner]: 'owner',
  };
  return {
    workspaceId: WS,
    folderId: null,
    name: 'Overview',
    kind: 'main',
    access,
    accessUids: Object.keys(access),
    position: 'a0',
    icon: null,
    boardIds: ['boardMain'],
    widgets: [widget('w1')],
    state: 'active',
    deletedAt: null,
    createdAt: seedTs,
    createdBy: USERS.owner,
    updatedAt: seedTs,
    ...overrides,
  };
}

/** A client-side create payload. */
function newDashboard(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    folderId: null,
    name: 'Mine',
    kind: 'main',
    access: { [uid]: 'owner' },
    accessUids: [uid],
    position: 'a0',
    icon: null,
    boardIds: [],
    widgets: [],
    state: 'active',
    deletedAt: null,
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed(id: string, overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ref(ctx.firestore(), id), dashboardDoc(overrides));
  });
}

/** A private dashboard shared with the member (editor) and the viewer (viewer). */
const sharedAccess = {
  [USERS.owner]: 'owner',
  [USERS.member]: 'editor',
  [USERS.viewer]: 'viewer',
};

const touch = (uid: string, extra: Record<string, unknown>) => ({
  ...extra,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});

describe('dashboards: read', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])(
    '%s reads a main dashboard',
    async (uid) => {
      await seed('d1');
      await assertSucceeds(getDoc(ref(as(uid), 'd1')));
    },
  );

  it('refuses non-members and signed-out users on a main dashboard', async () => {
    await seed('d1');
    await assertFails(getDoc(ref(as(USERS.outsider), 'd1')));
    await assertFails(getDoc(ref(anon(), 'd1')));
  });

  it('private: only the people in access read it', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    await assertSucceeds(getDoc(ref(as(USERS.owner), 'd1')));
    await assertSucceeds(getDoc(ref(as(USERS.member), 'd1')));
    await assertSucceeds(getDoc(ref(as(USERS.viewer), 'd1')));
    // A workspace admin without an access entry is not let in, as for boards.
    await assertFails(getDoc(ref(as(USERS.admin), 'd1')));
    await assertFails(getDoc(ref(as(USERS.outsider), 'd1')));
  });

  it('lists with the two board shapes', async () => {
    await seed('d1');
    await seed('d2', { kind: 'private', access: sharedAccess });
    await seed('d3', { kind: 'private' });
    const col = collection(as(USERS.member), 'dashboards');
    const main = await assertSucceeds(
      getDocs(query(col, where('workspaceId', '==', WS), where('kind', '==', 'main'))),
    );
    if (main.size !== 1) throw new Error(`expected 1 main dashboard, got ${main.size}`);
    const mine = await assertSucceeds(
      getDocs(
        query(col, where('workspaceId', '==', WS), where('accessUids', 'array-contains', 'member')),
      ),
    );
    if (mine.size !== 1) throw new Error(`expected 1 shared dashboard, got ${mine.size}`);
    // An unfiltered list could return dashboards the caller cannot read.
    await assertFails(getDocs(col));
  });

  it('refuses listing by a non-member', async () => {
    await seed('d1');
    await assertFails(
      getDocs(
        query(
          collection(as(USERS.outsider), 'dashboards'),
          where('workspaceId', '==', WS),
          where('kind', '==', 'main'),
        ),
      ),
    );
  });
});

describe('dashboards: create', () => {
  it.each([USERS.owner, USERS.admin, USERS.member])('%s can create', async (uid) => {
    await assertSucceeds(setDoc(ref(as(uid), 'new'), newDashboard(uid)));
  });

  it.each([USERS.viewer, USERS.outsider])('%s cannot create', async (uid) => {
    await assertFails(setDoc(ref(as(uid), 'new'), newDashboard(uid)));
  });

  it('refuses signed-out creates', async () => {
    await assertFails(setDoc(ref(anon(), 'new'), newDashboard(USERS.member)));
  });

  // A fresh id per call: a second create on the same id would be an update.
  let n = 0;
  const create = (overrides: Record<string, unknown>) =>
    setDoc(ref(as(USERS.member), `c${++n}`), newDashboard(USERS.member, overrides));

  it('accepts private and shareable kinds, rejects others', async () => {
    await assertSucceeds(create({ kind: 'private' }));
    await assertSucceeds(create({ kind: 'shareable' }));
    await assertFails(create({ kind: 'secret' }));
  });

  it('requires the creator to be the sole owner', async () => {
    await assertFails(create({ access: { [USERS.member]: 'owner', [USERS.owner]: 'owner' } }));
    await assertFails(create({ access: { [USERS.member]: 'editor' } }));
    await assertFails(create({ accessUids: [USERS.member, USERS.owner] }));
    await assertFails(create({ createdBy: USERS.owner }));
  });

  it('refuses client-chosen timestamps, state and extra fields', async () => {
    await assertFails(create({ createdAt: Timestamp.fromMillis(1) }));
    await assertFails(create({ updatedAt: Timestamp.fromMillis(1) }));
    await assertFails(create({ state: 'deleted', deletedAt: serverTimestamp() }));
    await assertFails(create({ extra: true }));
  });

  it('refuses a missing workspace or a folder from another place', async () => {
    await assertFails(create({ workspaceId: 'nope' }));
    await assertFails(create({ folderId: 'missing' }));
    await assertSucceeds(create({ folderId: 'f1' }));
  });

  it('enforces the name, boardIds and widgets limits', async () => {
    await assertFails(create({ name: '' }));
    await assertFails(create({ name: 'x'.repeat(81) }));
    await assertSucceeds(create({ name: 'x'.repeat(80) }));
    const boards = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);
    await assertSucceeds(create({ boardIds: boards(50) }));
    await assertFails(create({ boardIds: boards(51) }));
    const widgets = (n: number) => Array.from({ length: n }, (_, i) => widget(`w${i}`));
    await assertSucceeds(create({ widgets: widgets(24) }));
    await assertFails(create({ widgets: widgets(25) }));
    await assertFails(create({ widgets: 'nope' }));
  });
});

describe('dashboards: update widgets and name', () => {
  const payload = (uid: string) =>
    touch(uid, { name: 'Renamed', widgets: [widget('w1'), widget('w2')], boardIds: ['b1'] });

  it('owner and editors can edit content; viewers cannot', async () => {
    await seed('d1', { kind: 'private', access: sharedAccess });
    await assertSucceeds(updateDoc(ref(as(USERS.owner), 'd1'), payload(USERS.owner)));
    await assertSucceeds(updateDoc(ref(as(USERS.member), 'd1'), payload(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), payload(USERS.viewer)));
  });

  it('on a main dashboard the workspace role decides', async () => {
    await seed('d1');
    await assertSucceeds(updateDoc(ref(as(USERS.admin), 'd1'), payload(USERS.admin)));
    await assertSucceeds(updateDoc(ref(as(USERS.member), 'd1'), payload(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), payload(USERS.viewer)));
    await assertFails(updateDoc(ref(as(USERS.outsider), 'd1'), payload(USERS.outsider)));
    await assertFails(updateDoc(ref(anon(), 'd1'), payload(USERS.member)));
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

  it('enforces the shape limits on update', async () => {
    await seed('d1');
    const db = as(USERS.member);
    const widgets = (n: number) => Array.from({ length: n }, (_, i) => widget(`w${i}`));
    await assertSucceeds(updateDoc(ref(db, 'd1'), touch(USERS.member, { widgets: widgets(24) })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { widgets: widgets(25) })));
    const boards = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);
    await assertSucceeds(updateDoc(ref(db, 'd1'), touch(USERS.member, { boardIds: boards(50) })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { boardIds: boards(51) })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { name: '' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { name: 'x'.repeat(81) })));
  });

  it('keeps workspaceId and audit fields immutable', async () => {
    await seed('d1');
    const db = as(USERS.owner);
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { workspaceId: 'ws2' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { createdBy: USERS.member })));
    await assertFails(
      updateDoc(ref(db, 'd1'), touch(USERS.owner, { createdAt: serverTimestamp() })),
    );
  });

  it('lets editors move the dashboard but only into an existing folder', async () => {
    await seed('d1');
    const db = as(USERS.member);
    await assertSucceeds(
      updateDoc(ref(db, 'd1'), touch(USERS.member, { folderId: 'f1', position: 'a1' })),
    );
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { folderId: 'missing' })));
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.member, { position: '' })));
  });
});

describe('dashboards: access, kind and delete are owner-only', () => {
  it('owner may change kind and access, keeping accessUids in step', async () => {
    await seed('d1');
    await assertSucceeds(
      updateDoc(
        ref(as(USERS.owner), 'd1'),
        touch(USERS.owner, {
          kind: 'shareable',
          access: sharedAccess,
          accessUids: Object.keys(sharedAccess),
        }),
      ),
    );
  });

  it('refuses an accessUids that differs from the access keys', async () => {
    await seed('d1');
    await assertFails(
      updateDoc(
        ref(as(USERS.owner), 'd1'),
        touch(USERS.owner, { access: sharedAccess, accessUids: [USERS.owner] }),
      ),
    );
  });

  it('refuses an owner removing their own ownership', async () => {
    await seed('d1', { kind: 'shareable', access: sharedAccess });
    await assertFails(
      updateDoc(
        ref(as(USERS.owner), 'd1'),
        touch(USERS.owner, {
          access: { [USERS.member]: 'editor' },
          accessUids: [USERS.member],
        }),
      ),
    );
  });

  it('refuses editors and viewers changing kind or access', async () => {
    await seed('d1', { kind: 'shareable', access: sharedAccess });
    const next = { ...sharedAccess, [USERS.admin]: 'owner' };
    const change = (uid: string) => touch(uid, { access: next, accessUids: Object.keys(next) });
    await assertFails(updateDoc(ref(as(USERS.member), 'd1'), change(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), change(USERS.viewer)));
    await assertFails(
      updateDoc(ref(as(USERS.member), 'd1'), touch(USERS.member, { kind: 'main' })),
    );
  });

  it('soft delete and restore are owner-only', async () => {
    await seed('d1', { kind: 'shareable', access: sharedAccess });
    const del = (uid: string) => touch(uid, { state: 'deleted', deletedAt: serverTimestamp() });
    await assertFails(updateDoc(ref(as(USERS.member), 'd1'), del(USERS.member)));
    await assertFails(updateDoc(ref(as(USERS.viewer), 'd1'), del(USERS.viewer)));
    await assertSucceeds(updateDoc(ref(as(USERS.owner), 'd1'), del(USERS.owner)));
    // Editing a deleted dashboard keeps its deletedAt as is.
    await assertSucceeds(
      updateDoc(ref(as(USERS.member), 'd1'), touch(USERS.member, { name: 'Z' })),
    );
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

  it('refuses state values other than active and deleted, and inconsistent deletedAt', async () => {
    await seed('d1');
    const db = as(USERS.owner);
    await assertFails(
      updateDoc(ref(db, 'd1'), touch(USERS.owner, { state: 'archived', deletedAt: null })),
    );
    await assertFails(updateDoc(ref(db, 'd1'), touch(USERS.owner, { state: 'deleted' })));
  });

  it('never allows hard deletes', async () => {
    await seed('d1');
    await assertFails(deleteDoc(ref(as(USERS.owner), 'd1')));
    await assertFails(deleteDoc(ref(anon(), 'd1')));
  });
});
