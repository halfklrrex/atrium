import type { ColumnDef, GroupDef } from '@atrium/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { freshColumnId, tableActions, type TableCtx } from './table-actions';
import { buildColumnViews, buildGroupModels, withSubitemIds } from './table-model';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  create: vi.fn(),
  createMany: vi.fn(),
  setValue: vi.fn(),
  setState: vi.fn(),
  moveMany: vi.fn(),
  move: vi.fn(),
  updateBoardStructure: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  updateBoardStructure: mocks.updateBoardStructure,
  itemWrites: {
    create: mocks.create,
    createMany: mocks.createMany,
    setValue: mocks.setValue,
    setState: mocks.setState,
    moveMany: mocks.moveMany,
    move: mocks.move,
    rename: vi.fn(),
    toggleVote: vi.fn(),
    clearColumn: vi.fn(),
    copyColumn: vi.fn(),
  },
}));

const boardColumns: ColumnDef[] = [
  { id: 'note', type: 'text', title: 'Note', position: 'a0', settings: {} },
];
const subColumns: ColumnDef[] = [
  { id: 'subnote', type: 'text', title: 'Sub note', position: 'a0', settings: {} },
];
const groups: GroupDef[] = [
  { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Beta', color: '#037f4c', position: 'a1' },
];

const parent = (id: string, groupId = 'g1', position = 'a0') =>
  makeItem({ id, name: `Parent ${id}`, groupId, position });
const sub = (id: string, parentItemId: string, position: string, extra: Partial<ItemDoc> = {}) =>
  makeItem({ id, name: `Sub ${id}`, groupId: 'g1', position, parentItemId, ...extra });

const board = makeBoard({
  id: 'b1',
  access: { u1: 'owner' },
  columns: boardColumns,
  subitemColumns: subColumns,
  groups,
});

const allItems = (): ItemDoc[] => [
  parent('p1'),
  sub('s2', 'p1', 'a1'),
  sub('s1', 'p1', 'a0'),
  parent('p2', 'g1', 'a1'),
  parent('p3', 'g2', 'a0'),
];

const ctx = (extra: Partial<TableCtx> = {}): TableCtx => ({
  boardId: 'b1',
  uid: 'u1',
  columns: boardColumns,
  subitemColumns: subColumns,
  getItems: allItems,
  ...extra,
});

beforeEach(() => {
  mocks.items = allItems();
  for (const fn of [mocks.create, mocks.createMany, mocks.setValue, mocks.setState]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  mocks.create.mockResolvedValue('new-id');
  mocks.moveMany.mockReset().mockResolvedValue(undefined);
  mocks.move.mockReset().mockResolvedValue(undefined);
  mocks.updateBoardStructure.mockReset().mockResolvedValue(null);
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
  useToastStore.setState({ toasts: [] });
});

describe('group model with subitems', () => {
  const base = {
    groups,
    columns: buildColumnViews(boardColumns),
    subitemColumns: buildColumnViews(subColumns),
    search: '',
  };

  it('keeps subitems out of the top-level rows and exposes them per parent, in order', () => {
    const models = buildGroupModels({ ...base, items: allItems() });
    expect(models[0]!.items.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(models[1]!.items.map((i) => i.id)).toEqual(['p3']);
    expect(models[0]!.all.some((i) => i.parentItemId)).toBe(false);
    expect(models[0]!.subitemsByParent.get('p1')?.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(models[0]!.autoExpanded.size).toBe(0);
  });

  it('matches a parent through its subitems and opens it while searching', () => {
    const models = buildGroupModels({ ...base, items: allItems(), search: 'sub s2' });
    expect(models.map((m) => m.items.map((i) => i.id))).toEqual([['p1']]);
    expect([...models[0]!.autoExpanded]).toEqual(['p1']);
  });

  it('does not open a parent whose own name matched', () => {
    const models = buildGroupModels({ ...base, items: allItems(), search: 'parent p2' });
    expect(models[0]!.items.map((i) => i.id)).toEqual(['p2']);
    expect(models[0]!.autoExpanded.size).toBe(0);
  });

  it('lists subitem ids after their parents', () => {
    expect(withSubitemIds(['p1', 'p3'], allItems())).toEqual(['p1', 'p3', 's2', 's1']);
    expect(withSubitemIds(['p1', 's1'], allItems())).toEqual(['p1', 's1', 's2']);
  });
});

describe('cascade actions', () => {
  it('archives a parent with its subitems in one write and undoes both', async () => {
    expect(await tableActions.retireItems(ctx(), ['p1'], 'archived')).toBe(true);
    expect(mocks.setState).toHaveBeenCalledWith('u1', 'b1', ['p1', 's2', 's1'], 'archived');
    const toast = useToastStore.getState().toasts.at(-1)!;
    toast.action?.onClick();
    expect(mocks.setState).toHaveBeenLastCalledWith('u1', 'b1', ['p1', 's2', 's1'], 'active');
  });

  it('deletes a group together with the subitems of its items', async () => {
    const items = allItems();
    const ok = await tableActions.deleteGroup(
      ctx(),
      groups[0]!,
      items.filter((i) => i.groupId === 'g1' && !i.parentItemId),
    );
    expect(ok).toBe(true);
    expect(mocks.setState).toHaveBeenCalledWith('u1', 'b1', ['p1', 'p2', 's2', 's1'], 'deleted');
  });

  it('moves subitems with their parent to another group in one batch', async () => {
    const p1 = parent('p1');
    await tableActions.moveItemsToGroup(ctx(), [p1], 'g2', [parent('p3', 'g2')]);
    const moves = mocks.moveMany.mock.calls[0]![2] as { id: string; groupId: string }[];
    expect(moves.map((m) => [m.id, m.groupId])).toEqual([
      ['p1', 'g2'],
      ['s2', 'g2'],
      ['s1', 'g2'],
    ]);
  });

  it('moves a dragged parent and its subitems together only across groups', async () => {
    await tableActions.moveItem(ctx(), 'p1', { groupId: 'g2', position: 'a5' }, parent('p1'));
    expect(mocks.moveMany).toHaveBeenCalledTimes(1);
    expect(mocks.move).not.toHaveBeenCalled();

    mocks.moveMany.mockClear();
    await tableActions.moveItem(ctx(), 'p1', { groupId: 'g1', position: 'a5' }, parent('p1'));
    expect(mocks.move).toHaveBeenCalledTimes(1);
    expect(mocks.moveMany).not.toHaveBeenCalled();
  });

  it('duplicates a parent with copies of its subitems under the new parent id', async () => {
    await tableActions.duplicateItems(ctx(), [parent('p1')], () => allItems());
    const inputs = mocks.createMany.mock.calls[0]![2] as {
      id?: string;
      name: string;
      parentItemId?: string | null;
      groupId: string;
    }[];
    expect(inputs).toHaveLength(3);
    const [copy, ...copies] = inputs;
    expect(copy!.name).toBe('Parent p1 (copy)');
    expect(copy!.id).toEqual(expect.any(String));
    expect(copies.map((c) => c.parentItemId)).toEqual([copy!.id, copy!.id]);
    expect(copies.map((c) => c.name)).toEqual(['Sub s1', 'Sub s2']);
  });

  it('drops derived and server-managed values from duplicated subitems', async () => {
    const managed: ColumnDef[] = [
      ...subColumns,
      { id: 'files', type: 'files', title: 'Files', position: 'a1', settings: {} },
    ];
    const withFiles = sub('s1', 'p1', 'a0', { values: { subnote: 'x', files: [{ id: 'f' }] } });
    await tableActions.duplicateItems(
      ctx({ subitemColumns: managed, getItems: () => [parent('p1'), withFiles] }),
      [parent('p1')],
      () => [],
    );
    const inputs = mocks.createMany.mock.calls[0]![2] as { values: Record<string, unknown> }[];
    expect(inputs[1]!.values).toEqual({ subnote: 'x' });
  });
});

describe('subitem writes', () => {
  it('writes the default subitem columns before the board first subitem', async () => {
    const empty = ctx({ subitemColumns: [], getItems: () => [parent('p1')] });
    const id = await tableActions.addSubitem(empty, parent('p1'), { position: 'a0' });
    expect(id).toBe('new-id');
    expect(mocks.updateBoardStructure).toHaveBeenCalledTimes(1);
    const updater = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    const patch = updater({ columns: [], subitemColumns: [], groups: [] }) as {
      subitemColumns: ColumnDef[];
    };
    expect(patch.subitemColumns.map((c) => c.title)).toEqual(['Owner', 'Status', 'Date']);
    expect(updater({ columns: [], subitemColumns: subColumns, groups: [] })).toBeNull();
    expect(mocks.create).toHaveBeenCalledWith(
      'u1',
      'b1',
      expect.objectContaining({ parentItemId: 'p1', groupId: 'g1', position: 'a0' }),
    );
  });

  it('does not touch the columns when the board already has subitems', async () => {
    await tableActions.addSubitem(ctx(), parent('p1'), { position: 'a2' });
    expect(mocks.updateBoardStructure).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalled();
  });

  it('validates a subitem cell against the subitem column defs', async () => {
    const subCtx = ctx({ columns: subColumns, scope: 'subitems' });
    expect(await tableActions.setCell(subCtx, 's1', 'subnote', 'hello')).toBe(true);
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 's1', 'subnote', 'hello');
    // A board column id is not a subitem column.
    expect(await tableActions.setCell(subCtx, 's1', 'note', 'nope')).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe('This column no longer exists');
  });

  it('writes column changes of the subitem scope to subitemColumns', async () => {
    const subCtx = ctx({ columns: subColumns, scope: 'subitems' });
    await tableActions.updateColumn(subCtx, 'subnote', { title: 'Renamed' });
    const updater = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    const state = { columns: boardColumns, subitemColumns: subColumns, groups };
    expect(updater(state)).toEqual({
      subitemColumns: [expect.objectContaining({ id: 'subnote', title: 'Renamed' })],
    });
    mocks.updateBoardStructure.mockClear();
    await tableActions.updateColumn(ctx(), 'note', { title: 'Board note' });
    const boardUpdater = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    expect(boardUpdater(state)).toEqual({
      columns: [expect.objectContaining({ id: 'note', title: 'Board note' })],
    });
  });
});

describe('column ids are unique across both column lists', () => {
  it('freshColumnId skips ids used in either list', async () => {
    const state = { columns: boardColumns, subitemColumns: subColumns };
    const ids = new Set(['note', 'subnote']);
    for (let i = 0; i < 50; i++) expect(ids.has(freshColumnId(state))).toBe(false);
  });

  it('addColumn and duplicateColumn pick ids outside both lists', async () => {
    const state = { columns: boardColumns, subitemColumns: subColumns, groups };
    for (const scope of [undefined, 'subitems'] as const) {
      mocks.updateBoardStructure.mockClear();
      const c = ctx({ scope, columns: scope ? subColumns : boardColumns });
      await tableActions.addColumn(c, 'text');
      const add = mocks.updateBoardStructure.mock.calls[0]![1] as (
        s: unknown,
      ) => Record<string, ColumnDef[]>;
      const patch = add(state);
      const list = patch[scope ? 'subitemColumns' : 'columns']!;
      const added = list.at(-1)!;
      expect(['note', 'subnote']).not.toContain(added.id);

      mocks.updateBoardStructure.mockClear();
      const view = buildColumnViews(scope ? subColumns : boardColumns)[0]!;
      await tableActions.duplicateColumn(c, view, []);
      const dup = mocks.updateBoardStructure.mock.calls[0]![1] as typeof add;
      const copy = dup(state)[scope ? 'subitemColumns' : 'columns']!.at(-1)!;
      expect(['note', 'subnote']).not.toContain(copy.id);
    }
  });

  it('the first subitem columns avoid the board column ids', async () => {
    await tableActions.addSubitem(
      ctx({ subitemColumns: [], getItems: () => [parent('p1')] }),
      parent('p1'),
      { position: 'a0' },
    );
    const updater = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => {
      subitemColumns: ColumnDef[];
    };
    const clash = [{ ...boardColumns[0]!, id: 'sub_status' }];
    const ids = updater({ columns: clash, subitemColumns: [], groups }).subitemColumns.map(
      (c) => c.id,
    );
    expect(ids).not.toContain('sub_status');
  });
});

describe('subitems in the board table', () => {
  it('shows parents only, with a count badge, until a block is opened', async () => {
    render(<BoardTable board={board} />);
    expect(screen.getByText('Parent p1')).toBeInTheDocument();
    expect(screen.queryByText('Sub s1')).toBeNull();
    expect(screen.getByLabelText('2 subitems')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Expand subitems of Parent p1'));
    const block = screen.getByRole('grid', { name: 'Subitems of Parent p1' });
    expect(
      within(block)
        .getAllByText(/^Sub s/)
        .map((e) => e.textContent),
    ).toEqual(['Sub s1', 'Sub s2']);
    // The block has its own header with the subitem columns.
    expect(within(block).getByText('Sub note')).toBeInTheDocument();
    expect(within(block).queryByText('Note')).toBeNull();
    expect(within(block).getByText('+ Add subitem')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Collapse subitems of Parent p1'));
    expect(screen.queryByText('Sub s1')).toBeNull();
  });

  it('opens a parent automatically while a search matches only its subitem', async () => {
    render(<BoardTable board={board} />);
    useTableStore.getState().setSearch('sub s2');
    expect(await screen.findByText('Sub s2')).toBeInTheDocument();
    expect(screen.queryByText('Parent p2')).toBeNull();
  });

  it('keeps arrow keys inside the subitem block', async () => {
    render(<BoardTable board={board} />);
    useTableStore.getState().toggleExpanded('p1', true);
    useTableStore.getState().setActive({ itemId: 's1', columnId: 'name' });
    const scroll = screen.getByLabelText('Board table');
    scroll.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(useTableStore.getState().active).toEqual({ itemId: 's2', columnId: 'name' });
    await userEvent.keyboard('{ArrowDown}');
    expect(useTableStore.getState().active).toEqual({ itemId: 's2', columnId: 'name' });
    await userEvent.keyboard('{ArrowRight}');
    expect(useTableStore.getState().active).toEqual({ itemId: 's2', columnId: 'subnote' });
  });
});
