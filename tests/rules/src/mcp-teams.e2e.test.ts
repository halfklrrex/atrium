import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
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

describe('team management by the connector (batch 2 PR 5)', () => {
  const tools = (uid: string) => {
    const list = defineTools(createService({ client, actor: { uid } }));
    return (name: string, args: Record<string, unknown>) =>
      list.find((tool) => tool.name === name)!.run(args);
  };
  type TeamOut = {
    team: { id: string; name: string; members: { uid: string }[] };
    droppedFormerMembers?: string[];
  };

  it('writes the document shape the rules accept, from the real Admin client', async () => {
    const { doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const run = tools(USERS.admin);
    const created = (await run('atrium_create_team', {
      name: 'Parents',
      color: 'red',
      members: ['avery@example.com', USERS.owner],
    })) as TeamOut;
    expect(created.team.members.map((m) => m.uid).sort()).toEqual([USERS.member, USERS.owner]);

    // The stored document has exactly the keys, limits and audit fields the web client writes, so the
    // same payload passes the real rules for an admin and is refused for a plain member.
    const stored = (await client.getDoc(`workspaces/${WS}/teams/${created.team.id}`)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored).sort()).toEqual([
      'color',
      'createdAt',
      'createdBy',
      'memberUids',
      'name',
      'updatedAt',
      'updatedBy',
    ]);
    const asClient = (uid: string) => ({
      ...stored,
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const adminDb = env.authenticatedContext(USERS.admin).firestore();
    await assertSucceeds(
      setDoc(doc(adminDb, 'workspaces', WS, 'teams', 'viaWeb'), asClient(USERS.admin)),
    );
    const memberDb = env.authenticatedContext(USERS.member).firestore();
    await assertFails(
      setDoc(doc(memberDb, 'workspaces', WS, 'teams', 'viaWeb2'), asClient(USERS.member)),
    );
    // And a member reads it back through the real rules.
    await assertSucceeds(getDoc(doc(memberDb, 'workspaces', WS, 'teams', created.team.id)));

    // A member is refused by the tools themselves.
    await expect(tools(USERS.member)('atrium_create_team', { name: 'Nope' })).rejects.toThrow(
      /owner or admin/,
    );
  });

  it('updates members, then guards and performs a delete of a team that is assigned', async () => {
    const run = tools(USERS.owner);
    const updated = (await run('atrium_update_team', {
      team: 'Kids',
      addMembers: [USERS.owner],
      removeMembers: [USERS.member],
    })) as TeamOut;
    expect(updated.team.members.map((m) => m.uid)).toEqual([USERS.owner]);
    const stored = (await client.getDoc(`workspaces/${WS}/teams/${TEAM}`)) as {
      memberUids: string[];
      createdBy: string;
      updatedBy: string;
    };
    expect(stored.memberUids).toEqual([USERS.owner]);
    expect(stored.createdBy).toBe(USERS.owner);

    const assigned = { values: { who: { personsAndTeams: [{ id: TEAM, kind: 'team' }] } } };
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'boards', BOARD, 'items', ITEM), {
        ...assigned,
        assigneeTeamIds: [TEAM],
      });
    });
    const dry = (await run('atrium_delete_team', { team: 'Kids', dryRun: true })) as {
      assignedItems: number;
      boards: { boardId: string; items: number }[];
    };
    expect(dry.assignedItems).toBe(1);
    expect(dry.boards).toEqual([{ boardId: BOARD, name: 'Chores', items: 1 }]);
    await expect(run('atrium_delete_team', { team: 'Kids' })).rejects.toThrow(/Deleted team/);
    expect(await client.getDoc(`workspaces/${WS}/teams/${TEAM}`)).not.toBeNull();

    const done = (await run('atrium_delete_team', { team: 'Kids', allowDataLoss: true })) as {
      deleted: boolean;
    };
    expect(done.deleted).toBe(true);
    expect(await client.getDoc(`workspaces/${WS}/teams/${TEAM}`)).toBeNull();
    const read = (await run('atrium_find_items', { boardId: BOARD })) as {
      items: { values: { Owner: unknown } }[];
    };
    expect(read.items[0]!.values.Owner).toEqual([{ id: TEAM, kind: 'team', name: 'Deleted team' }]);
  });
});
