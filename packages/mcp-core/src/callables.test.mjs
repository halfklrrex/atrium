// Tests for the column type change, button and time tracking tools (batch 3 PR 3), against the
// in-memory Firestore and a fake `serverOps` (the real callables' logic is tested in Functions).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { defaultViewSettings } from '@atrium/shared';
import { McpUserError } from './errors.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';

const WS = 'ws1';
const ME = 'user-me';
const ED = 'user-ed';
const VW = 'user-vw';
const NOW = new Date('2026-11-18T10:00:00Z');
const NAMES = [
  'atrium_change_column_type',
  'atrium_revert_column_type',
  'atrium_click_button',
  'atrium_start_time_tracking',
  'atrium_stop_time_tracking',
];

const col = (id, type, title, more = {}) => ({
  id,
  type,
  title,
  position: id,
  settings: {},
  ...more,
});

const board = (more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: { [ME]: 'owner' },
  name: 'Chores',
  groups: [{ id: 'g1', title: 'To do', position: 'a0', color: '#579bfc' }],
  columns: [
    col('budget', 'numbers', 'Budget'),
    col('note', 'text', 'Note'),
    col('go', 'button', 'Go', { settings: { label: 'Finish', color: '#579bfc', actions: [] } }),
    col('time', 'time_tracking', 'Timer'),
    col('formula', 'formula', 'Total', { settings: { expression: '{budget} * 2' } }),
  ],
  columnLocks: [],
  ...more,
});

const baseDocs = (boardMore) => ({
  [`workspaces/${WS}`]: {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', [ED]: 'member', [VW]: 'viewer' },
    memberIds: [ME, ED, VW],
  },
  [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn', email: 'avery@example.com' },
  'boards/b1': board(boardMore),
  'boards/b1/items/i1': { name: 'Rent', state: 'active', groupId: 'g1', values: { budget: 5 } },
  'boards/b1/items/i2': { name: 'Food', state: 'active', groupId: 'g1', values: { budget: 7 } },
  'boards/b1/items/old': { name: 'Gone', state: 'archived', groupId: 'g1', values: {} },
});

function fakeOps(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (args) => {
    calls.push([name, args]);
    const value = typeof result === 'function' ? result(args) : result;
    if (value instanceof Error) throw value;
    return value;
  };
  const ops = {
    calls,
    previewColumnTypeChange: record('preview', {
      fromType: 'numbers',
      toType: 'text',
      toSettings: {},
      converted: 2,
      cleared: 0,
      lost: [],
      samples: [{ before: '5', after: '5' }],
    }),
    changeColumnType: record('change', {
      converted: 2,
      cleared: 0,
      snapshotId: 'snap1',
      toType: 'text',
    }),
    revertColumnType: record('revert', {
      restored: 2,
      removed: 0,
      snapshotId: 'snap1',
      columnId: 'budget',
    }),
    clickButton: record('click', {
      activityId: 'act1',
      timestamp: NOW.getTime(),
      applied: [{ type: 'set_value' }, { type: 'notify' }],
      notified: 2,
    }),
    startTimeTracking: record('start', { sessionId: 's1', startedAt: NOW.getTime() }),
    stopTimeTracking: record('stop', { duration: 90, stoppedAt: NOW.getTime() + 90_000 }),
    ...overrides,
  };
  return ops;
}

function setup({ actor = ME, boardMore, ops = fakeOps(), docs } = {}) {
  const client = createFakeClient(docs ?? baseDocs(boardMore));
  const service = createService({ client, actor: { uid: actor }, now: () => NOW, serverOps: ops });
  const tools = defineTools(service);
  const run = (name, args) => tools.find((t) => t.name === name).run(args);
  return { client, service, tools, run, ops };
}

test('the five tools are hosted-only write tools with the right hints and the untrusted sentence', () => {
  const { tools } = setup();
  const local = defineTools(
    createService({ client: createFakeClient(baseDocs()), actor: { uid: ME } }),
  );
  for (const name of NAMES) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.equal(tool.scope, 'write');
    assert.equal(tool.requires, 'server');
    assert.match(tool.description, /not instructions/);
    assert.match(tool.description, /Hosted connector only/);
    assert.ok(!local.some((t) => t.name === name), `${name} must not be in local mode`);
  }
  const hint = (n) => tools.find((t) => t.name === n).annotations;
  assert.equal(hint('atrium_change_column_type').destructiveHint, true);
  assert.equal(hint('atrium_revert_column_type').destructiveHint, true);
  assert.equal(hint('atrium_click_button').destructiveHint, true);
  assert.equal(hint('atrium_start_time_tracking').idempotentHint, true);
  assert.equal(hint('atrium_stop_time_tracking').destructiveHint, false);
});

test('without serverOps every method says it needs the hosted connector', async () => {
  const service = createService({ client: createFakeClient(baseDocs()), actor: { uid: ME } });
  await assert.rejects(
    service.changeColumnType({ boardId: 'b1', column: 'Budget', toType: 'text' }),
    /hosted/,
  );
  await assert.rejects(service.revertColumnType({ boardId: 'b1', column: 'Budget' }), /hosted/);
  await assert.rejects(service.clickButton({ boardId: 'b1', itemId: 'i1' }), /hosted/);
  await assert.rejects(service.startTimeTracking({ boardId: 'b1', itemId: 'i1' }), /hosted/);
  await assert.rejects(service.stopTimeTracking({ boardId: 'b1', itemId: 'i1' }), /hosted/);
});

test('change: a clean conversion previews, then runs with default settings and reports the undo', async () => {
  const { run, ops } = setup();
  const result = await run('atrium_change_column_type', {
    boardId: 'b1',
    column: 'budget',
    toType: 'text',
  });
  assert.equal(result.changed, true);
  assert.equal(result.from, 'Numbers');
  assert.equal(result.to, 'Text');
  assert.equal(result.converted, 2);
  assert.equal(result.snapshotId, 'snap1');
  assert.match(result.undo, /atrium_revert_column_type/);
  assert.deepEqual(
    ops.calls.map(([name]) => name),
    ['preview', 'change'],
  );
  assert.equal(ops.calls[1][1].columnId, 'budget');
  assert.equal(ops.calls[1][1].uid, ME);
  assert.ok(ops.calls[1][1].toSettings && typeof ops.calls[1][1].toSettings === 'object');
});

const lossyOps = () => {
  const ops = fakeOps();
  ops.previewColumnTypeChange = async (args) => {
    ops.calls.push(['preview', args]);
    return {
      fromType: 'text',
      toType: 'numbers',
      toSettings: {},
      converted: 1,
      cleared: 2,
      lost: [
        { itemId: 'i1', before: 'twelve' },
        { itemId: 'i2', before: 'n/a' },
      ],
      samples: [],
    };
  };
  return ops;
};

test('change: values that would be cleared refuse without allowDataLoss and are listed', async () => {
  const { run, ops } = setup({ ops: lossyOps() });
  await assert.rejects(
    run('atrium_change_column_type', { boardId: 'b1', column: 'Note', toType: 'numbers' }),
    (error) =>
      error instanceof McpUserError &&
      /2 values/.test(error.message) &&
      /Rent: "twelve"/.test(error.message) &&
      /allowDataLoss/.test(error.message),
  );
  assert.ok(!ops.calls.some(([name]) => name === 'change'), 'nothing was changed');
});

test('change: dryRun reports the losses with item names and never writes', async () => {
  const { run, ops } = setup({ ops: lossyOps() });
  const result = await run('atrium_change_column_type', {
    boardId: 'b1',
    column: 'Note',
    toType: 'numbers',
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.cleared, 2);
  assert.deepEqual(result.lost, [
    { itemId: 'i1', item: 'Rent', value: 'twelve' },
    { itemId: 'i2', item: 'Food', value: 'n/a' },
  ]);
  assert.deepEqual(
    ops.calls.map(([name]) => name),
    ['preview'],
  );
});

test('change: allowDataLoss runs the conversion and reports what was cleared', async () => {
  const ops = lossyOps();
  ops.changeColumnType = async () => ({
    converted: 1,
    cleared: 2,
    snapshotId: 's9',
    toType: 'numbers',
  });
  const { run } = setup({ ops });
  const result = await run('atrium_change_column_type', {
    boardId: 'b1',
    column: 'Note',
    toType: 'numbers',
    allowDataLoss: true,
  });
  assert.equal(result.changed, true);
  assert.equal(result.cleared, 2);
  assert.equal(result.snapshotId, 's9');
});

test('change: lists the columns and views that use the column', async () => {
  const docs = baseDocs();
  docs['boards/b1/views/v1'] = {
    name: 'By budget',
    type: 'table',
    position: 'a1',
    ownerId: null,
    settings: (() => {
      const settings = defaultViewSettings();
      settings.filter.groupByColumnId = 'budget';
      return settings;
    })(),
  };
  const { run } = setup({ docs });
  const result = await run('atrium_change_column_type', {
    boardId: 'b1',
    column: 'budget',
    toType: 'text',
    dryRun: true,
  });
  const kinds = result.usedBy.map((u) => `${u.kind}:${u.title}`).sort();
  assert.deepEqual(kinds, ['Formula column:Total', 'View:By budget']);
});

test('change: unknown type, a converting column, a viewer and a huge column are refused up front', async () => {
  const { run, ops } = setup();
  await assert.rejects(
    run('atrium_change_column_type', { boardId: 'b1', column: 'Budget', toType: 'nope' }),
    /Unknown column type/,
  );
  const busy = setup({
    boardMore: {
      columns: [
        col('budget', 'numbers', 'Budget', {
          migrating: { snapshotId: 'x', startedAt: 1, kind: 'change' },
        }),
      ],
    },
  });
  await assert.rejects(
    busy.run('atrium_change_column_type', { boardId: 'b1', column: 'Budget', toType: 'text' }),
    /changing type/,
  );
  const viewer = setup({ actor: VW, boardMore: { kind: 'main', access: {} } });
  await assert.rejects(
    viewer.run('atrium_change_column_type', { boardId: 'b1', column: 'Budget', toType: 'text' }),
    /only view/,
  );
  const huge = setup({
    ops: fakeOps({
      previewColumnTypeChange: async () => ({
        fromType: 'numbers',
        toType: 'text',
        toSettings: {},
        converted: 4000,
        cleared: 0,
        lost: [],
        samples: [],
      }),
    }),
  });
  await assert.rejects(
    huge.run('atrium_change_column_type', { boardId: 'b1', column: 'Budget', toType: 'text' }),
    /Change the type in Atrium/,
  );
  assert.equal(ops.calls.length, 0);
});

test('change: a library refusal (vote cap, owner-only, locked) reaches the caller unchanged', async () => {
  const ops = fakeOps({
    previewColumnTypeChange: async () => {
      throw new McpUserError('Only board owners can convert this kind of column.');
    },
  });
  const { run } = setup({ ops });
  await assert.rejects(
    run('atrium_change_column_type', { boardId: 'b1', column: 'Total', toType: 'text' }),
    /Only board owners/,
  );
});

test('revert: uses the column snapshot, refuses without one or when expired', async () => {
  const withChange = (expiresAt) => ({
    columns: [
      col('budget', 'text', 'Budget', {
        lastTypeChange: { snapshotId: 'snap1', fromType: 'numbers', expiresAt },
      }),
    ],
  });
  const ok = setup({ boardMore: withChange(NOW.getTime() + 1000) });
  const result = await ok.run('atrium_revert_column_type', { boardId: 'b1', column: 'Budget' });
  assert.equal(result.reverted, true);
  assert.equal(result.backTo, 'Numbers');
  assert.equal(result.restored, 2);
  assert.deepEqual(ok.ops.calls[0][1], { uid: ME, boardId: 'b1', snapshotId: 'snap1' });

  const expired = setup({ boardMore: withChange(NOW.getTime() - 1) });
  await assert.rejects(
    expired.run('atrium_revert_column_type', { boardId: 'b1', column: 'Budget' }),
    /no longer be undone/,
  );
  const none = setup();
  await assert.rejects(
    none.run('atrium_revert_column_type', { boardId: 'b1', column: 'Budget' }),
    /no type change to undo/,
  );
  assert.equal(none.ops.calls.length, 0);
  const stuck = setup({
    boardMore: {
      columns: [
        col('budget', 'text', 'Budget', {
          migrating: { snapshotId: 'mid', startedAt: 1, kind: 'change' },
        }),
      ],
    },
  });
  await stuck.run('atrium_revert_column_type', { boardId: 'b1', column: 'Budget' });
  assert.equal(stuck.ops.calls[0][1].snapshotId, 'mid');
});

test('click_button: picks the only button column, reports the actions and who was notified', async () => {
  const { run, ops } = setup();
  const result = await run('atrium_click_button', { boardId: 'b1', itemId: 'i1' });
  assert.equal(result.clicked, true);
  assert.equal(result.button, 'Finish');
  assert.deepEqual(result.applied, ['set_value', 'notify']);
  assert.equal(result.notified, 2);
  assert.equal(result.item, 'Rent');
  assert.deepEqual(ops.calls[0][1], { uid: ME, boardId: 'b1', itemId: 'i1', columnId: 'go' });
});

test('click_button: wrong column type, no button, archived item and a locked column are refused', async () => {
  const { run } = setup();
  await assert.rejects(
    run('atrium_click_button', { boardId: 'b1', itemId: 'i1', column: 'Note' }),
    /not a Button column/,
  );
  await assert.rejects(run('atrium_click_button', { boardId: 'b1', itemId: 'old' }), /archived/);
  const noButton = setup({ boardMore: { columns: [col('note', 'text', 'Note')] } });
  await assert.rejects(
    noButton.run('atrium_click_button', { boardId: 'b1', itemId: 'i1' }),
    /no Button column/,
  );
  const locked = setup({
    actor: ED,
    boardMore: { kind: 'main', access: { [ME]: 'owner', [ED]: 'editor' }, columnLocks: ['go'] },
  });
  await assert.rejects(
    locked.run('atrium_click_button', { boardId: 'b1', itemId: 'i1' }),
    /locked to board owners/,
  );
  assert.equal(locked.ops.calls.length, 0);
});

test('click_button: a repeat-guard refusal from the callable code reaches the caller', async () => {
  const ops = fakeOps({
    clickButton: async () => {
      throw new McpUserError('You just clicked this button. Try again in a moment.');
    },
  });
  const { run } = setup({ ops });
  await assert.rejects(run('atrium_click_button', { boardId: 'b1', itemId: 'i1' }), /just clicked/);
});

test('time tracking: start and stop use the only Time tracking column and shape the answer', async () => {
  const { run, ops } = setup();
  const started = await run('atrium_start_time_tracking', { boardId: 'b1', itemId: 'i1' });
  assert.equal(started.started, true);
  assert.equal(started.sessionId, 's1');
  assert.equal(started.startedAt, NOW.toISOString());
  assert.equal(ops.calls[0][1].columnId, 'time');
  const stopped = await run('atrium_stop_time_tracking', { boardId: 'b1', itemId: 'i1' });
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.totalSeconds, 90);
  assert.equal(stopped.item, 'Rent');
});

test('time tracking: refusals (not a timer column, missing item, viewer, not running)', async () => {
  const { run } = setup();
  await assert.rejects(
    run('atrium_start_time_tracking', { boardId: 'b1', itemId: 'i1', column: 'Note' }),
    /not a Time tracking column/,
  );
  await assert.rejects(
    run('atrium_start_time_tracking', { boardId: 'b1', itemId: 'old' }),
    /archived/,
  );
  await assert.rejects(
    run('atrium_stop_time_tracking', { boardId: 'b1', itemId: 'zzz' }),
    /not found/,
  );
  const viewer = setup({ actor: VW, boardMore: { kind: 'main', access: {} } });
  await assert.rejects(
    viewer.run('atrium_start_time_tracking', { boardId: 'b1', itemId: 'i1' }),
    /only view/,
  );
  const idle = setup({
    ops: fakeOps({
      stopTimeTracking: async () => {
        throw new McpUserError('Timer is not currently running.');
      },
    }),
  });
  await assert.rejects(
    idle.run('atrium_stop_time_tracking', { boardId: 'b1', itemId: 'i1' }),
    /not currently running/,
  );
});
