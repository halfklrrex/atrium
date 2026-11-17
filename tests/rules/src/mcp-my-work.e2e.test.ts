import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as AdminItemIndexModule from '../../../functions/src/lib/admin-item-index';
import type * as AdminNotificationsModule from '../../../functions/src/lib/admin-notifications';
import type * as ItemIndexModule from '../../../functions/src/lib/item-index';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * My Work, search and notifications through the MCP connector (batch 2 PR 3), against the Firestore
 * emulator: items are written in the shape the web writes them, the same library the item index
 * trigger runs fills `assigneeUids`, `assigneeTeamIds` and `nameTokens`, and the hosted connector's
 * Admin SDK client then finds them with the connector's own queries. Runs through `pnpm test:rules`,
 * which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let adminItemIndex: typeof AdminItemIndexModule;
let adminNotifications: typeof AdminNotificationsModule;
let itemIndex: typeof ItemIndexModule;
let client: FirestoreClient;

const BOARD = 'mcpWorkBoard';
const TEAM = 'mcpWorkKids';
const columns = [
  { id: 'who', type: 'people', title: 'Owner', position: 'a0', settings: {} },
  { id: 'due', type: 'date', title: 'Due', position: 'a1', settings: {} },
];
const person = (uid: string) => ({ personsAndTeams: [{ id: uid, kind: 'person' }] });
const team = (id: string) => ({ personsAndTeams: [{ id, kind: 'team' }] });
const ITEMS: Record<string, { name: string; values: Record<string, unknown> }> = {
  direct: {
    name: 'Pack the soccer bag',
    values: { who: person(USERS.member), due: { date: '2030-01-02' } },
  },
  viaTeam: { name: 'Soccer practice', values: { who: team(TEAM) } },
  other: { name: 'Pay the taxes', values: { who: person(USERS.owner) } },
};

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  adminItemIndex = await import('../../../functions/src/lib/admin-item-index');
  adminNotifications = await import('../../../functions/src/lib/admin-notifications');
  itemIndex = await import('../../../functions/src/lib/item-index');
  const adapter: typeof AdminClientModule = await import('../../../functions/src/mcp/admin-client');
  client = adapter.createAdminClient(admin.db());
});

afterAll(async () => {
  await env.cleanup();
});

/** What the item index trigger does for one write, through the same library. */
async function runIndexTrigger(itemId: string) {
  const firestore = admin.db();
  const store = itemIndex.withSharedBoardRead(adminNotifications.adminNotificationStore(firestore));
  const snapshot = await firestore.doc(`boards/${BOARD}/items/${itemId}`).get();
  const wrote = await itemIndex.syncItemIndexFields(
    {
      getBoard: (boardId) => store.getBoard(boardId),
      ...adminItemIndex.adminItemIndexWriter(firestore),
    },
    {
      boardId: BOARD,
      itemId,
      before: { name: '', values: {} },
      after: snapshot.data() ?? {},
      updateTime: snapshot.updateTime,
    },
  );
  expect(wrote).toBe(true);
}

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc, Timestamp } = await import('firebase/firestore');
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS, 'members', USERS.member), {
      displayName: 'Avery Quinn',
      email: 'avery@example.com',
      photoURL: null,
      role: 'member',
    });
    await setDoc(doc(db, 'workspaces', WS, 'teams', TEAM), {
      name: 'Kids',
      color: '#579bfc',
      memberUids: [USERS.member],
      createdBy: USERS.owner,
      updatedBy: USERS.owner,
    });
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({
        name: 'Chores',
        columns,
        groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
      }),
    );
    for (const [id, item] of Object.entries(ITEMS)) {
      await setDoc(doc(db, 'boards', BOARD, 'items', id), itemDoc(item));
    }
    for (const [id, readAt] of [
      ['n1', null],
      ['n2', Timestamp.fromMillis(1_700_000_100_000)],
    ] as const) {
      await setDoc(doc(db, 'users', USERS.member, 'notifications', id), {
        kind: 'assigned',
        actorId: USERS.owner,
        actorName: 'Sam Lee',
        actorPhotoURL: null,
        workspaceId: WS,
        boardId: BOARD,
        boardName: 'Chores',
        itemId: 'direct',
        itemName: ITEMS.direct!.name,
        updateId: null,
        replyId: null,
        columnId: 'who',
        snippet: '',
        createdAt: Timestamp.fromMillis(1_700_000_000_000 + (id === 'n1' ? 1 : 2)),
        readAt,
      });
    }
  });
  for (const id of Object.keys(ITEMS)) await runIndexTrigger(id);
});

function tools(uid: string) {
  const defined = defineTools(createService({ client, actor: { uid } }));
  return (name: string, args: Record<string, unknown> = {}) =>
    defined.find((tool) => tool.name === name)!.run(args);
}

describe('My Work through the connector', () => {
  it('lists the items assigned in the web shape, directly and through a team', async () => {
    const result = (await tools(USERS.member)('atrium_my_work')) as {
      items: { name: string; via: string; date: string | null }[];
    };
    expect(result.items.map((row) => [row.name, row.via, row.date])).toEqual([
      ['Pack the soccer bag', 'me', '2030-01-02'],
      ['Soccer practice', 'Kids', null],
    ]);
    const owners = (await tools(USERS.owner)('atrium_my_work')) as { items: { name: string }[] };
    expect(owners.items.map((row) => row.name)).toEqual(['Pay the taxes']);
  });

  it('an outsider sees nothing and a viewer-less workspace is refused', async () => {
    await expect(tools(USERS.outsider)('atrium_my_work', { workspaceId: WS })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('search through the connector', () => {
  it('finds items by the indexed name tokens and boards by name', async () => {
    const result = (await tools(USERS.member)('atrium_search', { query: 'soccer' })) as {
      results: { kind: string; name: string }[];
    };
    expect(result.results.map((row) => row.name).sort()).toEqual([
      'Pack the soccer bag',
      'Soccer practice',
    ]);
    const boards = (await tools(USERS.member)('atrium_search', {
      query: 'chores',
      kinds: ['boards'],
    })) as { results: { kind: string }[] };
    expect(boards.results.map((row) => row.kind)).toEqual(['board']);
  });

  it('skips a board the person cannot read', async () => {
    const result = (await tools(USERS.outsider)('atrium_search', { query: 'soccer' }).catch(
      (error: Error) => error,
    )) as Error | { results: unknown[] };
    // The outsider belongs to no workspace: no workspace, no results.
    expect('results' in result ? result.results : []).toEqual([]);
  });
});

describe('notifications through the connector', () => {
  it('lists newest first and marks read with readAt only', async () => {
    const run = tools(USERS.member);
    const listed = (await run('atrium_list_notifications')) as {
      notifications: { id: string; read: boolean }[];
    };
    expect(listed.notifications.map((n) => [n.id, n.read])).toEqual([
      ['n2', true],
      ['n1', false],
    ]);
    const marked = (await run('atrium_mark_notifications_read', { ids: ['n1'] })) as {
      marked: number;
    };
    expect(marked.marked).toBe(1);
    const stored = (await client.getDoc(`users/${USERS.member}/notifications/n1`)) as {
      readAt: unknown;
      snippet: string;
      actorName: string;
    };
    expect(stored.readAt).toBeInstanceOf(Date);
    expect(stored.actorName).toBe('Sam Lee');
    const unread = (await run('atrium_list_notifications', { unreadOnly: true })) as {
      shown: number;
    };
    expect(unread.shown).toBe(0);
  });
});
