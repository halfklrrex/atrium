import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { tableActions, type TableCtx } from './table-actions';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  workspaceRole: 'owner',
  create: vi.fn(),
  createMany: vi.fn(),
  setValue: vi.fn(),
  setState: vi.fn(),
  toggleVote: vi.fn(),
  clearColumn: vi.fn(),
  toggleColumnLock: vi.fn(),
  updateBoardStructure: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useItems: () => ({ data: mocks.items, loading: false, error: null }),
    useWorkspace: () => ({
      data: { roles: { u1: mocks.workspaceRole } },
      loading: false,
      error: null,
    }),
    updateBoardStructure: mocks.updateBoardStructure,
    writes: {
      ...(actual.writes as Record<string, unknown>),
      toggleColumnLock: mocks.toggleColumnLock,
    },
    itemWrites: {
      create: mocks.create,
      createMany: mocks.createMany,
      setValue: mocks.setValue,
      setState: mocks.setState,
      toggleVote: mocks.toggleVote,
      clearColumn: mocks.clearColumn,
      move: vi.fn(),
      moveMany: vi.fn(),
      rename: vi.fn(),
    },
  };
});

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const columns: ColumnDef[] = [
  column('status', 'status', 'Status', 'a0'),
  { ...column('budget', 'numbers', 'Budget', 'a1'), defaultValue: 100 },
  column('vote', 'vote', 'Votes', 'a2'),
];

const makeTestBoard = (overrides: Partial<BoardDoc> = {}): BoardDoc =>
  makeBoard({
    id: 'b1',
    access: { u1: 'owner' },
    accessUids: ['u1'],
    columns,
    columnLocks: [],
    groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
    ...overrides,
  });

const sampleItems = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'First task',
    groupId: 'g1',
    position: 'a0',
    values: { status: { index: 0 }, budget: 1200, vote: { votersIds: [] } },
  }),
];

beforeEach(() => {
  mocks.items = sampleItems();
  mocks.workspaceRole = 'owner';
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.createMany.mockReset().mockResolvedValue(['copy-id']);
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.setState.mockReset().mockResolvedValue(undefined);
  mocks.toggleVote.mockReset().mockResolvedValue(undefined);
  mocks.clearColumn.mockReset().mockResolvedValue(undefined);
  mocks.toggleColumnLock.mockReset().mockResolvedValue(undefined);
  mocks.updateBoardStructure.mockReset().mockResolvedValue(null);
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
  useToastStore.setState({ toasts: [] });
});

describe('Required column toggle and column defaults', () => {
  it('shows the required marker only on required columns', () => {
    const required = columns.map((c) => (c.id === 'status' ? { ...c, required: true } : c));
    render(<BoardTable board={makeTestBoard({ columns: required })} />);
    expect(screen.getByTestId('column-required-mark-status')).toBeInTheDocument();
    expect(screen.queryByTestId('column-required-mark-budget')).toBeNull();
  });

  it('toggles "Required column" from the header menu for editors, through updateColumn', async () => {
    mocks.workspaceRole = 'member';
    render(<BoardTable board={makeTestBoard({ access: { u1: 'editor' }, accessUids: ['u1'] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Budget' }));
    const item = await screen.findByRole('menuitem', { name: 'Required column' });
    fireEvent.mouseEnter(item);
    fireEvent.click(item);
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalledTimes(1));
    const update = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    const patch = update({ columns, subitemColumns: [] }) as { columns: ColumnDef[] };
    expect(patch.columns.find((c) => c.id === 'budget')?.required).toBe(true);
    expect(patch.columns.find((c) => c.id === 'status')?.required).toBeUndefined();
  });

  it('is not offered on a derived column', async () => {
    const derived = column('prog', 'progress', 'Progress', 'a3');
    render(<BoardTable board={makeTestBoard({ columns: [...columns, derived] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Progress' }));
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Required column' })).toBeNull();
  });

  it('refuses an invalid default patch through validateColumnDef', async () => {
    const ctx: TableCtx = { boardId: 'b1', uid: 'u1', columns };
    await tableActions.updateColumn(ctx, 'status', { defaultValue: { index: 99 } });
    const update = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    expect(() => update({ columns, subitemColumns: [] })).toThrow(/Invalid default value/);
  });

  it('addItem starts the item with column defaults, explicit values on top', async () => {
    const ctx: TableCtx = { boardId: 'b1', uid: 'u1', columns };
    await tableActions.addItem(ctx, { groupId: 'g1', position: 'a1' });
    expect(mocks.create).toHaveBeenLastCalledWith('u1', 'b1', {
      name: 'New item',
      groupId: 'g1',
      position: 'a1',
      values: { budget: 100 },
    });
    await tableActions.addItem(ctx, { groupId: 'g1', position: 'a1', values: { budget: 5 } });
    expect(mocks.create.mock.calls.at(-1)![2].values).toEqual({ budget: 5 });
  });

  it('addItem skips a locked default for an editor but not for the owner', async () => {
    const board = { columnLocks: ['budget'] };
    await tableActions.addItem(
      { boardId: 'b1', uid: 'u1', columns, board, boardRole: 'editor' },
      { groupId: 'g1', position: 'a1' },
    );
    expect(mocks.create.mock.calls.at(-1)![2]).not.toHaveProperty('values');
    await tableActions.addItem(
      { boardId: 'b1', uid: 'u1', columns, board, boardRole: 'owner' },
      { groupId: 'g1', position: 'a1' },
    );
    expect(mocks.create.mock.calls.at(-1)![2].values).toEqual({ budget: 100 });
  });

  it('addSubitem applies the subitem columns defaults', async () => {
    const subitemColumns = [{ ...column('est', 'numbers', 'Estimate', 'a0'), defaultValue: 2 }];
    await tableActions.addSubitem(
      { boardId: 'b1', uid: 'u1', columns, subitemColumns },
      { id: 'i1', groupId: 'g1' },
      { position: 'a0' },
    );
    expect(mocks.create.mock.calls.at(-1)![2].values).toEqual({ est: 2 });
  });
});
