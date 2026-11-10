import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useItemCardStore } from '../item-card/item-card-store';
import { BoardTable } from './BoardTable';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  role: 'owner',
  create: vi.fn(),
  setValue: vi.fn(),
  setState: vi.fn(),
  updateStructure: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: mocks.role } }, loading: false, error: null }),
  updateBoardStructure: mocks.updateStructure,
  itemWrites: {
    create: mocks.create,
    setValue: mocks.setValue,
    setState: mocks.setState,
    createMany: vi.fn(),
    move: vi.fn(),
    moveMany: vi.fn(),
    rename: vi.fn(),
  },
}));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const board = makeBoard({
  id: 'b1',
  access: { u1: 'owner' },
  columns: [
    column('status', 'status', 'Status', 'a0'),
    column('cost', 'numbers', 'Cost', 'a1'),
    column('done', 'checkbox', 'Done?', 'a2'),
  ],
  groups: [
    { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
    { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
  ],
});

const sample = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Write spec',
    groupId: 'g1',
    position: 'a0',
    values: { cost: '1200' },
  }),
  makeItem({
    id: 'i2',
    name: 'Build table',
    groupId: 'g1',
    position: 'a1',
    values: { status: { index: 1 }, cost: '300', done: { checked: 'true' } },
  }),
  makeItem({ id: 'i3', name: 'Ship it', groupId: 'g2', position: 'a0' }),
];

beforeEach(() => {
  mocks.items = sample();
  mocks.role = 'owner';
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.setState.mockReset().mockResolvedValue(undefined);
  mocks.updateStructure.mockReset().mockResolvedValue(null);
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
});

function renderTable() {
  return render(<BoardTable board={board} />);
}

describe('BoardTable', () => {
  it('renders groups with their items, headers and column summaries', () => {
    renderTable();
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Beta' })).toBeInTheDocument();
    const alpha = within(screen.getByRole('region', { name: 'Alpha' }));
    expect(alpha.getByText('Write spec')).toBeInTheDocument();
    expect(alpha.getByText('Build table')).toBeInTheDocument();
    expect(alpha.getAllByRole('columnheader', { name: /Status|Cost|Done\?/ })).toHaveLength(3);
    // The numbers footer: 1,200 + 300.
    expect(alpha.getByText('1,500')).toBeInTheDocument();
    // The checkbox footer: one ticked out of two.
    expect(alpha.getByText('1/2')).toBeInTheDocument();
  });

  it('sets a status through the picker', async () => {
    renderTable();
    const cell = document.querySelector('[data-cell="i1:status"]') as HTMLElement;
    await userEvent.click(cell);
    const picker = await screen.findByRole('dialog', { name: 'Status labels' });
    await userEvent.click(within(picker).getByRole('option', { name: 'Stuck' }));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'status', { index: 2 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status labels' })).toBeNull());
  });

  it('creates an item from "+ Add item" and keeps the input open for the next one', async () => {
    renderTable();
    const alpha = within(screen.getByRole('region', { name: 'Alpha' }));
    await userEvent.click(alpha.getByRole('button', { name: '+ Add item' }));
    const input = alpha.getByRole('textbox', { name: 'New item in Alpha' });
    await userEvent.type(input, 'Review{Enter}');
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const [uid, boardId, created] = mocks.create.mock.calls[0] as [
      string,
      string,
      { name: string; groupId: string; position: string },
    ];
    expect([uid, boardId, created.name, created.groupId]).toEqual(['u1', 'b1', 'Review', 'g1']);
    // It lands after the last item of the group.
    expect(created.position > 'a1').toBe(true);
    expect(alpha.getByRole('textbox', { name: 'New item in Alpha' })).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    expect(alpha.queryByRole('textbox', { name: 'New item in Alpha' })).toBeNull();
  });

  it('shows the batch bar when rows are selected and clears it again', async () => {
    renderTable();
    expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Write spec' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ship it' }));
    const bar = screen.getByRole('region', { name: 'Selected items' });
    expect(within(bar).getByText('Items selected')).toBeInTheDocument();
    expect(bar).toHaveTextContent('2');
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.setState).toHaveBeenCalledWith('u1', 'b1', ['i1', 'i3'], 'deleted'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull(),
    );
  });

  it('selects every item of a group with its header checkbox', async () => {
    renderTable();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all items in Alpha' }));
    expect(screen.getByRole('checkbox', { name: 'Select Write spec' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Build table' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Ship it' })).not.toBeChecked();
  });

  it('selects the rows between two checkboxes on shift+click, across groups', async () => {
    mocks.items = [
      ...sample(),
      makeItem({ id: 'i4', name: 'Review', groupId: 'g2', position: 'a1' }),
    ];
    renderTable();
    const box = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });
    const user = userEvent.setup();
    await user.click(box('Build table'));
    await user.keyboard('{Shift>}');
    await user.click(box('Review'));
    await user.keyboard('{/Shift}');
    expect(box('Write spec')).not.toBeChecked();
    for (const name of ['Build table', 'Ship it', 'Review']) expect(box(name)).toBeChecked();

    // A plain click moves the anchor: the next range starts there.
    await userEvent.click(box('Write spec'));
    expect(useTableStore.getState().anchorId).toBe('i1');
  });

  it('skips collapsed groups when selecting a range', async () => {
    useTablePrefs.setState({ collapsed: { b1: ['g2'] }, nameWidth: {} });
    mocks.items = [
      ...sample(),
      makeItem({ id: 'i4', name: 'Review', groupId: 'g3', position: 'a0' }),
    ];
    render(
      <BoardTable
        board={{
          ...board,
          groups: [...board.groups, { id: 'g3', title: 'Gamma', color: '#a25ddc', position: 'a2' }],
        }}
      />,
    );
    const box = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });
    const user = userEvent.setup();
    await user.click(box('Write spec'));
    await user.keyboard('{Shift>}');
    await user.click(box('Review'));
    await user.keyboard('{/Shift}');
    expect([...useTableStore.getState().selected].sort()).toEqual(['i1', 'i2', 'i4']);
  });

  it('collapses a group to one row that still shows its summaries', async () => {
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse group Alpha' }));
    const alpha = within(screen.getByRole('region', { name: 'Alpha' }));
    expect(alpha.queryByText('Write spec')).toBeNull();
    expect(alpha.getByText('2 items')).toBeInTheDocument();
    expect(alpha.getByText('1,500')).toBeInTheDocument();
    expect(alpha.getByRole('button', { name: 'Expand group Alpha' })).toBeInTheDocument();
    // The choice is remembered per user and board.
    expect(useTablePrefs.getState().collapsed.b1).toEqual(['g1']);
  });

  it('filters by search, highlights matches and hides groups without one', async () => {
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search this board' }), 'TABLE');
    await waitFor(() => expect(screen.queryByText('Write spec')).toBeNull());
    expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Beta' })).toBeNull();
    const mark = document.querySelector('mark');
    expect(mark?.textContent).toBe('table');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Beta' })).toBeInTheDocument();
  });

  it('toggles a checkbox cell in one click', async () => {
    renderTable();
    const cell = document.querySelector('[data-cell="i2:done"]') as HTMLElement;
    await userEvent.click(within(cell).getByRole('checkbox'));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i2', 'done', null);
  });

  it('shows a new group at once, with its title open, before the write returns', async () => {
    mocks.updateStructure.mockReturnValue(new Promise(() => undefined));
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Add new group' }));
    const region = await screen.findByRole('region', { name: 'New Group' });
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: 'Group title' })).toHaveFocus();
    // Three clicks, three groups.
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Add new group' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Add new group' }));
    expect(screen.getAllByRole('region', { name: 'New Group' })).toHaveLength(3);
  });

  it('shows the count in a badge on the updates bubble once an item has updates', () => {
    mocks.items = [
      makeItem({ id: 'i1', name: 'Write spec', groupId: 'g1', position: 'a0', updatesCount: 3 }),
      makeItem({ id: 'i2', name: 'Build table', groupId: 'g1', position: 'a1' }),
      makeItem({ id: 'i3', name: 'Ship it', groupId: 'g1', position: 'a2', updatesCount: 12 }),
    ];
    renderTable();
    const withUpdates = screen.getByRole('button', { name: 'Updates for Write spec (3)' });
    expect(within(withUpdates).getByText('3')).toBeInTheDocument();
    // The "add update" state has no badge.
    const without = screen.getByRole('button', { name: 'Updates for Build table' });
    expect(within(without).queryByText(/\d/)).toBeNull();
    // Counts above nine squeeze into the badge as "9+"; the accessible name keeps the real number.
    const many = screen.getByRole('button', { name: 'Updates for Ship it (12)' });
    expect(within(many).getByText('9+')).toBeInTheDocument();
  });

  it('opens the side panel on Updates from the bubble and on Overview from the name', async () => {
    mocks.items = [makeItem({ id: 'i1', name: 'Write spec', groupId: 'g1', position: 'a0' })];
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Updates for Write spec' }));
    expect(useItemCardStore.getState()).toMatchObject({ activeItemId: 'i1', tab: 'updates' });
    useItemCardStore.getState().closeItemCard();
    await userEvent.click(screen.getByRole('button', { name: 'Write spec' }));
    expect(useItemCardStore.getState()).toMatchObject({ activeItemId: 'i1', tab: 'overview' });
    useItemCardStore.getState().closeItemCard();
  });

  it('lets viewers read but not edit', async () => {
    mocks.role = 'viewer';
    const viewerBoard = { ...board, access: { u1: 'viewer' as const } };
    render(<BoardTable board={viewerBoard} />);
    await userEvent.click(document.querySelector('[data-cell="i1:status"]') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Status labels' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add new group' })).toBeNull();
    expect(screen.getByText('Write spec')).toBeInTheDocument();
    expect(mocks.setValue).not.toHaveBeenCalled();
  });
});
