import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * P5d time-based automations. Three server-only things: `automations.nextRunAt` (the scheduler's
 * next due time), `items.dateKeys` (the date index the scheduler queries) and
 * `system/automationScheduler` (the scheduler's own state). Clients, board owners included, can
 * create, change or remove none of them. `timezone` on a recipe is client-written.
 */

let env: RulesTestEnvironment;
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const recurring = (overrides: Record<string, unknown> = {}) => ({
  name: 'Weekly check-in',
  enabled: true,
  trigger: { type: 'recurring', every: 'week', weekday: 1, at: '09:00' },
  conditions: [],
  actions: [{ type: 'archive_item' }],
  runAs: USERS.owner,
  disabledReason: null,
  createdBy: USERS.owner,
  createdAt: seedTs,
  updatedBy: USERS.owner,
  updatedAt: seedTs,
  timezone: 'Europe/Madrid',
  ...overrides,
});

const newRecipe = (uid: string, overrides: Record<string, unknown> = {}) =>
  recurring({
    runAs: uid,
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const automationRef = (uid: string, id = 'a1') =>
  doc(as(uid), 'boards', MAIN_BOARD, 'automations', id);
const itemRef = (uid: string, id: string) => doc(as(uid), 'boards', MAIN_BOARD, 'items', id);
const schedulerRef = (uid: string) => doc(as(uid), 'system', 'automationScheduler');
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });
const newItem = (uid: string, overrides: Record<string, unknown> = {}) =>
  itemDoc({
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

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
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'automations', 'a1'),
      recurring({ nextRunAt: seedTs }),
    );
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'dated'),
      itemDoc({ name: 'Dated', dateKeys: ['due:2026-11-20'] }),
    );
    await setDoc(doc(db, 'system', 'automationScheduler'), { lastTickAt: seedTs });
  });
});

describe('automations.nextRunAt is server-only', () => {
  it('refuses creating a recipe with it', async () => {
    await assertFails(
      setDoc(automationRef(USERS.owner, 'n1'), newRecipe(USERS.owner, { nextRunAt: seedTs })),
    );
    await assertFails(
      setDoc(automationRef(USERS.owner, 'n2'), newRecipe(USERS.owner, { nextRunAt: null })),
    );
  });

  it('refuses setting, changing or removing it, board owner included', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      for (const value of [Timestamp.fromMillis(1), null, deleteField()]) {
        await assertFails(updateDoc(automationRef(uid), { nextRunAt: value, ...stamp(uid) }));
      }
    }
  });

  it('refuses smuggling it in with a legitimate edit', async () => {
    await assertFails(
      updateDoc(automationRef(USERS.owner), {
        enabled: false,
        nextRunAt: Timestamp.fromMillis(1),
        ...stamp(USERS.owner),
      }),
    );
  });

  it('still lets an owner edit a recipe that has it set, leaving it alone', async () => {
    await assertSucceeds(
      updateDoc(automationRef(USERS.owner), { enabled: false, ...stamp(USERS.owner) }),
    );
  });
});

describe('scheduled recipes (client side)', () => {
  it('lets a board owner create recurring and date_arrives recipes with a timezone', async () => {
    await assertSucceeds(setDoc(automationRef(USERS.owner, 'r1'), newRecipe(USERS.owner)));
    await assertSucceeds(
      setDoc(
        automationRef(USERS.owner, 'r2'),
        newRecipe(USERS.owner, {
          trigger: { type: 'date_arrives', columnId: 'due', offsetDays: -1, at: '08:00' },
        }),
      ),
    );
  });

  it('lets an owner change the timezone and the trigger', async () => {
    await assertSucceeds(
      updateDoc(automationRef(USERS.owner), {
        timezone: 'America/New_York',
        trigger: { type: 'recurring', every: 'day', at: '07:30' },
        ...stamp(USERS.owner),
      }),
    );
  });

  it('refuses a malformed timezone', async () => {
    await assertFails(
      setDoc(automationRef(USERS.owner, 'z1'), newRecipe(USERS.owner, { timezone: 5 })),
    );
    await assertFails(
      setDoc(
        automationRef(USERS.owner, 'z2'),
        newRecipe(USERS.owner, { timezone: 'x'.repeat(65) }),
      ),
    );
    await assertFails(
      updateDoc(automationRef(USERS.owner), { timezone: ['UTC'], ...stamp(USERS.owner) }),
    );
  });

  it('still lets an owner create and edit a plain recipe without a timezone', async () => {
    const { timezone: _tz, ...plain } = newRecipe(USERS.owner, {
      trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
    });
    await assertSucceeds(setDoc(automationRef(USERS.owner, 'p1'), plain));
    await assertSucceeds(
      updateDoc(automationRef(USERS.owner, 'p1'), { name: 'Renamed', ...stamp(USERS.owner) }),
    );
  });

  it('keeps refusing editors and viewers', async () => {
    for (const uid of [USERS.member, USERS.viewer]) {
      await assertFails(setDoc(automationRef(uid, 'e1'), newRecipe(uid)));
      await assertFails(updateDoc(automationRef(uid), { timezone: 'UTC', ...stamp(uid) }));
    }
  });
});

describe('items.dateKeys is server-only', () => {
  it('lets an editor create an item without it', async () => {
    await assertSucceeds(setDoc(itemRef(USERS.member, 'plain'), newItem(USERS.member)));
  });

  it('refuses creating an item with it', async () => {
    for (const [id, extra] of [
      ['a', { dateKeys: ['due:2026-11-20'] }],
      ['b', { dateKeys: [] }],
    ] as const) {
      await assertFails(setDoc(itemRef(USERS.member, id), newItem(USERS.member, extra)));
      await assertFails(setDoc(itemRef(USERS.owner, id), newItem(USERS.owner, extra)));
    }
  });

  it('refuses changing, adding or removing it, board owner included', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      for (const id of ['dated', 'i1']) {
        // Removing a field the item lacks is a no-op, so deleteField() only counts on 'dated'.
        const values = id === 'dated' ? [['due:2030-01-01'], [], deleteField()] : [['x:1'], []];
        for (const value of values) {
          await assertFails(updateDoc(itemRef(uid, id), { dateKeys: value, ...stamp(uid) }));
        }
      }
    }
  });

  it('refuses smuggling it in with a legitimate edit', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'dated'), {
        name: 'Renamed',
        dateKeys: ['due:2030-01-01'],
        ...stamp(USERS.member),
      }),
    );
  });

  it('still lets an editor edit an item that has dateKeys', async () => {
    await assertSucceeds(
      updateDoc(itemRef(USERS.member, 'dated'), { name: 'Renamed', ...stamp(USERS.member) }),
    );
  });
});

describe('system/automationScheduler is closed to clients', () => {
  it('refuses every read and write, for any signed-in user and for visitors', async () => {
    const anon = env.unauthenticatedContext().firestore();
    for (const ref of [
      schedulerRef(USERS.owner),
      schedulerRef(USERS.admin),
      schedulerRef(USERS.member),
      schedulerRef(USERS.outsider),
      doc(anon, 'system', 'automationScheduler'),
    ]) {
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { lastTickAt: seedTs }));
      await assertFails(updateDoc(ref, { lastTickAt: seedTs }));
    }
  });
});
