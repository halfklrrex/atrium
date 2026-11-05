import {
  activityEventSchema,
  defaultFormSettings,
  itemSchema,
  type FormSettings,
} from '@atrium/shared';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as ActivityModule from '../../../functions/src/lib/activity';
import type * as AdminActivityModule from '../../../functions/src/lib/admin-activity';
import type * as AdminFormsModule from '../../../functions/src/lib/admin-forms';
import type * as AdminItemSeqModule from '../../../functions/src/lib/admin-item-seq';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as FormsModule from '../../../functions/src/lib/forms';
import type * as ItemSeqModule from '../../../functions/src/lib/item-seq';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator: `getFormForVisitor` and `submitFormInTransaction` run
 * with the real Admin SDK adapters (what the `getForm` and `submitForm` callables wire up). The
 * created item's snapshot is then handed to the same `allocateItemNumbers` and `recordItemActivity`
 * the Firestore triggers call (trigger delivery itself is simulated, as in `activity.e2e.test.ts`).
 * Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let adapters: typeof AdminFormsModule;
let forms: typeof FormsModule;
let activityLogic: typeof ActivityModule;
let activityAdapter: typeof AdminActivityModule;
let seqLogic: typeof ItemSeqModule;
let seqAdapter: typeof AdminItemSeqModule;

const BOARD = 'boardFormsE2e';
const VIEW = 'formView';
const SUBMITTER = 'form-visitor';

const columns = [
  { id: 'notes', type: 'text', title: 'Notes', position: 'a0', settings: {} },
  {
    id: 'stage',
    type: 'status',
    title: 'Stage',
    position: 'a1',
    settings: { labels: [{ id: 's0', index: 0, label: 'New', color: '#579bfc' }] },
  },
  { id: 'secret', type: 'text', title: 'Internal', position: 'a2', settings: {} },
];
const groups = [
  { id: 'g1', title: 'Inbox', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Later', color: '#00c875', position: 'a1' },
];

const formSettings = (over: Partial<FormSettings> = {}): FormSettings => ({
  ...defaultFormSettings('g2'),
  title: 'Request',
  questions: [
    { columnId: 'name', label: 'Name', required: true },
    { columnId: 'notes', label: 'Notes', required: false },
    { columnId: 'stage', label: 'Stage', required: false },
  ],
  acceptingResponses: true,
  ...over,
});

const viewDoc = (form: FormSettings) => ({
  name: 'Form',
  type: 'form',
  position: 'a1',
  ownerId: null,
  settings: {
    filter: {
      personIds: [],
      filterGroup: { conjunction: 'and', conditions: [] },
      sortConditions: [],
      groupByColumnId: null,
    },
    hiddenColumnIds: [],
    form,
  },
  createdAt: new Date(1_700_000_000_000),
  createdBy: USERS.owner,
  updatedAt: new Date(1_700_000_000_000),
  updatedBy: USERS.owner,
});

async function seedForm(form: FormSettings): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'boards', BOARD, 'views', VIEW), viewDoc(form));
  });
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  adapters = await import('../../../functions/src/lib/admin-forms');
  forms = await import('../../../functions/src/lib/forms');
  activityLogic = await import('../../../functions/src/lib/activity');
  activityAdapter = await import('../../../functions/src/lib/admin-activity');
  seqLogic = await import('../../../functions/src/lib/item-seq');
  seqAdapter = await import('../../../functions/src/lib/admin-item-seq');
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
      doc(db, 'boards', BOARD),
      boardDoc({ access: { [USERS.owner]: 'owner', [USERS.member]: 'editor' }, columns, groups }),
    );
    await setDoc(
      doc(db, 'boards', BOARD, 'items', 'existing'),
      itemDoc({ groupId: 'g2', position: 'a4' }),
    );
  });
  await seedForm(formSettings());
});

const submit = (uid: string, answers: Record<string, unknown>) => {
  const firestore = admin.db();
  return firestore.runTransaction((tx) =>
    forms.submitFormInTransaction(adapters.adminFormsTx(firestore, tx), uid, {
      boardId: BOARD,
      viewId: VIEW,
      answers,
    }),
  );
};
const items = async () =>
  (await admin.db().collection('boards').doc(BOARD).collection('items').get()).docs;
const counters = async () =>
  (await admin.db().collection('boards').doc(BOARD).collection('counters').get()).docs;

describe('getForm against the emulator', () => {
  it('returns the safe shape for a visitor with no board access', async () => {
    const result = await forms.getFormForVisitor(adapters.adminFormsReads(admin.db()), {
      boardId: BOARD,
      viewId: VIEW,
    });
    expect(result.questions.map((q) => q.columnId)).toEqual(['name', 'notes', 'stage']);
    expect(JSON.stringify(result)).not.toMatch(/secret|Internal|Board|g2/);
  });

  it('is not-found when the form is switched off', async () => {
    await seedForm(formSettings({ acceptingResponses: false }));
    await expect(
      forms.getFormForVisitor(adapters.adminFormsReads(admin.db()), {
        boardId: BOARD,
        viewId: VIEW,
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('submitForm against the emulator', () => {
  it('creates the item for the submitter, numbered and logged with source form', async () => {
    const result = await submit(SUBMITTER, { name: 'Fix the gate', notes: 'It squeaks' });
    expect(result).toEqual({ ok: true, thankYou: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/item/i);

    const created = (await items()).find((d) => d.id !== 'existing')!;
    const data = created.data();
    expect(data).toMatchObject({
      name: 'Fix the gate',
      groupId: 'g2',
      parentItemId: null,
      values: { notes: 'It squeaks' },
      state: 'active',
      deletedAt: null,
      createdBy: SUBMITTER,
      updatedBy: SUBMITTER,
      updatedVia: 'form',
    });
    expect(data.position > 'a4').toBe(true);
    expect(itemSchema.safeParse({ ...data, seq: undefined }).success).toBe(true);

    // The numbering trigger path.
    const firestore = admin.db();
    const numbers = await firestore.runTransaction((tx) =>
      seqLogic.allocateItemNumbers(seqAdapter.adminItemSeqTx(firestore, tx), BOARD, created.id),
    );
    expect(numbers).toBeTruthy();

    // The activity trigger path: one item_created, by the submitter, tagged as a form submission.
    const store = activityAdapter.adminActivityStore(firestore);
    const logged = await activityLogic.recordItemActivity(store, {
      eventId: 'evt-form-1',
      boardId: BOARD,
      itemId: created.id,
      after: data,
    });
    expect(logged).toBe(1);
    const entries = await getDocs(
      collection(env.authenticatedContext(USERS.member).firestore(), 'boards', BOARD, 'activity'),
    );
    expect(entries.size).toBe(1);
    expect(entries.docs[0]!.data()).toMatchObject({
      kind: 'item_created',
      actorId: SUBMITTER,
      groupId: 'g2',
      data: { source: 'form' },
    });
    expect(activityEventSchema.safeParse(entries.docs[0]!.data()).success).toBe(true);
  });

  it('refuses a bad submission without writing an item or a counter', async () => {
    for (const answers of [{}, { name: 'A', secret: 'x' }, { name: 'A', stage: { index: 'x' } }]) {
      await expect(submit(SUBMITTER, answers)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(await items()).toHaveLength(1);
    expect(await counters()).toHaveLength(0);
  });

  it('refuses when the form is off', async () => {
    await seedForm(formSettings({ acceptingResponses: false }));
    await expect(submit(SUBMITTER, { name: 'A' })).rejects.toMatchObject({ code: 'not-found' });
    expect(await items()).toHaveLength(1);
  });

  it('stops the 11th submission of one person in an hour and counts per person and per form', async () => {
    for (let i = 0; i < 10; i += 1) await submit(SUBMITTER, { name: `n${i}` });
    await expect(submit(SUBMITTER, { name: 'n10' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    await submit('someone-else', { name: 'fine' });
    expect(await items()).toHaveLength(12);

    const docs = await counters();
    const byId = new Map(docs.map((d) => [d.id, d.data()]));
    const formCounter = [...byId.entries()].find(([id]) => /^form_formView_\d+$/.test(id))!;
    expect(formCounter[1].count).toBe(11);
    expect(formCounter[1].expiresAt.toMillis()).toBeGreaterThan(Date.now());
    expect(docs).toHaveLength(3);
  });

  it('stops the 201st submission of a form in an hour', async () => {
    const firestore = admin.db();
    const hour = forms.hourOf(Date.now());
    await firestore
      .collection('boards')
      .doc(BOARD)
      .collection('counters')
      .doc(`form_${VIEW}_${hour}`)
      .set({ count: 200, expiresAt: new Date(Date.now() + 86_400_000) });
    await expect(submit(SUBMITTER, { name: 'A' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('gives the submitter no access to the board, its items or the counters', async () => {
    await submit(SUBMITTER, { name: 'Mine' });
    const created = (await items()).find((d) => d.id !== 'existing')!;
    const visitor = env.authenticatedContext(SUBMITTER).firestore();
    const { getDoc, updateDoc, deleteDoc, serverTimestamp } = await import('firebase/firestore');
    const { assertFails } = await import('@firebase/rules-unit-testing');
    await assertFails(getDoc(doc(visitor, 'boards', BOARD)));
    await assertFails(getDoc(doc(visitor, 'boards', BOARD, 'items', created.id)));
    await assertFails(getDocs(collection(visitor, 'boards', BOARD, 'items')));
    await assertFails(getDocs(collection(visitor, 'boards', BOARD, 'counters')));
    await assertFails(getDocs(collection(visitor, 'boards', BOARD, 'views')));
    await assertFails(
      updateDoc(doc(visitor, 'boards', BOARD, 'items', created.id), {
        name: 'x',
        updatedAt: serverTimestamp(),
        updatedBy: SUBMITTER,
      }),
    );
    await assertFails(deleteDoc(doc(visitor, 'boards', BOARD, 'items', created.id)));
  });
});
