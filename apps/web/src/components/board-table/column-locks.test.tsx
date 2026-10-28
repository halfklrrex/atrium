import {
  COLUMN_LOCKED_MESSAGE,
  COLUMN_LOCKED_TOOLTIP,
  columnRegistry,
  type ColumnDef,
} from '@atrium/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  column('budget', 'numbers', 'Budget', 'a1'),
  column('vote', 'vote', 'Votes', 'a2'),
];

const makeTestBoard = (overrides: Partial<BoardDoc> = {}): BoardDoc =>
  makeBoard({
    id: 'b1',
    access: { u1: 'owner' },
    accessUids: ['u1'],
    columns,
    columnLocks: ['budget'],
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

describe('Column locks UI & actions', () => {
  it('renders the lock icon in the header when a column is in board.columnLocks', () => {
    render(<BoardTable board={makeTestBoard({ columnLocks: ['budget'] })} />);
    const lockIcon = screen.getByTestId('column-lock-icon-budget');
    expect(lockIcon).toBeInTheDocument();
    expect(lockIcon).toHaveAttribute('title', COLUMN_LOCKED_TOOLTIP);
    expect(screen.queryByTestId('column-lock-icon-status')).toBeNull();
  });

  it('shows "Restrict column editing" in the header menu for board owners and calls toggleColumnLock', async () => {
    render(<BoardTable board={makeTestBoard({ columnLocks: [] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Budget' }));
    const item = await screen.findByRole('menuitem', { name: 'Restrict column editing' });
    expect(item).toBeInTheDocument();
    fireEvent.mouseEnter(item);
    fireEvent.click(item);
    await waitFor(() => expect(mocks.toggleColumnLock).toHaveBeenCalledWith('b1', 'budget', true));
  });

  it('hides "Restrict column editing" in the header menu for board editors', async () => {
    mocks.workspaceRole = 'member';
    const editorBoard = makeTestBoard({
      access: { u1: 'editor' },
      accessUids: ['u1'],
    });
    render(<BoardTable board={editorBoard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Budget' }));
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Restrict column editing' })).toBeNull();
  });

  it('prevents an editor from opening an editor on a locked cell and shows the lock tooltip', async () => {
    mocks.workspaceRole = 'member';
    const editorBoard = makeTestBoard({
      access: { u1: 'editor' },
      accessUids: ['u1'],
      columnLocks: ['status', 'budget'],
    });
    render(<BoardTable board={editorBoard} />);

    const statusCell = document.querySelector('[data-cell="i1:status"]') as HTMLElement;
    expect(statusCell).toHaveAttribute('title', COLUMN_LOCKED_TOOLTIP);
    await userEvent.click(statusCell);
    expect(screen.queryByRole('dialog', { name: 'Status labels' })).toBeNull();

    // Keyboard Enter and Delete on a locked cell are also ignored for editors
    const scroll = screen.getByLabelText('Board table');
    scroll.focus();
    useTableStore.getState().setActive({ itemId: 'i1', columnId: 'budget' });
    await userEvent.keyboard('{Delete}');
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it('allows a board owner to open an editor and edit a locked cell', async () => {
    const ownerBoard = makeTestBoard({
      access: { u1: 'owner' },
      accessUids: ['u1'],
      columnLocks: ['status'],
    });
    render(<BoardTable board={ownerBoard} />);

    const statusCell = document.querySelector('[data-cell="i1:status"]') as HTMLElement;
    expect(statusCell).not.toHaveAttribute('title', COLUMN_LOCKED_TOOLTIP);
    await userEvent.click(statusCell);
    const picker = await screen.findByRole('dialog', { name: 'Status labels' });
    await userEvent.click(within(picker).getByRole('option', { name: 'Done' }));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'status', { index: 1 });
  });

  it('validates vote cells through validateCellWrite and blocks locked vote columns for editors', async () => {
    const item = sampleItems()[0]!;
    const editorCtx: TableCtx = {
      boardId: 'b1',
      uid: 'u1',
      columns,
      board: { columnLocks: ['vote'] },
      boardRole: 'editor',
    };
    const okEditor = await tableActions.setCell(
      editorCtx,
      'i1',
      'vote',
      { votersIds: ['u1'] },
      item,
    );
    expect(okEditor).toBe(false);
    expect(mocks.toggleVote).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe(COLUMN_LOCKED_MESSAGE);

    const ownerCtx: TableCtx = {
      ...editorCtx,
      boardRole: 'owner',
    };
    const okOwner = await tableActions.setCell(ownerCtx, 'i1', 'vote', { votersIds: ['u1'] }, item);
    expect(okOwner).toBe(true);
    expect(mocks.toggleVote).toHaveBeenCalledWith('u1', 'b1', 'i1', 'vote', false);
  });

  it('strips locked column values when an editor duplicates items, and keeps them for an owner', async () => {
    const item = sampleItems()[0]!;
    const editorCtx: TableCtx = {
      boardId: 'b1',
      uid: 'u1',
      columns,
      board: { columnLocks: ['budget'] },
      boardRole: 'editor',
    };
    await tableActions.duplicateItems(editorCtx, [item], () => [item]);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const editorInputs = mocks.createMany.mock.calls[0]![2] as {
      values: Record<string, unknown>;
    }[];
    expect(editorInputs[0]!.values).toEqual({
      status: { index: 0 },
      vote: { votersIds: [] },
    });

    mocks.createMany.mockClear();
    const ownerCtx: TableCtx = {
      ...editorCtx,
      boardRole: 'owner',
    };
    await tableActions.duplicateItems(ownerCtx, [item], () => [item]);
    const ownerInputs = mocks.createMany.mock.calls[0]![2] as {
      values: Record<string, unknown>;
    }[];
    expect(ownerInputs[0]!.values).toEqual({
      status: { index: 0 },
      budget: 1200,
      vote: { votersIds: [] },
    });
  });

  it('removes a deleted column id from columnLocks when an owner deletes the column', async () => {
    const ownerCtx: TableCtx = {
      boardId: 'b1',
      uid: 'u1',
      columns,
      board: { columnLocks: ['budget', 'status'] },
      boardRole: 'owner',
    };
    await tableActions.deleteColumn(ownerCtx, columns[1]!, ['i1']);
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalledTimes(1));
    const updater = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    const patch = updater({
      columns,
      subitemColumns: [],
      groups: [],
      columnLocks: ['budget', 'status'],
    });
    expect(patch).toEqual({
      columns: [columns[0], columns[2]],
      columnLocks: ['status'],
    });
  });
});
