import {
  KANBAN_EMPTY_LANE,
  columnRegistry,
  createDefaultFilterState,
  defaultKanbanSettings,
  type ColumnDef,
} from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { buildColumnViews } from '../board-table/table-model';
import {
  buildKanbanLanes,
  defaultCardColumns,
  isEmptyFieldValue,
  planDrop,
  resolveCardColumns,
  resolveStatusColumn,
} from './kanban-model';

const column = (
  id: string,
  type: string,
  title: string,
  position: string,
  settings?: unknown,
): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: (settings ?? columnRegistry.defaultSettings(type)) as Record<string, unknown>,
});

const status = {
  labels: [
    { id: 'todo', index: 0, label: 'To do', color: '#579bfc' },
    { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
    { id: 'blank', index: 5, label: '', color: '#c4c4c4' },
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
  ],
};

const columns = buildColumnViews([
  column('a', 'status', 'Status', 'a0', status),
  column('b', 'status', 'Priority', 'a1'),
  column('notes', 'text', 'Notes', 'a2'),
  column('cost', 'numbers', 'Cost', 'a3'),
  column('who', 'people', 'Owner', 'a4'),
  column('due', 'date', 'Due', 'a5'),
]);
const statusView = resolveStatusColumn(columns, 'a')!;

const items = [
  makeItem({ id: 'i1', name: 'One', position: 'a2', values: { a: { index: 1 }, notes: 'a' } }),
  makeItem({ id: 'i2', name: 'Two', position: 'a0', values: { a: { index: 1 }, notes: 'b' } }),
  makeItem({ id: 'i3', name: 'Three', position: 'a1', values: { a: { index: 0 } } }),
  makeItem({ id: 'i4', name: 'Four', position: 'a0', values: {} }),
  // The blank grey label means "no status": the card is in the Empty lane.
  makeItem({ id: 'i5', name: 'Five', position: 'a1', values: { a: { index: 5 } } }),
  makeItem({ id: 'sub', name: 'Sub', position: 'a0', parentItemId: 'i1', values: {} }),
];

const build = (overrides: Partial<Parameters<typeof buildKanbanLanes>[0]> = {}) =>
  buildKanbanLanes({
    items,
    status: statusView,
    columns,
    search: '',
    kanban: defaultKanbanSettings(),
    ...overrides,
  });

describe('kanban lanes', () => {
  it('has one lane per label in the column order, with the Empty lane last', () => {
    const lanes = build();
    expect(lanes.map((l) => l.title)).toEqual(['To do', 'Done', 'Stuck', 'Empty']);
    expect(lanes.at(-1)?.key).toBe(KANBAN_EMPTY_LANE);
    expect(lanes[0]!.color).toBe('#579bfc');
    expect(lanes.at(-1)?.color).toBeNull();
  });

  it('puts cards in their lane in position order and leaves subitems out', () => {
    const lanes = build();
    const ids = (key: string) => lanes.find((l) => l.key === key)!.items.map((i) => i.id);
    expect(ids('done')).toEqual(['i2', 'i1']);
    expect(ids('todo')).toEqual(['i3']);
    expect(ids('stuck')).toEqual([]);
    expect(ids(KANBAN_EMPTY_LANE)).toEqual(['i4', 'i5']);
  });

  it('applies the search and the filters, and counts only what is shown', () => {
    const searched = build({ search: 'tw' });
    expect(searched.flatMap((l) => l.items.map((i) => i.id))).toEqual(['i2']);
    expect(searched.find((l) => l.key === 'done')!.all).toHaveLength(2);

    const filterState = createDefaultFilterState();
    filterState.filterGroup.conditions.push({ columnId: 'a', operator: 'is_empty' });
    const filtered = build({ filterState });
    // i5 holds the blank label's index, which the filter engine counts as a value.
    expect(filtered.flatMap((l) => l.items.map((i) => i.id))).toEqual(['i4']);
  });

  it('orders cards by the sort when the view has one', () => {
    const filterState = createDefaultFilterState();
    filterState.sortConditions.push({ columnId: 'notes', direction: 'asc' });
    const lanes = build({ filterState });
    expect(lanes.find((l) => l.key === 'done')!.items.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('hides empty lanes on request, and flags collapsed ones', () => {
    const hidden = build({ kanban: { ...defaultKanbanSettings(), showEmptyLanes: false } });
    expect(hidden.map((l) => l.key)).toEqual(['todo', 'done', KANBAN_EMPTY_LANE]);
    const collapsed = build({
      kanban: { ...defaultKanbanSettings(), collapsedLaneIds: ['done', KANBAN_EMPTY_LANE] },
    });
    expect(collapsed.filter((l) => l.collapsed).map((l) => l.key)).toEqual([
      'done',
      KANBAN_EMPTY_LANE,
    ]);
  });

  it('shows a card that was just dropped in its new lane and place', () => {
    const lanes = build({ patches: { i3: { value: { index: 2 }, position: 'a5' } } });
    expect(lanes.find((l) => l.key === 'stuck')!.items.map((i) => i.id)).toEqual(['i3']);
    expect(lanes.find((l) => l.key === 'todo')!.items).toEqual([]);
    const cleared = build({ patches: { i2: { value: null, position: 'a9' } } });
    expect(cleared.find((l) => l.key === KANBAN_EMPTY_LANE)!.items.map((i) => i.id)).toEqual([
      'i4',
      'i5',
      'i2',
    ]);
  });
});

describe('kanban columns', () => {
  it('uses the saved status column if it exists, else the first one', () => {
    expect(resolveStatusColumn(columns, 'b')?.def.id).toBe('b');
    expect(resolveStatusColumn(columns, 'gone')?.def.id).toBe('a');
    expect(resolveStatusColumn(columns, null)?.def.id).toBe('a');
    expect(
      resolveStatusColumn(buildColumnViews([column('t', 'text', 'T', 'a0')]), null),
    ).toBeNull();
  });

  it('shows the first three plain columns on a card until the view chooses', () => {
    expect(defaultCardColumns(columns, 'a').map((c) => c.def.id)).toEqual(['notes', 'cost', 'who']);
    const settings = defaultKanbanSettings();
    expect(resolveCardColumns(columns, settings, 'a').map((c) => c.def.id)).toEqual([
      'notes',
      'cost',
      'who',
    ]);
  });

  it('keeps the chosen card columns in order and skips deleted ones', () => {
    const chosen = { cardColumnIds: ['due', 'gone', 'notes'] };
    expect(resolveCardColumns(columns, chosen, 'a').map((c) => c.def.id)).toEqual(['due', 'notes']);
    expect(resolveCardColumns(columns, { cardColumnIds: [] }, 'a')).toEqual([]);
  });

  it('knows which field values are empty', () => {
    for (const empty of [null, undefined, '', false, [], {}]) {
      expect(isEmptyFieldValue(empty)).toBe(true);
    }
    for (const filled of ['x', 0, true, ['a'], { ids: [1] }]) {
      expect(isEmptyFieldValue(filled)).toBe(false);
    }
  });
});

describe('planDrop', () => {
  const lanes = build();
  const lane = (key: string) => lanes.find((l) => l.key === key)!;

  it('writes the target lane status and a position between its neighbours', () => {
    const item = items[2]!; // i3, To do
    const plan = planDrop({ item, from: lane('todo'), to: lane('done'), index: 1 });
    expect(plan?.value).toEqual({ index: 1 });
    // Between i2 (a0) and i1 (a2).
    expect(plan!.position > 'a0' && plan!.position < 'a2').toBe(true);
  });

  it('clears the status when dropped in the Empty lane', () => {
    const plan = planDrop({
      item: items[0]!,
      from: lane('done'),
      to: lane(KANBAN_EMPTY_LANE),
      index: 0,
    });
    expect(plan?.value).toBeNull();
  });

  it('only writes a position when the card stays in its lane', () => {
    const plan = planDrop({ item: items[1]!, from: lane('done'), to: lane('done'), index: 1 });
    expect(plan?.value).toBeUndefined();
    expect(plan!.position > 'a2').toBe(true);
  });

  it('does nothing when the card is dropped on its own slot', () => {
    expect(
      planDrop({ item: items[1]!, from: lane('done'), to: lane('done'), index: 0 }),
    ).toBeNull();
  });

  it('puts a card first or last in an empty lane', () => {
    const plan = planDrop({ item: items[2]!, from: lane('todo'), to: lane('stuck'), index: 0 });
    expect(plan?.value).toEqual({ index: 2 });
    expect(typeof plan?.position).toBe('string');
  });
});
