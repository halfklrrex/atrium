// Tests for batch 2 PR 6: every column type can be created and holds a value, mirror columns read,
// and labels are renamed, recolored, reordered and removed (with the data-loss guard).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { columnRegistry } from '@atrium/shared';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { CREATABLE_COLUMN_TYPES } from './values.mjs';

const WS = 'ws1';
const ME = 'user-me';
const OTHER = 'user-other';
const NOW = new Date('2026-11-01T10:00:00Z');

const board = (access, more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'private',
  access,
  accessUids: Object.keys(access),
  position: 'a0',
  folderId: null,
  name: 'Board',
  description: '',
  columns: [],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  ...more,
});
const item = (name, values = {}, more = {}) => ({
  name,
  state: 'active',
  groupId: 'g1',
  position: `a${name.length}`,
  parentItemId: null,
  values,
  ...more,
});

function setup({ columns = [], extra = {} } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: {
      name: 'Home',
      ownerId: ME,
      roles: { [ME]: 'owner', [OTHER]: 'member' },
      memberIds: [ME, OTHER],
    },
    [`users/${ME}`]: { displayName: 'Avery Quinn' },
    'boards/b1': board({ [ME]: 'owner' }, { name: 'Main', columns }),
    // A board the actor can read (viewer), one they cannot (private to someone else).
    'boards/b2': board(
      { [ME]: 'viewer', [OTHER]: 'owner' },
      {
        name: 'Recipes',
        columns: [
          { id: 'cost', type: 'numbers', title: 'Cost', position: 'a0', settings: {} },
          { id: 'tag', type: 'text', title: 'Tag', position: 'a1', settings: {} },
          {
            id: 'f',
            type: 'formula',
            title: 'Calc',
            position: 'a2',
            settings: { expression: '1', outputType: 'number' },
          },
        ],
      },
    ),
    'boards/b3': board(
      { [OTHER]: 'owner' },
      {
        name: 'Secret',
        columns: [{ id: 'cost', type: 'numbers', title: 'Cost', position: 'a0', settings: {} }],
      },
    ),
    ...extra,
  });
  const service = createService({ client, actor: { uid: ME }, now: () => NOW });
  return { client, service };
}

const add = (service, type, settings, title = type) =>
  service.addColumn({ boardId: 'b1', title, type, settings });

// ---- creating every type ------------------------------------------------------------------------

test('the creatable types are every registered type except button', () => {
  const registered = columnRegistry.list().map((t) => t.type);
  assert.deepEqual(
    registered.filter((t) => !CREATABLE_COLUMN_TYPES.includes(t)),
    ['button'],
  );
});

test('create: the plain new types with their default and given settings', async () => {
  const { service, client } = setup();
  for (const type of ['email', 'phone', 'country', 'location', 'color_picker', 'files']) {
    const made = await add(service, type);
    assert.equal(made.type, type);
  }
  await add(service, 'hour', { format24Hour: false });
  await add(service, 'week', { firstDayOfWeek: 'sunday' });
  await add(service, 'world_clock', { showCity: false });
  await add(service, 'item_id', { displayType: 'customKey', customKeySettings: { prefix: 'T-' } });
  await add(service, 'auto_number', { prefix: 'N', scope: 'board' });
  await add(service, 'creation_log', { mode: 'dateOnly' });
  await add(service, 'last_updated');
  await add(service, 'time_tracking');
  await add(service, 'vote');
  const columns = client.docs.get('boards/b1').data.columns;
  assert.equal(columns.length, 15);
  assert.equal(columns.find((c) => c.type === 'hour').settings.format24Hour, false);
  assert.equal(columns.find((c) => c.type === 'item_id').settings.customKeySettings.prefix, 'T-');
  // The server-maintained id lists are never written by the connector.
  const doc = client.docs.get('boards/b1').data;
  for (const key of [
    'derivedColumnIds',
    'serverManagedColumnIds',
    'voteColumnIds',
    'requiredColumnIds',
  ]) {
    assert.equal(key in doc, false, key);
  }
});

test('create: invalid settings are refused per type', async () => {
  const { service } = setup();
  await assert.rejects(add(service, 'hour', { format24Hour: 'yes' }), /Invalid settings/);
  await assert.rejects(add(service, 'week', { firstDayOfWeek: 'friday' }), /Invalid settings/);
  await assert.rejects(add(service, 'email', { extra: 1 }), /Invalid settings/);
  await assert.rejects(add(service, 'item_id', { displayType: 'customKey' }), /Invalid settings/);
  await assert.rejects(add(service, 'auto_number', { scope: 'planet' }), /Invalid settings/);
  await assert.rejects(add(service, 'files', { maxFileSizeMb: 0 }), /Invalid settings/);
  await assert.rejects(add(service, 'button'), /not supported/);
});

test('create: the vote cap of 10 still holds', async () => {
  const { service } = setup();
  for (let i = 0; i < 10; i += 1) await add(service, 'vote', {}, `V${i}`);
  await assert.rejects(add(service, 'vote', {}, 'V10'), /vote/i);
});

test('create: formula is parsed like the web, progress takes status columns', async () => {
  const { service, client } = setup();
  await add(service, 'numbers', {}, 'Price');
  await add(service, 'status', { addLabels: ['Todo', { label: 'Done', color: 'green' }] }, 'Stage');
  const formula = await add(
    service,
    'formula',
    { expression: '{Price} * 2', outputType: 'number' },
    'Double',
  );
  assert.equal(formula.type, 'formula');
  await assert.rejects(
    add(service, 'formula', { expression: '{Nope} + 1', outputType: 'number' }, 'Bad'),
    /Unknown column reference/,
  );
  await assert.rejects(
    add(service, 'formula', { expression: '1 +', outputType: 'number' }, 'Bad2'),
    /Invalid formula/,
  );
  await add(service, 'progress', { statusColumns: ['Stage'] }, 'Done %');
  const prog = client.docs.get('boards/b1').data.columns.find((c) => c.title === 'Done %');
  const stage = client.docs.get('boards/b1').data.columns.find((c) => c.title === 'Stage');
  assert.equal(prog.settings.related_columns.columns[stage.id].isSelected, true);
  await assert.rejects(
    add(service, 'progress', { statusColumns: ['Price'] }, 'P2'),
    /not a status/,
  );
});

test('create: connect boards takes readable boards by id or name; unreadable and two-way are refused', async () => {
  const { service, client } = setup();
  const made = await add(service, 'board_relation', { boards: ['Recipes'] }, 'Link');
  assert.equal(made.type, 'board_relation');
  const col = client.docs.get('boards/b1').data.columns.find((c) => c.title === 'Link');
  assert.deepEqual(col.settings.boardIds, ['b2']);
  assert.equal(col.settings.twoWay, false);
  await assert.rejects(
    add(service, 'board_relation', { boards: ['b3'] }, 'L2'),
    /not found among the boards you can read/,
  );
  await assert.rejects(
    add(service, 'board_relation', { boards: ['Secret'] }, 'L3'),
    /not found among the boards you can read/,
  );
  await assert.rejects(
    add(service, 'board_relation', { boards: ['b2'], twoWay: true }, 'L4'),
    /Two-way/,
  );
});

test('create: mirror needs a connect boards column, a readable linked board and a plain target column', async () => {
  const { service, client } = setup();
  await assert.rejects(
    add(service, 'mirror', {}, 'M0'),
    /Connect boards column on this board first/,
  );
  await add(service, 'board_relation', { boards: ['b2'] }, 'Link');
  await assert.rejects(add(service, 'mirror', { relationColumn: 'Link' }, 'M1'), /targetColumns/);
  await assert.rejects(
    add(service, 'mirror', { relationColumn: 'Link', targetColumns: { Recipes: 'Calc' } }, 'M2'),
    /cannot be mirrored/,
  );
  await assert.rejects(
    add(
      service,
      'mirror',
      { relationColumn: 'Link', targetColumns: { Recipes: 'Tag' }, aggregation: 'sum' },
      'M3',
    ),
    /does not fit/,
  );
  await assert.rejects(
    add(service, 'mirror', { relationColumn: 'Link', targetColumns: { Secret: 'Cost' } }, 'M4'),
    /not found among the boards you can read/,
  );
  await add(
    service,
    'mirror',
    { relationColumn: 'Link', targetColumns: { Recipes: 'Cost' }, aggregation: 'sum' },
    'Total',
  );
  const cols = client.docs.get('boards/b1').data.columns;
  const mirror = cols.find((c) => c.title === 'Total');
  assert.deepEqual(mirror.settings, {
    relationColumnId: cols.find((c) => c.title === 'Link').id,
    targetColumnIds: { b2: 'cost' },
    aggregation: 'sum',
  });
});

test('create: dependency resolves its time column', async () => {
  const { service, client } = setup();
  await add(service, 'timeline', {}, 'When');
  await add(service, 'text', {}, 'Note');
  await assert.rejects(
    add(service, 'dependency', { timeColumn: 'Note' }, 'D0'),
    /not a date or timeline/,
  );
  await add(service, 'dependency', { strict: true, timeColumn: 'When' }, 'After');
  const dep = client.docs.get('boards/b1').data.columns.find((c) => c.title === 'After');
  assert.equal(dep.settings.strict, true);
  assert.ok(dep.settings.timeColumnId);
});

// ---- cell input ---------------------------------------------------------------------------------

async function boardWithCells() {
  const { service, client } = setup();
  const types = {
    Mail: ['email'],
    Tel: ['phone'],
    Land: ['country'],
    Where: ['location'],
    Time: ['hour'],
    Wk: ['week'],
    Clock: ['world_clock'],
    Paint: ['color_picker'],
  };
  for (const [title, [type]] of Object.entries(types)) await add(service, type, undefined, title);
  await add(service, 'week', { firstDayOfWeek: 'sunday' }, 'WkSun');
  await add(service, 'files', undefined, 'Docs');
  client.docs.set('boards/b1/items/i1', { data: item('One'), updateTime: 'x' });
  await service.createItems({ boardId: 'b1', items: [{ name: 'Row' }] });
  const rowId = [...client.docs.keys()]
    .find((k) => k.startsWith('boards/b1/items/') && k !== 'boards/b1/items/i1')
    .split('/')
    .at(-1);
  return { service, client, rowId };
}

test('cells: email, phone, country, location, hour, week, world clock and color', async () => {
  const { service, client, rowId } = await boardWithCells();
  await service.updateItem({
    boardId: 'b1',
    itemId: rowId,
    values: {
      Mail: 'avery@example.com',
      Tel: { phone: '+31 20 123 4567', country: 'nl' },
      Land: 'Netherlands',
      Where: { lat: 52.37, lng: 4.9, address: 'Amsterdam' },
      Time: '2:30 PM',
      Wk: '2026-W47',
      WkSun: '2026-11-19',
      Clock: 'Europe/Paris',
      Paint: '#ff5733',
    },
  });
  const stored = client.docs.get(`boards/b1/items/${rowId}`).data.values;
  const cols = client.docs.get('boards/b1').data.columns;
  const by = (title) => stored[cols.find((c) => c.title === title).id];
  assert.deepEqual(by('Mail'), { email: 'avery@example.com' });
  assert.deepEqual(by('Tel'), { phone: '+31 20 123 4567', countryShortName: 'NL' });
  assert.deepEqual(by('Land'), { countryCode: 'NL', countryName: 'Netherlands' });
  assert.deepEqual(by('Where'), { lat: 52.37, lng: 4.9, address: 'Amsterdam' });
  assert.deepEqual(by('Time'), { hour: 14, minute: 30 });
  assert.deepEqual(by('Wk'), { week: { startDate: '2026-11-16', endDate: '2026-11-22' } });
  assert.deepEqual(by('WkSun'), { week: { startDate: '2026-11-15', endDate: '2026-11-21' } });
  assert.deepEqual(by('Clock'), { timezone: 'Europe/Paris' });
  assert.deepEqual(by('Paint'), { color: { hex: '#ff5733' } });
  const read = await service.findItems({ boardId: 'b1', name: 'Row' });
  assert.equal(read.items[0].values.Land, 'Netherlands');
  assert.equal(read.items[0].values.Time, '14:30');
  assert.equal(read.items[0].values.Paint, '#FF5733');
});

test('cells: the week forms agree and the other values refuse bad input', async () => {
  const { service, rowId } = await boardWithCells();
  const write = (values) => service.updateItem({ boardId: 'b1', itemId: rowId, values });
  await write({ Wk: '2026-11-16' });
  await write({ Wk: '2026-W01' });
  await assert.rejects(write({ Mail: 'not an email' }), /Column "Mail"/);
  await assert.rejects(write({ Land: 'Atlantis' }), /not a country/);
  await assert.rejects(write({ Where: 'Dam Square' }), /need coordinates/);
  await assert.rejects(write({ Where: { lat: 100, lng: 0 } }), /Column "Where"/);
  await assert.rejects(write({ Time: '25:00' }), /not a time/);
  await assert.rejects(write({ Wk: 'next week' }), /not a week/);
  await assert.rejects(write({ Clock: 'Mars/Base' }), /not a time zone/);
  await assert.rejects(write({ Paint: 'red' }), /Column "Paint"/);
  await assert.rejects(write({ Docs: { files: [] } }), /calculated by Atrium/);
});

test('cells: connect boards takes ids and names, checks the connected boards and the actor', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b2/items/r1': item('Pasta'),
      'boards/b2/items/r2': item('Pizza'),
      'boards/b2/items/r3': item('Pizza', {}, { state: 'deleted' }),
      'boards/b3/items/s1': item('Hidden'),
      'boards/b1/items/i1': item('Dinner'),
    },
  });
  await add(service, 'board_relation', { boards: ['b2'] }, 'Link');
  await add(service, 'board_relation', { boards: ['b2'], allowMultipleItems: false }, 'One');
  const link = (values) => service.updateItem({ boardId: 'b1', itemId: 'i1', values });
  await link({ Link: ['Pasta', 'r2'] });
  const cols = client.docs.get('boards/b1').data.columns;
  const linkId = cols.find((c) => c.title === 'Link').id;
  assert.deepEqual(client.docs.get('boards/b1/items/i1').data.values[linkId], {
    linkedItems: [
      { boardId: 'b2', itemId: 'r1' },
      { boardId: 'b2', itemId: 'r2' },
    ],
  });
  await assert.rejects(link({ Link: 'Nothing' }), /No item "Nothing"/);
  await assert.rejects(
    link({ Link: { board: 'b3', item: 's1' } }),
    /not found among the boards you can read/,
  );
  await assert.rejects(link({ Link: { board: 'b1', item: 'i1' } }), /not connected to board/);
  await assert.rejects(link({ One: ['r1', 'r2'] }), /Column "One"/);
  await link({ Link: null });
  assert.equal(client.docs.get('boards/b1/items/i1').data.values[linkId], undefined);
});

test('cells: dependency takes ids and names on the same level and refuses cycles', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b1/items/a': item('Dig'),
      'boards/b1/items/b': item('Pour'),
      'boards/b1/items/c': item('Build'),
      'boards/b1/items/sub': item('Sub', {}, { parentItemId: 'a' }),
    },
  });
  await add(service, 'dependency', {}, 'After');
  const dep = (itemId, values) => service.updateItem({ boardId: 'b1', itemId, values });
  await dep('b', { After: ['Dig'] });
  await dep('c', { After: ['b'] });
  const col = client.docs.get('boards/b1').data.columns[0].id;
  assert.deepEqual(client.docs.get('boards/b1/items/b').data.values[col], { item_ids: ['a'] });
  await assert.rejects(dep('a', { After: ['Build'] }), /Circular dependency/);
  await assert.rejects(dep('a', { After: ['Dig'] }), /cannot depend on itself/);
  await assert.rejects(dep('b', { After: ['sub'] }), /not at the same level/);
  await assert.rejects(dep('b', { After: ['Ghost'] }), /not found on this board/);
});

// ---- mirror reads -------------------------------------------------------------------------------

test('mirror: reads the linked values, aggregates, and skips boards the actor cannot read', async () => {
  const { service } = setup({
    columns: [
      {
        id: 'rel',
        type: 'board_relation',
        title: 'Link',
        position: 'a0',
        settings: { boardIds: ['b2', 'b3'], allowMultipleItems: true, twoWay: false },
      },
      {
        id: 'mir',
        type: 'mirror',
        title: 'Costs',
        position: 'a1',
        settings: {
          relationColumnId: 'rel',
          targetColumnIds: { b2: 'cost', b3: 'cost' },
          aggregation: 'none',
        },
      },
      {
        id: 'sum',
        type: 'mirror',
        title: 'Total',
        position: 'a2',
        settings: {
          relationColumnId: 'rel',
          targetColumnIds: { b2: 'cost', b3: 'cost' },
          aggregation: 'sum',
        },
      },
    ],
    extra: {
      'boards/b2/items/r1': item('Pasta', { cost: 4 }),
      'boards/b2/items/r2': item('Pizza', { cost: 6 }),
      'boards/b2/items/r3': item('Gone', { cost: 100 }, { state: 'archived' }),
      'boards/b3/items/s1': item('Hidden', { cost: 1000 }),
      'boards/b1/items/i1': item('Dinner', {
        rel: {
          linkedItems: [
            { boardId: 'b2', itemId: 'r1' },
            { boardId: 'b2', itemId: 'r2' },
            { boardId: 'b2', itemId: 'r3' },
            { boardId: 'b2', itemId: 'missing' },
            { boardId: 'b3', itemId: 's1' },
          ],
        },
      }),
    },
  });
  const board = await service.getBoard({ boardId: 'b1' });
  const dinner = board.items.find((i) => i.name === 'Dinner');
  assert.equal(dinner.values.Costs, '4, 6');
  assert.equal(dinner.values.Total, '10');
  assert.equal(board.notes, undefined);
  const found = await service.findItems({ boardId: 'b1', name: 'Dinner' });
  assert.equal(found.items[0].values.Costs, '4, 6');
});

test('mirror: reads at most 10 linked boards and says so', async () => {
  const extra = {};
  const links = [];
  const targets = {};
  for (let n = 0; n < 12; n += 1) {
    extra[`boards/x${n}`] = board({ [ME]: 'owner' }, { name: `X${n}`, columns: [] });
    extra[`boards/x${n}/items/t`] = item('T', { v: n });
    links.push({ boardId: `x${n}`, itemId: 't' });
    targets[`x${n}`] = 'v';
  }
  const { service } = setup({
    columns: [
      {
        id: 'rel',
        type: 'board_relation',
        title: 'Link',
        position: 'a0',
        settings: { boardIds: [], allowMultipleItems: true, twoWay: false },
      },
      {
        id: 'mir',
        type: 'mirror',
        title: 'Vs',
        position: 'a1',
        settings: { relationColumnId: 'rel', targetColumnIds: targets, aggregation: 'count' },
      },
    ],
    extra: {
      ...extra,
      'boards/b1/items/i1': item('Many', { rel: { linkedItems: links } }),
    },
  });
  const result = await service.getBoard({ boardId: 'b1' });
  assert.match(result.notes[0], /10 of 12 linked boards/);
});

// ---- labels -------------------------------------------------------------------------------------

const statusColumn = {
  id: 'st',
  type: 'status',
  title: 'Stage',
  position: 'a0',
  settings: {
    labels: [
      { id: 'l0', index: 0, label: 'Todo', color: '#fdab3d' },
      { id: 'l1', index: 1, label: 'Doing', color: '#579bfc' },
      { id: 'l2', index: 2, label: 'Done', color: '#00c875', isDone: true },
      { id: 'lb', index: 5, label: '', color: '#c4c4c4' },
    ],
  },
};
const dropdownColumn = {
  id: 'dd',
  type: 'dropdown',
  title: 'Where',
  position: 'a1',
  settings: {
    labels: [
      { id: 0, label: 'Home' },
      { id: 1, label: 'Work' },
      { id: 2, label: 'Away' },
    ],
    limitSelect: false,
  },
};
const tagsColumn = {
  id: 'tg',
  type: 'tags',
  title: 'Tags',
  position: 'a2',
  settings: {
    tags: [
      { id: 1, name: 'urgent', color: '#df2f4a' },
      { id: 2, name: 'later' },
    ],
  },
};

function labelBoard() {
  return setup({
    columns: [statusColumn, dropdownColumn, tagsColumn],
    extra: {
      'boards/b1/items/i1': item('A', {
        st: { index: 0 },
        dd: { ids: [0, 1] },
        tg: { tag_ids: [1] },
      }),
      'boards/b1/items/i2': item('B', { st: { index: 0 }, dd: { ids: [1] } }),
      'boards/b1/items/i3': item('C', { st: { label: 'Doing' } }, { state: 'deleted' }),
    },
  });
}
const settingsOf = (client, id) =>
  client.docs.get('boards/b1').data.columns.find((c) => c.id === id).settings;

test('labels: rename and recolor keep the cells working (ids and indexes stay)', async () => {
  const { service, client } = labelBoard();
  const result = await service.editLabels({
    boardId: 'b1',
    column: 'Stage',
    rename: [{ from: 'todo', to: 'To do' }],
    recolor: [
      { label: 'Doing', color: 'purple' },
      { label: 'l2', color: '#ABCDEF' },
    ],
  });
  assert.deepEqual(result.renamed, [{ from: 'Todo', to: 'To do' }]);
  const labels = settingsOf(client, 'st').labels;
  assert.deepEqual(
    labels.map((l) => [l.id, l.index, l.label, l.color]),
    [
      ['l0', 0, 'To do', '#fdab3d'],
      ['l1', 1, 'Doing', '#a25ddc'],
      ['l2', 2, 'Done', '#abcdef'],
      ['lb', 5, '', '#c4c4c4'],
    ],
  );
  assert.equal(labels[2].isDone, true);
  const board = await service.getBoard({ boardId: 'b1' });
  assert.equal(board.items.find((i) => i.name === 'A').values.Stage, 'To do');
  // Tags recolor; dropdown options have no colors.
  await service.editLabels({
    boardId: 'b1',
    column: 'Tags',
    recolor: [{ label: 'later', color: 'teal' }],
  });
  assert.equal(settingsOf(client, 'tg').tags[1].color, '#4eccc6');
  await assert.rejects(
    service.editLabels({
      boardId: 'b1',
      column: 'Where',
      recolor: [{ label: 'Home', color: 'blue' }],
    }),
    /no colors/,
  );
});

test('labels: rename refuses duplicates, the empty label and unknown labels', async () => {
  const { service } = labelBoard();
  const edit = (args) => service.editLabels({ boardId: 'b1', column: 'Stage', ...args });
  await assert.rejects(edit({ rename: [{ from: 'Todo', to: 'done' }] }), /share a name/);
  await assert.rejects(edit({ rename: [{ from: 'Nope', to: 'X' }] }), /No label "Nope"/);
  await assert.rejects(edit({ rename: [{ from: 'lb', to: 'X' }] }), /No label "lb"/);
  await assert.rejects(edit({}), /Give something to change/);
  await assert.rejects(
    service.editLabels({ boardId: 'b1', column: 'Where', rename: [{ from: 'Home', to: 'Work' }] }),
    /share a name/,
  );
});

test('labels: reorder lists every label once and keeps the empty label last', async () => {
  const { service, client } = labelBoard();
  await service.editLabels({ boardId: 'b1', column: 'Stage', order: ['Done', 'Todo', 'Doing'] });
  assert.deepEqual(
    settingsOf(client, 'st').labels.map((l) => l.id),
    ['l2', 'l0', 'l1', 'lb'],
  );
  await assert.rejects(
    service.editLabels({ boardId: 'b1', column: 'Stage', order: ['Done', 'Todo'] }),
    /missing: "Doing"/,
  );
  await assert.rejects(
    service.editLabels({ boardId: 'b1', column: 'Stage', order: ['Done', 'Done', 'Todo'] }),
    /twice/,
  );
  await service.editLabels({ boardId: 'b1', column: 'Where', order: ['Away', 'Work', 'Home'] });
  assert.deepEqual(
    settingsOf(client, 'dd').labels.map((l) => l.label),
    ['Away', 'Work', 'Home'],
  );
});

test('labels: removing a used label refuses without allowDataLoss; dryRun reports and writes nothing', async () => {
  const { service, client } = labelBoard();
  const before = JSON.stringify([...client.docs.entries()]);
  const dry = await service.editLabels({
    boardId: 'b1',
    column: 'Stage',
    remove: ['Todo', 'Done'],
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.removed, [
    { label: 'Todo', items: 2 },
    { label: 'Done', items: 0 },
  ]);
  assert.equal(dry.itemsAffected, 2);
  assert.equal(dry.needsAllowDataLoss, true);
  assert.equal(JSON.stringify([...client.docs.entries()]), before);
  await assert.rejects(
    service.editLabels({ boardId: 'b1', column: 'Stage', remove: ['Todo'] }),
    /"Todo" on 2 items.*allowDataLoss/,
  );
  assert.equal(JSON.stringify([...client.docs.entries()]), before);
  // An unused label goes without the flag.
  await service.editLabels({ boardId: 'b1', column: 'Stage', remove: ['Done'] });
  assert.equal(
    settingsOf(client, 'st').labels.some((l) => l.id === 'l2'),
    false,
  );
});

test('labels: with allowDataLoss the removed label is cleared from the cells that held it', async () => {
  const { service, client } = labelBoard();
  const result = await service.editLabels({
    boardId: 'b1',
    column: 'Where',
    remove: ['Work'],
    allowDataLoss: true,
  });
  assert.equal(result.itemsCleared, 2);
  assert.deepEqual(client.docs.get('boards/b1/items/i1').data.values.dd, { ids: [0] });
  assert.equal('dd' in client.docs.get('boards/b1/items/i2').data.values, false);
  await service.editLabels({
    boardId: 'b1',
    column: 'Stage',
    remove: ['Doing'],
    allowDataLoss: true,
  });
  assert.equal('st' in client.docs.get('boards/b1/items/i3').data.values, false);
  await service.editLabels({
    boardId: 'b1',
    column: 'Tags',
    remove: ['urgent'],
    allowDataLoss: true,
  });
  assert.equal('tg' in client.docs.get('boards/b1/items/i1').data.values, false);
  // The last named status label cannot go.
  await assert.rejects(
    service.editLabels({
      boardId: 'b1',
      column: 'Stage',
      remove: ['Todo', 'Done'],
      allowDataLoss: true,
    }),
    /at least one label/,
  );
});

test('labels: owner only, active board, label columns only', async () => {
  const { service } = labelBoard();
  await assert.rejects(
    service.editLabels({ boardId: 'b2', column: 'Cost', rename: [{ from: 'a', to: 'b' }] }),
    /owner role/,
  );
  await assert.rejects(
    service.editLabels({ boardId: 'b3', column: 'Cost', rename: [{ from: 'a', to: 'b' }] }),
    /not found/,
  );
  await assert.rejects(
    service
      .editLabels({
        boardId: 'b1',
        column: 'Stage',
        rename: [{ from: 'Todo', to: 'T' }],
        dryRun: true,
      })
      .then(() => service.editLabels({ boardId: 'b1', column: 'Missing', remove: ['x'] })),
    /No column/,
  );
});
