import {
  columnRegistry,
  createDefaultFilterState,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { ItemDoc } from '../../data';
import { ts } from '../../test/fixtures';
import { comparePositions } from '../../lib/positions';
import { defaultColumnTitle, duplicateColumnTitle } from './column-naming';
import { appendPositions, dropPosition, indexWithout, positionsAfter } from './move-math';
import { splitMatches } from './search';
import {
  NAME_COLUMN,
  buildColumnViews,
  buildGroupModels,
  gridTemplate,
  itemMatchesSearch,
  tableWidth,
} from './table-model';

const sortBy = (columnId: string, direction: 'asc' | 'desc') => ({
  ...createDefaultFilterState(),
  sortConditions: [{ columnId, direction }],
});

const column = (
  id: string,
  type: string,
  position: string,
  extra: Partial<ColumnDef> = {},
): ColumnDef => ({
  id,
  type,
  title: id,
  position,
  settings: extra.settings ?? (columnRegistry.defaultSettings(type) as Record<string, unknown>),
  ...extra,
});

const group = (id: string, position: string): GroupDef => ({
  id,
  title: id,
  color: '#579bfc',
  position,
});

let counter = 0;
const item = (
  id: string,
  groupId: string,
  position: string,
  name = id,
  values: Record<string, unknown> = {},
): ItemDoc => ({
  id,
  name,
  groupId,
  position,
  parentItemId: null,
  values,
  state: 'active',
  deletedAt: null,
  createdAt: ts(1_700_000_000_000 + counter++),
  createdBy: 'u1',
  updatedAt: ts(),
  updatedBy: 'u1',
});

describe('column default naming', () => {
  it('uses the type name when it is free', () => {
    expect(defaultColumnTitle('status', ['Person'])).toBe('Status');
    expect(defaultColumnTitle('long_text', [])).toBe('Long text');
  });

  it('appends a number when the title is taken, ignoring case', () => {
    expect(defaultColumnTitle('status', ['Status'])).toBe('Status 1');
    expect(defaultColumnTitle('status', ['status', 'Status 1'])).toBe('Status 2');
  });

  it('names duplicates "<title> copy" with a counter', () => {
    expect(duplicateColumnTitle('Budget', ['Budget'])).toBe('Budget copy');
    expect(duplicateColumnTitle('Budget', ['Budget', 'Budget copy'])).toBe('Budget copy 1');
  });
});

describe('position maths', () => {
  const list = [
    { id: 'a', position: 'a0' },
    { id: 'b', position: 'a1' },
    { id: 'c', position: 'a2' },
  ];

  it('drops between neighbours, ignoring the moving item', () => {
    const key = dropPosition(list, 'a', 1); // a is removed: [b, c], index 1 = between b and c
    expect(key > 'a1' && key < 'a2').toBe(true);
  });

  it('drops at the start and the end', () => {
    expect(dropPosition(list, 'c', 0) < 'a0').toBe(true);
    expect(dropPosition(list, 'a', 2) > 'a2').toBe(true);
  });

  it('finds the target index without the moving item', () => {
    expect(indexWithout(list, 'a', 'c')).toBe(1);
    expect(indexWithout(list, 'c', 'a')).toBe(0);
    expect(indexWithout(list, 'a', 'zzz')).toBe(-1);
  });

  it('appends increasing keys after everything', () => {
    const keys = appendPositions(list, 3);
    expect(keys).toHaveLength(3);
    expect(keys[0]! > 'a2').toBe(true);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });

  it('puts duplicates right after their originals, in order', () => {
    const keys = positionsAfter(list, ['a', 'b']);
    expect(keys[0]! > 'a0' && keys[0]! < 'a1').toBe(true);
    expect(keys[1]! > 'a1' && keys[1]! < 'a2').toBe(true);
    // Two copies after the same item stay ordered and stay between it and its neighbour.
    const twice = positionsAfter(list, ['a', 'a']);
    expect(twice[0]! > 'a0' && twice[1]! < 'a1').toBe(true);
  });
});

describe('search matching', () => {
  const columns = buildColumnViews([
    column('status', 'status', 'a0'),
    column('scope', 'text', 'a1'),
  ]);
  const row = item('i1', 'g1', 'a0', 'Firebase project', {
    status: { index: 1 },
    scope: 'Live at atrium',
  });

  it('matches the name and any value text, case-insensitively', () => {
    expect(itemMatchesSearch(row, columns, 'FIREBASE')).toBe(true);
    expect(itemMatchesSearch(row, columns, 'done')).toBe(true);
    expect(itemMatchesSearch(row, columns, 'live at')).toBe(true);
    expect(itemMatchesSearch(row, columns, 'nothing like this')).toBe(false);
  });

  it('matches everything for an empty term', () => {
    expect(itemMatchesSearch(row, columns, '  ')).toBe(true);
  });

  it('splits text into highlighted parts', () => {
    expect(splitMatches('Firebase base', 'base')).toEqual([
      { text: 'Fire', match: false },
      { text: 'base', match: true },
      { text: ' ', match: false },
      { text: 'base', match: true },
    ]);
    expect(splitMatches('abc', '')).toEqual([{ text: 'abc', match: false }]);
    expect(splitMatches('abc', 'z')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('group models', () => {
  const columns = buildColumnViews([column('n', 'numbers', 'a0'), column('s', 'status', 'a1')]);
  const groups = [group('g2', 'a1'), group('g1', 'a0')];
  const items = [
    item('x', 'g1', 'a1', 'Charlie', { n: 5 }),
    item('y', 'g1', 'a0', 'alpha', { n: 20 }),
    item('z', 'g2', 'a0', 'Bravo'),
    item('orphan', 'gone', 'a0'),
    { ...item('sub', 'g1', 'a5'), parentItemId: 'x' },
  ];

  it('orders groups and items by position and skips orphans and subitems', () => {
    const models = buildGroupModels({ groups, items, columns, search: '' });
    expect(models.map((m) => m.group.id)).toEqual(['g1', 'g2']);
    expect(models[0]!.items.map((i) => i.id)).toEqual(['y', 'x']);
    expect(models[0]!.all).toHaveLength(2);
  });

  it('sorts within a group, with empty cells last in both directions', () => {
    const asc = buildGroupModels({
      groups,
      items,
      columns,
      search: '',
      filterState: sortBy('n', 'asc'),
    });
    expect(asc[0]!.items.map((i) => i.id)).toEqual(['x', 'y']);
    const desc = buildGroupModels({
      groups,
      items: [...items, item('e', 'g1', 'a9')],
      columns,
      search: '',
      filterState: sortBy('n', 'desc'),
    });
    expect(desc[0]!.items.map((i) => i.id)).toEqual(['y', 'x', 'e']);
  });

  it('sorts by name naturally', () => {
    const byName = buildGroupModels({
      groups,
      items,
      columns,
      search: '',
      filterState: sortBy(NAME_COLUMN, 'asc'),
    });
    expect(byName[0]!.items.map((i) => i.name)).toEqual(['alpha', 'Charlie']);
  });

  it('hides groups without a match while searching but keeps all items for position maths', () => {
    const models = buildGroupModels({ groups, items, columns, search: 'bravo' });
    expect(models.map((m) => m.group.id)).toEqual(['g2']);
    const partial = buildGroupModels({ groups, items, columns, search: 'char' });
    expect(partial).toHaveLength(1);
    expect(partial[0]!.items.map((i) => i.id)).toEqual(['x']);
    expect(partial[0]!.all.map((i) => i.id)).toEqual(['y', 'x']);
  });

  it('applies local move patches to the group and position an item is shown at', () => {
    const models = buildGroupModels({
      groups,
      items,
      columns,
      search: '',
      patches: { x: { groupId: 'g2', position: 'a0V' } },
    });
    expect(models[1]!.items.map((i) => i.id)).toEqual(['z', 'x']);
    expect(models[0]!.items.map((i) => i.id)).toEqual(['y']);
  });

  it('marks dynamic group-by models with synthetic: true', () => {
    const statusCol = column('status', 'status', 'a0', {
      settings: {
        labels: [
          { id: 'done', label: 'Done', color: '#00c875', index: 1 },
          { id: 'working', label: 'Working on it', color: '#fdab3d', index: 0 },
        ],
      },
    });
    const statusViews = buildColumnViews([statusCol]);
    const itemsWithStatus = [
      item('x', 'g1', 'a1', 'Task 1', { status: { index: 1 } }),
      item('y', 'g1', 'a0', 'Task 2', { status: { index: 0 } }),
    ];
    const models = buildGroupModels({
      groups,
      items: itemsWithStatus,
      columns: statusViews,
      search: '',
      filterState: {
        filterGroup: { conjunction: 'and', conditions: [] },
        sortConditions: [],
        personIds: [],
        groupByColumnId: 'status',
      },
    });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.synthetic === true)).toBe(true);
  });
});

describe('column views and grid', () => {
  it('orders by position, resolves widths and falls back to default settings', () => {
    const views = buildColumnViews([
      column('b', 'text', 'a1'),
      column('a', 'status', 'a0', { width: 222 }),
      column('bad', 'status', 'a2', { settings: { labels: 'nope' } }),
      column('ghost', 'does-not-exist', 'a3', { settings: {} }),
    ]);
    expect(views.map((v) => v.def.id)).toEqual(['a', 'b', 'bad']);
    expect(views.map((v) => v.width)).toEqual([222, 200, 140]);
    expect((views[2]!.settings as { labels: unknown[] }).labels.length).toBeGreaterThan(0);
  });

  it('builds the shared grid template and total width', () => {
    const views = buildColumnViews([column('a', 'status', 'a0'), column('b', 'checkbox', 'a1')]);
    expect(gridTemplate(400, views, '36px')).toBe('400px 140px 80px 36px');
    expect(tableWidth(400, views, '36px')).toBe('calc(620px + 36px)');
  });

  it('keeps comparePositions available for sorted siblings', () => {
    expect(comparePositions({ id: 'a', position: 'a0' }, { id: 'b', position: 'a1' })).toBe(-1);
  });
});
