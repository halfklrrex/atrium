import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as ColumnIdsModule from '../../../functions/src/lib/derived-column-ids';
import type * as ColumnsTriggerModule from '../../../functions/src/triggers/onBoardColumnsWritten';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * Every column type and label editing through the MCP connector (batch 2 PR 6), against the Firestore
 * emulator: the hosted connector's Admin SDK client creates formula, vote, files and mirror columns
 * with `atrium_add_column` and never writes the server-maintained id lists; the same library the
 * `onBoardColumnsWritten` trigger runs then fills `derivedColumnIds`, `serverManagedColumnIds` and
 * `voteColumnIds`. Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let columnIds: typeof ColumnIdsModule;
let trigger: typeof ColumnsTriggerModule;
let client: FirestoreClient;

const BOARD = 'mcpColumnsBoard';
const LINKED = 'mcpColumnsLinked';
const columns = [
  { id: 'n', type: 'numbers', title: 'Price', position: 'a0', settings: {} },
  {
    id: 'st',
    type: 'status',
    title: 'Stage',
    position: 'a1',
    settings: {
      labels: [
        { id: 'l0', index: 0, label: 'Todo', color: '#fdab3d' },
        { id: 'l1', index: 1, label: 'Done', color: '#00c875', isDone: true },
      ],
    },
  },
];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  columnIds = await import('../../../functions/src/lib/derived-column-ids');
  trigger = await import('../../../functions/src/triggers/onBoardColumnsWritten');
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
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({
        name: 'Plan',
        access: { [USERS.owner]: 'owner' },
        kind: 'private',
        columns,
        groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
      }),
    );
    await setDoc(doc(db, 'boards', BOARD, 'items', 'i1'), {
      ...itemDoc({ name: 'Paint the fence' }),
      values: { n: 12, st: { index: 0 } },
    });
    await setDoc(
      doc(db, 'boards', LINKED),
      boardDoc({
        name: 'Shopping',
        access: { [USERS.owner]: 'owner' },
        kind: 'private',
        columns: [{ id: 'cost', type: 'numbers', title: 'Cost', position: 'a0', settings: {} }],
        groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
      }),
    );
    await setDoc(doc(db, 'boards', LINKED, 'items', 'l1'), {
      ...itemDoc({ name: 'Paint' }),
      values: { cost: 25 },
    });
  });
});

const run = (name: string, args: Record<string, unknown>) =>
  defineTools(createService({ client, actor: { uid: USERS.owner } }))
    .find((tool) => tool.name === name)!
    .run(args);

describe('every column type, created by the connector', () => {
  it('creates formula, vote, files and mirror columns; the trigger library fills the id lists', async () => {
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Double',
      type: 'formula',
      settings: { expression: '{Price} * 2', outputType: 'number' },
    });
    await run('atrium_add_column', { boardId: BOARD, title: 'Votes', type: 'vote' });
    await run('atrium_add_column', { boardId: BOARD, title: 'Receipts', type: 'files' });
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Shop',
      type: 'board_relation',
      settings: { boards: ['Shopping'] },
    });
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Shop cost',
      type: 'mirror',
      settings: {
        relationColumn: 'Shop',
        targetColumns: { Shopping: 'Cost' },
        aggregation: 'sum',
      },
    });

    // The connector never writes the server-maintained lists.
    const written = (await client.getDoc(`boards/${BOARD}`)) as Record<string, unknown>;
    for (const key of ['derivedColumnIds', 'serverManagedColumnIds', 'voteColumnIds']) {
      expect(written[key] ?? []).toEqual([]);
    }
    const created = (written.columns as { id: string; type: string }[]).filter((c) =>
      ['formula', 'vote', 'files', 'mirror'].includes(c.type),
    );
    expect(created).toHaveLength(4);

    // What the onBoardColumnsWritten trigger does with that write.
    const result = await columnIds.syncColumnIdLists(
      trigger.adminColumnIdListsStore(),
      BOARD,
      written as never,
    );
    expect(result.written).toBeTruthy();
    const after = (await client.getDoc(`boards/${BOARD}`)) as Record<string, string[]>;
    const idOf = (type: string) => created.find((c) => c.type === type)!.id;
    expect([...after.derivedColumnIds!].sort()).toEqual([idOf('formula'), idOf('mirror')].sort());
    expect(after.serverManagedColumnIds).toEqual([idOf('files')]);
    expect(after.voteColumnIds).toEqual([idOf('vote')]);
  });

  it('reads a formula and a mirror, and links an item by name', async () => {
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Double',
      type: 'formula',
      settings: { expression: '{Price} * 2', outputType: 'number' },
    });
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Shop',
      type: 'board_relation',
      settings: { boards: [LINKED] },
    });
    await run('atrium_add_column', {
      boardId: BOARD,
      title: 'Shop cost',
      type: 'mirror',
      settings: { relationColumn: 'Shop', targetColumns: { [LINKED]: 'Cost' }, aggregation: 'sum' },
    });
    await run('atrium_update_item', { boardId: BOARD, itemId: 'i1', values: { Shop: ['Paint'] } });
    const board = (await run('atrium_get_board', { boardId: BOARD })) as {
      items: { values: Record<string, unknown> }[];
    };
    expect(board.items[0]!.values.Double).toBe('24');
    expect(board.items[0]!.values['Shop cost']).toBe('25');
  });
});

describe('label editing by the connector', () => {
  it('renames and removes a used label with the data-loss guard', async () => {
    await run('atrium_edit_labels', {
      boardId: BOARD,
      column: 'Stage',
      rename: [{ from: 'Todo', to: 'To do' }],
    });
    await expect(
      run('atrium_edit_labels', { boardId: BOARD, column: 'Stage', remove: ['To do'] }),
    ).rejects.toThrow(/allowDataLoss/);
    const dry = (await run('atrium_edit_labels', {
      boardId: BOARD,
      column: 'Stage',
      remove: ['To do'],
      dryRun: true,
    })) as { itemsAffected: number };
    expect(dry.itemsAffected).toBe(1);
    await run('atrium_edit_labels', {
      boardId: BOARD,
      column: 'Stage',
      remove: ['To do'],
      allowDataLoss: true,
    });
    const item = (await client.getDoc(`boards/${BOARD}/items/i1`)) as {
      values: Record<string, unknown>;
    };
    expect(item.values.st).toBeUndefined();
    const board = (await client.getDoc(`boards/${BOARD}`)) as {
      columns: { id: string; settings: { labels?: { label: string }[] } }[];
    };
    expect(board.columns.find((c) => c.id === 'st')!.settings.labels!.map((l) => l.label)).toEqual([
      'Done',
    ]);
  });
});
