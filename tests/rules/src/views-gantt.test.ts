import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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

const ganttSettings = () => ({
  columnId: null,
  zoom: 'weeks',
  colorBy: null,
  collapsedGroupIds: [],
  showGroupSummary: true,
  showToday: true,
  showWeekends: true,
  showLegend: true,
  dependencyColumnId: null,
  baselineColumnId: null,
  showBaseline: true,
  showCriticalPath: false,
});

function newView(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Gantt',
    type: 'gantt',
    position: 'a1',
    ownerId: null,
    settings: { ...emptySettings(), gantt: ganttSettings() },
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

async function seedGantt(id: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), viewPath(id)), {
      name: 'Gantt',
      type: 'gantt',
      position: 'a1',
      ownerId: null,
      settings: { ...emptySettings(), gantt: ganttSettings() },
      createdAt: new Date(1_700_000_000_000),
      createdBy: USERS.owner,
      updatedAt: new Date(1_700_000_000_000),
      updatedBy: USERS.owner,
    });
  });
}

describe('gantt views', () => {
  it('lets a board editor create a gantt view, with and without its settings', async () => {
    const m = USERS.member;
    await assertSucceeds(setDoc(doc(as(m), viewPath('g1')), newView(m)));
    await assertSucceeds(
      setDoc(doc(as(m), viewPath('g2')), newView(m, { settings: emptySettings() })),
    );
  });

  it('denies a viewer a shared gantt view', async () => {
    const v = USERS.viewer;
    await assertFails(setDoc(doc(as(v), viewPath('g1')), newView(v)));
  });

  it('refuses non-map gantt settings and an unknown settings key', async () => {
    const m = USERS.member;
    const bad = (settings: Record<string, unknown>) =>
      assertFails(setDoc(doc(as(m), viewPath('bad')), newView(m, { settings })));
    await bad({ ...emptySettings(), gantt: 'weeks' });
    await bad({ ...emptySettings(), gantt: [] });
    await bad({ ...emptySettings(), gnatt: ganttSettings() });
  });

  it('lets a board editor update a gantt view and refuses a viewer', async () => {
    await seedGantt('g1');
    const settings = {
      ...emptySettings(),
      gantt: { ...ganttSettings(), zoom: 'days', showCriticalPath: true },
    };
    const change = (uid: string) => ({ settings, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(updateDoc(doc(as(USERS.member), viewPath('g1')), change(USERS.member)));
    await assertFails(updateDoc(doc(as(USERS.viewer), viewPath('g1')), change(USERS.viewer)));
  });
});
