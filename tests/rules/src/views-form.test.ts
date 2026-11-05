import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, createTestEnv, itemDoc, seedFixture } from './helpers';

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

const formSettings = () => ({
  title: 'Request',
  description: '',
  thankYou: 'Thanks',
  targetGroupId: 'g1',
  questions: [{ columnId: 'name', label: 'Name', required: true }],
  acceptingResponses: false,
});

function newView(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Form',
    type: 'form',
    position: 'a1',
    ownerId: null,
    settings: { ...emptySettings(), form: formSettings() },
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...overrides,
  };
}

async function seedForm(id: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), viewPath(id)), {
      name: 'Form',
      type: 'form',
      position: 'a1',
      ownerId: null,
      settings: { ...emptySettings(), form: formSettings() },
      createdAt: new Date(1_700_000_000_000),
      createdBy: USERS.owner,
      updatedAt: new Date(1_700_000_000_000),
      updatedBy: USERS.owner,
    });
  });
}

describe('form views', () => {
  it('lets the board owner and an editor create a form view, with and without its settings', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.owner), viewPath('f1')), newView(USERS.owner)));
    const m = USERS.member;
    await assertSucceeds(setDoc(doc(as(m), viewPath('f2')), newView(m)));
    await assertSucceeds(
      setDoc(doc(as(m), viewPath('f3')), newView(m, { settings: emptySettings() })),
    );
  });

  it('denies a viewer and an outsider a shared form view', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(doc(as(uid), viewPath('f1')), newView(uid)));
    }
  });

  it('refuses non-map form settings and an unknown settings key', async () => {
    const m = USERS.member;
    const bad = (settings: Record<string, unknown>) =>
      assertFails(setDoc(doc(as(m), viewPath('bad')), newView(m, { settings })));
    await bad({ ...emptySettings(), form: 'on' });
    await bad({ ...emptySettings(), form: [] });
    await bad({ ...emptySettings(), forms: formSettings() });
  });

  it('keeps the type allow-list: an unknown view type is still refused', async () => {
    const m = USERS.member;
    await assertFails(setDoc(doc(as(m), viewPath('x')), newView(m, { type: 'forms' })));
  });

  it('lets the owner and an editor update a form view and refuses a viewer and an outsider', async () => {
    await seedForm('f1');
    const settings = {
      ...emptySettings(),
      form: { ...formSettings(), title: 'Open', acceptingResponses: true },
    };
    const change = (uid: string) => ({ settings, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(updateDoc(doc(as(USERS.owner), viewPath('f1')), change(USERS.owner)));
    await assertSucceeds(updateDoc(doc(as(USERS.member), viewPath('f1')), change(USERS.member)));
    await assertFails(updateDoc(doc(as(USERS.viewer), viewPath('f1')), change(USERS.viewer)));
    await assertFails(updateDoc(doc(as(USERS.outsider), viewPath('f1')), change(USERS.outsider)));
  });

  it('lets a board reader read the form view and an outsider not', async () => {
    await seedForm('f1');
    await assertSucceeds(getDoc(doc(as(USERS.viewer), viewPath('f1'))));
    await assertFails(getDoc(doc(as(USERS.outsider), viewPath('f1'))));
  });

  it('keeps the per-form counters and the submitter out of reach of every client', async () => {
    const counter = `boards/${MAIN_BOARD}/counters/form_f1_1`;
    for (const uid of [USERS.owner, USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(getDoc(doc(as(uid), counter)));
      await assertFails(setDoc(doc(as(uid), counter), { count: 0 }));
    }
  });
});

describe('form submitters', () => {
  it('gain nothing from being the createdBy of an item they submitted', async () => {
    const submitter = USERS.outsider;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `boards/${MAIN_BOARD}/items/submitted`),
        itemDoc({ name: 'From a form', createdBy: submitter, updatedBy: submitter }),
      );
    });
    const ref = doc(as(submitter), `boards/${MAIN_BOARD}/items/submitted`);
    await assertFails(getDoc(ref));
    await assertFails(
      updateDoc(ref, { name: 'Edited', updatedAt: serverTimestamp(), updatedBy: submitter }),
    );
    await assertFails(deleteDoc(ref));
  });
});
