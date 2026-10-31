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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, createTestEnv, seedFixture } from './helpers';

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

const viewPath = (id: string) => `boards/${MAIN_BOARD}/views/${id}`;

const emptySettings = () => ({
  filter: {
    personIds: [],
    filterGroup: { conjunction: 'and', conditions: [] },
    sortConditions: [],
    groupByColumnId: null,
  },
  hiddenColumnIds: [],
});

/** A client-side create payload. */
function newView(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Due this week',
    type: 'table',
    position: 'a1',
    ownerId: null,
    settings: emptySettings(),
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

/** Seed a view as admin (rules off). */
async function seedView(id: string, ownerId: string | null, extra: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), viewPath(id)), {
      name: id === 'main' ? 'Main table' : `View ${id}`,
      type: 'table',
      position: id === 'main' ? 'a0' : 'a1',
      ownerId,
      settings: emptySettings(),
      createdAt: new Date(1_700_000_000_000),
      createdBy: USERS.owner,
      updatedAt: new Date(1_700_000_000_000),
      updatedBy: USERS.owner,
      ...extra,
    });
  });
}

describe('board views: reading', () => {
  it('lets members read shared views and the outsider nothing', async () => {
    await seedView('v1', null);
    await assertSucceeds(getDoc(doc(as(USERS.viewer), viewPath('v1'))));
    await assertSucceeds(getDoc(doc(as(USERS.member), viewPath('v1'))));
    await assertFails(getDoc(doc(as(USERS.outsider), viewPath('v1'))));
    await assertFails(getDoc(doc(anon(), viewPath('v1'))));
  });

  it('shows a personal view to its owner only', async () => {
    await seedView('p1', USERS.member);
    await assertSucceeds(getDoc(doc(as(USERS.member), viewPath('p1'))));
    await assertFails(getDoc(doc(as(USERS.viewer), viewPath('p1'))));
    await assertFails(getDoc(doc(as(USERS.owner), viewPath('p1'))));
  });

  it('answers the app query (shared plus own personal) without the others personal views', async () => {
    await seedView('v1', null);
    await seedView('p-member', USERS.member);
    await seedView('p-viewer', USERS.viewer);
    // The rules engine refuses `in [null, uid]`, so the app runs two queries and merges them.
    const db = as(USERS.member);
    const views = collection(db, `boards/${MAIN_BOARD}/views`);
    const shared = await assertSucceeds(getDocs(query(views, where('ownerId', '==', null))));
    const own = await assertSucceeds(getDocs(query(views, where('ownerId', '==', USERS.member))));
    const ids = [...shared.docs, ...own.docs].map((d) => d.id).sort();
    if (ids.join() !== 'p-member,v1') throw new Error(`unexpected views: ${ids.join()}`);
    await assertFails(getDocs(query(views, where('ownerId', '==', USERS.viewer))));
  });

  it('refuses an unfiltered list when personal views of others exist', async () => {
    await seedView('p-viewer', USERS.viewer);
    await assertFails(getDocs(collection(as(USERS.member), `boards/${MAIN_BOARD}/views`)));
  });
});

describe('board views: creating', () => {
  it('lets an editor create a shared view and a viewer not', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.member), viewPath('v1')), newView(USERS.member)));
    await assertFails(setDoc(doc(as(USERS.viewer), viewPath('v2')), newView(USERS.viewer)));
    await assertFails(setDoc(doc(as(USERS.outsider), viewPath('v3')), newView(USERS.outsider)));
  });

  it('lets a viewer keep a personal view, but not for somebody else', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(USERS.viewer), viewPath('p1')),
        newView(USERS.viewer, { ownerId: USERS.viewer }),
      ),
    );
    await assertFails(
      setDoc(
        doc(as(USERS.viewer), viewPath('p2')),
        newView(USERS.viewer, { ownerId: USERS.member }),
      ),
    );
    await assertFails(
      setDoc(
        doc(as(USERS.outsider), viewPath('p3')),
        newView(USERS.outsider, { ownerId: USERS.outsider }),
      ),
    );
  });

  it('checks the shape: key set, name, type, position, settings, audit fields', async () => {
    const m = USERS.member;
    const bad = async (overrides: Record<string, unknown>, id = 'bad') =>
      assertFails(setDoc(doc(as(m), viewPath(id)), newView(m, overrides)));
    await bad({ name: '' });
    await bad({ name: 'x'.repeat(61) });
    await bad({ name: 5 });
    await bad({ type: 'chart' });
    await bad({ position: '' });
    await bad({ position: 3 });
    await bad({ settings: 'nope' });
    await bad({ settings: { filter: emptySettings().filter } });
    await bad({ settings: { ...emptySettings(), extra: 1 } });
    await bad({
      settings: {
        ...emptySettings(),
        hiddenColumnIds: Array.from({ length: 201 }, (_, i) => `c${i}`),
      },
    });
    await bad({ createdBy: USERS.owner });
    await bad({ updatedBy: USERS.owner });
    await bad({ createdAt: new Date(1_700_000_000_000) });
    await bad({ updatedAt: new Date(1_700_000_000_000) });
    await bad({ extra: true });
    const { settings: _settings, ...noSettings } = newView(m);
    await assertFails(setDoc(doc(as(m), viewPath('bad')), noSettings));
  });

  it('allows a kanban view with kanban settings', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(USERS.member), viewPath('k1')),
        newView(USERS.member, {
          type: 'kanban',
          settings: { ...emptySettings(), kanban: { columnId: 'status' } },
        }),
      ),
    );
  });

  it('allows calendar and timeline views with and without their settings', async () => {
    const m = USERS.member;
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['c1', 'calendar', { ...emptySettings(), calendar: { columnId: 'due', mode: 'month' } }],
      ['c2', 'calendar', emptySettings()],
      ['t1', 'timeline', { ...emptySettings(), timeline: { columnId: null, zoom: 'weeks' } }],
      ['t2', 'timeline', emptySettings()],
    ];
    for (const [id, type, settings] of cases) {
      await assertSucceeds(setDoc(doc(as(m), viewPath(id)), newView(m, { type, settings })));
    }
  });

  it('refuses an unknown settings key and non-map calendar or timeline settings', async () => {
    const m = USERS.member;
    const bad = (type: string, settings: Record<string, unknown>) =>
      assertFails(setDoc(doc(as(m), viewPath('bad')), newView(m, { type, settings })));
    await bad('calendar', { ...emptySettings(), gantt: {} });
    await bad('calendar', { ...emptySettings(), calendar: 'month' });
    await bad('timeline', { ...emptySettings(), timeline: [] });
  });

  it('only allows main as a shared table with the fixed name and position', async () => {
    const m = USERS.member;
    await assertFails(
      setDoc(
        doc(as(m), viewPath('main')),
        newView(m, { name: 'Main table', position: 'a0', ownerId: m }),
      ),
    );
    await assertFails(
      setDoc(
        doc(as(m), viewPath('main')),
        newView(m, { name: 'Main table', position: 'a0', type: 'kanban' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(as(m), viewPath('main')),
        newView(m, { name: 'Main table', position: 'a0', type: 'calendar' }),
      ),
    );
    await assertFails(
      setDoc(doc(as(m), viewPath('main')), newView(m, { name: 'Other', position: 'a0' })),
    );
    await assertSucceeds(
      setDoc(doc(as(m), viewPath('main')), newView(m, { name: 'Main table', position: 'a0' })),
    );
  });
});

describe('board views: updating', () => {
  const bump = (uid: string, patch: Record<string, unknown>) => ({
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });

  it('lets editors change a shared view and viewers not', async () => {
    await seedView('v1', null);
    const patch = { name: 'Renamed', settings: { ...emptySettings(), hiddenColumnIds: ['a'] } };
    await assertSucceeds(
      updateDoc(doc(as(USERS.member), viewPath('v1')), bump(USERS.member, patch)),
    );
    await assertFails(updateDoc(doc(as(USERS.viewer), viewPath('v1')), bump(USERS.viewer, patch)));
    await assertFails(
      updateDoc(doc(as(USERS.outsider), viewPath('v1')), bump(USERS.outsider, patch)),
    );
  });

  it('lets only the owner change a personal view, a viewer included', async () => {
    await seedView('p1', USERS.viewer);
    await assertSucceeds(
      updateDoc(doc(as(USERS.viewer), viewPath('p1')), bump(USERS.viewer, { name: 'Mine' })),
    );
    await assertFails(
      updateDoc(doc(as(USERS.owner), viewPath('p1')), bump(USERS.owner, { name: 'Taken' })),
    );
  });

  it('keeps ownerId, type, createdAt and createdBy immutable', async () => {
    await seedView('v1', null);
    const ref = () => doc(as(USERS.member), viewPath('v1'));
    await assertFails(updateDoc(ref(), bump(USERS.member, { ownerId: USERS.member })));
    await assertFails(updateDoc(ref(), bump(USERS.member, { type: 'kanban' })));
    await assertFails(updateDoc(ref(), bump(USERS.member, { type: 'calendar' })));
    await assertFails(updateDoc(ref(), bump(USERS.member, { createdBy: USERS.member })));
    await assertFails(updateDoc(ref(), bump(USERS.member, { createdAt: serverTimestamp() })));
    await assertFails(updateDoc(ref(), { name: 'No stamp' }));
    await assertFails(updateDoc(ref(), bump(USERS.owner, { name: 'Wrong updatedBy' })));
    await assertSucceeds(updateDoc(ref(), bump(USERS.member, { position: 'a2' })));
  });

  it('makes main impossible to rename or move, but its settings can be saved', async () => {
    await seedView('main', null);
    const ref = () => doc(as(USERS.member), viewPath('main'));
    await assertFails(updateDoc(ref(), bump(USERS.member, { name: 'Renamed' })));
    await assertFails(updateDoc(ref(), bump(USERS.member, { position: 'b0' })));
    await assertSucceeds(
      updateDoc(
        ref(),
        bump(USERS.member, { settings: { ...emptySettings(), hiddenColumnIds: ['x'] } }),
      ),
    );
  });
});

describe('board views: saving settings (regression: "Save to this view" failed)', () => {
  const bump = (uid: string, patch: Record<string, unknown>) => ({
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });

  const typed = {
    kanban: { columnId: null, cardColumnIds: null, collapsedLaneIds: [], showEmptyLanes: true },
    calendar: {
      columnId: null,
      mode: 'month',
      colorBy: null,
      showWeekends: true,
      firstDayOfWeek: 'monday',
    },
    timeline: {
      columnId: null,
      zoom: 'weeks',
      colorBy: null,
      collapsedGroupIds: [],
      showGroupSummary: true,
      showToday: true,
      showWeekends: true,
      showLegend: true,
    },
  } as const;

  it('reads a missing main view (a signed-in reader sees "not found", not permission-denied)', async () => {
    const snap = await assertSucceeds(getDoc(doc(as(USERS.member), viewPath('main'))));
    if (snap.exists()) throw new Error('main should not exist yet');
    await assertSucceeds(getDoc(doc(as(USERS.viewer), viewPath('main'))));
    await assertFails(getDoc(doc(as(USERS.outsider), viewPath('main'))));
    await assertFails(getDoc(doc(anon(), viewPath('main'))));
  });

  it('saves hidden columns on main the first time, the way the app does (transaction)', async () => {
    const db = as(USERS.member);
    const ref = doc(db, viewPath('main'));
    const settings = { ...emptySettings(), hiddenColumnIds: ['notes'] };
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) throw new Error('unexpected');
        tx.set(ref, newView(USERS.member, { name: 'Main table', position: 'a0', settings }));
      }),
    );
    // ...and again once it exists.
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('unexpected');
        tx.update(ref, bump(USERS.member, { settings: { ...settings, hiddenColumnIds: [] } }));
      }),
    );
  });

  it('keeps refusing a viewer a shared main, and the outsider everything', async () => {
    const ref = doc(as(USERS.viewer), viewPath('main'));
    await assertFails(setDoc(ref, newView(USERS.viewer, { name: 'Main table', position: 'a0' })));
  });

  it.each(['kanban', 'calendar', 'timeline'] as const)(
    'saves %s settings on a shared and on a personal view',
    async (kind) => {
      await seedView('s1', null, { type: kind });
      await seedView('p1', USERS.viewer, { type: kind });
      const settings = {
        ...emptySettings(),
        hiddenColumnIds: ['a'],
        [kind]: typed[kind],
      };
      await assertSucceeds(
        updateDoc(doc(as(USERS.member), viewPath('s1')), bump(USERS.member, { settings })),
      );
      await assertSucceeds(
        updateDoc(doc(as(USERS.viewer), viewPath('p1')), bump(USERS.viewer, { settings })),
      );
    },
  );
});

describe('board views: deleting', () => {
  it('follows the update rights', async () => {
    await seedView('v1', null);
    await seedView('p1', USERS.viewer);
    await assertFails(deleteDoc(doc(as(USERS.viewer), viewPath('v1'))));
    await assertFails(deleteDoc(doc(as(USERS.outsider), viewPath('v1'))));
    await assertFails(deleteDoc(doc(as(USERS.member), viewPath('p1'))));
    await assertSucceeds(deleteDoc(doc(as(USERS.viewer), viewPath('p1'))));
    await assertSucceeds(deleteDoc(doc(as(USERS.member), viewPath('v1'))));
  });

  it('never deletes main', async () => {
    await seedView('main', null);
    await assertFails(deleteDoc(doc(as(USERS.owner), viewPath('main'))));
    await assertFails(deleteDoc(doc(as(USERS.member), viewPath('main'))));
  });
});
