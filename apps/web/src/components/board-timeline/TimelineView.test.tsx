import {
  columnRegistry,
  defaultTimelineViewSettings,
  defaultViewSettings,
  type ColumnDef,
  type TimelineViewSettings,
} from '@atrium/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, isViewDirty, useFilterStore, viewKey } from '../board-filters';
import { useItemViewStore } from '../item-view/item-view-store';
import { useTableStore } from '../board-table/table-store';
import { useTimelineUi } from './timeline-store';
import { TimelineView } from './TimelineView';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  role: 'owner',
  create: vi.fn(),
  setValue: vi.fn(),
  openItemFull: vi.fn(),
  visible: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../board-table/open-item', () => ({
  openItemFull: mocks.openItemFull,
  openItem: vi.fn(),
}));
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
    { id: 'g3', title: 'Unused', color: '#ff642e', position: 'a2' },
  ],
});

const sample = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Design',
    groupId: 'g1',
    position: 'a0',
    values: {
      plan: { from: '2026-10-05', to: '2026-10-12' },
      due: { date: '2026-10-12' },
      status: { index: 0 },
    },
  }),
  makeItem({
    id: 'i2',
    name: 'Build',
    groupId: 'g1',
    position: 'a1',
    values: { plan: { from: '2026-10-10', to: '2026-10-20' } },
  }),
  makeItem({
    id: 'i3',
    name: 'Ship',
    groupId: 'g2',
    position: 'a2',
    values: { plan: { from: '2026-10-25', to: '2026-10-30' } },
  }),
  makeItem({ id: 'i4', name: 'Undated', groupId: 'g2', position: 'a3', values: {} }),
];

function open(timeline: Partial<TimelineViewSettings> = {}, shown = board) {
  useFilterStore.getState().syncView('b1', 'tv', {
    ...defaultViewSettings(),
    timeline: { ...defaultTimelineViewSettings(), zoom: 'days', ...timeline },
  });
  return render(<TimelineView board={shown} />);
}

const bar = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });

beforeEach(() => {
  // A fixed "today" (Saturday 24 October 2026).
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  mocks.items = sample();
  mocks.role = 'owner';
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.openItemFull.mockReset();
  useFilterStore.setState({ activeView: {}, views: {} });
  useTimelineUi.setState({ scroll: {}, paneHidden: {}, settingsOpen: {} });
  useTableStore.getState().reset(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimelineView layout', () => {
  it('shows a lane per group with dated items, in board order', () => {
    open({ columnId: 'plan' });
    const lanes = screen.getAllByRole('button', { name: /, (expanded|collapsed)$/ });
    expect(lanes.map((l) => l.getAttribute('aria-label'))).toEqual([
      'Alpha, expanded',
      'Beta, expanded',
    ]);
    expect(screen.queryByRole('button', { name: /^Unused/ })).toBeNull();
    expect(screen.queryByText('Undated')).toBeNull();
  });

  it('draws the group summary: name, range and days', () => {
    open({ columnId: 'plan' });
    const alpha = within(document.querySelector('[data-group="g1"]') as HTMLElement);
    expect(alpha.getByText('Oct 5 - 20')).toBeInTheDocument();
    expect(alpha.getByText('16 days')).toBeInTheDocument();
  });

  it('hides the summary when turned off', () => {
    open({ columnId: 'plan', showGroupSummary: false });
    expect(screen.queryByText('16 days')).toBeNull();
  });

  it('puts overlapping items on separate rows', () => {
    open({ columnId: 'plan' });
    const rowOf = (name: string) =>
      Number((bar(name) as HTMLElement).style.getPropertyValue('--tl-row'));
    expect(rowOf('Design')).toBe(1);
    expect(rowOf('Build')).toBe(2);
  });

  it('shows the two header rows: months over days, with today marked', () => {
    open({ columnId: 'plan' });
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    const today = document.querySelector('[aria-current="date"]') as HTMLElement;
    expect(today).toHaveTextContent('Sa 24');
  });

  it('labels weeks "W43 19 - 25" at the weeks zoom', () => {
    open({ columnId: 'plan', zoom: 'weeks' });
    expect(screen.getByText('W43 19 - 25')).toBeInTheDocument();
  });

  it('draws the today line and leaves it out when turned off', () => {
    const { unmount } = open({ columnId: 'plan' });
    expect(document.querySelector('[data-today="true"]')).not.toBeNull();
    unmount();
    open({ columnId: 'plan', showToday: false });
    expect(document.querySelector('[data-today="true"]')).toBeNull();
    expect(document.querySelector('[aria-current="date"]')).toBeNull();
  });

  it('lists the groups in the legend, or the status labels, and can hide it', () => {
    const { unmount } = open({ columnId: 'plan' });
    const legend = within(screen.getByRole('list', { name: 'Legend' }));
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Unused',
    ]);
    unmount();
    const second = open({ columnId: 'plan', colorBy: 'status' });
    expect(
      within(screen.getByRole('list', { name: 'Legend' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['To do', 'Done']);
    second.unmount();
    open({ columnId: 'plan', showLegend: false });
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });

  it('falls back to the first timeline column when none is saved', () => {
    open();
    expect(screen.getByRole('button', { name: 'Design, Oct 5 to Oct 12' })).toBeInTheDocument();
  });

  it('draws a date item as a one-day bar', () => {
    open({ columnId: 'due' });
    expect(bar('Design').getAttribute('aria-label')).toBe('Design, Monday, October 12, 2026');
  });

  it('applies the search', () => {
    open({ columnId: 'plan' });
    useTableStore.getState().setSearch('ship');
    return vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^Ship,/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Design,/ })).toBeNull();
    });
  });

  it('feeds the visible items to the full item view, lane by lane', () => {
    open({ columnId: 'plan' });
    expect(useItemViewStore.getState().visible['b1']).toEqual([
      { groupId: 'g1', ids: ['i1', 'i2'] },
      { groupId: 'g2', ids: ['i3'] },
    ]);
  });
});

describe('collapsing lanes', () => {
  it('collapses and expands a lane from its name, as an unsaved view change', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(screen.getByRole('button', { name: 'Alpha, expanded' }));
    expect(currentViewState('b1').timeline?.collapsedGroupIds).toEqual(['g1']);
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'tv')])).toBe(true);
    // Only the summary row is left: the items are gone, the summary stays.
    expect(screen.queryByRole('button', { name: /^Design,/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Alpha, collapsed' })).toBeInTheDocument();
    expect(screen.getByText('16 days')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alpha, collapsed' }));
    expect(currentViewState('b1').timeline?.collapsedGroupIds).toEqual([]);
    expect(screen.getByRole('button', { name: /^Design,/ })).toBeInTheDocument();
  });

  it('collapses and expands every lane at once', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all groups' }));
    expect(currentViewState('b1').timeline?.collapsedGroupIds).toEqual(['g1', 'g2']);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all groups' }));
    expect(currentViewState('b1').timeline?.collapsedGroupIds).toEqual([]);
  });

  it('hides and shows the group-name pane (UI state, not a view change)', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(screen.getByRole('button', { name: 'Hide group names' }));
    expect(screen.queryByRole('button', { name: 'Alpha, expanded' })).toBeNull();
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'tv')])).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show group names' }));
    expect(screen.getByRole('button', { name: 'Alpha, expanded' })).toBeInTheDocument();
  });
});

describe('toolbar and zoom', () => {
  it('has New item, Today, the zoom and the settings gear, but no Hide or Group by', () => {
    open({ columnId: 'plan' });
    const toolbar = within(screen.getByRole('toolbar', { name: 'Board tools' }));
    expect(toolbar.getByRole('button', { name: 'New item' })).toBeInTheDocument();
    expect(toolbar.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(toolbar.getByRole('combobox', { name: 'Timeline zoom' })).toHaveValue('days');
    expect(toolbar.getByRole('button', { name: 'Timeline settings' })).toBeInTheDocument();
    expect(toolbar.queryByRole('button', { name: /Hide columns/ })).toBeNull();
    expect(toolbar.queryByRole('button', { name: /Group by/ })).toBeNull();
  });

  it('changes the zoom (an unsaved view change)', async () => {
    open({ columnId: 'plan' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Timeline zoom' }),
      'months',
    );
    expect(currentViewState('b1').timeline?.zoom).toBe('months');
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'tv')])).toBe(true);
    expect(screen.getByText('Oct')).toBeInTheDocument();
  });

  it('scrolls to today from the Today button', async () => {
    open({ columnId: 'plan' });
    const scroll = document.querySelector('[class*="scroll"]') as HTMLElement;
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('remembers the scroll position per view for the session', () => {
    open({ columnId: 'plan' });
    const scroll = document.querySelector('[class*="scroll"]') as HTMLElement;
    scroll.scrollLeft = 300;
    fireEvent.scroll(scroll);
    expect(useTimelineUi.getState().scroll[viewKey('b1', 'tv')]).toEqual({ left: 300, top: 0 });
  });
});

describe('opening items', () => {
  it('opens the full item view from a bar, by click and by Enter', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(bar('Design'));
    expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'i1');
    mocks.openItemFull.mockReset();
    bar('Ship').focus();
    await userEvent.keyboard('{Enter}');
    expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'i3');
  });
});

describe('adding an item', () => {
  it('adds today from New item, in the first group, with a one-day timeline', async () => {
    open({ columnId: 'plan' });
    await userEvent.click(screen.getByRole('button', { name: 'New item' }));
    const [uid, boardId, input] = mocks.create.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([uid, boardId]).toEqual(['u1', 'b1']);
    expect(input).toMatchObject({
      groupId: 'g1',
      values: { plan: { from: '2026-10-24', to: '2026-10-24' } },
    });
    await vi.waitFor(() => expect(mocks.openItemFull).toHaveBeenCalledWith('b1', 'new-id'));
  });

  it('sets a date for a date column', async () => {
    open({ columnId: 'due' });
    await userEvent.click(screen.getByRole('button', { name: 'New item' }));
    expect(mocks.create.mock.calls[0]![2]).toMatchObject({
      values: { due: { date: '2026-10-24' } },
    });
  });
});

describe('moving and resizing with the pointer', () => {
  // A day is 40px wide at the days zoom (jsdom has no layout, so the model's own width is used).
  const DAY = 40;

  function drag(target: HTMLElement, dx: number) {
    fireEvent.pointerDown(target, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(target, { clientX: 100 + dx, pointerId: 1 });
  }

  it('moves a bar by whole days and writes through the validated cell write', async () => {
    open({ columnId: 'plan' });
    const element = bar('Ship');
    drag(element, 3 * DAY + 10);
    // While dragging: a tooltip with the new range, and the bar moves by transform.
    expect(within(element).getByRole('status')).toHaveTextContent('Oct 28 - Nov 2');
    expect(element.style.transform).toBe(`translate3d(${3 * DAY}px, 0, 0)`);
    fireEvent.pointerUp(element, { clientX: 100 + 3 * DAY + 10, pointerId: 1 });
    // The click the browser sends after the drag must not open the item.
    fireEvent.click(element);
    expect(mocks.openItemFull).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i3', 'plan', {
      from: '2026-10-28',
      to: '2026-11-02',
    });
    // The bar is on its new dates at once (an optimistic patch).
    expect(screen.getByRole('button', { name: 'Ship, Oct 28 to Nov 2' })).toBeInTheDocument();
  });

  it('resizes from the right edge and the left edge', async () => {
    open({ columnId: 'plan' });
    const end = bar('Ship').querySelector('[data-handle="end"]') as HTMLElement;
    drag(end, 2 * DAY);
    fireEvent.pointerUp(end, { clientX: 100 + 2 * DAY, pointerId: 1 });
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenLastCalledWith('u1', 'b1', 'i3', 'plan', {
      from: '2026-10-25',
      to: '2026-11-01',
    });

    const start = bar('Design').querySelector('[data-handle="start"]') as HTMLElement;
    drag(start, -2 * DAY);
    fireEvent.pointerUp(start, { clientX: 100 - 2 * DAY, pointerId: 1 });
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(2));
    expect(mocks.setValue).toHaveBeenLastCalledWith('u1', 'b1', 'i1', 'plan', {
      from: '2026-10-03',
      to: '2026-10-12',
    });
  });

  it('never drags an end past the other one', async () => {
    open({ columnId: 'plan' });
    const end = bar('Ship').querySelector('[data-handle="end"]') as HTMLElement;
    drag(end, -20 * DAY);
    fireEvent.pointerUp(end, { clientX: 100 - 20 * DAY, pointerId: 1 });
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i3', 'plan', {
      from: '2026-10-25',
      to: '2026-10-25',
    });
  });

  it('treats a small movement as a click, not a drag', async () => {
    open({ columnId: 'plan' });
    const element = bar('Ship');
    drag(element, 2);
    fireEvent.pointerUp(element, { clientX: 102, pointerId: 1 });
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(element.style.transform).toBe('');
  });

  it('cancels a drag on pointer cancel', () => {
    open({ columnId: 'plan' });
    const element = bar('Ship');
    drag(element, 3 * DAY);
    fireEvent.pointerCancel(element, { pointerId: 1 });
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(element.style.transform).toBe('');
  });

  it('moves a date bar but gives it no resize handles', async () => {
    open({ columnId: 'due' });
    const element = bar('Design');
    expect(element.querySelector('[data-handle]')).toBeNull();
    drag(element, -2 * DAY);
    fireEvent.pointerUp(element, { clientX: 100 - 2 * DAY, pointerId: 1 });
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'due', { date: '2026-10-10' });
  });

  it('puts the bar back when the write is refused', async () => {
    mocks.setValue.mockRejectedValue(new Error('denied'));
    open({ columnId: 'plan' });
    const element = bar('Ship');
    drag(element, 3 * DAY);
    fireEvent.pointerUp(element, { clientX: 100 + 3 * DAY, pointerId: 1 });
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ship, Oct 25 to Oct 30' })).toBeInTheDocument(),
    );
  });

  it('does not drag for a viewer or on a locked column', () => {
    mocks.role = 'viewer';
    const viewer = makeBoard({ ...board, access: { u1: 'viewer' }, accessUids: ['u1'] });
    const { unmount } = open({ columnId: 'plan' }, viewer);
    const element = bar('Ship');
    expect(element.querySelector('[data-handle]')).toBeNull();
    expect(element).not.toHaveAttribute('aria-description');
    drag(element, 3 * DAY);
    fireEvent.pointerUp(element, { clientX: 100 + 3 * DAY, pointerId: 1 });
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'New item' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    unmount();

    mocks.role = 'editor';
    const locked = makeBoard({
      ...board,
      access: { u1: 'editor' },
      accessUids: ['u1'],
      columnLocks: ['plan'],
    });
    open({ columnId: 'plan' }, locked);
    const lockedBar = bar('Ship');
    expect(lockedBar.querySelector('[data-handle]')).toBeNull();
    drag(lockedBar, 3 * DAY);
    fireEvent.pointerUp(lockedBar, { clientX: 100 + 3 * DAY, pointerId: 1 });
    expect(mocks.setValue).not.toHaveBeenCalled();
  });
});

describe('moving and resizing with the keyboard', () => {
  it('moves a bar a day with the arrows', async () => {
    open({ columnId: 'plan' });
    bar('Ship').focus();
    await userEvent.keyboard('{ArrowRight}');
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenLastCalledWith('u1', 'b1', 'i3', 'plan', {
      from: '2026-10-26',
      to: '2026-10-31',
    });
  });

  it('changes the end with Shift and the start with Alt', async () => {
    open({ columnId: 'plan' });
    bar('Ship').focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(1));
    expect(mocks.setValue).toHaveBeenLastCalledWith('u1', 'b1', 'i3', 'plan', {
      from: '2026-10-25',
      to: '2026-10-31',
    });
    bar('Design').focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await vi.waitFor(() => expect(mocks.setValue).toHaveBeenCalledTimes(2));
    expect(mocks.setValue).toHaveBeenLastCalledWith('u1', 'b1', 'i1', 'plan', {
      from: '2026-10-04',
      to: '2026-10-12',
    });
  });

  it('explains the keys to editors', () => {
    open({ columnId: 'plan' });
    expect(bar('Ship').getAttribute('aria-description')).toMatch(/Shift/);
    expect(bar('Ship').getAttribute('aria-roledescription')).toBe('timeline item');
  });
});

describe('empty states', () => {
  it('asks for a date or timeline column when the board has none, with an Add column menu', async () => {
    useFilterStore.getState().syncView('b1', 'tv', defaultViewSettings());
    render(
      <TimelineView board={{ ...board, columns: [column('notes', 'text', 'Notes', 'a0')] }} />,
    );
    expect(screen.getByText('Add a date or timeline column to use this view')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const menu = within(screen.getByRole('dialog', { name: 'Add column' }));
    expect(menu.getAllByRole('button').map((b) => b.textContent)).toEqual(['Date', 'Timeline']);
  });

  it('says so when no item has a date', () => {
    mocks.items = [makeItem({ id: 'x', name: 'Undated', values: {} })];
    open({ columnId: 'plan' });
    expect(screen.getByText(/No item has a date in Plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undated/ })).toBeNull();
  });
});

describe('Timeline settings panel', () => {
  async function openPanel() {
    await userEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    return within(screen.getByRole('complementary', { name: 'Timeline settings' }));
  }

  it('opens as a side panel next to the timeline and closes again', async () => {
    open({ columnId: 'plan' });
    const panel = await openPanel();
    expect(screen.getByRole('toolbar', { name: 'Board tools' })).toBeInTheDocument();
    // The timeline is still there (the panel pushes it narrower, it does not cover it).
    expect(screen.getByRole('group', { name: 'Timeline' })).toBeInTheDocument();
    await userEvent.click(panel.getByRole('button', { name: 'Close timeline settings' }));
    expect(screen.queryByRole('complementary', { name: 'Timeline settings' })).toBeNull();
  });

  it('changes the column and colours as unsaved view changes', async () => {
    open();
    const panel = await openPanel();
    const timeColumn = panel.getByRole('combobox', { name: 'Show items by' });
    expect(timeColumn).toHaveValue('plan');
    expect(
      within(timeColumn)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Due', 'Plan']);
    await userEvent.selectOptions(timeColumn, 'due');
    expect(currentViewState('b1').timeline?.columnId).toBe('due');
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'tv')])).toBe(true);

    const color = panel.getByRole('combobox', { name: 'Colour items by' });
    expect(
      within(color)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Group', 'Status']);
    await userEvent.selectOptions(color, 'status');
    expect(currentViewState('b1').timeline?.colorBy).toBe('status');
  });

  it('toggles the summary, today, weekends and legend', async () => {
    open({ columnId: 'plan' });
    const panel = await openPanel();
    for (const [label, key] of [
      ['Show group summary', 'showGroupSummary'],
      ['Show today indication', 'showToday'],
      ['Show weekends', 'showWeekends'],
      ['Show colour legend', 'showLegend'],
    ] as const) {
      await userEvent.click(panel.getByRole('checkbox', { name: label }));
      expect(currentViewState('b1').timeline?.[key]).toBe(false);
    }
  });

  it('collapses its sections', async () => {
    open({ columnId: 'plan' });
    const panel = await openPanel();
    await userEvent.click(panel.getByRole('button', { name: 'View settings' }));
    expect(panel.queryByRole('checkbox', { name: 'Show weekends' })).toBeNull();
  });

  it('drops the weekend days from the axis', async () => {
    open({ columnId: 'plan', showWeekends: false });
    expect(screen.queryByText('Sa 24')).toBeNull();
    expect(screen.getByText('Fr 23')).toBeInTheDocument();
  });

  it('shows "Group" for a colour column that no longer exists', async () => {
    open({ colorBy: 'gone' });
    const panel = await openPanel();
    expect(panel.getByRole('combobox', { name: 'Colour items by' })).toHaveValue('');
  });
});
