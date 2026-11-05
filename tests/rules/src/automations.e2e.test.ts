import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldValue as FieldValueType } from 'firebase-admin/firestore';
import type * as ActivityModule from '../../../functions/src/lib/activity';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminActivityModule from '../../../functions/src/lib/admin-activity';
import type * as AdminAutomationsModule from '../../../functions/src/lib/admin-automations';
import type * as AdminNotificationsModule from '../../../functions/src/lib/admin-notifications';
import type * as ColumnActionsModule from '../../../functions/src/lib/column-actions';
import type * as RunModule from '../../../functions/src/lib/automations/run';
import type * as AdminItemSeqModule from '../../../functions/src/lib/admin-item-seq';
import type * as ItemSeqModule from '../../../functions/src/lib/item-seq';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator: the automation runner (`handleActivityEvent`, the
 * logic behind the `onActivityCreated` trigger) runs with the real Admin SDK adapters. Trigger
 * delivery is simulated, as in `activity.e2e.test.ts`: `settle()` hands every new activity entry to
 * the runner and every item write to `recordItemActivity` (the `onItemWrittenActivity` logic) until
 * nothing new appears, which is the chain the deployed triggers would produce. Runs through
 * `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let logic: typeof ActivityModule;
let activityAdapter: typeof AdminActivityModule;
let admin: typeof AdminModule;
let automationsAdapter: typeof AdminAutomationsModule;
let notificationsAdapter: typeof AdminNotificationsModule;
let actions: typeof ColumnActionsModule;
let runner: typeof RunModule;
let FieldValue: typeof FieldValueType;
let itemSeq: typeof ItemSeqModule;
let itemSeqAdapter: typeof AdminItemSeqModule;

const BOARD = 'boardAutomationsE2e';
const CREATOR = USERS.owner;

const columns = [
  { id: 'stage', type: 'text', title: 'Stage', position: 'a0', settings: {} },
  {
    id: 'status',
    type: 'status',
    title: 'Status',
    position: 'a1',
    settings: {
      labels: [
        { id: 'l0', index: 0, label: 'Open', color: '#579bfc' },
        { id: 'l1', index: 1, label: 'Working', color: '#fdab3d' },
        { id: 'l2', index: 2, label: 'Done', color: '#00c875' },
      ],
    },
  },
  { id: 'owner', type: 'people', title: 'Owner', position: 'a3', settings: {} },
  {
    id: 'go',
    type: 'button',
    title: 'Go',
    position: 'a2',
    settings: { label: 'Go', color: '#579bfc', actions: [] },
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
  activityAdapter = await import('../../../functions/src/lib/admin-activity');
  automationsAdapter = await import('../../../functions/src/lib/admin-automations');
  notificationsAdapter = await import('../../../functions/src/lib/admin-notifications');
  logic = await import('../../../functions/src/lib/activity');
  actions = await import('../../../functions/src/lib/column-actions');
  runner = await import('../../../functions/src/lib/automations/run');
  itemSeq = await import('../../../functions/src/lib/item-seq');
  itemSeqAdapter = await import('../../../functions/src/lib/admin-item-seq');
  ({ FieldValue } = await import('firebase-admin/firestore'));
});

afterAll(async () => {
  await env.cleanup();
});

let processed: Set<string>;
let logged: Set<string>;
let counter: number;

beforeEach(async () => {
  processed = new Set();
  logged = new Set();
  counter = 0;
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS, 'members', USERS.owner), {
      displayName: 'Casey Lane',
      photoURL: null,
    });
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({
        access: { [USERS.owner]: 'owner', [USERS.member]: 'editor', [USERS.viewer]: 'viewer' },
        columns,
        groups,
        serverManagedColumnIds: ['go'],
      }),
    );
  });
});

const boardRef = () => admin.db().collection('boards').doc(BOARD);
const itemRef = (id: string) => boardRef().collection('items').doc(id);
const getItem = async (id = 'i1') => (await itemRef(id).get()).data()!;
const runsOf = async () => (await boardRef().collection('automationRuns').get()).docs;
const activityOf = async () => (await boardRef().collection('activity').get()).docs;
const automationOf = async (id: string) =>
  (await boardRef().collection('automations').doc(id).get()).data()!;

async function seedAutomation(id: string, over: Record<string, unknown> = {}) {
  await boardRef()
    .collection('automations')
    .doc(id)
    .set({
      name: id,
      enabled: true,
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'set_value', columnId: 'stage', value: 'Auto' }],
      runAs: CREATOR,
      disabledReason: null,
      createdBy: CREATOR,
      updatedBy: CREATOR,
      ...over,
    });
}

/** A client-created item (rules bypassed in the seed), logged as the activity trigger would. */
async function createItem(id: string, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'boards', BOARD, 'items', id),
      itemDoc({ createdBy: USERS.member, updatedBy: USERS.member, ...over }),
    );
  });
  const after = await getItem(id);
  logged.add(id);
  counter += 1;
  await logic.recordItemActivity(activityAdapter.adminActivityStore(admin.db()), {
    eventId: `create-${counter}`,
    boardId: BOARD,
    itemId: id,
    after,
  });
}

/** A human edit of an item, logged for the human. */
async function humanEdit(uid: string, patch: Record<string, unknown>, id = 'i1') {
  const before = await getItem(id);
  await itemRef(id).update({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  const after = await getItem(id);
  counter += 1;
  await logic.recordItemActivity(activityAdapter.adminActivityStore(admin.db()), {
    eventId: `human-${counter}`,
    boardId: BOARD,
    itemId: id,
    before,
    after,
  });
}

const toInput = (data: FirebaseFirestore.DocumentData): RunModule.ActivityEntryInput => ({
  kind: data.kind,
  actorId: data.actorId,
  itemId: data.itemId ?? null,
  itemName: data.itemName ?? null,
  parentItemId: data.parentItemId ?? null,
  columnId: data.columnId ?? null,
  groupId: data.groupId ?? null,
  data: data.data ?? {},
});

const deps = () => ({
  store: automationsAdapter.adminAutomationStore(admin.db()),
  notifications: notificationsAdapter.adminNotificationStore(admin.db()),
  serverTimestamp: FieldValue.serverTimestamp(),
});

/** Hands one activity entry to the runner, then logs the item write it caused. */
async function handle(entryId: string, itemId = 'i1') {
  const entry = (await boardRef().collection('activity').doc(entryId).get()).data()!;
  const before = (await itemRef(itemId).get()).data();
  const outcomes = await runner.handleActivityEvent(deps(), {
    eventId: entryId,
    boardId: BOARD,
    activity: toInput(entry),
  });
  const after = (await itemRef(itemId).get()).data();
  if (before && after) {
    counter += 1;
    await logic.recordItemActivity(activityAdapter.adminActivityStore(admin.db()), {
      eventId: `item-${counter}`,
      boardId: BOARD,
      itemId,
      before,
      after,
    });
  }
  // Items the run created: `onItemCreated` numbers them, `onItemWrittenActivity` logs them.
  for (const created of (await boardRef().collection('items').get()).docs) {
    if (logged.has(created.id)) continue;
    logged.add(created.id);
    await admin
      .db()
      .runTransaction((tx) =>
        itemSeq.allocateItemNumbers(
          itemSeqAdapter.adminItemSeqTx(admin.db(), tx),
          BOARD,
          created.id,
        ),
      );
    counter += 1;
    await logic.recordItemActivity(activityAdapter.adminActivityStore(admin.db()), {
      eventId: `create-${counter}`,
      boardId: BOARD,
      itemId: created.id,
      after: created.data(),
    });
  }
  return outcomes;
}

/** The deployed triggers, looped until the chain stops. */
async function settle(): Promise<RunModule.RunOutcome[]> {
  const all: RunModule.RunOutcome[] = [];
  for (let round = 0; round < 15; round += 1) {
    const fresh = (await activityOf()).filter((d) => !processed.has(d.id));
    if (fresh.length === 0) return all;
    for (const d of fresh) {
      processed.add(d.id);
      if (d.data().itemId) all.push(...(await handle(d.id, d.data().itemId)));
    }
  }
  throw new Error('the chain did not settle');
}

const click = () => {
  const firestore = admin.db();
  return firestore.runTransaction((tx) =>
    actions.clickButtonInTransaction(
      admin.adminColumnActionsTx(firestore, tx),
      USERS.member,
      { boardId: BOARD, itemId: 'i1', columnId: 'go' },
      FieldValue.serverTimestamp(),
    ),
  );
};

describe('automations engine against the emulator', () => {
  it('item created fires the recipe as its creator, and the write is logged under the automation', async () => {
    await seedAutomation('welcome', { name: 'Welcome' });
    await createItem('i1');
    await settle();

    const item = await getItem();
    expect(item).toMatchObject({
      values: { stage: 'Auto' },
      updatedBy: CREATOR,
      updatedVia: 'automation:welcome',
      automationDepth: 1,
    });
    const runs = await runsOf();
    expect(runs.map((r) => r.id)).toEqual([expect.stringMatching(/^welcome-/)]);
    expect(runs[0]!.data()).toMatchObject({ status: 'ok', actions: ['set_value'], depth: 0 });

    const entries = (await activityOf()).map((d) => d.data());
    const ran = entries.find((e) => e.kind === 'automation_ran')!;
    expect(ran).toMatchObject({ actorId: 'automation:welcome', actorName: 'Welcome' });
    const changed = entries.find((e) => e.kind === 'value_changed' && e.columnId === 'stage')!;
    expect(changed).toMatchObject({ actorId: 'automation:welcome', data: { depth: 1 } });
    // The item_created entry is the human's.
    expect(entries.find((e) => e.kind === 'item_created')).toMatchObject({ actorId: USERS.member });
  });

  it('a later human edit is credited to the human, not to the automation', async () => {
    await seedAutomation('welcome', { name: 'Welcome' });
    await createItem('i1');
    await settle();
    await humanEdit(USERS.member, { 'values.stage': 'Mine' });
    const entries = (await activityOf()).map((d) => d.data());
    const mine = entries.find((e) => e.kind === 'value_changed' && e.data.toText === 'Mine')!;
    expect(mine.actorId).toBe(USERS.member);
    expect(mine.data.depth).toBeUndefined();
  });

  it('status changed fires only for the chosen label', async () => {
    await createItem('i1');
    await seedAutomation('done', {
      trigger: { type: 'status_changed', columnId: 'status', toLabelId: 2 },
      actions: [{ type: 'set_value', columnId: 'stage', value: 'Finished' }],
    });
    await humanEdit(USERS.member, { 'values.status': { index: 1 } });
    await settle();
    expect(await runsOf()).toHaveLength(0);

    await humanEdit(USERS.member, { 'values.status': { index: 2 } });
    await settle();
    expect(await runsOf()).toHaveLength(1);
    expect((await getItem()).values).toMatchObject({ stage: 'Finished', status: { index: 2 } });
  });

  it('button clicked fires the recipe', async () => {
    await createItem('i1');
    await seedAutomation('goes', {
      trigger: { type: 'button_clicked', columnId: 'go' },
      actions: [{ type: 'set_value', columnId: 'stage', value: 'Clicked' }],
    });
    await click();
    await settle();
    expect((await getItem()).values.stage).toBe('Clicked');
    expect((await runsOf()).map((r) => r.data().status)).toEqual(['ok']);
  });

  it('conditions block a run', async () => {
    await createItem('i1');
    await seedAutomation('cond', {
      trigger: { type: 'status_changed', columnId: 'status' },
      conditions: [{ columnId: 'stage', op: 'is', value: 'Ready' }],
    });
    await humanEdit(USERS.member, { 'values.status': { index: 1 } });
    await settle();
    expect(await runsOf()).toHaveLength(0);
    expect((await getItem()).values.stage).toBeUndefined();

    await humanEdit(USERS.member, { 'values.stage': 'Ready' });
    await humanEdit(USERS.member, { 'values.status': { index: 2 } });
    await settle();
    expect((await runsOf()).map((r) => r.data().status)).toEqual(['ok']);
    expect((await getItem()).values.stage).toBe('Auto');
  });

  it('two recipes that undo each other stop at depth 3 with a "loop limit" run', async () => {
    await createItem('i1');
    await seedAutomation('up', {
      trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
      actions: [{ type: 'set_value', columnId: 'status', value: { index: 2 } }],
    });
    await seedAutomation('down', {
      trigger: { type: 'status_changed', columnId: 'status', toLabelId: 2 },
      actions: [{ type: 'set_value', columnId: 'status', value: { index: 1 } }],
    });
    await humanEdit(USERS.member, { 'values.status': { index: 1 } });
    await settle();

    const runs = (await runsOf()).map((r) => r.data());
    expect(runs.filter((r) => r.status === 'ok')).toHaveLength(3);
    expect(
      runs
        .filter((r) => r.status === 'ok')
        .map((r) => r.depth)
        .sort(),
    ).toEqual([0, 1, 2]);
    expect(runs.filter((r) => r.status === 'skipped')).toEqual([
      expect.objectContaining({ reason: 'loop limit', depth: 3 }),
    ]);
    expect((await getItem()).automationDepth).toBe(3);
  });

  it('a recipe does not trigger itself', async () => {
    await createItem('i1');
    await seedAutomation('self', {
      trigger: { type: 'status_changed', columnId: 'status' },
      actions: [{ type: 'set_value', columnId: 'status', value: { index: 2 } }],
    });
    await humanEdit(USERS.member, { 'values.status': { index: 1 } });
    await settle();
    expect(await runsOf()).toHaveLength(1);
  });

  it('skips the 101st run in an hour', async () => {
    const bucket = new Date().toISOString().slice(0, 13);
    await boardRef()
      .collection('counters')
      .doc('automations')
      .set({ hourBucket: bucket, runs: 99 });
    await seedAutomation('welcome');
    await createItem('i1');
    await createItem('i2');
    await settle();

    const runs = (await runsOf()).map((r) => r.data());
    expect(runs.map((r) => r.status).sort()).toEqual(['ok', 'skipped']);
    expect(runs.find((r) => r.status === 'skipped')).toMatchObject({ reason: 'rate limit' });
    expect((await boardRef().collection('counters').doc('automations').get()).data()).toEqual({
      hourBucket: bucket,
      runs: 100,
    });
  });

  it('a creator who lost access is skipped and the automation is switched off', async () => {
    await seedAutomation('welcome', { runAs: USERS.member, createdBy: USERS.member });
    await boardRef().update({
      access: { [USERS.owner]: 'owner', [USERS.member]: 'viewer' },
      accessUids: [USERS.owner, USERS.member],
    });
    await createItem('i1');
    await settle();

    expect((await runsOf()).map((r) => r.data())).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'creator lost access' }),
    ]);
    expect(await automationOf('welcome')).toMatchObject({ enabled: false });
    expect((await automationOf('welcome')).disabledReason).toBeTruthy();
    expect((await getItem()).values.stage).toBeUndefined();
  });

  it('a retry of the same event does not run twice', async () => {
    await seedAutomation('welcome');
    await createItem('i1');
    const [entry] = await activityOf();
    const first = await handle(entry!.id);
    const again = await handle(entry!.id);
    expect(first.map((o) => o.status)).toEqual(['ok']);
    expect(again.map((o) => o.status)).toEqual(['none']);
    expect(await runsOf()).toHaveLength(1);
    expect((await boardRef().collection('counters').doc('automations').get()).data()?.runs).toBe(1);
    expect((await activityOf()).filter((d) => d.data().kind === 'automation_ran')).toHaveLength(1);
  });

  it('the circuit breaker switches a failing recipe off after 10 failures with a single notice', async () => {
    await seedAutomation('broken', {
      name: 'Broken',
      actions: [{ type: 'set_value', columnId: 'missing', value: 'x' }],
    });
    for (let i = 1; i <= 11; i += 1) {
      await createItem(`i${i}`);
      await settle();
    }
    const runs = (await runsOf()).map((r) => r.data());
    expect(runs.filter((r) => r.status === 'failed')).toHaveLength(10);
    expect(await automationOf('broken')).toMatchObject({
      enabled: false,
      consecutiveFailures: 10,
    });
    expect((await automationOf('broken')).disabledReason).toContain('10 failed runs');

    const notices = await admin
      .db()
      .collection('users')
      .doc(CREATOR)
      .collection('notifications')
      .get();
    expect(notices.docs.map((d) => d.data())).toEqual([
      expect.objectContaining({
        kind: 'automation_disabled',
        recipeName: 'Broken',
        actorId: CREATOR,
      }),
    ]);
  });

  it('notify actions deliver an automation notification naming the creator and the recipe', async () => {
    await seedAutomation('tell', {
      name: 'Tell the team',
      actions: [{ type: 'notify', uids: [USERS.member], message: 'New task' }],
    });
    await createItem('i1', { name: 'Write spec' });
    await settle();
    const notes = await admin
      .db()
      .collection('users')
      .doc(USERS.member)
      .collection('notifications')
      .get();
    expect(notes.docs.map((d) => d.data())).toEqual([
      expect.objectContaining({
        kind: 'automation',
        actorId: CREATOR,
        actorName: 'Casey Lane',
        recipeName: 'Tell the team',
        snippet: 'New task',
        itemName: 'Write spec',
      }),
    ]);
  });

  describe('P5c: more triggers and actions', () => {
    const people = (...uids: string[]) => ({
      personsAndTeams: uids.map((id) => ({ id, kind: 'person' })),
    });
    const itemIds = async () => (await boardRef().collection('items').get()).docs.map((d) => d.id);

    it('item moved fires for the chosen group only', async () => {
      await createItem('i1');
      await seedAutomation('moved', {
        trigger: { type: 'item_moved', groupId: 'g2' },
        actions: [{ type: 'set_value', columnId: 'stage', value: 'Moved' }],
      });
      await seedAutomation('elsewhere', {
        trigger: { type: 'item_moved', groupId: 'g9' },
      });
      await humanEdit(USERS.member, { groupId: 'g2' });
      await settle();
      expect((await runsOf()).map((r) => r.id)).toEqual([expect.stringMatching(/^moved-/)]);
      expect((await getItem()).values.stage).toBe('Moved');

      await humanEdit(USERS.member, { groupId: 'g1' });
      await settle();
      expect(await runsOf()).toHaveLength(1);
    });

    it('person assigned fires when someone is added, and honours the person filter', async () => {
      await createItem('i1');
      await seedAutomation('anyone', {
        trigger: { type: 'person_assigned', columnId: 'owner' },
        actions: [{ type: 'set_value', columnId: 'stage', value: 'Assigned' }],
      });
      await seedAutomation('viewer-only', {
        trigger: { type: 'person_assigned', columnId: 'owner', uid: USERS.viewer },
        actions: [{ type: 'set_value', columnId: 'stage', value: 'Viewer' }],
      });
      await humanEdit(USERS.member, { 'values.owner': people(USERS.member) });
      await settle();
      expect((await runsOf()).map((r) => r.id)).toEqual([expect.stringMatching(/^anyone-/)]);
      expect((await getItem()).values.stage).toBe('Assigned');

      // Adding a second person fires the filtered recipe; removing one fires nothing.
      await humanEdit(USERS.member, { 'values.owner': people(USERS.member, USERS.viewer) });
      await settle();
      expect((await runsOf()).map((r) => r.id.split('-')[0]).sort()).toEqual([
        'anyone',
        'anyone',
        'viewer',
      ]);
      await humanEdit(USERS.member, { 'values.owner': people(USERS.viewer) });
      await settle();
      expect(await runsOf()).toHaveLength(3);
    });

    it('create_item makes a numbered item in the chosen group, credited to the automation', async () => {
      await createItem('i1', { name: 'Write spec' });
      await seedAutomation('follow', {
        name: 'Follow up',
        trigger: { type: 'status_changed', columnId: 'status', toLabelId: 2 },
        actions: [
          {
            type: 'create_item',
            name: '{name} follow-up',
            groupId: 'g2',
            values: { stage: 'Review' },
          },
        ],
      });
      await humanEdit(USERS.member, { 'values.status': { index: 2 } });
      await settle();

      const ids = (await itemIds()).filter((id) => id !== 'i1');
      expect(ids).toHaveLength(1);
      const made = await getItem(ids[0]);
      expect(made).toMatchObject({
        name: 'Write spec follow-up',
        groupId: 'g2',
        parentItemId: null,
        state: 'active',
        values: { stage: 'Review' },
        createdBy: CREATOR,
        updatedVia: 'automation:follow',
        automationDepth: 1,
        automationRunId: expect.stringMatching(/^follow-/),
      });
      expect(typeof made.position).toBe('string');
      expect(made.seq).toBeGreaterThan(0);
      expect(made.boardSeq).toBeGreaterThan(0);
      // The trigger item is not stamped by the run.
      expect((await getItem()).updatedVia).toBeUndefined();

      const entries = (await activityOf()).map((d) => d.data());
      expect(entries.find((e) => e.kind === 'item_created' && e.itemId === ids[0])).toMatchObject({
        actorId: 'automation:follow',
        data: { depth: 1 },
      });
      expect((await runsOf()).map((r) => r.data())).toEqual([
        expect.objectContaining({ status: 'ok', actions: ['create_item'], depth: 0 }),
      ]);
      expect(entries.find((e) => e.kind === 'automation_ran')?.data.actions).toEqual([
        'create_item',
      ]);
    });

    it('post_update adds a plain update authored as Automations', async () => {
      await createItem('i1', { name: 'Ship' });
      await seedAutomation('say', {
        name: 'Say it',
        trigger: { type: 'item_moved', groupId: 'g2' },
        actions: [{ type: 'post_update', text: '{name} is done on {date}' }],
      });
      await humanEdit(USERS.member, { groupId: 'g2' });
      await settle();

      const updates = await itemRef('i1').collection('updates').get();
      expect(updates.docs).toHaveLength(1);
      const update = updates.docs[0]!;
      expect(update.data()).toMatchObject({
        itemId: 'i1',
        authorId: 'automation:say',
        authorName: 'Automations',
        authorPhotoUrl: null,
        content: expect.stringMatching(/^Ship is done on \d{4}-\d{2}-\d{2}$/),
        likes: [],
        repliesCount: 0,
      });
      expect((await getItem()).updatesCount).toBe(1);

      // `onUpdateCreated` logs it once, under the automation's name.
      await logic.recordUpdatePosted(activityAdapter.adminActivityStore(admin.db()), {
        eventId: 'upd-1',
        boardId: BOARD,
        itemId: 'i1',
        update: update.data(),
      });
      const posted = (await activityOf()).find((d) => d.data().kind === 'update_posted')!;
      expect(posted.data()).toMatchObject({ actorId: 'automation:say', actorName: 'Automations' });
      expect((await runsOf()).map((r) => r.data().actions)).toEqual([['post_update']]);
    });

    it('a recipe that creates an item in the group it triggers on does not trigger itself', async () => {
      await seedAutomation('again', {
        trigger: { type: 'item_created', groupId: 'g1' },
        actions: [{ type: 'create_item', name: 'Again', groupId: 'g1' }],
      });
      await createItem('i1');
      await settle();
      expect(await itemIds()).toHaveLength(2);
      expect((await runsOf()).map((r) => r.data().status)).toEqual(['ok']);
    });

    it('two recipes that create items for each other stop at depth 3 with a "loop limit" run', async () => {
      await seedAutomation('ping', {
        trigger: { type: 'item_created', groupId: 'g1' },
        actions: [{ type: 'create_item', name: 'Ping', groupId: 'g2' }],
      });
      await seedAutomation('pong', {
        trigger: { type: 'item_created', groupId: 'g2' },
        actions: [{ type: 'create_item', name: 'Pong', groupId: 'g1' }],
      });
      await createItem('i1');
      await settle();

      expect(await itemIds()).toHaveLength(4); // the human's item plus three created ones
      const runs = (await runsOf()).map((r) => r.data());
      expect(
        runs
          .filter((r) => r.status === 'ok')
          .map((r) => r.depth)
          .sort(),
      ).toEqual([0, 1, 2]);
      expect(runs.filter((r) => r.status === 'skipped')).toEqual([
        expect.objectContaining({ reason: 'loop limit', depth: 3 }),
      ]);
    });

    it('create_item counts toward the hourly run limit', async () => {
      const bucket = new Date().toISOString().slice(0, 13);
      await boardRef()
        .collection('counters')
        .doc('automations')
        .set({ hourBucket: bucket, runs: 100 });
      await seedAutomation('make', { actions: [{ type: 'create_item', name: 'X' }] });
      await createItem('i1');
      await settle();
      expect(await itemIds()).toEqual(['i1']);
      expect((await runsOf()).map((r) => r.data())).toEqual([
        expect.objectContaining({ status: 'skipped', reason: 'rate limit' }),
      ]);
    });

    it('an invalid or unsafe recipe is recorded failed and changes nothing', async () => {
      await seedAutomation('bad-group', {
        actions: [
          { type: 'post_update', text: 'Hello' },
          { type: 'create_item', name: 'X', groupId: 'gone' },
        ],
      });
      await seedAutomation('two-creates', {
        actions: [
          { type: 'create_item', name: 'A' },
          { type: 'create_item', name: 'B' },
        ],
      });
      await seedAutomation('derived', {
        actions: [{ type: 'create_item', name: 'A', values: { go: 'x' } }],
      });
      await createItem('i1');
      await settle();

      const runs = (await runsOf()).map((r) => r.data());
      expect(runs.map((r) => r.status)).toEqual(['failed', 'failed', 'failed']);
      expect(await itemIds()).toEqual(['i1']);
      expect((await itemRef('i1').collection('updates').get()).empty).toBe(true);
      expect((await getItem()).updatesCount).toBeUndefined();
    });

    it('a button column ignores the automation-only actions (its settings no longer parse)', async () => {
      await createItem('i1');
      await boardRef().update({
        columns: columns.map((c) =>
          c.id === 'go'
            ? { ...c, settings: { ...c.settings, actions: [{ type: 'create_item', name: 'X' }] } }
            : c,
        ),
      });
      // Stored settings that do not parse fall back to "no actions": the click runs nothing.
      expect(await click()).toMatchObject({ success: true, applied: [] });
      expect(await itemIds()).toEqual(['i1']);
    });
  });
});
