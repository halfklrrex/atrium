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
 * Teams in People cells through the MCP connector (batch 2 PR 1), against the Firestore emulator: the
 * hosted connector's Admin SDK client assigns a team by name with `atrium_update_item`, then the same
 * library the `onItemPeopleAssigned` trigger runs fills the server-maintained `assigneeTeamIds`.
 * Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let adminItemIndex: typeof AdminItemIndexModule;
let adminNotifications: typeof AdminNotificationsModule;
let itemIndex: typeof ItemIndexModule;
let client: FirestoreClient;

const BOARD = 'mcpTeamsBoard';
const ITEM = 'mcpTeamsItem';
const TEAM = 'mcpTeamKids';
const columns = [
  { id: 'who', type: 'people', title: 'Owner', position: 'a0', settings: {} },
  { id: 'txt', type: 'text', title: 'Note', position: 'a1', settings: {} },
];

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

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
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
        access: { [USERS.owner]: 'owner' },
        kind: 'private',
        columns,
        groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
      }),
    );
    await setDoc(doc(db, 'boards', BOARD, 'items', ITEM), itemDoc({ name: 'Take out the trash' }));
  });
});

describe('a team in a People cell, assigned by the connector', () => {
  it('is written as a team, read back with its name, and indexed by the item trigger', async () => {
    const service = createService({ client, actor: { uid: USERS.owner } });
    const tools = defineTools(service);
    const run = (name: string, args: Record<string, unknown>) =>
      tools.find((tool) => tool.name === name)!.run(args);

    const { teams } = (await run('atrium_list_teams', {})) as { teams: { id: string }[] };
    expect(teams.map((team) => team.id)).toEqual([TEAM]);

    await run('atrium_update_item', {
      boardId: BOARD,
      itemId: ITEM,
      values: { Owner: ['team:kids'] },
    });
    const stored = (await client.getDoc(`boards/${BOARD}/items/${ITEM}`)) as {
      values: { who: unknown };
    };
    expect(stored.values.who).toEqual({ personsAndTeams: [{ id: TEAM, kind: 'team' }] });

    const found = (await run('atrium_find_items', {
      boardId: BOARD,
      where: [{ column: 'Owner', equals: 'Kids' }],
    })) as { items: { name: string; values: { Owner: unknown } }[] };
    expect(found.items).toHaveLength(1);
    expect(found.items[0]!.values.Owner).toEqual([{ id: TEAM, kind: 'team', name: 'Kids' }]);

    // The trigger's own library, over the same emulator: the team id lands in the index field.
    const firestore = admin.db();
    const store = itemIndex.withSharedBoardRead(
      adminNotifications.adminNotificationStore(firestore),
    );
    const snapshot = await firestore.doc(`boards/${BOARD}/items/${ITEM}`).get();
    const wrote = await itemIndex.syncItemIndexFields(
      {
        getBoard: (boardId) => store.getBoard(boardId),
        ...adminItemIndex.adminItemIndexWriter(firestore),
      },
      {
        boardId: BOARD,
        itemId: ITEM,
        before: { name: 'Take out the trash', values: {} },
        after: snapshot.data() ?? {},
        updateTime: snapshot.updateTime,
      },
    );
    expect(wrote).toBe(true);
    const indexed = (await firestore.doc(`boards/${BOARD}/items/${ITEM}`).get()).data();
    expect(indexed?.assigneeTeamIds).toEqual([TEAM]);
    expect(indexed?.assigneeUids).toEqual([]);
  });
});
