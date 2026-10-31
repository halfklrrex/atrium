import {
  columnRegistry,
  defaultCalendarSettings,
  defaultViewSettings,
  type CalendarSettings,
  type ColumnDef,
} from '@atrium/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as DndKit from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, isViewDirty, useFilterStore, viewKey } from '../board-filters';
import { useTableStore } from '../board-table/table-store';
import { useCalendarUi } from './calendar-store';
import { CalendarView } from './CalendarView';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  role: 'owner',
  create: vi.fn(),
  setValue: vi.fn(),
  addColumn: vi.fn(),
  openItemFull: vi.fn(),
  /** The props the view gave its DndContext, so a test can play a drop. */
  dnd: null as null | { onDragStart?: (e: unknown) => void; onDragEnd: (e: unknown) => void },
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../board-table/open-item', () => ({
  openItemFull: mocks.openItemFull,
  openItem: vi.fn(),
}));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof DndKit>();
  return {
    ...original,
    DndContext: (props: Parameters<typeof original.DndContext>[0]) => {
      mocks.dnd = props as never;
      return <original.DndContext {...props} />;
    },
  };
});
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: mocks.role } }, loading: false, error: null }),
  usePresence: () => ({ viewers: [] }),
  updateBoardStructure: vi.fn(),
  itemWrites: {
    create: mocks.create,
    setValue: mocks.setValue,
    setValueAndMove: vi.fn(),
    move: vi.fn(),
    moveMany: vi.fn(),
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
  ],
};

const board = makeBoard({
  id: 'b1',
  columns: [
    column('status', 'status', 'Status', 'a0', status),
    column('due', 'date', 'Due', 'a1'),
    column('plan', 'timeline', 'Plan', 'a2'),
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
    values: { due: { date: '2026-10-20', time: '09:30:00' }, status: { index: 0 } },
  }),
  makeItem({
    id: 'i2',
    name: 'Launch',
    position: 'a1',
    values: { plan: { from: '2026-10-22', to: '2026-10-28' }, due: { date: '2026-10-28' } },
  }),
  makeItem({ id: 'i3', name: 'Undated', position: 'a2', values: {} }),
  makeItem({
    id: 'sub',
    name: 'A subitem',
    parentItemId: 'i1',
    values: { due: { date: '2026-10-20' } },
  }),
];

function open(calendar: Partial<CalendarSettings> = {}, shown = board) {
  useFilterStore.getState().syncView('b1', 'cv', {
    ...defaultViewSettings(),
    calendar: { ...defaultCalendarSettings(), ...calendar },
  });
  return render(<CalendarView board={shown} />);
}

const cell = (label: string) => within(screen.getByRole('gridcell', { name: label }));

beforeEach(() => {
  // A fixed "today" (Saturday 24 October 2026) for the month on screen and the today marker.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  mocks.items = sample();
  mocks.role = 'owner';
  mocks.dnd = null;
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.openItemFull.mockReset();
  useFilterStore.setState({ activeView: {}, views: {} });
  useCalendarUi.setState({ anchors: {} });
  useTableStore.getState().reset(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CalendarView', () => {
  it('shows the month with weekday names, the title and the items on their days', () => {
    open({ columnId: 'due' });
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(cell('Tuesday, October 20, 2026').getByText('09:30 Write spec')).toBeInTheDocument();
    expect(cell('Wednesday, October 28, 2026').getByText('Launch')).toBeInTheDocument();
    // Items without a value and subitems are not shown.
    expect(screen.queryByText('Undated')).toBeNull();
    expect(screen.queryByText('A subitem')).toBeNull();
  });

  it('marks today with aria-current and puts the day number in the cell', () => {
    open({ columnId: 'due' });
    const today = screen.getByRole('gridcell', { name: 'Saturday, October 24, 2026' });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveTextContent('24');
  });

  it('draws a timeline as one bar per week row it spans', () => {
    open({ columnId: 'plan' });
    const bars = screen.getAllByRole('button', { name: 'Launch, Oct 22 to Oct 28' });
    expect(bars).toHaveLength(2);
    expect(cell('Thursday, October 22, 2026').getByText('Launch')).toBeInTheDocument();
    expect(cell('Monday, October 26, 2026').getByText('Launch')).toBeInTheDocument();
  });

  it('falls back to the first date column and lists the groups in the legend', () => {
    open();
    expect(screen.getByText('09:30 Write spec')).toBeInTheDocument();
    const legend = within(screen.getByRole('list', { name: 'Legend' }));
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Alpha', 'Beta']);
  });

  it('lists status labels in the legend when coloured by a status column', () => {
    open({ columnId: 'due', colorBy: 'status' });
    const legend = within(screen.getByRole('list', { name: 'Legend' }));
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['To do', 'Done']);
  });

  it('hides the weekend columns', () => {
    open({ columnId: 'due', showWeekends: false });
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.queryByRole('gridcell', { name: 'Saturday, October 24, 2026' })).toBeNull();
  });

  it('applies the search', async () => {
    open({ columnId: 'due' });
    act(() => useTableStore.getState().setSearch('launch'));
    expect(screen.getByText('Launch')).toBeInTheDocument();
    expect(screen.queryByText('09:30 Write spec')).toBeNull();
  });

  it('opens the full item view from a pill, by click and by Enter', async () => {
    open({ columnId: 'due' });
    await userEvent.click(screen.getByRole('button', { name: /Write spec/ }));
    expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'i1');
    mocks.openItemFull.mockReset();
    screen.getByRole('button', { name: /Launch/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'i2');
  });

  it('moves between days with the arrow keys', async () => {
    open({ columnId: 'due' });
    const today = screen.getByRole('gridcell', { name: 'Saturday, October 24, 2026' });
    today.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('gridcell', { name: 'Sunday, October 25, 2026' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('gridcell', { name: 'Sunday, November 1, 2026' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowUp}');
    expect(screen.getByRole('gridcell', { name: 'Saturday, October 24, 2026' })).toHaveFocus();
  });
});

describe('period controls', () => {
  it('goes back, forward and to today', async () => {
    open({ columnId: 'due' });
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    // The period on screen is UI state, never an unsaved view change.
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')])).toBe(false);
  });

  it('switches to week mode (an unsaved view change) and steps by weeks', async () => {
    open({ columnId: 'due' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar mode' }), 'week');
    expect(currentViewState('b1').calendar?.mode).toBe('week');
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')])).toBe(true);
    expect(screen.getByRole('heading', { name: 'Oct 19 – 25, 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('heading', { name: 'Oct 26 – Nov 1, 2026' })).toBeInTheDocument();
    expect(screen.getByText('Launch')).toBeInTheDocument();
  });

  it('keeps each view on its own period', async () => {
    open({ columnId: 'due' });
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(useCalendarUi.getState().anchors[viewKey('b1', 'cv')]).toBe('2026-11-24');
  });
});

describe('adding an item on a day', () => {
  it('creates it in the first group with the date set, then opens it', async () => {
    open({ columnId: 'due' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Add item on Friday, October 23, 2026' }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [uid, boardId, input] = mocks.create.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([uid, boardId]).toEqual(['u1', 'b1']);
    // "Alpha" comes first by position, even though the board lists "Beta" first.
    expect(input).toMatchObject({ groupId: 'g1', values: { due: { date: '2026-10-23' } } });
    await vi.waitFor(() => expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'new-id'));
  });

  it('sets a one-day timeline for a timeline column', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Add item on Friday, October 23, 2026' }),
    );
    expect(mocks.create.mock.calls[0]![2]).toMatchObject({
      values: { plan: { from: '2026-10-23', to: '2026-10-23' } },
    });
  });

  it('adds today from the New item button', async () => {
    open({ columnId: 'due' });
    await userEvent.click(screen.getByRole('button', { name: 'New item' }));
    expect(mocks.create.mock.calls[0]![2]).toMatchObject({
      values: { due: { date: '2026-10-24' } },
    });
  });

  it('is read-only for a viewer: no add buttons, New item disabled, pills not draggable', () => {
    mocks.role = 'viewer';
    open(
      { columnId: 'due' },
      makeBoard({ ...board, access: { u1: 'viewer' }, accessUids: ['u1'] }),
    );
    expect(screen.queryByRole('button', { name: /^Add item on/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'New item' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: /Write spec/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lets an editor drag pills', () => {
    open({ columnId: 'due' });
    expect(screen.getByRole('button', { name: /Write spec/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
});

describe('dragging to another day', () => {
  /** Play a drop of the pill `segmentKey` (grabbed on `grab`) on the cell of `drop`. */
  function drop(
    segmentKey: string,
    itemId: string,
    startDay: string,
    grab: string,
    dropDay: string,
  ) {
    const pill = document.querySelector(`[data-item="${itemId}"]`);
    expect(pill).not.toBeNull();
    act(() => {
      mocks.dnd!.onDragStart?.({
        active: { id: segmentKey, data: { current: { itemId, startDay } } },
        activatorEvent: new Event('pointerdown'),
      });
    });
    void grab;
    act(() => {
      mocks.dnd!.onDragEnd({
        active: { id: segmentKey, data: { current: { itemId, startDay } } },
        over: { id: `day:${dropDay}`, data: { current: { day: dropDay } } },
      });
    });
  }

  it('moves a date to the dropped day through the validated cell write, keeping its time', async () => {
    open({ columnId: 'due' });
    drop('i1@3', 'i1', '2026-10-20', '2026-10-20', '2026-10-23');
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'due', {
      date: '2026-10-23',
      time: '09:30:00',
    });
    // The pill is on its new day at once (an optimistic patch).
    expect(cell('Friday, October 23, 2026').getByText('09:30 Write spec')).toBeInTheDocument();
  });

  it('moves both ends of a timeline by the same number of days', async () => {
    open({ columnId: 'plan' });
    drop('i2@3', 'i2', '2026-10-22', '2026-10-22', '2026-10-21');
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i2', 'plan', {
      from: '2026-10-21',
      to: '2026-10-27',
    });
  });

  it('does nothing when dropped on the day it came from, or outside the grid', () => {
    open({ columnId: 'due' });
    drop('i1@3', 'i1', '2026-10-20', '2026-10-20', '2026-10-20');
    act(() => {
      mocks.dnd!.onDragEnd({
        active: { id: 'i1@3', data: { current: { itemId: 'i1', startDay: '2026-10-20' } } },
        over: null,
      });
    });
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it('refuses the write on a locked column for an editor, and puts the pill back', async () => {
    mocks.role = 'editor';
    const locked = makeBoard({
      ...board,
      access: { u1: 'editor' },
      accessUids: ['u1'],
      columnLocks: ['due'],
    });
    open({ columnId: 'due' }, locked);
    // Locked columns are not draggable at all.
    expect(screen.getByRole('button', { name: /Write spec/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    drop('i1@3', 'i1', '2026-10-20', '2026-10-20', '2026-10-23');
    // The refused write rolls the optimistic move back.
    await vi.waitFor(() =>
      expect(cell('Tuesday, October 20, 2026').getByText('09:30 Write spec')).toBeInTheDocument(),
    );
    expect(mocks.setValue).not.toHaveBeenCalled();
  });
});

describe('overflow and empty states', () => {
  it('shows "+N more" for items that do not fit and lists the day in a popup', async () => {
    mocks.items = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      makeItem({
        id,
        name: `Task ${id}`,
        position: `a${i}`,
        values: { due: { date: '2026-10-21' } },
      }),
    );
    // A 100px-tall week row has room for two bars (the day number and the "+N more" row take the rest).
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    open({ columnId: 'due' });
    const day = cell('Wednesday, October 21, 2026');
    expect(day.getByText('Task b')).toBeInTheDocument();
    expect(day.queryByText('Task c')).toBeNull();
    await userEvent.click(
      day.getByRole('button', { name: '3 more on Wednesday, October 21, 2026' }),
    );
    const popup = within(
      screen.getByRole('dialog', { name: 'Items on Wednesday, October 21, 2026' }),
    );
    expect(popup.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Task a',
      'Task b',
      'Task c',
      'Task d',
      'Task e',
    ]);
    await userEvent.click(popup.getByRole('button', { name: 'Task d' }));
    expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'd');
  });

  it('asks for a date or timeline column when the board has none, with an Add column menu', async () => {
    useFilterStore.getState().syncView('b1', 'cv', defaultViewSettings());
    render(
      <CalendarView board={{ ...board, columns: [column('notes', 'text', 'Notes', 'a0')] }} />,
    );
    expect(screen.getByText('Add a date or timeline column to use this view')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const menu = within(screen.getByRole('dialog', { name: 'Add column' }));
    expect(menu.getAllByRole('button').map((b) => b.textContent)).toEqual(['Date', 'Timeline']);
  });

  it('does not offer to add a column to a viewer', () => {
    mocks.role = 'viewer';
    useFilterStore.getState().syncView('b1', 'cv', defaultViewSettings());
    render(
      <CalendarView
        board={makeBoard({
          ...board,
          columns: [],
          access: { u1: 'viewer' },
          accessUids: ['u1'],
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  });
});

describe('toolbar', () => {
  it('has New item, but no Hide or Group by, and the settings gear', () => {
    open({ columnId: 'due' });
    const toolbar = within(screen.getByRole('toolbar', { name: 'Board tools' }));
    expect(toolbar.getByRole('button', { name: 'New item' })).toBeInTheDocument();
    expect(toolbar.queryByRole('button', { name: /Hide columns/ })).toBeNull();
    expect(toolbar.queryByRole('button', { name: /Group by/ })).toBeNull();
    expect(toolbar.getByRole('button', { name: 'Calendar settings' })).toBeInTheDocument();
  });
});

describe('Calendar settings popover', () => {
  it('changes the column, colours, week start and weekends as unsaved view changes', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Calendar settings' }));
    const panel = within(screen.getByRole('dialog', { name: 'Calendar settings' }));
    const timeColumn = panel.getByRole('combobox', { name: 'Show items by' });
    expect(timeColumn).toHaveValue('due');
    expect(
      within(timeColumn)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Due', 'Plan']);
    await userEvent.selectOptions(timeColumn, 'plan');
    expect(currentViewState('b1').calendar?.columnId).toBe('plan');
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')])).toBe(true);

    const color = panel.getByRole('combobox', { name: 'Colour by' });
    expect(
      within(color)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Group', 'Status']);
    await userEvent.selectOptions(color, 'status');
    expect(currentViewState('b1').calendar?.colorBy).toBe('status');

    await userEvent.selectOptions(
      panel.getByRole('combobox', { name: 'Week starts on' }),
      'sunday',
    );
    expect(currentViewState('b1').calendar?.firstDayOfWeek).toBe('sunday');
    await userEvent.click(panel.getByRole('checkbox', { name: 'Show weekends' }));
    expect(currentViewState('b1').calendar?.showWeekends).toBe(false);
  });

  it('shows "Group" for a colour column that no longer exists', async () => {
    open({ colorBy: 'gone' });
    await userEvent.click(screen.getByRole('button', { name: 'Calendar settings' }));
    expect(screen.getByRole('combobox', { name: 'Colour by' })).toHaveValue('');
  });
});
