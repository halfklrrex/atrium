import {
  columnRegistry,
  defaultKanbanSettings,
  defaultViewSettings,
  type ColumnDef,
  type KanbanSettings,
} from '@atrium/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, isViewDirty, useFilterStore, viewKey } from '../board-filters';
import { tableActions } from '../board-table/table-actions';
import { useTableStore } from '../board-table/table-store';
import { KanbanBoard } from './KanbanBoard';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  role: 'owner',
  create: vi.fn(),
  setValueAndMove: vi.fn(),
  move: vi.fn(),
  addGroup: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: mocks.role } }, loading: false, error: null }),
  usePresence: () => ({ viewers: [] }),
  updateBoardStructure: vi.fn(),
  itemWrites: {
    create: mocks.create,
    setValueAndMove: mocks.setValueAndMove,
    move: mocks.move,
    moveMany: vi.fn(),
    setValue: vi.fn(),
  },
}));

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
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
  ],
};

const board = makeBoard({
  id: 'b1',
  columns: [
    column('status', 'status', 'Status', 'a0', status),
    column('notes', 'text', 'Notes', 'a1'),
    column('cost', 'numbers', 'Cost', 'a2'),
    column('due', 'date', 'Due', 'a3'),
  ],
  groups: [
    { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
    { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
  ],
});

const sample = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Write spec',
    position: 'a0',
    values: { status: { index: 0 }, notes: 'Cover the lanes', cost: '1200' },
    updatesCount: 3,
  }),
  makeItem({ id: 'i2', name: 'Build board', position: 'a1', values: { status: { index: 1 } } }),
  makeItem({ id: 'i3', name: 'Ship it', groupId: 'g2', position: 'a0', values: {} }),
  makeItem({ id: 'sub', name: 'A subitem', parentItemId: 'i1', values: {} }),
];

function open(kanban: Partial<KanbanSettings> = {}, shown = board) {
  useFilterStore.getState().syncView('b1', 'kv', {
    ...defaultViewSettings(),
    kanban: { ...defaultKanbanSettings(), ...kanban },
  });
  return render(<KanbanBoard board={shown} />);
}

const lane = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => {
  mocks.items = sample();
  mocks.role = 'owner';
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.setValueAndMove.mockReset().mockResolvedValue(undefined);
  mocks.move.mockReset().mockResolvedValue(undefined);
  useFilterStore.setState({ activeView: {}, views: {} });
  useTableStore.getState().reset(null);
});

describe('KanbanBoard', () => {
  it('shows a lane per status label with the cards in them, and the Empty lane last', () => {
    open();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'To do',
      'Done',
      'Stuck',
      'Empty',
    ]);
    expect(lane('To do').getByText('Write spec')).toBeInTheDocument();
    expect(lane('Done').getByText('Build board')).toBeInTheDocument();
    expect(lane('Empty').getByText('Ship it')).toBeInTheDocument();
    // A subitem is not a card.
    expect(screen.queryByText('A subitem')).toBeNull();
    // Counts: To do 1, Done 1, Stuck 0, Empty 1.
    expect(screen.getByRole('region', { name: 'Stuck' })).toHaveTextContent('0');
  });

  it('shows the card fields, the updates bubble with its count and no column titles', () => {
    open({ cardColumnIds: ['notes', 'cost'] });
    const card = within(screen.getByRole('button', { name: 'Write spec' }));
    expect(card.getByText('Cover the lanes')).toBeInTheDocument();
    expect(card.getByText('1,200')).toBeInTheDocument();
    expect(card.queryByText('Notes')).toBeNull();
    expect(card.getByRole('button', { name: 'Updates for Write spec (3)' })).toBeInTheDocument();
    // Only the chosen columns, so the date column is not on the card.
    const empty = within(screen.getByRole('button', { name: 'Build board' }));
    expect(empty.queryByText('Cover the lanes')).toBeNull();
  });

  it('collapses and expands a lane, and counts it as an unsaved view change', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Done lane' }));
    expect(screen.getByRole('button', { name: /Expand Done lane/ })).toBeInTheDocument();
    expect(screen.queryByText('Build board')).toBeNull();
    expect(currentViewState('b1').kanban?.collapsedLaneIds).toEqual(['done']);
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'kv')])).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Expand Done lane/ }));
    expect(screen.getByText('Build board')).toBeInTheDocument();
  });

  it('starts with the lanes the view saved as collapsed, and can hide empty lanes', () => {
    open({ collapsedLaneIds: ['todo'], showEmptyLanes: false });
    expect(screen.getByRole('button', { name: /Expand To do lane/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Stuck' })).toBeNull();
  });

  it('adds an item from a lane: first group, the lane status, last in the lane', async () => {
    open();
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Done' })).getByText('Add item'),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'New item in Done' }),
      'Release{Enter}',
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [uid, boardId, input] = mocks.create.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(uid).toBe('u1');
    expect(boardId).toBe('b1');
    // "Alpha" comes first by position, even though the board lists "Beta" first.
    expect(input).toMatchObject({
      name: 'Release',
      groupId: 'g1',
      values: { status: { index: 1 } },
    });
    // After "Build board" (a1), the lane's only card.
    expect((input.position as string) > 'a1').toBe(true);
    // The field stays open for the next one.
    expect(screen.getByRole('textbox', { name: 'New item in Done' })).toHaveValue('');
  });

  it('adds to the Empty lane without a status value', async () => {
    open();
    await userEvent.click(lane('Empty').getByText('Add item'));
    await userEvent.type(screen.getByRole('textbox', { name: 'New item in Empty' }), 'Idea{Enter}');
    const input = mocks.create.mock.calls[0]![2] as Record<string, unknown>;
    expect(input.values).toBeUndefined();
  });

  it('is read-only for a viewer: no "Add item" and cards are not draggable', () => {
    mocks.role = 'viewer';
    open({}, makeBoard({ ...board, access: { u1: 'viewer' }, accessUids: ['u1'] }));
    expect(screen.queryByText('Add item')).toBeNull();
    expect(screen.getByRole('button', { name: 'Write spec' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lets an editor drag cards', () => {
    open();
    expect(screen.getByRole('button', { name: 'Write spec' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('turns dragging off while the view is sorted, and says why', () => {
    open();
    act(() => {
      useFilterStore.getState().setSortConditions('b1', [{ columnId: 'notes', direction: 'asc' }]);
    });
    const card = screen.getByRole('button', { name: 'Write spec' });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveAttribute('title', 'Dragging is off while the view is sorted');
  });

  it('leaves out New item, Hide and Group by in the toolbar', () => {
    open();
    const toolbar = within(screen.getByRole('toolbar', { name: 'Board tools' }));
    expect(toolbar.queryByText('New item')).toBeNull();
    expect(toolbar.queryByRole('button', { name: /Hide columns/ })).toBeNull();
    expect(toolbar.queryByRole('button', { name: /Group by/ })).toBeNull();
    expect(toolbar.getByRole('button', { name: 'Kanban settings' })).toBeInTheDocument();
    expect(toolbar.getByRole('group', { name: 'Status summary' })).toBeInTheDocument();
  });

  it('asks for a status column when the board has none', () => {
    useFilterStore.getState().syncView('b1', 'kv', defaultViewSettings());
    render(<KanbanBoard board={{ ...board, columns: [column('notes', 'text', 'Notes', 'a0')] }} />);
    expect(screen.getByText(/Add a status column/)).toBeInTheDocument();
  });
});

describe('Kanban settings popover', () => {
  it('changes the card fields and their order, as unsaved view changes', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Kanban settings' }));
    const panel = within(screen.getByRole('dialog', { name: 'Kanban settings' }));
    // The defaults: the first three plain columns.
    expect(panel.getByRole('checkbox', { name: 'Notes' })).toBeChecked();
    expect(panel.getByRole('checkbox', { name: 'Due' })).toBeChecked();
    await userEvent.click(panel.getByRole('checkbox', { name: 'Cost' }));
    expect(currentViewState('b1').kanban?.cardColumnIds).toEqual(['notes', 'due']);
    await userEvent.click(panel.getByRole('button', { name: 'Move Due up' }));
    expect(currentViewState('b1').kanban?.cardColumnIds).toEqual(['due', 'notes']);
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'kv')])).toBe(true);
  });

  it('toggles empty lanes and lists the status columns for "Group cards by"', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Kanban settings' }));
    const panel = within(screen.getByRole('dialog', { name: 'Kanban settings' }));
    expect(panel.getByRole('combobox', { name: 'Group cards by' })).toHaveValue('status');
    await userEvent.click(panel.getByRole('checkbox', { name: 'Show empty lanes' }));
    expect(currentViewState('b1').kanban?.showEmptyLanes).toBe(false);
    expect(screen.queryByRole('region', { name: 'Stuck' })).toBeNull();
  });
});

describe('dropping a card', () => {
  const ctx = {
    boardId: 'b1',
    uid: 'u1',
    columns: board.columns,
    subitemColumns: [],
  };

  it('writes the new status and the position in one document write', async () => {
    const ok = await tableActions.setCellAndMove(ctx, 'i1', 'status', { index: 1 }, 'a0V');
    expect(ok).toBe(true);
    expect(mocks.setValueAndMove).toHaveBeenCalledTimes(1);
    expect(mocks.setValueAndMove).toHaveBeenCalledWith(
      'u1',
      'b1',
      'i1',
      'status',
      { index: 1 },
      'a0V',
    );
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it('clears the status for the Empty lane', async () => {
    await tableActions.setCellAndMove(ctx, 'i1', 'status', null, 'a0V');
    expect(mocks.setValueAndMove).toHaveBeenCalledWith('u1', 'b1', 'i1', 'status', null, 'a0V');
  });

  it('never sends a value the column refuses', async () => {
    const ok = await tableActions.setCellAndMove(ctx, 'i1', 'status', { index: -1 }, 'a0V');
    expect(ok).toBe(false);
    expect(mocks.setValueAndMove).not.toHaveBeenCalled();
  });
});
