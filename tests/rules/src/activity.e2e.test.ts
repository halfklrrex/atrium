import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { activityEventSchema } from '@atrium/shared';
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as ActivityModule from '../../../functions/src/lib/activity';
import type * as AdminActivityModule from '../../../functions/src/lib/admin-activity';
import type * as AdminModule from '../../../functions/src/lib/admin';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator: a client edit goes through the security rules, then the
 * real Admin SDK adapter of the activity log (functions/src/lib/admin-activity.ts) and the real
 * logic (functions/src/lib/activity.ts) log it, and the entry is read back through the rules.
 *
 * What runs for real: the rules, the Admin adapter, the logic, the TTL field and the shared schema.
 * What is simulated: Cloud Functions trigger delivery (the emulator run by `pnpm test:rules` has no
 * Functions emulator), so the test hands the trigger's `before` / `after` snapshots, taken from the
 * emulator around the client write, to the same functions the triggers call. Runs through
 * `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let logic: typeof ActivityModule;
let adapter: typeof AdminActivityModule;
let admin: typeof AdminModule;

const BOARD = 'boardActivityE2e';
const columns = [
  { id: 'status', type: 'text', title: 'Stage', position: 'a0', settings: {} },
  { id: 'calc', type: 'formula', title: 'Calc', position: 'a1', settings: {} },
];
const groups = [{ id: 'g1', title: 'To do', color: '#579bfc', position: 'a0' }];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  adapter = await import('../../../functions/src/lib/admin-activity');
  logic = await import('../../../functions/src/lib/activity');
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
    await setDoc(doc(db, 'boards', BOARD), boardDoc({ columns, groups }));
    await setDoc(
      doc(db, 'boards', BOARD, 'items', 'i1'),
      itemDoc({ name: 'Write spec', values: { status: 'Open' } }),
    );
  });
});

const member = () => env.authenticatedContext(USERS.member).firestore();
const activityOf = (uid: string) =>
  getDocs(collection(env.authenticatedContext(uid).firestore(), 'boards', BOARD, 'activity'));
const snap = async (path: string[]) => (await admin.db().doc(path.join('/')).get()).data()!;

describe('activity log against the emulator', () => {
  it('a client cell edit produces one value_changed, readable by a viewer and not by an outsider', async () => {
    const itemPath = ['boards', BOARD, 'items', 'i1'];
    const before = await snap(itemPath);
    await updateDoc(doc(member(), itemPath.join('/')), {
      'values.status': 'Done',
      updatedAt: serverTimestamp(),
      updatedBy: USERS.member,
    });
    const after = await snap(itemPath);

    const store = adapter.adminActivityStore(admin.db());
    const created = await logic.recordItemActivity(store, {
      eventId: 'evt-cell-1',
      boardId: BOARD,
      itemId: 'i1',
      before,
      after,
    });
    expect(created).toBe(1);

    const seen = await activityOf(USERS.viewer);
    expect(seen.size).toBe(1);
    const entry = seen.docs[0]!;
    expect(entry.id).toBe('evt-cell-1-0');
    expect(entry.data()).toMatchObject({
      kind: 'value_changed',
      actorId: USERS.member,
      actorName: 'Avery Quinn',
      actorPhotoUrl: 'https://example.com/avery.png',
      itemId: 'i1',
      itemName: 'Write spec',
      columnId: 'status',
      columnTitle: 'Stage',
      columnType: 'text',
      data: { fromText: 'Open', toText: 'Done', fromValue: 'Open', toValue: 'Done' },
    });
    // The stored document is what the shared schema (and so the web) expects, TTL included.
    expect(activityEventSchema.safeParse(entry.data()).success).toBe(true);
    const data = entry.data();
    const ttlMs = data.expiresAt.toMillis() - data.createdAt.toMillis();
    expect(Math.round(ttlMs / 86_400_000)).toBe(90);

    await assertFails(activityOf(USERS.outsider));
  });

  it('a retried trigger event writes nothing more', async () => {
    const itemPath = ['boards', BOARD, 'items', 'i1'];
    const before = await snap(itemPath);
    await updateDoc(doc(member(), itemPath.join('/')), {
      name: 'Write the spec',
      updatedAt: serverTimestamp(),
      updatedBy: USERS.member,
    });
    const after = await snap(itemPath);
    const store = adapter.adminActivityStore(admin.db());
    const change = { eventId: 'evt-retry', boardId: BOARD, itemId: 'i1', before, after };
    expect(await logic.recordItemActivity(store, change)).toBe(1);
    expect(await logic.recordItemActivity(store, change)).toBe(0);
    expect((await activityOf(USERS.owner)).size).toBe(1);
  });

  it('server writes that are not edits log nothing (seq numbers, migration values, derived columns)', async () => {
    const firestore = admin.db();
    const ref = firestore.collection('boards').doc(BOARD).collection('items').doc('i1');
    const before = (await ref.get()).data()!;
    // onItemCreated-style write and a column type migration write: no updatedAt change.
    await ref.update({ seq: 7, boardSeq: 3, 'values.status': 'Converted' });
    const after = (await ref.get()).data()!;
    const store = adapter.adminActivityStore(firestore);
    expect(
      await logic.recordItemActivity(store, {
        eventId: 'evt-server',
        boardId: BOARD,
        itemId: 'i1',
        before,
        after,
      }),
    ).toBe(0);
    expect((await activityOf(USERS.owner)).size).toBe(0);
  });

  it('a client board rename is attributed to updatedBy, and the onBoardColumnsWritten write adds no entry', async () => {
    const boardPath = `boards/${BOARD}`;
    const store = adapter.adminActivityStore(admin.db());

    const before = await snap(boardPath.split('/'));
    await updateDoc(doc(member(), boardPath), {
      name: 'Roadmap 2027',
      updatedAt: serverTimestamp(),
      updatedBy: USERS.member,
    });
    const renamed = await snap(boardPath.split('/'));
    expect(
      await logic.recordBoardActivity(store, {
        eventId: 'evt-board-1',
        boardId: BOARD,
        before,
        after: renamed,
      }),
    ).toBe(1);

    // What onBoardColumnsWritten does after a column change: it only maintains derivedColumnIds.
    await admin
      .db()
      .doc(boardPath)
      .update({ derivedColumnIds: ['calc'] });
    const maintained = await snap(boardPath.split('/'));
    expect(
      await logic.recordBoardActivity(store, {
        eventId: 'evt-board-2',
        boardId: BOARD,
        before: renamed,
        after: maintained,
      }),
    ).toBe(0);

    const seen = await activityOf(USERS.viewer);
    expect(seen.size).toBe(1);
    expect(seen.docs[0]!.data()).toMatchObject({
      kind: 'board_renamed',
      actorId: USERS.member,
      actorName: 'Avery Quinn',
      data: { fromText: 'Board', toText: 'Roadmap 2027' },
    });
  });

  it('a callable transaction writes its entry with the real adapter', async () => {
    const firestore = admin.db();
    const id = adapter.newActivityId(firestore, BOARD);
    await firestore.runTransaction(async (tx) => {
      const profiles = await adapter.getMemberProfilesTx(firestore, tx, WS, [USERS.member]);
      const doc = logic.activityDoc(
        logic.actorOf(USERS.member, profiles.get(USERS.member)),
        'board_kind_changed',
        { data: { fromKind: 'main', toKind: 'private' } },
      );
      adapter.appendActivityTx(firestore, tx, BOARD, id, doc);
    });
    const seen = await activityOf(USERS.owner);
    expect(seen.docs.map((d) => d.id)).toEqual([id]);
    expect(seen.docs[0]!.data()).toMatchObject({
      kind: 'board_kind_changed',
      actorName: 'Avery Quinn',
      data: { fromKind: 'main', toKind: 'private' },
    });
    expect(activityEventSchema.safeParse(seen.docs[0]!.data()).success).toBe(true);
  });
});
