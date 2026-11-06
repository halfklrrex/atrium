import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { bulkPeers, bulkSummary, isBulkEditableType, planBulkApply } from './bulk-edit';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  setValue: vi.fn(),
  setValueMany: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useItems: () => ({ data: mocks.items, loading: false, error: null }),
    useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
    updateBoardStructure: vi.fn(),
    itemWrites: {
      create: vi.fn(),
      createMany: vi.fn(),
      setValue: mocks.setValue,
      setValueMany: mocks.setValueMany,
      setState: vi.fn(),
      toggleVote: vi.fn(),
      clearColumn: vi.fn(),
      move: vi.fn(),
      moveMany: vi.fn(),
      rename: vi.fn(),
    },
  };
});

const col = (
  id: string,
  type: string,
  title: string,
  extra: Partial<ColumnDef> = {},
): ColumnDef => ({
  id,
  type,
  title,
  position: `a${id}`,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
  ...extra,
});

const done = col('done', 'checkbox', 'Done');
const note = col('note', 'text', 'Note', { required: true });
const columns = [done, note];

const row = (id: string, values: Record<string, unknown> = {}, parent: string | null = null) =>
  makeItem({ id, name: id, groupId: 'g1', position: `a${id}`, parentItemId: parent, values });

describe('isBulkEditableType', () => {
  it('accepts plain value types and refuses derived, managed and link types', () => {
    for (const t of ['status', 'dropdown', 'people', 'date', 'text', 'checkbox', 'numbers']) {
      expect(isBulkEditableType(t)).toBe(true);
    }
    for (const t of ['files', 'button', 'time_tracking', 'auto_number', 'item_id', 'formula']) {
      expect(isBulkEditableType(t)).toBe(false);
    }
    for (const t of ['mirror', 'dependency', 'board_relation', 'vote']) {
      expect(isBulkEditableType(t)).toBe(false);
    }
  });
});

describe('bulkPeers', () => {
  it('keeps selected rows of the edited row level, without the row itself', () => {
    const items = [row('a'), row('b'), row('c'), row('s1', {}, 'a'), row('s2', {}, 'a')];
    const selected = new Set(['a', 'b', 's1', 's2']);
    expect(bulkPeers(items, selected, items[0]!).map((i) => i.id)).toEqual(['b']);
    expect(bulkPeers(items, selected, items[3]!).map((i) => i.id)).toEqual(['s2']);
  });
});

describe('planBulkApply', () => {
  const base = { boardId: 'b1', columns, columnId: 'done', value: { checked: 'true' } };

  it('writes every peer and carries the previous value for Undo', () => {
    const peers = [row('b', { done: { checked: 'true' } }), row('c')];
    const plan = planBulkApply({ ...base, peers });
    expect(plan.total).toBe(3);
    expect(plan.skipped).toEqual([]);
    expect(plan.writes).toEqual([
      { itemId: 'b', value: { checked: 'true' }, previous: { checked: 'true' } },
      { itemId: 'c', value: { checked: 'true' }, previous: null },
    ]);
  });

  it('carries a status index unchanged', () => {
    const status = col('st', 'status', 'Status');
    const plan = planBulkApply({
      boardId: 'b1',
      columns: [status],
      columnId: 'st',
      value: { index: 1 },
      peers: [row('b', { st: { index: 0 } })],
    });
    expect(plan.writes[0]).toMatchObject({ value: { index: 1 }, previous: { index: 0 } });
  });

  it('skips rows that would be emptied in a required column', () => {
    const plan = planBulkApply({
      boardId: 'b1',
      columns,
      columnId: 'note',
      value: null,
      peers: [row('b', { note: 'x' })],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([{ itemId: 'b', reason: 'required' }]);
  });

  it('skips every row of a locked column for an editor', () => {
    const plan = planBulkApply({
      ...base,
      peers: [row('b'), row('c')],
      lockCtx: { board: { columnLocks: ['done'] }, boardRole: 'editor' },
    });
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['locked', 'locked']);
  });

  it('skips everything for a derived column', () => {
    const plan = planBulkApply({
      boardId: 'b1',
      columns: [col('f', 'formula', 'F')],
      columnId: 'f',
      value: 1,
      peers: [row('b')],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.skipped).toEqual([{ itemId: 'b', reason: 'invalid' }]);
  });

  it('words the summary without hiding skips', () => {
    expect(bulkSummary(9, 9, 0)).toBe('Updated 9 items.');
    expect(bulkSummary(7, 9, 2)).toBe('Updated 7 of 9 items; 2 skipped (locked or required).');
  });
});

describe('bulk edit in the table', () => {
  const board = (overrides: Partial<BoardDoc> = {}): BoardDoc =>
    makeBoard({
      id: 'b1',
      columns,
      groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
      ...overrides,
    });

  beforeEach(() => {
    mocks.items = [row('r1', { note: 'x' }), row('r2', { note: 'x' }), row('r3', { note: 'x' })];
    mocks.setValue.mockReset().mockResolvedValue(undefined);
    mocks.setValueMany.mockReset().mockResolvedValue(undefined);
    useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
    useTableStore.getState().reset(null);
    useToastStore.setState({ toasts: [] });
  });

  const select = (...ids: string[]) =>
    act(() => useTableStore.getState().setSelected(new Set(ids)));
  const toggleRow = async (id: string) => {
    await userEvent.click(document.querySelector(`[data-cell="${id}:done"]`)!);
  };

  it('offers the change to all selected rows and applies it with one Undo', async () => {
    render(<BoardTable board={board()} />);
    select('r1', 'r2', 'r3');
    await toggleRow('r1');
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'r1', 'done', { checked: 'true' });

    await userEvent.click(await screen.findByRole('button', { name: 'Apply to 3 selected items' }));
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(1));
    expect(mocks.setValueMany).toHaveBeenCalledWith('u1', 'b1', 'done', [
      { id: 'r2', value: { checked: 'true' } },
      { id: 'r3', value: { checked: 'true' } },
    ]);
    expect(useTableStore.getState().selected.size).toBe(3);
    expect(screen.queryByRole('dialog', { name: 'Apply to selected items' })).toBeNull();

    const toast = useToastStore.getState().toasts.at(-1)!;
    expect(toast.text).toBe('Updated 3 items.');
    act(() => toast.action!.onClick());
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(2));
    expect(mocks.setValueMany).toHaveBeenLastCalledWith('u1', 'b1', 'done', [
      { id: 'r1', value: null },
      { id: 'r2', value: null },
      { id: 'r3', value: null },
    ]);
  });

  it('writes nothing more for "Only this item" and for Escape', async () => {
    render(<BoardTable board={board()} />);
    select('r1', 'r2');
    await toggleRow('r1');
    await userEvent.click(await screen.findByRole('button', { name: 'Only this item' }));
    expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull();

    await toggleRow('r2');
    await screen.findByRole('button', { name: 'Apply to 2 selected items' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull());
    expect(mocks.setValueMany).not.toHaveBeenCalled();
  });

  it('does not offer anything with one selected row or an unselected edited row', async () => {
    render(<BoardTable board={board()} />);
    select('r1');
    await toggleRow('r1');
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull();

    select('r1', 'r2');
    await toggleRow('r3');
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull();
  });
});
