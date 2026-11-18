import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { automationSchema, validateAutomation } from '@atrium/shared';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import { MAIN_BOARD, USERS, boardDoc, createTestEnv, seedFixture } from './helpers';

/**
 * Automations through the MCP connector (batch 4 PR 2), against the Firestore emulator: the hosted
 * connector's Admin SDK client writes the recipes (it bypasses the rules, so the service mirrors
 * them), and a web client under the security rules then reads them back, parses them with the shared
 * schema, accepts the same document as a web create and takes web-shaped updates. Run history is
 * seeded the way Cloud Functions write it. `nextRunAt` is filled by `onAutomationWritten`, a Cloud
 * Function that does not run in the rules emulator (see functions/src/lib/automations/next-run.test.ts),
 * so this file checks that the connector never writes it. Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;

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

const COLUMNS = [
  {
    id: 'st',
    type: 'status',
    title: 'Status',
    position: 'a0',
    settings: {
      labels: [
        { id: 'working', index: 0, label: 'Working on it', color: '#fdab3d' },
        { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
      ],
    },
  },
  { id: 'due', type: 'date', title: 'Due', position: 'a1', settings: {} },
  { id: 'note', type: 'text', title: 'Note', position: 'a2', settings: {} },
];
const GROUPS = [{ id: 'g1', title: 'To do', color: '#579bfc', position: 'a0' }];
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'boards', MAIN_BOARD),
      boardDoc({
        name: 'Chores',
        columns: COLUMNS,
        groups: GROUPS,
        access: { [USERS.owner]: 'owner', [USERS.member]: 'editor', [USERS.viewer]: 'viewer' },
      }),
    );
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'automationRuns', 'old-e1'), {
      automationId: 'old',
      eventId: 'e1',
      itemId: 'i1',
      status: 'skipped',
      reason: 'rate limit',
      actions: [],
      startedAt: seedTs,
      durationMs: 3,
      depth: 0,
      expiresAt: Timestamp.fromMillis(1_700_000_000_000 + 30 * 86_400_000),
    });
  });
});

describe('automations written by the connector', () => {
  const tools = () => {
    const service = createService({ client, actor: { uid: USERS.owner } });
    const all = defineTools(service);
    return (name: string, args: Record<string, unknown>) =>
      all.find((tool) => tool.name === name)!.run(args);
  };

  it('creates switched-off recipes the web reads, accepts and edits under the rules', async () => {
    const run = tools();
    const { doc, getDoc, getDocs, collection, setDoc, updateDoc, serverTimestamp } =
      await import('firebase/firestore');
    const owner = env.authenticatedContext(USERS.owner).firestore();

    const event = (await run('atrium_create_automation', {
      boardId: MAIN_BOARD,
      name: 'Tell the member',
      trigger: { type: 'status_changed', column: 'Status', to: 'Done' },
      conditions: [{ column: 'Note', op: 'is_not_empty' }],
      actions: [
        { type: 'notify', people: [USERS.member], message: 'Done' },
        { type: 'post_update', text: 'Finished {name}' },
      ],
    })) as { created: { id: string; enabled: boolean } };
    const scheduled = (await run('atrium_create_automation', {
      boardId: MAIN_BOARD,
      name: 'Weekly',
      trigger: { type: 'recurring', every: 'week', weekday: 'Monday', at: '09:00' },
      actions: [
        {
          type: 'create_item',
          name: 'Weekly {date}',
          group: 'To do',
          values: { Status: 'Working on it' },
        },
      ],
      timezone: 'Europe/Madrid',
    })) as { created: { id: string } };
    expect(event.created.enabled).toBe(false);

    // Read back through a web client under the rules, as the shared schema.
    const snap = await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', event.created.id));
    const parsed = automationSchema.parse(snap.data());
    expect(parsed).toMatchObject({
      name: 'Tell the member',
      enabled: false,
      runAs: USERS.owner,
      createdBy: USERS.owner,
      disabledReason: null,
      trigger: { type: 'status_changed', columnId: 'st', toLabelId: 1 },
    });
    expect(snap.data()).not.toHaveProperty('nextRunAt');
    expect(snap.data()).not.toHaveProperty('consecutiveFailures');
    const board = { columns: COLUMNS, groups: GROUPS, memberUids: Object.values(USERS) };
    expect(validateAutomation(parsed, board, 'owner')).toEqual({ ok: true });
    const weekly = automationSchema.parse(
      (await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', scheduled.created.id))).data(),
    );
    expect(weekly.timezone).toBe('Europe/Madrid');
    expect(validateAutomation(weekly, board, 'owner')).toEqual({ ok: true });

    // The same stored document is accepted by the rules as a web create (server time stamps).
    for (const id of [event.created.id, scheduled.created.id]) {
      const stored = (await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', id))).data()!;
      await assertSucceeds(
        setDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', `web-${id}`), {
          ...stored,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
    }
    // And takes the web's own update and switch-on shapes.
    await assertSucceeds(
      updateDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', event.created.id), {
        name: 'Renamed in the app',
        runAs: USERS.owner,
        updatedBy: USERS.owner,
        updatedAt: serverTimestamp(),
      }),
    );

    // Switch on through the connector, then it reads as on; repeating changes nothing.
    await run('atrium_set_automation_enabled', {
      boardId: MAIN_BOARD,
      automation: event.created.id,
      enabled: true,
    });
    const on = automationSchema.parse(
      (await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', event.created.id))).data(),
    );
    expect(on).toMatchObject({ enabled: true, name: 'Renamed in the app' });
    const again = (await run('atrium_set_automation_enabled', {
      boardId: MAIN_BOARD,
      automation: event.created.id,
      enabled: true,
    })) as { unchanged?: boolean };
    expect(again.unchanged).toBe(true);

    // A connector update validates again and the document stays web-valid.
    await run('atrium_update_automation', {
      boardId: MAIN_BOARD,
      automation: scheduled.created.id,
      trigger: { type: 'item_created' },
      actions: [{ type: 'archive_item' }],
    });
    const changed = (
      await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', scheduled.created.id))
    ).data()!;
    expect(automationSchema.parse(changed).trigger).toEqual({ type: 'item_created' });
    expect(changed).not.toHaveProperty('timezone');

    // Readers see the recipes; only the owner sees the run history.
    const viewer = env.authenticatedContext(USERS.viewer).firestore();
    await assertSucceeds(getDocs(collection(viewer, 'boards', MAIN_BOARD, 'automations')));
    await assertFails(getDocs(collection(viewer, 'boards', MAIN_BOARD, 'automationRuns')));
    const runs = (await run('atrium_list_automation_runs', { boardId: MAIN_BOARD })) as {
      runs: { status: string; reason?: string }[];
    };
    expect(runs.runs).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'rate limit' }),
    ]);

    // Delete returns the definition.
    const gone = (await run('atrium_delete_automation', {
      boardId: MAIN_BOARD,
      automation: scheduled.created.id,
    })) as { deleted: { name: string } };
    expect(gone.deleted.name).toBe('Weekly');
    expect(
      (
        await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', scheduled.created.id))
      ).exists(),
    ).toBe(false);
  });

  it('keeps another person as the creator unless takeOver, which the rules allow', async () => {
    const run = tools();
    const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
    const owner = env.authenticatedContext(USERS.owner).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'boards', MAIN_BOARD, 'automations', 'theirs'), {
        name: 'Theirs',
        enabled: true,
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'archive_item' }],
        runAs: USERS.admin,
        disabledReason: null,
        createdBy: USERS.admin,
        createdAt: seedTs,
        updatedBy: USERS.admin,
        updatedAt: seedTs,
      });
    });
    await run('atrium_update_automation', {
      boardId: MAIN_BOARD,
      automation: 'theirs',
      name: 'Theirs 2',
    });
    const kept = (await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', 'theirs'))).data()!;
    expect(kept).toMatchObject({
      runAs: USERS.admin,
      createdBy: USERS.admin,
      updatedBy: USERS.owner,
    });
    // The web may save it again without changing runAs.
    await assertSucceeds(
      updateDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', 'theirs'), {
        name: 'Theirs 3',
        updatedBy: USERS.owner,
        updatedAt: serverTimestamp(),
      }),
    );
    await run('atrium_update_automation', {
      boardId: MAIN_BOARD,
      automation: 'theirs',
      takeOver: true,
    });
    const taken = (await getDoc(doc(owner, 'boards', MAIN_BOARD, 'automations', 'theirs'))).data()!;
    expect(taken).toMatchObject({ runAs: USERS.owner, createdBy: USERS.admin });
  });

  it('refuses everyone but board owners', async () => {
    for (const actor of [USERS.member, USERS.viewer]) {
      const service = createService({ client, actor: { uid: actor } });
      const all = defineTools(service);
      const call = (name: string, args: Record<string, unknown>) =>
        all.find((tool) => tool.name === name)!.run(args);
      await expect(
        call('atrium_create_automation', {
          boardId: MAIN_BOARD,
          name: 'x',
          trigger: { type: 'item_created' },
          actions: [{ type: 'archive_item' }],
        }),
      ).rejects.toThrow(/board owners/);
      await expect(call('atrium_list_automation_runs', { boardId: MAIN_BOARD })).rejects.toThrow(
        /board owners/,
      );
      await expect(call('atrium_list_automations', { boardId: MAIN_BOARD })).resolves.toBeTruthy();
    }
  });
});
