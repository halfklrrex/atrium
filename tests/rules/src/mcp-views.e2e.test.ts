import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * Views and forms through the MCP connector (batch 2 PR 4), against the Firestore emulator. The hosted
 * connector's Admin SDK client writes `boards/{id}/views/{viewId}`; the web client SDK, signed in as
 * the same person, then reads it back, and writes the same document again with server timestamps (what
 * the web does), so the real rules judge the shape (`viewKeysOk`, `viewSettingsOk`, `canWriteView`).
 * Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;

const BOARD = 'mcpViewsBoard';
const TYPES = [
  'table',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'workload',
  'chart',
  'files',
  'form',
] as const;
const columns = [
  {
    id: 'st',
    type: 'status',
    title: 'Status',
    position: 'a0',
    settings: {
      labels: [
        { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
        { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
      ],
    },
  },
  { id: 'who', type: 'people', title: 'Owner', position: 'a1', settings: {} },
  { id: 'due', type: 'date', title: 'Due', position: 'a2', settings: {} },
  { id: 'note', type: 'text', title: 'Note', position: 'a3', settings: {} },
];
const groups = [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }];
const person = (uid: string) => ({ personsAndTeams: [{ id: uid, kind: 'person' }] });

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  const adapter: typeof AdminClientModule = await import('../../../functions/src/mcp/admin-client');
  client = adapter.createAdminClient(admin.db());
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = ctx.firestore();
    for (const uid of [USERS.owner, USERS.member, USERS.viewer]) {
      await setDoc(doc(db, 'workspaces', WS, 'members', uid), {
        displayName: uid,
        email: `${uid}@example.com`,
        photoURL: null,
        role: 'member',
      });
    }
    await setDoc(doc(db, 'boards', BOARD), boardDoc({ name: 'Chores', columns, groups }));
    const items: Record<string, { name: string; values: Record<string, unknown> }> = {
      a: { name: 'Dishes', values: { st: { index: 1 }, who: person(USERS.member) } },
      b: { name: 'Laundry', values: { st: { index: 2 }, who: person(USERS.owner) } },
      c: { name: 'Taxes', values: { st: { index: 1 } } },
    };
    let position = 0;
    for (const [id, item] of Object.entries(items)) {
      await setDoc(
        doc(db, 'boards', BOARD, 'items', id),
        itemDoc({ ...item, position: `a${position++}` }),
      );
    }
  });
});

function tools(uid: string) {
  const defined = defineTools(createService({ client, actor: { uid } }));
  return (name: string, args: Record<string, unknown> = {}) =>
    defined.find((tool) => tool.name === name)!.run(args);
}

/** The web's write of a stored view document: the same fields, with server timestamps. */
async function replayAsClient(uid: string, viewId: string, newId: string) {
  const { doc, getDoc, serverTimestamp, setDoc } = await import('firebase/firestore');
  const db = env.authenticatedContext(uid).firestore();
  const snap = await getDoc(doc(db, 'boards', BOARD, 'views', viewId));
  const data = snap.data()!;
  return setDoc(doc(db, 'boards', BOARD, 'views', newId), {
    ...data,
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

describe('views created by the connector', () => {
  it('every type reads back as that user and is accepted by the rules when the web writes it', async () => {
    const run = tools(USERS.owner);
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    for (const type of TYPES) {
      const { created } = (await run('atrium_create_view', {
        boardId: BOARD,
        name: `My ${type}`,
        type,
        filter: { conditions: [{ column: 'Status', operator: 'is', value: 'Done' }] },
        sort: [{ column: 'Due', direction: 'desc' }],
        hiddenColumns: ['Note'],
      })) as { created: { id: string } };
      await assertSucceeds(replayAsClient(USERS.owner, created.id, `copy-${type}`));
    }
    const db = env.authenticatedContext(USERS.owner).firestore();
    const shared = await assertSucceeds(
      getDocs(query(collection(db, 'boards', BOARD, 'views'), where('ownerId', '==', null))),
    );
    // Nine created, nine replayed.
    expect(shared.size).toBe(TYPES.length * 2);
  });

  it('a form with questions and an updated view pass the rules too', async () => {
    const run = tools(USERS.member);
    const { created } = (await run('atrium_create_view', {
      boardId: BOARD,
      name: 'Request',
      type: 'form',
      settings: {
        title: 'Ask',
        acceptingResponses: true,
        questions: [
          { column: 'Status', required: true },
          { column: 'Note', help: 'Any detail' },
        ],
      },
    })) as { created: { id: string } };
    await assertSucceeds(replayAsClient(USERS.member, created.id, 'form-copy'));
    await run('atrium_update_view', {
      boardId: BOARD,
      view: created.id,
      name: 'Renamed',
      settings: { thankYou: 'Done!' },
    });
    const { doc, getDoc, serverTimestamp, updateDoc } = await import('firebase/firestore');
    const db = env.authenticatedContext(USERS.member).firestore();
    const stored = (await getDoc(doc(db, 'boards', BOARD, 'views', created.id))).data()!;
    expect(stored.name).toBe('Renamed');
    expect(stored.settings.form.thankYou).toBe('Done!');
    expect(stored.settings.form.questions.map((q: { columnId: string }) => q.columnId)).toEqual([
      'name',
      'st',
      'note',
    ]);
    // The web saves the settings again as it read them.
    await assertSucceeds(
      updateDoc(doc(db, 'boards', BOARD, 'views', created.id), {
        settings: stored.settings,
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('a personal view by a viewer is theirs alone; shared ones are refused to them', async () => {
    const viewer = tools(USERS.viewer);
    await expect(
      viewer('atrium_create_view', { boardId: BOARD, name: 'Shared', type: 'table' }),
    ).rejects.toThrow(/personal: true/);
    const { created } = (await viewer('atrium_create_view', {
      boardId: BOARD,
      name: 'Mine',
      type: 'kanban',
      personal: true,
    })) as { created: { id: string } };
    const { collection, doc, getDoc, getDocs, query, where } = await import('firebase/firestore');
    const viewerDb = env.authenticatedContext(USERS.viewer).firestore();
    await assertSucceeds(getDoc(doc(viewerDb, 'boards', BOARD, 'views', created.id)));
    await assertSucceeds(replayAsClient(USERS.viewer, created.id, 'mine-copy'));
    const ownerDb = env.authenticatedContext(USERS.owner).firestore();
    await assertFails(getDoc(doc(ownerDb, 'boards', BOARD, 'views', created.id)));
    await assertFails(
      getDocs(
        query(collection(ownerDb, 'boards', BOARD, 'views'), where('ownerId', '==', USERS.viewer)),
      ),
    );
    // The connector agrees with the rules.
    const owners = (await tools(USERS.owner)('atrium_list_views', { boardId: BOARD })) as {
      views: { name: string }[];
    };
    expect(owners.views.map((v) => v.name)).toEqual(['Main table']);
    await expect(
      tools(USERS.owner)('atrium_delete_view', { boardId: BOARD, view: created.id }),
    ).rejects.toThrow(/No view/);
  });

  it('main is stored on its first save in the shape the rules require, and cannot be deleted', async () => {
    const run = tools(USERS.owner);
    await run('atrium_update_view', {
      boardId: BOARD,
      view: 'main',
      sort: [{ column: 'name' }],
    });
    const { doc, getDoc, deleteDoc } = await import('firebase/firestore');
    const db = env.authenticatedContext(USERS.owner).firestore();
    const stored = (await getDoc(doc(db, 'boards', BOARD, 'views', 'main'))).data()!;
    expect(stored.name).toBe('Main table');
    expect(stored.position).toBe('a0');
    expect(stored.ownerId).toBeNull();
    await assertFails(deleteDoc(doc(db, 'boards', BOARD, 'views', 'main')));
    await expect(run('atrium_delete_view', { boardId: BOARD, view: 'main' })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('delete removes the document and returns the definition', async () => {
    const run = tools(USERS.owner);
    const { created } = (await run('atrium_create_view', {
      boardId: BOARD,
      name: 'Gone',
      type: 'table',
    })) as { created: { id: string } };
    const result = (await run('atrium_delete_view', { boardId: BOARD, view: 'Gone' })) as {
      deleted: { name: string; type: string };
    };
    expect(result.deleted).toMatchObject({ name: 'Gone', type: 'table' });
    expect(await client.getDoc(`boards/${BOARD}/views/${created.id}`)).toBeNull();
  });
});

describe('reading through a view', () => {
  it('applies the stored filter and sort on emulator data', async () => {
    const run = tools(USERS.owner);
    await run('atrium_create_view', {
      boardId: BOARD,
      name: 'Stuck first',
      type: 'table',
      filter: { conditions: [{ column: 'Status', operator: 'is_not', value: 'Stuck' }] },
      sort: [{ column: 'name', direction: 'desc' }],
    });
    const result = (await run('atrium_get_view_items', {
      boardId: BOARD,
      view: 'Stuck first',
    })) as {
      items: { name: string }[];
    };
    expect(result.items.map((i) => i.name)).toEqual(['Taxes', 'Dishes']);
  });
});
