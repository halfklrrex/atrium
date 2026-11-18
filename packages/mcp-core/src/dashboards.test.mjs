// Batch 4 PR 1: the Dashboards tools (list, get, create, update, delete, restore). In-memory Firestore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardWidgetsSchema } from '@atrium/shared';
import { addLabelsToSettings, buildColumnSettings } from './builders.mjs';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';
import { clampLayout, findFreeSlot, normalizeWidgets } from './service/dashboards.mjs';
import {
  findFreeSlot as webFindFreeSlot,
  normalizeWidgets as webNormalizeWidgets,
} from '../../../apps/web/src/components/dashboard/dashboard-layout.ts';
import { buildBatteryModel } from '../../../apps/web/src/components/dashboard/widgets/battery-model.ts';
import { buildNumbersModel } from '../../../apps/web/src/components/dashboard/widgets/numbers-model.ts';

const WS = 'ws1';
const ME = 'user-me'; // workspace owner
const ED = 'user-ed'; // member
const VW = 'user-vw'; // viewer
const NOW = new Date('2026-11-18T10:00:00Z');
const LONG_AGO = new Date('2026-11-01T08:00:00Z');

const statusSettings = buildColumnSettings('status');
const col = (id, type, title, settings = {}) => ({ id, type, title, position: id, settings });
const choreColumns = [
  col('st', 'status', 'Status', statusSettings),
  col('who', 'people', 'Owner'),
  col('cost', 'numbers', 'Cost'),
  col(
    'dd',
    'dropdown',
    'Kind',
    addLabelsToSettings('dropdown', buildColumnSettings('dropdown'), ['Home']),
  ),
  col('due', 'date', 'Due'),
  col('fm', 'formula', 'Double', { expression: '{Cost} * 2', outputType: 'number' }),
  col('note', 'text', 'Note'),
];
// Another board: its own column ids, the same titles and types for Status and Cost.
const budgetColumns = [
  col('bst', 'status', 'Status', statusSettings),
  col('bcost', 'numbers', 'Cost'),
];
const board = (name, columns, more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: {},
  accessUids: [ME],
  position: 'a0',
  folderId: null,
  name,
  columns,
  groups: [],
  ...more,
});
const item = (name, values, more = {}) => ({
  name,
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values,
  ...more,
});

const dashDoc = (more = {}) => ({
  workspaceId: WS,
  folderId: null,
  name: 'Home',
  kind: 'main',
  access: { [ME]: 'owner' },
  accessUids: [ME],
  position: 'a5',
  icon: null,
  boardIds: ['b1'],
  widgets: [],
  state: 'active',
  deletedAt: null,
  createdAt: LONG_AGO,
  createdBy: ME,
  updatedAt: LONG_AGO,
  ...more,
});

const docs = (extra = {}) => ({
  [`workspaces/${WS}`]: {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', [ED]: 'member', [VW]: 'viewer' },
    memberIds: [ME, ED, VW],
  },
  [`users/${ME}`]: { displayName: 'Avery Quinn' },
  'boards/b1': board('Chores', choreColumns, { position: 'a1' }),
  'boards/b2': board('Budget', budgetColumns, { position: 'a2' }),
  // A private board of someone else: the actors below cannot read it.
  'boards/b3': board('Secret', budgetColumns, {
    kind: 'private',
    access: { [VW]: 'owner' },
    accessUids: [VW],
    position: 'a3',
  }),
  'boards/b1/items/i1': item('Dishes', { st: { index: 1 }, cost: 5 }),
  'boards/b1/items/i2': item('Laundry', { st: { index: 0 }, cost: 7.5 }),
  'boards/b1/items/i3': item('Mow', { st: { index: 1 } }),
  'boards/b1/items/i4': item('Old', { st: { index: 1 }, cost: 100 }, { state: 'archived' }),
  'boards/b2/items/j1': item('Rent', { bst: { index: 0 }, bcost: 1000 }),
  'boards/b2/items/j2': item('Food', { bst: { index: 1 }, bcost: 250 }),
  'boards/b3/items/k1': item('Hidden', { bst: { index: 1 }, bcost: 999 }),
  ...extra,
});

function setup({ actor = ME, extra = {} } = {}) {
  const client = createFakeClient(docs(extra));
  const service = createService({ client, actor: { uid: actor }, now: () => NOW });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { client, run };
}

const widgetOf = (result, title) => result.widgets.find((w) => w.title === title);

test('create builds a valid dashboard with every widget type, placed on the grid', async () => {
  const { client, run } = setup();
  const created = await run('atrium_create_dashboard', {
    name: '  Family  ',
    boards: ['Chores', 'b2'],
    widgets: [
      { type: 'numbers', title: 'Total cost', settings: { mode: 'sum', column: 'Cost' } },
      { type: 'battery', settings: { doneLabels: ['Done'] } },
      { type: 'chart', settings: { chartType: 'pie', x: 'Status' } },
      {
        type: 'table',
        boards: ['Chores'],
        settings: { columns: ['Status', 'Cost'], rowLimit: 25 },
      },
      { type: 'workload', settings: { peopleColumn: 'Owner', dateColumn: 'Due' } },
    ],
  });
  assert.equal(created.name, 'Family');
  assert.deepEqual(
    created.boards.map((b) => b.name),
    ['Chores', 'Budget'],
  );
  const stored = client.docs.get(`dashboards/${created.id}`).data;
  assert.deepEqual(Object.keys(stored).sort(), [
    'access',
    'accessUids',
    'boardIds',
    'createdAt',
    'createdBy',
    'deletedAt',
    'folderId',
    'icon',
    'kind',
    'name',
    'position',
    'state',
    'updatedAt',
    'widgets',
    'workspaceId',
  ]);
  assert.deepEqual(stored.access, { [ME]: 'owner' });
  assert.deepEqual(stored.accessUids, [ME]);
  assert.equal(stored.kind, 'main');
  assert.equal(stored.state, 'active');
  assert.deepEqual(stored.boardIds, ['b1', 'b2']);
  assert.equal(dashboardWidgetsSchema.safeParse(stored.widgets).success, true);
  assert.deepEqual(
    stored.widgets.map((w) => [w.type, w.title, w.layout]),
    [
      ['numbers', 'Total cost', { x: 0, y: 0, w: 3, h: 3 }],
      ['battery', 'Battery', { x: 3, y: 0, w: 6, h: 3 }],
      ['chart', 'Chart', { x: 0, y: 3, w: 6, h: 5 }],
      ['table', 'Table', { x: 0, y: 8, w: 12, h: 6 }],
      ['workload', 'Workload', { x: 0, y: 14, w: 12, h: 6 }],
    ],
  );
  // Column titles became ids; the numbers widget keeps the first board's column id.
  assert.deepEqual(stored.widgets[0].settings, { mode: 'sum', columnId: 'cost', filter: null });
  assert.deepEqual(stored.widgets[1].settings, {
    statusColumnId: null,
    doneLabelIds: ['done_green'],
  });
  assert.equal(stored.widgets[2].settings.xColumnId, 'st');
  assert.equal(stored.widgets[2].settings.chartType, 'pie');
  assert.deepEqual(stored.widgets[3].settings.columnIds, ['st', 'cost']);
  assert.deepEqual(stored.widgets[3].boardIds, ['b1']);
  assert.equal(stored.widgets[4].settings.peopleColumnId, 'who');
  // Read back in the tool's own words.
  const read = await run('atrium_get_dashboard', { dashboardId: created.id });
  assert.deepEqual(read.widgets[0].settings, { mode: 'sum', column: 'Cost', filter: null });
  assert.deepEqual(read.widgets[1].settings.doneLabels, ['Done']);
  assert.equal(read.widgets[2].settings.x, 'Status');
  assert.deepEqual(read.widgets[3].settings.columns, ['Status', 'Cost']);
  assert.equal(read.widgets[4].settings.dateColumn, 'Due');
});

test('create refuses bad input and writes nothing', async () => {
  const { client, run } = setup();
  const before = client.commits.length;
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [{ type: 'numbers', settings: { mode: 'sum', column: 'Nope' } }],
      }),
    /No column "Nope".*Available: "Cost", "Double"/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [{ type: 'numbers', settings: { mode: 'sum', column: 'Note' } }],
      }),
    /cannot be used/,
  );
  await assert.rejects(
    () => run('atrium_create_dashboard', { name: 'X', boards: ['Secret'] }),
    /No board "Secret"/,
  );
  await assert.rejects(
    () => run('atrium_create_dashboard', { name: 'X', boards: ['b3'] }),
    /No board "b3"/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        widgets: [{ type: 'chart', settings: { x: 'Status' } }],
      }),
    /widget reads no boards/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [{ type: 'numbers', boards: ['Budget'] }],
      }),
    /can only read boards that are on the dashboard/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [{ type: 'battery', settings: { colour: 1 } }],
      }),
    /Unknown battery setting "colour"/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [{ type: 'numbers', settings: { mode: 'median' } }],
      }),
    /widgets are not valid/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        boards: ['Chores'],
        widgets: [
          { type: 'numbers', settings: { filter: { column: 'Status', labels: ['Gone'] } } },
        ],
      }),
    /no label "Gone"/,
  );
  await assert.rejects(
    () =>
      run('atrium_create_dashboard', {
        name: 'X',
        widgets: Array.from({ length: 25 }, () => ({ type: 'numbers' })),
      }),
    /at most 24 widgets/,
  );
  assert.equal(client.commits.length, before);
});

test('a viewer cannot create a dashboard; a member can and owns it', async () => {
  await assert.rejects(
    () => setup({ actor: VW }).run('atrium_create_dashboard', { name: 'X' }),
    /member role or higher/,
  );
  const { client, run } = setup({ actor: ED });
  const created = await run('atrium_create_dashboard', { name: 'Mine', kind: 'private' });
  const stored = client.docs.get(`dashboards/${created.id}`).data;
  assert.deepEqual(stored.access, { [ED]: 'owner' });
  assert.deepEqual(stored.accessUids, [ED]);
  assert.equal(stored.kind, 'private');
});

test('numbers and battery values are computed from the boards the actor can read', async () => {
  const { run } = setup({
    extra: {
      'dashboards/d1': dashDoc({
        boardIds: ['b1', 'b2', 'b3'],
        widgets: [
          {
            id: 'w1',
            type: 'numbers',
            title: 'Sum',
            layout: { x: 0, y: 0, w: 3, h: 3 },
            boardIds: [],
            settings: { mode: 'sum', columnId: 'cost', filter: null },
          },
          {
            id: 'w2',
            type: 'numbers',
            title: 'Done cost',
            layout: { x: 3, y: 0, w: 3, h: 3 },
            boardIds: [],
            settings: {
              mode: 'sum',
              columnId: 'cost',
              filter: { columnId: 'st', values: ['done_green'] },
            },
          },
          {
            id: 'w3',
            type: 'numbers',
            title: 'Items',
            layout: { x: 6, y: 0, w: 3, h: 3 },
            boardIds: ['b1'],
            settings: { mode: 'count', columnId: null, filter: null },
          },
          {
            id: 'w4',
            type: 'numbers',
            title: 'Avg double',
            layout: { x: 9, y: 0, w: 3, h: 3 },
            boardIds: ['b1'],
            settings: { mode: 'average', columnId: 'fm', filter: null },
          },
          {
            id: 'w5',
            type: 'battery',
            title: 'Progress',
            layout: { x: 0, y: 3, w: 6, h: 3 },
            boardIds: [],
            settings: { statusColumnId: null, doneLabelIds: [] },
          },
          {
            id: 'w6',
            type: 'chart',
            title: 'Chart',
            layout: { x: 6, y: 3, w: 6, h: 5 },
            boardIds: [],
            settings: {
              chartType: 'bar',
              xColumnId: 'st',
              dateBucket: 'month',
              stackColumnId: null,
              yMode: 'count',
              yColumnId: null,
              sortBy: 'board',
              showLegend: true,
              showValues: true,
              showEmpty: true,
            },
          },
        ],
      }),
    },
  });
  const read = await run('atrium_get_dashboard', { dashboardId: 'd1' });
  assert.deepEqual(read.unreadableBoardIds, ['b3']);
  // 5 + 7.5 on Chores (the archived item and the unreadable board add nothing) + 1000 + 250 on Budget.
  assert.equal(widgetOf(read, 'Sum').data.value, 1262.5);
  assert.equal(widgetOf(read, 'Done cost').data.value, 5 + 250);
  assert.equal(widgetOf(read, 'Items').data.value, 3);
  // The formula column is computed per item: 10, 15 and 0 for Mow (no cost).
  assert.equal(widgetOf(read, 'Avg double').data.value, 25 / 3);
  const battery = widgetOf(read, 'Progress').data;
  assert.equal(battery.total, 5);
  assert.equal(battery.doneCount, 3);
  assert.equal(battery.percent, 60);
  assert.deepEqual(
    battery.segments.map((s) => [s.label, s.count, s.done]),
    [
      ['Working on it', 2, false],
      ['Done', 3, true],
    ],
  );
  assert.equal(widgetOf(read, 'Chart').data, undefined);
  // Readable form: titles and label texts, never ids.
  assert.deepEqual(widgetOf(read, 'Done cost').settings.filter, {
    column: 'Status',
    labels: ['Done'],
  });
  assert.deepEqual(widgetOf(read, 'Items').boards, [{ id: 'b1', name: 'Chores' }]);
});

test('numbers and battery computations equal the web models on the same data', async () => {
  const boards = [
    { id: 'b1', name: 'Chores', columns: choreColumns, workspaceId: WS },
    { id: 'b2', name: 'Budget', columns: budgetColumns, workspaceId: WS },
  ];
  const mk = (rows) => rows.map(([id, values, more]) => ({ id, data: item(id, values, more) }));
  const webItems = (rows) => rows.map(([id, values, more]) => ({ id, ...item(id, values, more) }));
  const rows1 = [
    ['i1', { st: { index: 1 }, cost: 5 }],
    ['i2', { st: { index: 0 }, cost: 7.5 }],
    ['i3', { st: { index: 1 } }],
    ['i4', {}],
  ];
  const rows2 = [
    ['j1', { bst: { index: 0 }, bcost: 1000 }],
    ['j2', { bst: { index: 2 }, bcost: 250 }],
  ];
  const { computeWidget } = await import('./service/dashboards.mjs');
  const mine = [
    { ...boards[0], items: mk(rows1) },
    { ...boards[1], items: mk(rows2) },
  ];
  const web = [
    { board: { ...boards[0], state: 'active' }, items: webItems(rows1) },
    { board: { ...boards[1], state: 'active' }, items: webItems(rows2) },
  ];
  for (const settings of [
    { mode: 'count', columnId: null, filter: null },
    { mode: 'sum', columnId: 'cost', filter: null },
    { mode: 'average', columnId: 'cost', filter: null },
    { mode: 'min', columnId: 'bcost', filter: null },
    { mode: 'max', columnId: 'fm', filter: null },
    {
      mode: 'sum',
      columnId: 'cost',
      filter: { columnId: 'st', values: ['done_green', 'stuck_red'] },
    },
    { mode: 'sum', columnId: 'gone', filter: null },
  ]) {
    for (const boardIds of [[], ['b2']]) {
      const widget = { type: 'numbers', boardIds, settings };
      const expected = buildNumbersModel({ boards: web, widgetBoardIds: boardIds, settings });
      const got = computeWidget(mine, widget);
      assert.equal(got.value, expected.value, JSON.stringify([settings, boardIds]));
      assert.equal(got.itemCount, expected.itemCount);
    }
  }
  for (const settings of [
    { statusColumnId: null, doneLabelIds: [] },
    { statusColumnId: 'st', doneLabelIds: ['done_green', 'stuck_red'] },
  ]) {
    const expected = buildBatteryModel({ boards: web, widgetBoardIds: [], settings });
    const got = computeWidget(mine, { type: 'battery', boardIds: [], settings });
    assert.equal(got.percent, expected.percent);
    assert.equal(got.total, expected.total);
    assert.deepEqual(
      got.segments.map((s) => [s.label, s.count, s.done]),
      expected.segments.map((s) => [s.label, s.count, s.done]),
    );
  }
});

test('the grid layout equals the web layout engine on the same widgets', () => {
  const sizes = [
    { x: 0, y: 0, w: 3, h: 3 },
    { x: 3, y: 0, w: 6, h: 3 },
    { x: 2, y: 1, w: 12, h: 6 },
    { x: 11, y: 40, w: 2, h: 2 },
    { x: 0, y: 2, w: 6, h: 5 },
  ];
  const widgets = sizes.map((layout, i) => ({ id: `w${i}`, layout }));
  assert.deepEqual(normalizeWidgets(widgets), webNormalizeWidgets(widgets));
  for (let n = 0; n <= sizes.length; n += 1) {
    const items = sizes.slice(0, n);
    for (const size of [
      { w: 3, h: 3 },
      { w: 6, h: 5 },
      { w: 12, h: 6 },
      { w: 1, h: 99 },
    ]) {
      assert.deepEqual(findFreeSlot(items, size), webFindFreeSlot(items, size));
    }
  }
  assert.deepEqual(clampLayout({ x: 99, y: -5, w: 50, h: 0 }), { x: 0, y: 0, w: 12, h: 2 });
});

test('update changes the name, boards and widgets in one write and returns what it removed', async () => {
  const { client, run } = setup({
    extra: {
      'dashboards/d1': dashDoc({
        boardIds: ['b1', 'b2'],
        widgets: [
          {
            id: 'w1',
            type: 'numbers',
            title: 'Sum',
            layout: { x: 0, y: 0, w: 3, h: 3 },
            boardIds: ['b1', 'b2'],
            settings: { mode: 'sum', columnId: 'cost', filter: null },
          },
          {
            id: 'w2',
            type: 'battery',
            title: 'Progress',
            layout: { x: 3, y: 0, w: 6, h: 3 },
            boardIds: [],
            settings: { statusColumnId: null, doneLabelIds: [] },
          },
        ],
      }),
    },
  });
  const result = await run('atrium_update_dashboard', {
    dashboardId: 'd1',
    name: 'Budget view',
    removeWidgets: ['w2'],
    updateWidgets: [{ widgetId: 'w1', title: 'Total', settings: { mode: 'average' } }],
    addWidgets: [{ type: 'table', settings: { columns: ['Status'] } }],
  });
  assert.equal(result.name, 'Budget view');
  assert.equal(result.removedWidgets.length, 1);
  assert.equal(result.removedWidgets[0].id, 'w2');
  assert.equal(result.removedWidgets[0].type, 'battery');
  assert.equal(result.addedWidgetIds.length, 1);
  const patch = client.commits.at(-1)[0];
  assert.deepEqual(Object.keys(patch.data).sort(), ['name', 'updatedAt', 'updatedBy', 'widgets']);
  assert.equal(patch.data.updatedBy, ME);
  const stored = client.docs.get('dashboards/d1').data;
  assert.equal(stored.name, 'Budget view');
  assert.deepEqual(
    stored.widgets.map((w) => w.title),
    ['Total', 'Table'],
  );
  // Only the given setting changed; the rest of the widget stayed.
  assert.deepEqual(stored.widgets[0].settings, { mode: 'average', columnId: 'cost', filter: null });
  assert.deepEqual(stored.widgets[0].boardIds, ['b1', 'b2']);
  // The remaining widget was compacted to the top, the new one took the next free slot.
  assert.deepEqual(stored.widgets[0].layout, { x: 0, y: 0, w: 3, h: 3 });
  assert.deepEqual(stored.widgets[1].layout, { x: 0, y: 3, w: 12, h: 6 });
  assert.equal(dashboardWidgetsSchema.safeParse(stored.widgets).success, true);
  // Sharing fields were not touched.
  assert.deepEqual(stored.access, { [ME]: 'owner' });
  assert.equal(stored.kind, 'main');
});

test('changing the boards prunes widgets, keeps boards the actor cannot read, and refuses bad refs', async () => {
  const { client, run } = setup({
    extra: {
      'dashboards/d1': dashDoc({
        boardIds: ['b1', 'b2', 'b3'],
        widgets: [
          {
            id: 'w1',
            type: 'numbers',
            title: 'Sum',
            layout: { x: 0, y: 0, w: 3, h: 3 },
            boardIds: ['b2', 'b3'],
            settings: { mode: 'count', columnId: null, filter: null },
          },
        ],
      }),
    },
  });
  await assert.rejects(
    () => run('atrium_update_dashboard', { dashboardId: 'd1', boards: ['Nope'] }),
    /No board "Nope"/,
  );
  await assert.rejects(
    () => run('atrium_update_dashboard', { dashboardId: 'd1' }),
    /Nothing to change/,
  );
  await assert.rejects(
    () => run('atrium_update_dashboard', { dashboardId: 'd1', removeWidgets: ['zz'] }),
    /Widget "zz" is not on this dashboard/,
  );
  await assert.rejects(
    () =>
      run('atrium_update_dashboard', {
        dashboardId: 'd1',
        updateWidgets: [{ widgetId: 'w1', boards: ['Chores'] }, { widgetId: 'zz' }],
      }),
    /Widget "zz"/,
  );
  await run('atrium_update_dashboard', { dashboardId: 'd1', boards: ['Chores'] });
  const stored = client.docs.get('dashboards/d1').data;
  // b3 is private to someone else: it stays, b2 left, and the widget lost b2 only.
  assert.deepEqual(stored.boardIds, ['b1', 'b3']);
  assert.deepEqual(stored.widgets[0].boardIds, ['b3']);
});

test('only the dashboard owner or an editor can change it; a viewer reads', async () => {
  const extra = {
    'dashboards/d1': dashDoc({
      access: { [ME]: 'owner', [VW]: 'viewer', [ED]: 'editor' },
      accessUids: [ME, VW, ED],
    }),
  };
  await assert.rejects(
    () =>
      setup({ actor: VW, extra }).run('atrium_update_dashboard', { dashboardId: 'd1', name: 'x' }),
    /only view/,
  );
  const viewer = await setup({ actor: VW, extra }).run('atrium_get_dashboard', {
    dashboardId: 'd1',
  });
  assert.equal(viewer.role, 'viewer');
  const editor = setup({ actor: ED, extra });
  await editor.run('atrium_update_dashboard', { dashboardId: 'd1', name: 'Edited' });
  assert.equal(editor.client.docs.get('dashboards/d1').data.name, 'Edited');
  await assert.rejects(
    () => editor.run('atrium_delete_dashboard', { dashboardId: 'd1' }),
    /Only the dashboard owner/,
  );
});

test('delete moves to the trash and restore brings it back; both are owner-only', async () => {
  const { client, run } = setup({
    extra: {
      'dashboards/d1': dashDoc({ widgets: [] }),
      'dashboards/d2': dashDoc({ name: 'Other', position: 'a6' }),
    },
  });
  const deleted = await run('atrium_delete_dashboard', { dashboardId: 'd1' });
  assert.equal(deleted.state, 'deleted');
  const stored = client.docs.get('dashboards/d1').data;
  assert.equal(stored.state, 'deleted');
  assert.deepEqual(stored.deletedAt, NOW);
  assert.deepEqual(
    (await run('atrium_list_dashboards', {})).dashboards.map((d) => d.id),
    ['d2'],
  );
  assert.deepEqual(
    (await run('atrium_list_dashboards', { state: 'deleted' })).dashboards.map((d) => d.id),
    ['d1'],
  );
  await assert.rejects(() => run('atrium_get_dashboard', { dashboardId: 'd1' }), /in the trash/);
  await assert.rejects(
    () => run('atrium_update_dashboard', { dashboardId: 'd1', name: 'x' }),
    /in the trash/,
  );
  await assert.rejects(() => run('atrium_delete_dashboard', { dashboardId: 'd1' }), /in the trash/);
  assert.equal((await run('atrium_restore_dashboard', { dashboardId: 'd1' })).state, 'active');
  assert.equal(client.docs.get('dashboards/d1').data.deletedAt, null);
  // Repeating a restore changes nothing.
  const writes = client.commits.length;
  await run('atrium_restore_dashboard', { dashboardId: 'd1' });
  assert.equal(client.commits.length, writes);
  // Restore needs the owner too.
  const member = setup({
    actor: ED,
    extra: { 'dashboards/d1': dashDoc({ state: 'deleted', deletedAt: LONG_AGO }) },
  });
  await assert.rejects(
    () => member.run('atrium_restore_dashboard', { dashboardId: 'd1' }),
    /Only the dashboard owner/,
  );
});

test('list shows main dashboards and those that name the actor, and hides everything else', async () => {
  const { run } = setup({
    actor: ED,
    extra: {
      'dashboards/d1': dashDoc({ position: 'a1' }),
      'dashboards/d2': dashDoc({ name: 'Private', kind: 'private', position: 'a2' }),
      'dashboards/d3': dashDoc({
        name: 'Shared',
        kind: 'shareable',
        access: { [ME]: 'owner', [ED]: 'viewer' },
        accessUids: [ME, ED],
        position: 'a3',
      }),
      'dashboards/d4': dashDoc({ name: 'Elsewhere', workspaceId: 'other', position: 'a4' }),
    },
  });
  const list = await run('atrium_list_dashboards', {});
  assert.deepEqual(
    list.dashboards.map((d) => [d.id, d.role]),
    [
      ['d1', 'editor'],
      ['d3', 'viewer'],
    ],
  );
  await assert.rejects(() => run('atrium_get_dashboard', { dashboardId: 'd2' }), /not found/);
  await assert.rejects(() => run('atrium_get_dashboard', { dashboardId: 'd4' }), /not found/);
});
