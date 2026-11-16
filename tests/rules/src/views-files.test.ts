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

const filesSettings = () => ({
  columnIds: null,
  kinds: [],
  sort: 'newest',
  includeUpdates: true,
});

function newView(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Files',
    type: 'files',
    position: 'a1',
    ownerId: null,
    settings: { ...emptySettings(), files: filesSettings() },
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

async function seedFiles(id: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), viewPath(id)), {
      name: 'Files',
      type: 'files',
      position: 'a1',
      ownerId: null,
      settings: { ...emptySettings(), files: filesSettings() },
      createdAt: new Date(1_700_000_000_000),
      createdBy: USERS.owner,
      updatedAt: new Date(1_700_000_000_000),
      updatedBy: USERS.owner,
    });
  });
}

describe('files views', () => {
  it('lets a board editor create a files view, with and without its settings', async () => {
    const m = USERS.member;
    await assertSucceeds(setDoc(doc(as(m), viewPath('f1')), newView(m)));
    await assertSucceeds(
      setDoc(doc(as(m), viewPath('f2')), newView(m, { settings: emptySettings() })),
    );
  });

  it('denies a viewer a shared files view', async () => {
    const v = USERS.viewer;
    await assertFails(setDoc(doc(as(v), viewPath('f1')), newView(v)));
  });

  it('refuses non-map files settings and an unknown settings key', async () => {
    const m = USERS.member;
    const bad = (settings: Record<string, unknown>) =>
      assertFails(setDoc(doc(as(m), viewPath('bad')), newView(m, { settings })));
    await bad({ ...emptySettings(), files: 'newest' });
    await bad({ ...emptySettings(), files: [] });
    await bad({ ...emptySettings(), fils: filesSettings() });
  });

  it('lets a board editor update a files view and refuses a viewer', async () => {
    await seedFiles('f1');
    const settings = {
      ...emptySettings(),
      files: { ...filesSettings(), sort: 'name', kinds: ['pdf'] },
    };
    const change = (uid: string) => ({ settings, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(updateDoc(doc(as(USERS.member), viewPath('f1')), change(USERS.member)));
    await assertFails(updateDoc(doc(as(USERS.viewer), viewPath('f1')), change(USERS.viewer)));
  });

  it('still refuses an unknown view type', async () => {
    const m = USERS.member;
    await assertFails(setDoc(doc(as(m), viewPath('x1')), newView(m, { type: 'gallery' })));
  });
});
