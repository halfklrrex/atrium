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

const workloadSettings = () => ({
  columnId: null,
  peopleColumnId: null,
  zoom: 'weeks',
  measure: 'count',
  sumColumnId: null,
  capacityPerDay: null,
  showWeekends: true,
  showToday: true,
});

function newView(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Workload',
    type: 'workload',
    position: 'a1',
    ownerId: null,
    settings: { ...emptySettings(), workload: workloadSettings() },
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

async function seedWorkload(id: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), viewPath(id)), {
      name: 'Workload',
      type: 'workload',
      position: 'a1',
      ownerId: null,
      settings: { ...emptySettings(), workload: workloadSettings() },
      createdAt: new Date(1_700_000_000_000),
      createdBy: USERS.owner,
      updatedAt: new Date(1_700_000_000_000),
      updatedBy: USERS.owner,
    });
  });
}

describe('workload views', () => {
  it('lets a board editor create a workload view, with and without its settings', async () => {
    const m = USERS.member;
    await assertSucceeds(setDoc(doc(as(m), viewPath('w1')), newView(m)));
    await assertSucceeds(
      setDoc(doc(as(m), viewPath('w2')), newView(m, { settings: emptySettings() })),
    );
  });

  it('denies a viewer a shared workload view', async () => {
    const v = USERS.viewer;
    await assertFails(setDoc(doc(as(v), viewPath('w1')), newView(v)));
  });

  it('refuses non-map workload settings and an unknown settings key', async () => {
    const m = USERS.member;
    const bad = (settings: Record<string, unknown>) =>
      assertFails(setDoc(doc(as(m), viewPath('bad')), newView(m, { settings })));
    await bad({ ...emptySettings(), workload: 'weeks' });
    await bad({ ...emptySettings(), workload: [] });
    await bad({ ...emptySettings(), wokrload: workloadSettings() });
  });

  it('lets a board editor update a workload view and refuses a viewer', async () => {
    await seedWorkload('w1');
    const settings = {
      ...emptySettings(),
      workload: { ...workloadSettings(), zoom: 'days', measure: 'sum', capacityPerDay: 6 },
    };
    const change = (uid: string) => ({ settings, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(updateDoc(doc(as(USERS.member), viewPath('w1')), change(USERS.member)));
    await assertFails(updateDoc(doc(as(USERS.viewer), viewPath('w1')), change(USERS.viewer)));
  });
});
