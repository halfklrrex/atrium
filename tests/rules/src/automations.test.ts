import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, PRIVATE_BOARD, USERS, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * P5a automations. `boards/{id}/automations` (recipes) is read by everyone who can read the board and
 * written by board owners only; `automationRuns` is read by owners and written only by Cloud
 * Functions; `counters/automations` is Functions-only. Roles on MAIN_BOARD: `owner` and `admin` own
 * it (workspace owner and admin), `member` edits, `viewer` views, `outsider` is not a member.
 *
 * Rules can't count documents, so the 20-automations-per-board limit is NOT tested here: it is
 * enforced by `validateAutomation` in the UI and again by the runner (extra automations are
 * ignored). The same goes for the contents of `trigger`, `conditions` and `actions`: the rules
 * check only their outer shape, the shared schemas check the rest.
 */

let env: RulesTestEnvironment;
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const recipe = (overrides: Record<string, unknown> = {}) => ({
  name: 'Done means archived',
  enabled: true,
  trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
  conditions: [],
  actions: [{ type: 'archive_item' }],
  runAs: USERS.owner,
  disabledReason: null,
  createdBy: USERS.owner,
  createdAt: seedTs,
  updatedBy: USERS.owner,
  updatedAt: seedTs,
  ...overrides,
});

/** A recipe as a client creates it: stamped with the caller and the server time. */
const newRecipe = (uid: string, overrides: Record<string, unknown> = {}) =>
  recipe({
    runAs: uid,
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const automationRef = (uid: string, id = 'a1', boardId = MAIN_BOARD) =>
  doc(as(uid), 'boards', boardId, 'automations', id);
const runRef = (uid: string, id = 'a1-e1', boardId = MAIN_BOARD) =>
  doc(as(uid), 'boards', boardId, 'automationRuns', id);
const counterRef = (uid: string, boardId = MAIN_BOARD) =>
  doc(as(uid), 'boards', boardId, 'counters', 'automations');
const itemRef = (uid: string, id = 'i1') => doc(as(uid), 'boards', MAIN_BOARD, 'items', id);

const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

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
    for (const boardId of [MAIN_BOARD, PRIVATE_BOARD]) {
      await setDoc(doc(db, 'boards', boardId, 'automations', 'a1'), recipe());
      await setDoc(doc(db, 'boards', boardId, 'automationRuns', 'a1-e1'), {
        automationId: 'a1',
        eventId: 'e1',
        itemId: 'i1',
        status: 'ok',
        actions: ['archive_item'],
        startedAt: seedTs,
        durationMs: 12,
        depth: 0,
        expiresAt: Timestamp.fromMillis(1_700_000_000_000 + 30 * 86_400_000),
      });
      await setDoc(doc(db, 'boards', boardId, 'counters', 'automations'), {
        hourBucket: '2026-11-04T09',
        runs: 3,
      });
    }
  });
});

describe('reading automations', () => {
  it('lets every board reader get and list them: owner, editor, viewer', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(automationRef(uid)));
      await assertSucceeds(getDocs(collection(as(uid), 'boards', MAIN_BOARD, 'automations')));
    }
  });

  it('refuses a non-member and a signed-out visitor', async () => {
    await assertFails(getDoc(automationRef(USERS.outsider)));
    await assertFails(getDocs(collection(as(USERS.outsider), 'boards', MAIN_BOARD, 'automations')));
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD, 'automations', 'a1')));
  });

  it('follows private-board access: the explicit viewer reads, other workspace members do not', async () => {
    await assertSucceeds(getDoc(automationRef(USERS.member, 'a1', PRIVATE_BOARD)));
    await assertFails(getDoc(automationRef(USERS.admin, 'a1', PRIVATE_BOARD)));
    await assertFails(getDoc(automationRef(USERS.viewer, 'a1', PRIVATE_BOARD)));
  });
});

describe('creating automations', () => {
  it('lets a board owner create one as themselves', async () => {
    await assertSucceeds(setDoc(automationRef(USERS.owner, 'new'), newRecipe(USERS.owner)));
    await assertSucceeds(
      addDoc(
        collection(as(USERS.admin), 'boards', MAIN_BOARD, 'automations'),
        newRecipe(USERS.admin),
      ),
    );
  });

  it('refuses an editor, a viewer, a non-member and a signed-out visitor', async () => {
    for (const uid of [USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(automationRef(uid, 'new'), newRecipe(uid)));
    }
    await assertFails(
      setDoc(doc(anon(), 'boards', MAIN_BOARD, 'automations', 'new'), newRecipe(USERS.owner)),
    );
  });

  it('refuses a runAs, createdBy or updatedBy that is not the caller', async () => {
    await assertFails(
      setDoc(automationRef(USERS.owner, 'x1'), newRecipe(USERS.owner, { runAs: USERS.member })),
    );
    await assertFails(
      setDoc(automationRef(USERS.owner, 'x2'), newRecipe(USERS.owner, { createdBy: USERS.admin })),
    );
    await assertFails(
      setDoc(automationRef(USERS.owner, 'x3'), newRecipe(USERS.owner, { updatedBy: USERS.admin })),
    );
  });

  it('refuses client-chosen timestamps', async () => {
    await assertFails(
      setDoc(automationRef(USERS.owner, 'x1'), newRecipe(USERS.owner, { createdAt: seedTs })),
    );
    await assertFails(
      setDoc(automationRef(USERS.owner, 'x2'), newRecipe(USERS.owner, { updatedAt: seedTs })),
    );
  });

  it('refuses a bad shape: extra or missing keys, wrong types, too many actions or conditions', async () => {
    const bad = [
      { extra: 1 },
      { consecutiveFailures: 0 },
      { name: 'x'.repeat(81) },
      { name: 5 },
      { enabled: 'yes' },
      { trigger: 'status_changed' },
      { trigger: { columnId: 'status' } },
      { conditions: 'none' },
      { conditions: [{}, {}, {}, {}] },
      { actions: [] },
      { actions: Array.from({ length: 6 }, () => ({ type: 'archive_item' })) },
      { actions: 'archive_item' },
      { disabledReason: 'x'.repeat(201) },
      { disabledReason: 7 },
    ];
    for (const [i, overrides] of bad.entries()) {
      await assertFails(
        setDoc(automationRef(USERS.owner, `bad${i}`), newRecipe(USERS.owner, overrides)),
      );
    }
    const { name: _name, ...noName } = newRecipe(USERS.owner);
    await assertFails(setDoc(automationRef(USERS.owner, 'noname'), noName));
  });
});

describe('updating and deleting automations', () => {
  it('lets a board owner switch one off with a reason and edit its recipe', async () => {
    await assertSucceeds(
      updateDoc(automationRef(USERS.owner), {
        enabled: false,
        disabledReason: 'Paused by hand',
        ...stamp(USERS.owner),
      }),
    );
    await assertSucceeds(
      updateDoc(automationRef(USERS.admin), {
        name: 'Renamed',
        actions: [{ type: 'rename_item', template: '{name} done' }],
        ...stamp(USERS.admin),
      }),
    );
  });

  it('lets another owner take a recipe over (runAs becomes them) but not hand it to someone else', async () => {
    await assertSucceeds(
      updateDoc(automationRef(USERS.admin), { runAs: USERS.admin, ...stamp(USERS.admin) }),
    );
    await assertFails(
      updateDoc(automationRef(USERS.admin), { runAs: USERS.member, ...stamp(USERS.admin) }),
    );
  });

  it('refuses an editor, a viewer, a non-member and a signed-out visitor', async () => {
    for (const uid of [USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(updateDoc(automationRef(uid), { enabled: false, ...stamp(uid) }));
      await assertFails(deleteDoc(automationRef(uid)));
    }
    await assertFails(
      updateDoc(doc(anon(), 'boards', MAIN_BOARD, 'automations', 'a1'), { enabled: false }),
    );
    await assertFails(deleteDoc(doc(anon(), 'boards', MAIN_BOARD, 'automations', 'a1')));
  });

  it('keeps createdBy and createdAt immutable and requires the caller stamp', async () => {
    await assertFails(
      updateDoc(automationRef(USERS.owner), { createdBy: USERS.admin, ...stamp(USERS.owner) }),
    );
    await assertFails(
      updateDoc(automationRef(USERS.owner), {
        createdAt: serverTimestamp(),
        ...stamp(USERS.owner),
      }),
    );
    await assertFails(updateDoc(automationRef(USERS.owner), { enabled: false }));
    await assertFails(
      updateDoc(automationRef(USERS.owner), { enabled: false, ...stamp(USERS.admin) }),
    );
  });

  it('refuses a client write to the server-written consecutiveFailures, even a reset to 0', async () => {
    await assertFails(
      updateDoc(automationRef(USERS.owner), { consecutiveFailures: 0, ...stamp(USERS.owner) }),
    );
    await assertFails(
      updateDoc(automationRef(USERS.owner), { consecutiveFailures: 10, ...stamp(USERS.owner) }),
    );
  });

  it('refuses a client write once the server has set consecutiveFailures, unless it is left alone', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'boards', MAIN_BOARD, 'automations', 'a1'), {
        consecutiveFailures: 4,
      });
    });
    await assertSucceeds(
      updateDoc(automationRef(USERS.owner), { enabled: false, ...stamp(USERS.owner) }),
    );
    await assertFails(
      updateDoc(automationRef(USERS.owner), {
        consecutiveFailures: deleteField(),
        ...stamp(USERS.owner),
      }),
    );
  });

  it('lets a board owner delete one', async () => {
    await assertSucceeds(deleteDoc(automationRef(USERS.owner)));
    await assertSucceeds(deleteDoc(automationRef(USERS.admin)));
  });
});

describe('automation runs', () => {
  it('lets board owners get and list them, newest first and by status', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertSucceeds(getDoc(runRef(uid)));
      const col = collection(as(uid), 'boards', MAIN_BOARD, 'automationRuns');
      await assertSucceeds(getDocs(col));
      await assertSucceeds(
        getDocs(query(col, where('automationId', '==', 'a1'), orderBy('startedAt', 'desc'))),
      );
      await assertSucceeds(
        getDocs(query(col, where('status', '==', 'failed'), orderBy('startedAt', 'desc'))),
      );
    }
  });

  it('refuses an editor, a viewer, a non-member and a signed-out visitor', async () => {
    for (const uid of [USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(getDoc(runRef(uid)));
      await assertFails(getDocs(collection(as(uid), 'boards', MAIN_BOARD, 'automationRuns')));
    }
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD, 'automationRuns', 'a1-e1')));
  });

  it('refuses every client write, board owners included', async () => {
    const run = {
      automationId: 'a1',
      eventId: 'e2',
      itemId: 'i1',
      status: 'ok',
      actions: [],
      startedAt: seedTs,
      durationMs: 1,
      depth: 0,
      expiresAt: seedTs,
    };
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(runRef(uid, `new-${uid}`), run));
      await assertFails(updateDoc(runRef(uid), { status: 'failed' }));
      await assertFails(deleteDoc(runRef(uid)));
    }
    await assertFails(setDoc(doc(anon(), 'boards', MAIN_BOARD, 'automationRuns', 'anon'), run));
  });
});

describe('the automation run counter', () => {
  it('gives every client no access, board owners included', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(getDoc(counterRef(uid)));
      await assertFails(setDoc(counterRef(uid), { hourBucket: 'x', runs: 0 }));
      await assertFails(updateDoc(counterRef(uid), { runs: 0 }));
      await assertFails(deleteDoc(counterRef(uid)));
    }
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD, 'counters', 'automations')));
  });
});

describe('the automation marker on items (updatedVia, automationDepth)', () => {
  const edit = (uid: string, fields: Record<string, unknown>) =>
    updateDoc(itemRef(uid), { name: 'Edited', ...stamp(uid), ...fields });

  it('keeps a normal edit working for the owner and the editor', async () => {
    await assertSucceeds(edit(USERS.owner, {}));
    await assertSucceeds(edit(USERS.member, {}));
  });

  it('refuses a client that sets updatedVia or automationDepth on an update', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      await assertFails(edit(uid, { updatedVia: 'automation:a1' }));
      await assertFails(edit(uid, { automationDepth: 1 }));
      await assertFails(edit(uid, { updatedVia: 'automation:a1', automationDepth: 1 }));
      await assertFails(edit(uid, { updatedVia: uid }));
    }
  });

  it('refuses a client that sets them on create', async () => {
    const created = (uid: string, fields: Record<string, unknown>) =>
      setDoc(
        doc(as(uid), 'boards', MAIN_BOARD, 'items', `n-${uid}`),
        itemDoc({
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
          updatedBy: uid,
          ...fields,
        }),
      );
    await assertSucceeds(created(USERS.member, {}));
    await assertFails(created(USERS.owner, { updatedVia: 'automation:a1' }));
    await assertFails(created(USERS.owner, { automationDepth: 2 }));
  });

  it('lets a human edit clear a marker the server set (to null), but never set one', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'boards', MAIN_BOARD, 'items', 'i1'), {
        updatedVia: 'automation:a1',
        automationDepth: 1,
      });
    });
    // An edit that doesn't touch the marker still works (the marker stays until cleared).
    await assertSucceeds(edit(USERS.member, {}));
    await assertSucceeds(edit(USERS.member, { updatedVia: null, automationDepth: null }));
    await assertFails(edit(USERS.member, { updatedVia: 'automation:a2' }));
  });

  it('refuses an editor-only marker write that touches nothing else', async () => {
    await assertFails(updateDoc(itemRef(USERS.member), { updatedVia: 'automation:a1' }));
    await assertFails(updateDoc(itemRef(USERS.viewer), { updatedVia: null }));
  });
});
