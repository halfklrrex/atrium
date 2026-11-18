import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { dashboardSchema } from '@atrium/shared';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import { MAIN_BOARD, USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * Dashboards through the MCP connector (batch 4 PR 1), against the Firestore emulator: the hosted
 * connector's Admin SDK client creates a dashboard with widgets and the stored document reads back
 * through a web client under the security rules, parses as a valid `dashboardSchema` and takes a
 * web-shaped update. Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
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
  { id: 'cost', type: 'numbers', title: 'Cost', position: 'a1', settings: {} },
];

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = ctx.firestore();
    await setDoc(doc(db, 'boards', MAIN_BOARD), boardDoc({ name: 'Budget', columns: COLUMNS }));
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'i1'),
      itemDoc({ values: { st: { index: 1 }, cost: 40 } }),
    );
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'i2'),
      itemDoc({ values: { st: { index: 0 }, cost: 2.5 } }),
    );
  });
});

describe('dashboards written by the connector', () => {
  it('creates a dashboard that the web reads as valid, computes its numbers, and takes web updates', async () => {
    const service = createService({ client, actor: { uid: USERS.owner } });
    const tools = defineTools(service);
    const run = (name: string, args: Record<string, unknown>) =>
      tools.find((tool) => tool.name === name)!.run(args);

    const created = (await run('atrium_create_dashboard', {
      name: 'Money',
      boards: ['Budget'],
      widgets: [
        { type: 'numbers', title: 'Total', settings: { mode: 'sum', column: 'Cost' } },
        { type: 'battery', settings: { doneLabels: ['Done'] } },
        { type: 'chart', settings: { x: 'Status' } },
      ],
    })) as { id: string };

    const { doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
    const owner = env.authenticatedContext(USERS.owner).firestore();
    const snap = await getDoc(doc(owner, 'dashboards', created.id));
    expect(snap.exists()).toBe(true);
    const parsed = dashboardSchema.parse(snap.data());
    expect(parsed).toMatchObject({
      name: 'Money',
      kind: 'main',
      access: { [USERS.owner]: 'owner' },
      accessUids: [USERS.owner],
      boardIds: [MAIN_BOARD],
      state: 'active',
    });
    expect(parsed.widgets.map((w) => w.type)).toEqual(['numbers', 'battery', 'chart']);

    const read = (await run('atrium_get_dashboard', { dashboardId: created.id })) as {
      widgets: { title: string; data?: { value?: number; percent?: number } }[];
    };
    expect(read.widgets[0]!.data?.value).toBe(42.5);
    expect(read.widgets[1]!.data?.percent).toBe(50);

    // A change through the connector validates again, and the web's own update shape still applies.
    await run('atrium_update_dashboard', {
      dashboardId: created.id,
      removeWidgets: [parsed.widgets[2]!.id],
      addWidgets: [{ type: 'numbers', title: 'Items' }],
    });
    await updateDoc(doc(owner, 'dashboards', created.id), {
      name: 'Money 2',
      updatedAt: serverTimestamp(),
      updatedBy: USERS.owner,
    });
    const after = dashboardSchema.parse(
      (await getDoc(doc(owner, 'dashboards', created.id))).data(),
    );
    expect(after.name).toBe('Money 2');
    expect(after.widgets.map((w) => w.title)).toEqual(['Total', 'Battery', 'Items']);

    // Trash and restore, owner only.
    await run('atrium_delete_dashboard', { dashboardId: created.id });
    expect(
      dashboardSchema.parse((await getDoc(doc(owner, 'dashboards', created.id))).data()).state,
    ).toBe('deleted');
    await run('atrium_restore_dashboard', { dashboardId: created.id });
    expect(
      dashboardSchema.parse((await getDoc(doc(owner, 'dashboards', created.id))).data()).state,
    ).toBe('active');
  });
});
