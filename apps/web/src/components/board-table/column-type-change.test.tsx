import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, ItemDoc } from '../../data';
import { keepServerColumnFields, withoutServerColumnFields } from '../../data/server-column-fields';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { ChangeColumnTypeDialog } from './ChangeColumnTypeDialog';
import { describeConversionCounts } from './conversion-text';
import { COLUMN_MIGRATING_MESSAGE, validateCellWrite } from './derived';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  workspaceRole: 'owner',
  setValue: vi.fn(),
  change: vi.fn(),
  revert: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../lib/callables', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, columnTypeCalls: { change: mocks.change, revert: mocks.revert } };
});
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
    itemWrites: {
      create: vi.fn(),
      createMany: vi.fn(),
      setValue: mocks.setValue,
      setState: vi.fn(),
      toggleVote: vi.fn(),
      clearColumn: vi.fn(),
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

const budget = column('budget', 'numbers', 'Budget', 'a1');
const baseColumns: ColumnDef[] = [column('status', 'status', 'Status', 'a0'), budget];

const makeTestBoard = (
  columns: ColumnDef[] = baseColumns,
  overrides: Partial<BoardDoc> = {},
): BoardDoc =>
  makeBoard({
    id: 'b1',
    access: { u1: 'owner' },
    accessUids: ['u1'],
    columns,
    columnLocks: [],
    groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
    ...overrides,
  });

const sampleItems = (): ItemDoc[] =>
  [1200, 30, null].map((value, i) =>
    makeItem({
      id: `i${i + 1}`,
      name: `Task ${i + 1}`,
      groupId: 'g1',
      position: `a${i}`,
      values: value === null ? {} : { budget: value },
    }),
  );

beforeEach(() => {
  mocks.items = sampleItems();
  mocks.workspaceRole = 'owner';
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.change
    .mockReset()
    .mockResolvedValue({ converted: 2, cleared: 0, snapshotId: 'snap1', toType: 'text' });
  mocks.revert.mockReset().mockResolvedValue({
    restored: 2,
    removed: 0,
    snapshotId: 'snap1',
    columnId: 'budget',
  });
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
  useToastStore.setState({ toasts: [] });
});

const clickItem = (item: HTMLElement) => {
  fireEvent.mouseEnter(item);
  fireEvent.click(item);
};

const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Options for Budget' }));
};

describe('describeConversionCounts', () => {
  it('words the counts for every combination', () => {
    expect(describeConversionCounts(42, 3)).toBe(
      "42 values will be converted and 3 can't be converted and will be cleared.",
    );
    expect(describeConversionCounts(1, 1)).toBe(
      "1 value will be converted and 1 can't be converted and will be cleared.",
    );
    expect(describeConversionCounts(5, 0)).toBe('5 values will be converted.');
    expect(describeConversionCounts(0, 2)).toBe("2 values can't be converted and will be cleared.");
    expect(describeConversionCounts(0, 0)).toBe('There are no values to convert.');
  });
});

describe('ChangeColumnTypeDialog', () => {
  const textColumn: ColumnDef = column('t', 'text', 'Budget', 'a0');
  const textItems = ['10', 'ten', '$30'].map((v, i) =>
    makeItem({ id: `i${i}`, name: `Task ${i}`, values: { t: v } }),
  );

  it('shows the counts, a preview of conversions and the confirm buttons', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(
      <ChangeColumnTypeDialog
        boardId="b1"
        column={textColumn}
        columns={[textColumn]}
        toType="numbers"
        items={textItems}
        views={[]}
        personNames={{}}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(await screen.findByText('Change "Budget" from Text to Numbers?')).toBeInTheDocument();
    expect(screen.getByTestId('change-type-counts')).toHaveTextContent(
      "2 values will be converted and 1 can't be converted and will be cleared.",
    );
    const samples = within(screen.getByTestId('change-type-samples')).getAllByRole('listitem');
    expect(samples.map((s) => s.textContent)).toEqual(['10→10', 'ten→Cleared', '$30→30']);
    expect(screen.queryByTestId('change-type-warning')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({
      toSettings: { unit: null, decimals: null },
      valueCount: 3,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('warns when the values cannot be carried over, and lists what depends on the column', async () => {
    const formula: ColumnDef = {
      ...column('f', 'formula', 'Total', 'a1'),
      settings: { expression: '{t} * 2', outputType: 'number' },
    };
    render(
      <ChangeColumnTypeDialog
        boardId="b1"
        column={textColumn}
        columns={[textColumn, formula]}
        toType="vote"
        items={textItems}
        views={[]}
        personNames={{}}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('change-type-warning')).toHaveTextContent(
      'Values will be cleared',
    );
    expect(screen.getByTestId('change-type-counts')).toHaveTextContent(
      "3 values can't be converted and will be cleared.",
    );
    expect(screen.getByTestId('change-type-dependents')).toHaveTextContent(
      'Formula column "Total"',
    );
  });

  it('Cancel closes without converting', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ChangeColumnTypeDialog
        boardId="b1"
        column={textColumn}
        columns={[textColumn]}
        toType="numbers"
        items={textItems}
        views={[]}
        personNames={{}}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('column menu', () => {
  it('changes the type through the submenu and the dialog, with an Undo toast', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    await openMenu();
    const entry = await screen.findByRole('menuitem', { name: 'Change column type' });
    clickItem(entry);
    const target = await screen.findByRole('menuitem', { name: 'Text' });
    clickItem(target);

    expect(await screen.findByTestId('change-type-counts')).toHaveTextContent(
      '2 values will be converted.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(1));
    expect(mocks.change).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        columnId: 'budget',
        scope: 'columns',
        toType: 'text',
        toSettings: {},
        snapshotId: expect.stringMatching(/^[a-z0-9]{20}$/),
      }),
    );

    const toast = await waitFor(() => {
      const t = useToastStore.getState().toasts.at(-1);
      expect(t?.text).toContain('"Budget" is now Text. 2 converted.');
      return t!;
    });
    toast.action?.onClick();
    await waitFor(() =>
      expect(mocks.revert).toHaveBeenCalledWith({ boardId: 'b1', snapshotId: 'snap1' }),
    );
  });

  it('does not list the current type or server-managed types', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    await openMenu();
    const entry = await screen.findByRole('menuitem', { name: 'Change column type' });
    fireEvent.mouseEnter(entry);
    fireEvent.click(entry);
    await screen.findByRole('menuitem', { name: 'Text' });
    expect(screen.queryByRole('menuitem', { name: 'Numbers' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Files' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Button' })).toBeNull();
  });

  it('makes the long type submenu scroll inside the viewport', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    await openMenu();
    const entry = await screen.findByRole('menuitem', { name: 'Change column type' });
    fireEvent.mouseEnter(entry);
    fireEvent.click(entry);
    const item = await screen.findByRole('menuitem', { name: 'Text' });
    expect(item.closest('[role="menu"]')?.className).toMatch(/submenuScroll/);
  });

  it('hides the submenu for viewers and, on a locked column, for editors', async () => {
    mocks.workspaceRole = 'viewer';
    const { unmount } = render(
      <BoardTable board={makeTestBoard(baseColumns, { access: { u1: 'viewer' } })} />,
    );
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Sort ascending' });
    expect(screen.queryByRole('menuitem', { name: 'Change column type' })).toBeNull();
    unmount();

    mocks.workspaceRole = 'member';
    render(
      <BoardTable
        board={makeTestBoard(baseColumns, { access: { u1: 'editor' }, columnLocks: ['budget'] })}
      />,
    );
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Sort ascending' });
    expect(screen.queryByRole('menuitem', { name: 'Change column type' })).toBeNull();
  });

  it('offers Undo while the snapshot is valid and not after it expired', async () => {
    const change = { snapshotId: 'snap1', fromType: 'text', expiresAt: Date.now() + 60_000 };
    const { unmount } = render(
      <BoardTable
        board={makeTestBoard([baseColumns[0]!, { ...budget, lastTypeChange: change }])}
      />,
    );
    await openMenu();
    const undo = await screen.findByRole('menuitem', { name: 'Undo type change' });
    clickItem(undo);
    await waitFor(() =>
      expect(mocks.revert).toHaveBeenCalledWith({ boardId: 'b1', snapshotId: 'snap1' }),
    );
    unmount();

    render(
      <BoardTable
        board={makeTestBoard([
          baseColumns[0]!,
          { ...budget, lastTypeChange: { ...change, expiresAt: Date.now() - 1 } },
        ])}
      />,
    );
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Sort ascending' });
    expect(screen.queryByRole('menuitem', { name: 'Undo type change' })).toBeNull();
  });

  it('offers Resume and Undo only once a migration is stale (10 minutes)', async () => {
    const stale = {
      snapshotId: 'snap1',
      startedAt: Date.now() - 11 * 60 * 1000,
      kind: 'change' as const,
    };
    const { unmount } = render(
      <BoardTable board={makeTestBoard([baseColumns[0]!, { ...budget, migrating: stale }])} />,
    );
    await openMenu();
    clickItem(await screen.findByRole('menuitem', { name: 'Resume type change' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(1));
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap1' }));
    expect(screen.queryByRole('menuitem', { name: 'Change column type' })).toBeNull();
    unmount();

    render(
      <BoardTable
        board={makeTestBoard([
          baseColumns[0]!,
          { ...budget, migrating: { ...stale, startedAt: Date.now() - 1000 } },
        ])}
      />,
    );
    await openMenu();
    await screen.findByRole('menuitem', { name: 'Sort ascending' });
    expect(screen.queryByRole('menuitem', { name: 'Resume type change' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Undo type change' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Change column type' })).toBeNull();
  });
});

describe('a column that is being converted is read-only', () => {
  const migratingBudget: ColumnDef = {
    ...budget,
    migrating: { snapshotId: 'snap1', startedAt: Date.now(), kind: 'change' },
  };

  it('shows a spinner and refuses editing, Delete and direct writes', async () => {
    render(<BoardTable board={makeTestBoard([baseColumns[0]!, migratingBudget])} />);
    const cell = document.querySelector('[data-cell="i1:budget"]') as HTMLElement;
    expect(within(cell).getByTestId('cell-migrating')).toBeInTheDocument();
    expect(cell).toHaveAttribute('title', 'Converting this column…');
    expect(
      document.querySelector('[data-cell="i1:status"] [data-testid="cell-migrating"]'),
    ).toBeNull();

    await userEvent.click(cell);
    screen.getByLabelText('Board table').focus();
    useTableStore.getState().setActive({ itemId: 'i1', columnId: 'budget' });
    await userEvent.keyboard('{Delete}');
    await userEvent.keyboard('{Enter}');
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(useTableStore.getState().editing).toBeNull();
  });

  it('validateCellWrite refuses a write to a migrating column', () => {
    const result = validateCellWrite('b1', [migratingBudget], 'budget', 5);
    expect(result).toEqual({ ok: false, message: COLUMN_MIGRATING_MESSAGE });
    expect(validateCellWrite('b1', [budget], 'budget', 5)).toEqual({ ok: true });
  });
});

describe('server-only column fields are never written by the web', () => {
  const marked: ColumnDef = {
    ...budget,
    migrating: { snapshotId: 's1', startedAt: 5, kind: 'change' },
    lastTypeChange: { snapshotId: 's0', fromType: 'text', expiresAt: 9 },
  };

  it('keeps what the server stored and drops forged marks', () => {
    const forged: ColumnDef = {
      ...budget,
      migrating: { snapshotId: 'forged', startedAt: 1, kind: 'revert' },
      lastTypeChange: { snapshotId: 'forged', fromType: 'x', expiresAt: 1 },
    };
    const fresh: ColumnDef = { ...forged, id: 'new' };
    const result = keepServerColumnFields([forged, fresh], [marked]);
    expect(result[0]).toEqual(marked);
    expect(result[1]!.migrating).toBeUndefined();
    expect(result[1]!.lastTypeChange).toBeUndefined();
  });

  it('a column that lost its marks on the server cannot gain them back from the client', () => {
    const result = keepServerColumnFields([marked], [budget]);
    expect(result[0]).toEqual(budget);
  });

  it('copies of a board carry no marks', () => {
    expect(withoutServerColumnFields([marked])).toEqual([budget]);
  });
});
