import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn() }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return { ...actual, getDoc: getDocMock };
});
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/firestore', () => ({
  refs: { board: (boardId: string) => ({ boardId }), items: (boardId: string) => ({ boardId }) },
  queries: {},
}));

import { clearBoardRelationCacheForTests } from '../../columns/board-relation';
import { ColumnSettingsPopup } from './ColumnSettings';
import { tableActions, type TableCtx } from './table-actions';
import { TableEnvContext, type TableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { useTableStore } from './table-store';

const mockCtx: TableCtx = { boardId: 'board-1', uid: 'user-1', columns: [] };

const view = (
  id: string,
  type: string,
  title: string,
  settings: Record<string, unknown> = {},
): ColumnView => ({
  def: { id, type, title, position: 'a0', settings },
  settings,
  width: 140,
});

const def = (id: string, type: string, title: string): ColumnDef => ({
  id,
  type,
  title,
  position: 'a0',
  settings: {},
});

/** Columns of the connected boards, by board id. */
const BOARD_COLUMNS: Record<string, ColumnDef[]> = {
  'board-tasks': [
    def('status', 'status', 'Status'),
    def('budget', 'numbers', 'Budget'),
    def('due', 'date', 'Due'),
    def('mirror', 'mirror', 'Nested mirror'),
    def('rel', 'board_relation', 'Other relation'),
    def('calc', 'formula', 'Calculated'),
    def('go', 'button', 'Go button'),
  ],
  'board-people': [def('role', 'text', 'Role')],
};

const relation = view('rel-1', 'board_relation', 'Linked tasks', {
  boardIds: ['board-tasks', 'board-people', 'board-hidden'],
  allowMultipleItems: true,
  twoWay: false,
});

function renderEditor(settings: Record<string, unknown>, envOverrides: Partial<TableEnv> = {}) {
  const mirror = view('mirror-1', 'mirror', 'Mirror', settings);
  const env: TableEnv = {
    boardId: 'board-1',
    uid: 'user-1',
    canEdit: true,
    columns: [relation, mirror],
    subitemColumns: [],
    groups: [],
    nameWidth: 300,
    ctx: mockCtx,
    getModels: () => [],
    getItems: () => [],
    scrollElement: null,
    onResize: vi.fn(),
    // `board-hidden` is not in the readable list.
    workspaceBoards: [
      { id: 'board-tasks', name: 'Tasks' },
      { id: 'board-people', name: 'People' },
    ],
    ...envOverrides,
  };
  return render(
    <TableEnvContext.Provider value={env}>
      <ColumnSettingsPopup column={mirror} anchor={document.body} />
    </TableEnvContext.Provider>,
  );
}

const optionLabels = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].map((o) => o.textContent);

describe('Mirror column settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearBoardRelationCacheForTests();
    vi.spyOn(tableActions, 'updateColumn').mockResolvedValue(undefined);
    useTableStore.getState().reset(null);
    getDocMock.mockReset();
    getDocMock.mockImplementation(async (ref: { boardId: string }) => ({
      exists: () => ref.boardId in BOARD_COLUMNS,
      data: () => ({ columns: BOARD_COLUMNS[ref.boardId] }),
    }));
  });

  it('offers only Connect boards columns in the relation select', () => {
    renderEditor({});
    const select = screen.getByLabelText('Connect boards column');
    expect(optionLabels(select)).toEqual(['Choose a column', 'Linked tasks']);
  });

  it('lists the target columns of each readable connected board, without chains or unreadable ones', async () => {
    renderEditor({});
    fireEvent.change(screen.getByLabelText('Connect boards column'), {
      target: { value: 'rel-1' },
    });
    const tasks = await screen.findByLabelText('Column from Tasks');
    await waitFor(() => expect(optionLabels(tasks)).toContain('Status'));
    expect(optionLabels(tasks)).toEqual(['Choose a column', 'Status', 'Budget', 'Due']);
    expect(optionLabels(screen.getByLabelText('Column from People'))).toContain('Role');
    expect(screen.queryByLabelText(/hidden/i)).toBeNull();
    expect(getDocMock).not.toHaveBeenCalledWith({ boardId: 'board-hidden' });
  });

  it('offers only the aggregations that fit the chosen targets and saves the settings', async () => {
    renderEditor({});
    fireEvent.change(screen.getByLabelText('Connect boards column'), {
      target: { value: 'rel-1' },
    });
    const tasks = await screen.findByLabelText('Column from Tasks');
    await waitFor(() => expect(optionLabels(tasks)).toContain('Budget'));
    const showAs = screen.getByLabelText('Show as');
    expect(optionLabels(showAs)).toEqual([
      'None (show values)',
      'Count',
      'Count filled',
      'Count empty',
      'Percent filled',
    ]);

    fireEvent.change(tasks, { target: { value: 'budget' } });
    expect(optionLabels(screen.getByLabelText('Show as'))).toEqual([
      'None (show values)',
      'Count',
      'Count filled',
      'Count empty',
      'Percent filled',
      'Sum',
      'Average',
      'Min',
      'Max',
    ]);

    fireEvent.change(tasks, { target: { value: 'due' } });
    expect(optionLabels(screen.getByLabelText('Show as'))).toContain('Earliest');
    expect(optionLabels(screen.getByLabelText('Show as'))).not.toContain('Sum');

    fireEvent.change(tasks, { target: { value: 'budget' } });
    fireEvent.change(screen.getByLabelText('Show as'), { target: { value: 'sum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'mirror-1', {
      settings: {
        relationColumnId: 'rel-1',
        targetColumnIds: { 'board-tasks': 'budget' },
        aggregation: 'sum',
      },
    });
  });

  it('shows the schema error inline and blocks Apply', async () => {
    const longBoardId = 'b'.repeat(200);
    const longRelation = view('rel-1', 'board_relation', 'Linked tasks', {
      boardIds: [longBoardId],
      allowMultipleItems: true,
      twoWay: false,
    });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ columns: [def('status', 'status', 'Status')] }),
    });
    renderEditor(
      { relationColumnId: 'rel-1', targetColumnIds: {}, aggregation: 'none' },
      {
        columns: [longRelation, view('mirror-1', 'mirror', 'Mirror')],
        workspaceBoards: [{ id: longBoardId, name: 'Long board' }],
      },
    );
    const select = await screen.findByLabelText('Column from Long board');
    await waitFor(() => expect(optionLabels(select)).toContain('Status'));
    fireEvent.change(select, { target: { value: 'status' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('with no Connect boards column, explains what to do instead of showing empty controls', () => {
    renderEditor({}, { columns: [view('mirror-1', 'mirror', 'Mirror')] });
    expect(screen.getByText('Add a Connect boards column first')).toBeInTheDocument();
    expect(screen.queryByLabelText('Connect boards column')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show as')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('with a Connect boards column that has no boards yet, says to choose boards first', () => {
    const empty = view('rel-1', 'board_relation', 'Linked tasks', { boardIds: [] });
    renderEditor(
      { relationColumnId: 'rel-1' },
      { columns: [empty, view('mirror-1', 'mirror', 'Mirror')] },
    );
    expect(screen.getByText(/not connected to any board yet/)).toBeInTheDocument();
  });
});
