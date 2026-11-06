import { REQUIRED_COLUMN_RULE_CAP, type ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import {
  REQUIRED_CAP_MESSAGE,
  checkRequiredWrite,
  countEmptyCells,
  explainRequiredDenied,
  requiredEmptyNote,
  wouldExceedRequiredCap,
} from './required-write';
import { tableActions, type TableCtx } from './table-actions';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  setValue: vi.fn(),
  setValueAndMove: vi.fn(),
  create: vi.fn(),
  updateBoardStructure: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useItems: () => ({ data: mocks.items, loading: false, error: null }),
    useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
    updateBoardStructure: mocks.updateBoardStructure,
    itemWrites: {
      create: mocks.create,
      createMany: vi.fn(),
      setValue: mocks.setValue,
      setValueAndMove: mocks.setValueAndMove,
      setState: vi.fn(),
      toggleVote: vi.fn(),
      clearColumn: vi.fn(),
      move: vi.fn(),
      moveMany: vi.fn(),
      rename: vi.fn(),
    },
  };
});

const labels = [
  { id: 'w', index: 0, label: 'Working', color: '#fdab3d' },
  { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
];
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
  settings: type === 'status' ? { labels } : {},
  ...extra,
});

const status = col('st', 'status', 'Status');
const owner = col('owner', 'text', 'Owner', { required: true });
const due = col('due', 'text', 'Due date', { required: true });
const columns = [status, owner, due];
const filled = { owner: 'Avery', due: '2026-12-01' };

const item = (values: Record<string, unknown>): ItemDoc =>
  makeItem({ id: 'i1', name: 'Task', groupId: 'g1', position: 'a0', values });

const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

beforeEach(() => {
  mocks.items = [];
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.setValueAndMove.mockReset().mockResolvedValue(undefined);
  mocks.create.mockReset().mockResolvedValue('new');
  mocks.updateBoardStructure.mockReset().mockResolvedValue(null);
  useToastStore.setState({ toasts: [] });
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
});

describe('checkRequiredWrite', () => {
  it('refuses emptying a required cell, naming the column', () => {
    const err = checkRequiredWrite(columns, 'owner', null, item({ ...filled }));
    expect(err?.message).toBe('Owner is required');
    expect(err?.violation.kind).toBe('cleared');
    expect(checkRequiredWrite(columns, 'owner', '', item({ ...filled }))?.message).toBe(
      'Owner is required',
    );
  });

  it('allows changing a required cell to another value and clearing an optional one', () => {
    expect(checkRequiredWrite(columns, 'owner', 'Blake', item({ ...filled }))).toBeNull();
    const optional = col('note', 'text', 'Note');
    expect(
      checkRequiredWrite([...columns, optional], 'note', null, item({ note: 'x' })),
    ).toBeNull();
  });

  it('refuses Done while other required cells are empty and names them', () => {
    const err = checkRequiredWrite(columns, 'st', { index: 1 }, item({ st: { index: 0 } }));
    expect(err?.message).toBe('Fill in Owner, Due date before setting Status to Done');
    expect(err?.violation.kind).toBe('done_with_empty');
  });

  it('allows Done when every required cell is filled, and non-done labels always', () => {
    expect(
      checkRequiredWrite(columns, 'st', { index: 1 }, item({ st: { index: 0 }, ...filled })),
    ).toBeNull();
    expect(checkRequiredWrite(columns, 'st', { index: 0 }, item({}))).toBeNull();
  });
});

describe('tableActions.setCell with required columns', () => {
  const ctx = (extra: Partial<TableCtx> = {}): TableCtx => ({
    boardId: 'b1',
    uid: 'u1',
    columns,
    requiredColumnIds: ['due', 'owner'],
    ...extra,
  });

  it('never sends a write that empties a required cell, and toasts', async () => {
    const ok = await tableActions.setCell(ctx(), 'i1', 'owner', null, item({ ...filled }));
    expect(ok).toBe(false);
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['Owner is required']);
  });

  it('never sends Done with an empty required cell (item looked up from getItems)', async () => {
    const current = item({ st: { index: 0 }, owner: 'Avery' });
    const ok = await tableActions.setCell(ctx({ getItems: () => [current] }), 'i1', 'st', {
      index: 1,
    });
    expect(ok).toBe(false);
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['Fill in Due date before setting Status to Done']);
  });

  it('refuses a kanban drop into Done the same way', async () => {
    const ok = await tableActions.setCellAndMove(
      ctx(),
      'i1',
      'st',
      { index: 1 },
      'a5',
      item({ st: { index: 0 } }),
    );
    expect(ok).toBe(false);
    expect(mocks.setValueAndMove).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatch(/^Fill in Owner, Due date before setting Status to Done/);
  });

  it('writes a valid required value', async () => {
    const ok = await tableActions.setCell(ctx(), 'i1', 'owner', 'Blake', item({ ...filled }));
    expect(ok).toBe(true);
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'owner', 'Blake');
  });

  it('turns a rules permission-denied on the 11th required column into the cap toast', async () => {
    mocks.setValue.mockRejectedValueOnce({ code: 'permission-denied' });
    const ids = Array.from({ length: REQUIRED_COLUMN_RULE_CAP }, (_, i) => `r${i}`);
    const ok = await tableActions.setCell(
      ctx({ requiredColumnIds: [...ids, 'owner'] }),
      'i1',
      'owner',
      'Blake',
      item({ ...filled }),
    );
    expect(ok).toBe(false);
    expect(toasts()).toEqual([REQUIRED_CAP_MESSAGE]);
  });

  it('explains a denied empty write to a required column, and leaves other denials generic', async () => {
    expect(explainRequiredDenied(columns, ['owner'], 'owner', null)).toBe('Owner is required');
    expect(explainRequiredDenied(columns, ['owner'], 'owner', 'x')).toBeNull();
    expect(explainRequiredDenied(columns, ['owner'], 'st', null)).toBeNull();
    mocks.setValue.mockRejectedValueOnce({ code: 'permission-denied' });
    const ok = await tableActions.setCell(ctx(), 'i1', 'owner', 'x', item({ ...filled }));
    expect(ok).toBe(false);
    expect(toasts()).toEqual(["You don't have permission to do that."]);
  });

  it('item creation is exempt', async () => {
    await tableActions.addItem(ctx(), { groupId: 'g1', position: 'a1' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual([]);
  });
});

describe('required column menu', () => {
  it('counts empty items and blocks the 11th required column', () => {
    expect(countEmptyCells([item({}), item({ owner: 'x' }), item({ owner: '' })], owner)).toBe(2);
    expect(requiredEmptyNote(0)).toBeNull();
    expect(requiredEmptyNote(1)).toBe(
      "1 item is empty; they stay as they are but can't be saved empty again",
    );
    expect(requiredEmptyNote(3)).toBe(
      "3 items are empty; they stay as they are but can't be saved empty again",
    );
    const ten = Array.from({ length: REQUIRED_COLUMN_RULE_CAP }, (_, i) => `c${i}`);
    expect(wouldExceedRequiredCap(ten, 'extra')).toBe(true);
    expect(wouldExceedRequiredCap(ten, 'c3')).toBe(false);
    expect(wouldExceedRequiredCap(ten.slice(1), 'extra')).toBe(false);
  });

  const boardWith = (cols: ColumnDef[], requiredColumnIds: string[]): BoardDoc =>
    makeBoard({
      id: 'b1',
      access: { u1: 'owner' },
      accessUids: ['u1'],
      columns: cols,
      requiredColumnIds,
      columnLocks: [],
      groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
    });

  it('shows how many items are empty under the Required switch', async () => {
    mocks.items = [item({}), { ...item({ owner: 'x' }), id: 'i2' }, { ...item({}), id: 'i3' }];
    render(<BoardTable board={boardWith([status, owner], ['owner'])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Options for Owner' }));
    expect((await screen.findAllByTestId('column-required-note-owner'))[0]).toHaveTextContent(
      "2 items are empty; they stay as they are but can't be saved empty again",
    );
  });

  it('warns and blocks turning Required on past the cap', async () => {
    const many = Array.from({ length: REQUIRED_COLUMN_RULE_CAP }, (_, i) =>
      col(`r${i}`, 'text', `R${i}`, { required: true }),
    );
    const extra = col('extra', 'text', 'Extra');
    render(
      <BoardTable
        board={boardWith(
          [status, ...many, extra],
          many.map((c) => c.id),
        )}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Options for Extra' }));
    expect((await screen.findAllByTestId('column-required-note-extra'))[0]).toHaveTextContent(
      REQUIRED_CAP_MESSAGE,
    );
    const menuItem = await screen.findByRole('menuitem', { name: 'Required column' });
    fireEvent.mouseEnter(menuItem);
    fireEvent.click(menuItem);
    await waitFor(() => expect(toasts()).toContain(REQUIRED_CAP_MESSAGE));
    expect(mocks.updateBoardStructure).not.toHaveBeenCalled();
  });
});
