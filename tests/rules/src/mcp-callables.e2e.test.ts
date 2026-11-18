import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as ServerOpsModule from '../../../functions/src/mcp/server-ops';
import { USERS, WS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * Column type change, buttons and time tracking through the MCP connector (batch 3 PR 3), against
 * the Firestore emulator: the hosted connector's `serverOps` run the callables' library code with the
 * real Admin SDK adapters, as the production wiring does. Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;
let serverOpsModule: typeof ServerOpsModule;

const BOARD = 'boardMcpCallables';
const columns = [
  { id: 'note', type: 'text', title: 'Note', position: 'a0', settings: {} },
  { id: 'stage', type: 'text', title: 'Stage', position: 'a1', settings: {} },
  {
    id: 'done',
    type: 'button',
    title: 'Done',
    position: 'a2',
    settings: {
      label: 'Finish',
      color: '#00c875',
      actions: [
        { type: 'set_value', columnId: 'stage', value: 'Finished' },
        { type: 'notify', uids: [USERS.member], message: 'All done' },
      ],
    },
  },
  { id: 'timer', type: 'time_tracking', title: 'Timer', position: 'a3', settings: {} },
];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  serverOpsModule = await import('../../../functions/src/mcp/server-ops');
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
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS, 'members', USERS.owner), {
      displayName: 'Avery Quinn',
      photoURL: null,
    });
    await setDoc(
      doc(db, 'boards', BOARD),
      boardDoc({
        access: { [USERS.owner]: 'owner', [USERS.member]: 'editor', [USERS.viewer]: 'viewer' },
        columns,
        serverManagedColumnIds: ['done', 'timer'],
        groups: [{ id: 'g1', title: 'To do', color: '#579bfc', position: 'a0' }],
      }),
    );
    const items = [
      ['i1', { note: '12' }],
      ['i2', { note: 'twelve' }],
      ['i3', { note: '7' }],
    ] as const;
    for (const [id, values] of items) {
      await setDoc(doc(db, 'boards', BOARD, 'items', id), itemDoc({ name: `Item ${id}`, values }));
    }
  });
});

function runAs(uid: string) {
  const serverOps = serverOpsModule.adminServerOps();
  const tools = defineTools(createService({ client, actor: { uid }, serverOps }));
  return (name: string, args: Record<string, unknown>) =>
    tools.find((tool) => tool.name === name)!.run(args);
}

const stored = async (path: string) => (await admin.db().doc(path).get()).data();

describe('column type change through the connector', () => {
  it('previews the loss, refuses without allowDataLoss, converts, and reverts', async () => {
    const run = runAs(USERS.member);
    const preview = (await run('atrium_change_column_type', {
      boardId: BOARD,
      column: 'Note',
      toType: 'numbers',
      dryRun: true,
    })) as { cleared: number; converted: number; lost: { item: string; value: string }[] };
    expect(preview).toMatchObject({ converted: 2, cleared: 1 });
    expect(preview.lost).toEqual([expect.objectContaining({ item: 'Item i2', value: 'twelve' })]);
    expect((await stored(`boards/${BOARD}`))?.columns[0].type).toBe('text');
    expect((await admin.db().collection(`boards/${BOARD}/columnSnapshots`).get()).size).toBe(0);

    await expect(
      run('atrium_change_column_type', { boardId: BOARD, column: 'Note', toType: 'numbers' }),
    ).rejects.toThrow(/allowDataLoss/);
    expect((await stored(`boards/${BOARD}`))?.columns[0].type).toBe('text');

    const done = (await run('atrium_change_column_type', {
      boardId: BOARD,
      column: 'Note',
      toType: 'numbers',
      allowDataLoss: true,
    })) as { changed: boolean; snapshotId: string; converted: number; cleared: number };
    expect(done).toMatchObject({ changed: true, converted: 2, cleared: 1 });
    const board = await stored(`boards/${BOARD}`);
    expect(board?.columns[0]).toMatchObject({
      type: 'numbers',
      lastTypeChange: { snapshotId: done.snapshotId, fromType: 'text' },
    });
    expect((await stored(`boards/${BOARD}/items/i1`))?.values.note).toBe(12);
    expect((await stored(`boards/${BOARD}/items/i2`))?.values.note).toBeUndefined();
    const activity = await admin.db().collection(`boards/${BOARD}/activity`).get();
    expect(activity.docs.map((d) => d.get('kind'))).toContain('column_type_changed');

    const reverted = (await run('atrium_revert_column_type', {
      boardId: BOARD,
      column: 'Note',
    })) as { reverted: boolean; restored: number };
    expect(reverted).toMatchObject({ reverted: true, restored: 3 });
    expect((await stored(`boards/${BOARD}`))?.columns[0].type).toBe('text');
    expect((await stored(`boards/${BOARD}/items/i2`))?.values.note).toBe('twelve');
    await expect(
      run('atrium_revert_column_type', { boardId: BOARD, column: 'Note' }),
    ).rejects.toThrow(/no type change to undo/);
  });

  it('refuses a viewer and a locked column for an editor, writing nothing', async () => {
    await expect(
      runAs(USERS.viewer)('atrium_change_column_type', {
        boardId: BOARD,
        column: 'Note',
        toType: 'text',
      }),
    ).rejects.toThrow(/only view/);
    await admin
      .db()
      .doc(`boards/${BOARD}`)
      .update({ columnLocks: ['stage'] });
    await expect(
      runAs(USERS.member)('atrium_change_column_type', {
        boardId: BOARD,
        column: 'Stage',
        toType: 'long_text',
      }),
    ).rejects.toThrow(/locked/);
    expect((await admin.db().collection(`boards/${BOARD}/columnSnapshots`).get()).size).toBe(0);
  });
});

describe('buttons and time tracking through the connector', () => {
  it('a click runs the actions, logs the activity and notifies the person', async () => {
    const out = (await runAs(USERS.owner)('atrium_click_button', {
      boardId: BOARD,
      itemId: 'i1',
    })) as { applied: string[]; notified: number };
    expect(out.applied).toEqual(['set_value', 'notify']);
    expect(out.notified).toBe(1);
    expect((await stored(`boards/${BOARD}/items/i1`))?.values.stage).toBe('Finished');
    const activity = await admin.db().collection(`boards/${BOARD}/activity`).get();
    expect(activity.docs.map((d) => d.get('kind'))).toContain('button_clicked');
    const inbox = await admin.db().collection(`users/${USERS.member}/notifications`).get();
    expect(inbox.size).toBe(1);
    // The repeat guard of the callable code applies.
    await expect(
      runAs(USERS.owner)('atrium_click_button', { boardId: BOARD, itemId: 'i1' }),
    ).rejects.toThrow(/just clicked/);
    await expect(
      runAs(USERS.viewer)('atrium_click_button', { boardId: BOARD, itemId: 'i2' }),
    ).rejects.toThrow(/only view/);
  });

  it('starts and stops a timer, and refuses a stop when nothing runs', async () => {
    const run = runAs(USERS.member);
    await expect(
      run('atrium_stop_time_tracking', { boardId: BOARD, itemId: 'i1' }),
    ).rejects.toThrow(/not currently running/);
    const started = (await run('atrium_start_time_tracking', { boardId: BOARD, itemId: 'i1' })) as {
      sessionId: string;
    };
    const cell = (await stored(`boards/${BOARD}/items/i1`))?.values.timer;
    expect(cell).toMatchObject({ running: true });
    const again = (await run('atrium_start_time_tracking', { boardId: BOARD, itemId: 'i1' })) as {
      sessionId: string;
    };
    expect(again.sessionId).toBe(started.sessionId);
    const stopped = (await run('atrium_stop_time_tracking', { boardId: BOARD, itemId: 'i1' })) as {
      stopped: boolean;
    };
    expect(stopped.stopped).toBe(true);
    expect((await stored(`boards/${BOARD}/items/i1`))?.values.timer).toMatchObject({
      running: false,
    });
  });
});
