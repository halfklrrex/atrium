import { columnRegistry, REQUIRED_COLUMN_RULE_CAP, type ColumnDef } from '@atrium/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartialBatchError, type BoardDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { REQUIRED_CAP_MESSAGE } from './required-write';
import { tableActions, type TableCtx } from './table-actions';
import {
  bulkPeers,
  bulkSummary,
  bulkUndoSummary,
  isBulkEditableType,
  planBulkApply,
  planBulkUndo,
} from './bulk-edit';
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
    expect(bulkSummary(9, 9, 0)).toBe('Updated 9 items');
    expect(bulkSummary(7, 9, 2)).toBe('Updated 7 of 9 items; 2 skipped (locked or required)');
  });
});

describe('planBulkUndo', () => {
  const req = col('st', 'status', 'Status', { required: true });
  const plain = col('pl', 'text', 'Plain');
  const rowsNow = [row('a', { st: { index: 1 } }), row('b', { st: { index: 1 } })];
  const prev = (a: unknown, b: unknown) =>
    new Map<string, unknown>([
      ['a', a],
      ['b', b],
    ]);

  it('restores every row whose previous value is allowed', () => {
    const plan = planBulkUndo({
      columns: [req],
      columnId: 'st',
      previousById: prev({ index: 0 }, { index: 2 }),
      current: rowsNow,
    });
    expect(plan.kept).toEqual([]);
    expect(plan.restore).toEqual([
      { id: 'a', value: { index: 0 } },
      { id: 'b', value: { index: 2 } },
    ]);
  });

  it('keeps a row whose previous value was empty in a required column', () => {
    const plan = planBulkUndo({
      columns: [req],
      columnId: 'st',
      previousById: prev({ index: 0 }, null),
      current: rowsNow,
    });
    expect(plan.restore).toEqual([{ id: 'a', value: { index: 0 } }]);
    expect(plan.kept).toEqual([{ id: 'b', reason: 'required' }]);
  });

  it('restores an empty previous value in an ordinary column', () => {
    const plan = planBulkUndo({
      columns: [plain],
      columnId: 'pl',
      previousById: prev(null, null),
      current: [row('a', { pl: 'x' }), row('b', { pl: 'y' })],
    });
    expect(plan.restore).toEqual([
      { id: 'a', value: null },
      { id: 'b', value: null },
    ]);
  });

  it('keeps every row of a column that has become locked', () => {
    const plan = planBulkUndo({
      columns: [plain],
      columnId: 'pl',
      previousById: prev('p', 'q'),
      current: [row('a', { pl: 'x' }), row('b', { pl: 'y' })],
      locked: true,
    });
    expect(plan.restore).toEqual([]);
    expect(plan.kept.map((k) => k.reason)).toEqual(['locked', 'locked']);
  });

  it('can keep all rows, and words the toast without hiding them', () => {
    const plan = planBulkUndo({
      columns: [req],
      columnId: 'st',
      previousById: prev(null, null),
      current: rowsNow,
    });
    expect(plan.restore).toEqual([]);
    expect(plan.kept).toHaveLength(2);
    expect(bulkUndoSummary(0, 2, plan.kept, 'Status')).toBe(
      'Undid 0 of 2 items; 2 items kept the new value because Status is required',
    );
    expect(bulkUndoSummary(2, 3, [{ reason: 'required' }], 'Status')).toBe(
      'Undid 2 of 3 items; 1 item kept the new value because Status is required',
    );
    expect(bulkUndoSummary(2, 2, [], 'Status')).toBe('Undid 2 items');
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

  it('applies the change to all selected rows at once, with no popup and one Undo', async () => {
    render(<BoardTable board={board()} />);
    select('r1', 'r2', 'r3');
    await toggleRow('r1');
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(1));
    // One batch holds the edited row and its peers; there is no separate first write.
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(mocks.setValueMany).toHaveBeenCalledWith('u1', 'b1', 'done', [
      { id: 'r1', value: { checked: 'true' } },
      { id: 'r2', value: { checked: 'true' } },
      { id: 'r3', value: { checked: 'true' } },
    ]);
    expect(screen.queryByRole('button', { name: /Apply to|Only this item/ })).toBeNull();
    expect(useTableStore.getState().selected.size).toBe(3);

    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.text).toBe('Updated 3 items'),
    );
    const toast = useToastStore.getState().toasts.at(-1)!;
    expect(toast.action?.label).toBe('Undo');
    act(() => toast.action!.onClick());
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(2));
    expect(mocks.setValueMany).toHaveBeenLastCalledWith('u1', 'b1', 'done', [
      { id: 'r1', value: null },
      { id: 'r2', value: null },
      { id: 'r3', value: null },
    ]);
  });

  it('shows "Updating N selected items" only when the write is slow, then the result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let finish: () => void = () => undefined;
      mocks.setValueMany.mockReturnValue(new Promise<void>((r) => (finish = r)));
      render(<BoardTable board={board()} />);
      select('r1', 'r2');
      await toggleRow('r1');
      expect(useToastStore.getState().toasts).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      const pending = useToastStore.getState().toasts.at(-1)!;
      expect(pending).toMatchObject({ text: 'Updating 2 selected items', loading: true });
      await act(async () => {
        finish();
        await vi.advanceTimersByTimeAsync(0);
      });
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({ id: pending.id, text: 'Updated 2 items' });
      expect(toasts[0]!.loading).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a single row when one row or none of the selected rows is edited', async () => {
    render(<BoardTable board={board()} />);
    select('r1');
    await toggleRow('r1');
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));

    select('r1', 'r2');
    await toggleRow('r3');
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(2));
    expect(mocks.setValueMany).not.toHaveBeenCalled();
  });

  it('shows the error and no result toast when the write fails, and dismisses the pending toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail: (e: Error) => void = () => undefined;
      mocks.setValueMany.mockReturnValue(new Promise<void>((_, r) => (fail = r)));
      render(<BoardTable board={board()} />);
      select('r1', 'r2');
      await toggleRow('r1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(useToastStore.getState().toasts.some((t) => t.loading)).toBe(true);
      await act(async () => {
        fail(new Error('boom'));
        await vi.advanceTimersByTimeAsync(0);
      });
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.loading)).toBe(false);
      expect(toasts.some((t) => t.type === 'negative')).toBe(true);
      expect(toasts.some((t) => /^Updated/.test(t.text))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a partial failure and offers Undo for the rows already written', async () => {
    mocks.setValueMany.mockRejectedValueOnce(
      new PartialBatchError(['r1', 'r2'], 1, new Error('x')),
    );
    render(<BoardTable board={board()} />);
    select('r1', 'r2', 'r3');
    await toggleRow('r1');
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.text).toBe(
        'Updated 2 items; 1 could not be saved',
      ),
    );
    const toast = useToastStore.getState().toasts.at(-1)!;
    expect(toast.type).toBe('negative');
    act(() => toast.action!.onClick());
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(2));
    expect(mocks.setValueMany).toHaveBeenLastCalledWith('u1', 'b1', 'done', [
      { id: 'r1', value: null },
      { id: 'r2', value: null },
    ]);
  });

  it('Undo restores the rows that can go back and names the required one that keeps the new value', async () => {
    const doneReq = col('done', 'checkbox', 'Done', { required: true });
    mocks.items = [
      row('r1', { done: { checked: 'true' }, note: 'x' }),
      row('r2', { note: 'x' }),
      row('r3', { done: { checked: 'true' }, note: 'x' }),
    ];
    render(<BoardTable board={board({ columns: [doneReq, note] })} />);
    select('r1', 'r2', 'r3');
    await toggleRow('r2');
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.action).toBeDefined());
    act(() => useToastStore.getState().toasts.at(-1)!.action!.onClick());
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(2));
    // r2 had an empty required cell: it keeps the new value, so it is not in the Undo batch.
    const undoCells = mocks.setValueMany.mock.calls[1]![3] as { id: string }[];
    expect(undoCells.map((c) => c.id)).toEqual(['r1', 'r3']);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.text).toBe(
        'Undid 2 of 3 items; 1 item kept the new value because Done is required',
      ),
    );
  });

  describe('column highlight', () => {
    const outlined = () =>
      Array.from(document.querySelectorAll('[data-bulk-outlined]')).map((e) =>
        e.getAttribute('data-cell'),
      );

    it('outlines the hovered column in every selected row, and only there', async () => {
      render(<BoardTable board={board()} />);
      select('r1', 'r2');
      await userEvent.hover(document.querySelector('[data-cell="r1:done"]')!);
      expect(useTableStore.getState().bulkColumnId).toBe('done');
      expect(outlined().sort()).toEqual(['r1:done', 'r2:done']);
      expect(
        document.querySelector('[data-cell="r1:done"]')!.getAttribute('aria-description'),
      ).toBe('Changes all 2 selected items');
      await userEvent.unhover(document.querySelector('[data-cell="r1:done"]')!);
      expect(useTableStore.getState().bulkColumnId).toBeNull();
      expect(outlined()).toEqual([]);
    });

    it('does nothing with one row selected or when the hovered row is not selected', async () => {
      render(<BoardTable board={board()} />);
      select('r1');
      await userEvent.hover(document.querySelector('[data-cell="r1:done"]')!);
      expect(outlined()).toEqual([]);
      select('r1', 'r2');
      await userEvent.hover(document.querySelector('[data-cell="r3:done"]')!);
      expect(outlined()).toEqual([]);
    });

    it('does nothing for a column that is not bulk-editable', async () => {
      const formula = col('f', 'formula', 'F');
      render(<BoardTable board={board({ columns: [done, formula] })} />);
      select('r1', 'r2');
      await userEvent.hover(document.querySelector('[data-cell="r1:f"]')!);
      expect(outlined()).toEqual([]);
    });

    it('keeps the outline while the editor is open and drops it when it closes', async () => {
      const text = col('tx', 'text', 'Text');
      render(<BoardTable board={board({ columns: [done, text] })} />);
      select('r1', 'r2');
      const cell = document.querySelector('[data-cell="r1:tx"]')!;
      await userEvent.hover(cell);
      await userEvent.click(cell);
      expect(useTableStore.getState().editing?.itemId).toBe('r1');
      await userEvent.unhover(cell);
      expect(outlined().sort()).toEqual(['r1:tx', 'r2:tx']);
      act(() => useTableStore.getState().setEditing(null));
      await waitFor(() => expect(outlined()).toEqual([]));
    });
  });

  it('Undo puts back the previous value of rows that had one and empties the rest', async () => {
    mocks.items = [row('r1', { done: { checked: 'true' } }), row('r2'), row('r3')];
    render(<BoardTable board={board()} />);
    select('r1', 'r2', 'r3');
    await toggleRow('r2');
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.action).toBeDefined());
    act(() => useToastStore.getState().toasts.at(-1)!.action!.onClick());
    await waitFor(() => expect(mocks.setValueMany).toHaveBeenCalledTimes(2));
    expect(mocks.setValueMany).toHaveBeenLastCalledWith('u1', 'b1', 'done', [
      { id: 'r2', value: null },
      { id: 'r1', value: { checked: 'true' } },
      { id: 'r3', value: null },
    ]);
  });
});

describe('tableActions.setCellBulk', () => {
  const status = col('st', 'status', 'Status', {
    settings: {
      labels: [
        { id: 'w', index: 0, label: 'Working', color: '#fdab3d' },
        { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
      ],
    },
  });
  const owner = col('owner', 'text', 'Owner', { required: true });
  const cols = [status, owner, done];
  const ctx = (extra: Partial<TableCtx> = {}): TableCtx => ({
    boardId: 'b1',
    uid: 'u1',
    columns: cols,
    ...extra,
  });
  const toasts = () => useToastStore.getState().toasts;

  beforeEach(() => {
    mocks.setValueMany.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('refuses an edited row in a locked column without writing', async () => {
    const edited = row('r1');
    const ok = await tableActions.setCellBulk(
      ctx({ board: { columnLocks: ['done'] }, boardRole: 'editor' }),
      edited,
      'done',
      { checked: 'true' },
      [row('r2')],
    );
    expect(ok).toBe(false);
    expect(mocks.setValueMany).not.toHaveBeenCalled();
    expect(toasts().at(-1)?.type).toBe('negative');
  });

  it('refuses an edited row whose change breaks the required rule without writing', async () => {
    const edited = row('r1', { owner: 'Avery' });
    const ok = await tableActions.setCellBulk(ctx(), edited, 'owner', null, [
      row('r2', { owner: 'Blake' }),
    ]);
    expect(ok).toBe(false);
    expect(mocks.setValueMany).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toMatchObject({ text: 'Owner is required', type: 'negative' });
  });

  it('skips required-breaking peers, writes the rest and says how many were skipped', async () => {
    const edited = row('r1', { owner: 'Avery', st: { index: 0 } });
    const filledPeer = row('r2', { owner: 'Blake', st: { index: 0 } });
    const emptyPeer = row('r3', { st: { index: 0 } });
    const ok = await tableActions.setCellBulk(ctx(), edited, 'st', { index: 1 }, [
      filledPeer,
      emptyPeer,
    ]);
    expect(ok).toBe(true);
    expect(mocks.setValueMany).toHaveBeenCalledWith('u1', 'b1', 'st', [
      { id: 'r1', value: { index: 1 } },
      { id: 'r2', value: { index: 1 } },
    ]);
    expect(toasts().at(-1)?.text).toBe('Updated 2 of 3 items; 1 skipped (locked or required)');
  });

  it('explains a required-rule permission denial in plain words', async () => {
    mocks.setValueMany.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    const ok = await tableActions.setCellBulk(
      ctx({
        requiredColumnIds: [
          ...Array.from({ length: REQUIRED_COLUMN_RULE_CAP }, (_, i) => `x${i}`),
          'owner',
        ],
      }),
      row('r1', { owner: 'Avery' }),
      'owner',
      'Blake',
      [row('r2', { owner: 'Avery' })],
    );
    expect(ok).toBe(false);
    expect(toasts().at(-1)?.type).toBe('negative');
    expect(toasts().at(-1)?.text).toBe(REQUIRED_CAP_MESSAGE);
  });
});
