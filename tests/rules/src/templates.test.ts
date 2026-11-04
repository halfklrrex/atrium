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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, WS, createTestEnv, seedFixture } from './helpers';

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
const path = (id: string) => `workspaces/${WS}/templates/${id}`;

const structure = () => ({
  columns: [
    { id: 'status', type: 'status', title: 'Status', position: 'a0', settings: { labels: [] } },
  ],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'Group', color: '#579bfc', position: 'a0' }],
  itemTerminology: 'item',
});

/** A client-side create payload. */
function newTemplate(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'My template',
    description: 'For weekly planning',
    structure: structure(),
    sampleItems: [{ name: 'One', groupId: 'g1', values: {} }],
    itemCount: 1,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedTemplate(id: string, createdBy: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    await setDoc(doc(ctx.firestore(), path(id)), {
      ...newTemplate(createdBy),
      createdAt: ts,
      updatedAt: ts,
    });
  });
}

describe('templates: read', () => {
  it.each([USERS.owner, USERS.admin, USERS.member, USERS.viewer])('%s can read', async (uid) => {
    await seedTemplate('t1', USERS.member);
    await assertSucceeds(getDoc(doc(as(uid), path('t1'))));
    await assertSucceeds(getDocs(collection(as(uid), `workspaces/${WS}/templates`)));
  });

  it('refuses non-members and signed-out users', async () => {
    await seedTemplate('t1', USERS.member);
    await assertFails(getDoc(doc(as(USERS.outsider), path('t1'))));
    await assertFails(getDoc(doc(anon(), path('t1'))));
  });
});

describe('templates: create', () => {
  it.each([USERS.owner, USERS.admin, USERS.member])('%s can create', async (uid) => {
    await assertSucceeds(setDoc(doc(as(uid), path('t1')), newTemplate(uid)));
  });

  it.each([USERS.viewer, USERS.outsider])('%s cannot create', async (uid) => {
    await assertFails(setDoc(doc(as(uid), path('t1')), newTemplate(uid)));
  });

  it('refuses signed-out creates', async () => {
    await assertFails(setDoc(doc(anon(), path('t1')), newTemplate(USERS.member)));
  });

  const create = (overrides: Record<string, unknown>) =>
    setDoc(doc(as(USERS.member), path('bad')), newTemplate(USERS.member, overrides));

  it('refuses creating as someone else', async () => {
    await assertFails(create({ createdBy: USERS.owner }));
  });

  it('refuses client-chosen timestamps', async () => {
    await assertFails(create({ createdAt: Timestamp.fromMillis(1) }));
    await assertFails(create({ updatedAt: Timestamp.fromMillis(1) }));
  });

  it('refuses extra or missing fields', async () => {
    await assertFails(create({ extra: true }));
    const { description: _d, ...rest } = newTemplate(USERS.member);
    void _d;
    await assertFails(setDoc(doc(as(USERS.member), path('bad')), rest));
  });

  it('enforces the name and description limits', async () => {
    await assertFails(create({ name: '' }));
    await assertFails(create({ name: 'x'.repeat(81) }));
    await assertSucceeds(create({ name: 'x'.repeat(80) }));
    await assertFails(create({ description: 'x'.repeat(301) }));
  });

  it('enforces the structure shape and limits', async () => {
    await assertFails(create({ structure: { ...structure(), extra: 1 } }));
    await assertFails(create({ structure: { ...structure(), groups: [] } }));
    await assertFails(create({ structure: { ...structure(), itemTerminology: '' } }));
    await assertFails(create({ structure: 'nope' }));
    const column = structure().columns[0];
    await assertFails(
      create({ structure: { ...structure(), columns: Array.from({ length: 61 }, () => column) } }),
    );
  });

  it('caps sample items at 50 and keeps itemCount honest', async () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `i${i}`, groupId: 'g1', values: {} }));
    await assertSucceeds(create({ sampleItems: items(50), itemCount: 50 }));
    await assertFails(create({ sampleItems: items(51), itemCount: 51 }));
    await assertFails(create({ sampleItems: items(2), itemCount: 1 }));
  });
});

describe('templates: update and delete', () => {
  const rename = (uid: string) =>
    updateDoc(doc(as(uid), path('t1')), { name: 'Renamed', updatedAt: serverTimestamp() });

  it('lets the creator, an admin and an owner rename', async () => {
    await seedTemplate('t1', USERS.member);
    await assertSucceeds(rename(USERS.member));
    await assertSucceeds(rename(USERS.admin));
    await assertSucceeds(rename(USERS.owner));
  });

  it('refuses a rename by another member, a viewer, an outsider or signed out', async () => {
    await seedTemplate('t1', USERS.owner);
    await assertFails(rename(USERS.member));
    await assertFails(rename(USERS.viewer));
    await assertFails(rename(USERS.outsider));
    await assertFails(
      updateDoc(doc(anon(), path('t1')), { name: 'Renamed', updatedAt: serverTimestamp() }),
    );
  });

  it('only allows name and description to change', async () => {
    await seedTemplate('t1', USERS.member);
    const ref = doc(as(USERS.member), path('t1'));
    await assertFails(
      updateDoc(ref, {
        structure: { ...structure(), itemTerminology: 'task' },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(ref, { createdBy: USERS.owner, updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(ref, { sampleItems: [], itemCount: 0, updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(ref, { name: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'Fine' }));
    await assertSucceeds(
      updateDoc(ref, { name: 'Fine', description: 'New', updatedAt: serverTimestamp() }),
    );
  });

  it('lets the creator, an admin and an owner delete', async () => {
    for (const uid of [USERS.member, USERS.admin, USERS.owner]) {
      await seedTemplate('t1', USERS.member);
      await assertSucceeds(deleteDoc(doc(as(uid), path('t1'))));
    }
  });

  it('refuses a delete by another member, a viewer, an outsider or signed out', async () => {
    await seedTemplate('t1', USERS.owner);
    await assertFails(deleteDoc(doc(as(USERS.member), path('t1'))));
    await assertFails(deleteDoc(doc(as(USERS.viewer), path('t1'))));
    await assertFails(deleteDoc(doc(as(USERS.outsider), path('t1'))));
    await assertFails(deleteDoc(doc(anon(), path('t1'))));
  });
});
