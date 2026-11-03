import { activityEventSchema } from '@atrium/shared';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as ActivityModule from '../../../functions/src/lib/activity';
import type * as AdminActivityModule from '../../../functions/src/lib/admin-activity';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type { FieldValue as FieldValueType } from 'firebase-admin/firestore';
import type * as ColumnActionsModule from '../../../functions/src/lib/column-actions';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator: `clickButtonInTransaction` runs with the real Admin SDK
 * adapter (`adminColumnActionsTx`) and writes the item patch plus the `button_clicked` entry. The
 * item's before / after snapshots are then handed to the same `recordItemActivity` the Firestore
 * trigger calls (trigger delivery itself is simulated, as in `activity.e2e.test.ts`), so the click's
 * changes are logged with the clicking user as the actor. Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let logic: typeof ActivityModule;
let adapter: typeof AdminActivityModule;
let admin: typeof AdminModule;
let actions: typeof ColumnActionsModule;
let FieldValue: typeof FieldValueType;

const BOARD = 'boardButtonActionsE2e';
const buttonActions = [
  { type: 'set_value', columnId: 'stage', value: 'Done' },
  { type: 'rename_item', template: '{name} (shipped)' },
  { type: 'move_to_group', groupId: 'g2' },
];
const columns = [
  { id: 'stage', type: 'text', title: 'Stage', position: 'a0', settings: {} },
  {
    id: 'ship',
    type: 'button',
    title: 'Ship',
    position: 'a1',
    settings: { label: 'Ship', color: '#579bfc', actions: buttonActions },
  },
];
const groups = [
  { id: 'g1', title: 'To do', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Done', color: '#00c875', position: 'a1' },
];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  adapter = await import('../../../functions/src/lib/admin-activity');
  logic = await import('../../../functions/src/lib/activity');
  actions = await import('../../../functions/src/lib/column-actions');
  ({ FieldValue } = await import('firebase-admin/firestore'));
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS, 'members', USERS.member), {
      displayName: 'Avery Quinn',
      photoURL: 'https://example.com/avery.png',
    });
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({
        access: { [USERS.owner]: 'owner', [USERS.member]: 'editor' },
        columns,
        groups,
        serverManagedColumnIds: ['ship'],
      }),
    );
    await setDoc(
      doc(db, 'boards', BOARD, 'items', 'i1'),
      itemDoc({ name: 'Write spec', values: { stage: 'Open' } }),
    );
  });
});

const snap = async () =>
  (await admin.db().collection('boards').doc(BOARD).collection('items').doc('i1').get()).data()!;
const click = (uid: string) => {
  const firestore = admin.db();
  return firestore.runTransaction((tx) =>
    actions.clickButtonInTransaction(
      admin.adminColumnActionsTx(firestore, tx),
      uid,
      { boardId: BOARD, itemId: 'i1', columnId: 'ship' },
      FieldValue.serverTimestamp(),
    ),
  );
};

describe('button actions against the emulator', () => {
  it('a click sets the status, renames and moves the item, and the changes are logged for the clicker', async () => {
    const before = await snap();
    const result = await click(USERS.member);
    expect(result.applied.map((a) => a.type)).toEqual([
      'set_value',
      'rename_item',
      'move_to_group',
    ]);
    const after = await snap();

    expect(after).toMatchObject({
      name: 'Write spec (shipped)',
      groupId: 'g2',
      values: { stage: 'Done' },
      updatedBy: USERS.member,
    });

    const store = adapter.adminActivityStore(admin.db());
    const created = await logic.recordItemActivity(store, {
      eventId: 'evt-click-1',
      boardId: BOARD,
      itemId: 'i1',
      before,
      after,
    });
    expect(created).toBeGreaterThanOrEqual(3);

    const seen = await getDocs(
      collection(env.authenticatedContext(USERS.viewer).firestore(), 'boards', BOARD, 'activity'),
    );
    const kinds = seen.docs.map((d) => d.data().kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['button_clicked', 'value_changed', 'item_renamed', 'item_moved']),
    );
    for (const entry of seen.docs) {
      expect(entry.data()).toMatchObject({ actorId: USERS.member, actorName: 'Avery Quinn' });
      expect(activityEventSchema.safeParse(entry.data()).success).toBe(true);
    }
    const clicked = seen.docs.find((d) => d.data().kind === 'button_clicked')!;
    expect(clicked.data().data.actions).toEqual(['set_value', 'rename_item', 'move_to_group']);
  });

  it('an invalid action writes nothing, not even the activity entry', async () => {
    await admin
      .db()
      .collection('boards')
      .doc(BOARD)
      .update({ groups: [groups[0]] });
    const before = await snap();
    await expect(click(USERS.member)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await snap()).toEqual(before);
    const seen = await admin.db().collection('boards').doc(BOARD).collection('activity').get();
    expect(seen.size).toBe(0);
  });
});
