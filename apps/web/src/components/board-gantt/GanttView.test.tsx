import {
  columnRegistry,
  defaultGanttSettings,
  defaultViewSettings,
  type ColumnDef,
  type GanttSettings,
} from '@atrium/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, useFilterStore } from '../board-filters';
import { useTableStore } from '../board-table/table-store';
import { useTimelineUi } from '../board-timeline/timeline-store';
import { GanttView } from './GanttView';

const mocks = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../board-table/open-item', () => ({ openItemFull: vi.fn(), openItem: vi.fn() }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  usePresence: () => ({ viewers: [] }),
  updateBoardStructure: vi.fn(),
  itemWrites: {
    create: vi.fn(),
    setValue: vi.fn(),
    setValueAndMove: vi.fn(),
    move: vi.fn(),
    moveMany: vi.fn(),
  },
}));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const group = [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }];

const withDeps = makeBoard({
  id: 'b1',
  columns: [column('plan', 'timeline', 'Plan', 'a0'), column('deps', 'dependency', 'After', 'a1')],
  groups: group,
});
const withBaseline = makeBoard({
  id: 'b1',
  columns: [
    ...withDeps.columns,
    column('base', 'timeline', 'Planned', 'a2'),
    column('due', 'date', 'Due', 'a3'),
  ],
  groups: group,
});
const withoutDeps = makeBoard({
  id: 'b1',
  columns: [column('plan', 'timeline', 'Plan', 'a0')],
  groups: group,
});

const items = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Design',
    groupId: 'g1',
    position: 'a0',
    values: { plan: { from: '2026-10-05', to: '2026-10-12' } },
  }),
  makeItem({
    id: 'i2',
    name: 'Build',
    groupId: 'g1',
    position: 'a1',
    values: { plan: { from: '2026-10-14', to: '2026-10-20' }, deps: { item_ids: ['i1'] } },
  }),
];

function open(board = withDeps, gantt: Partial<GanttSettings> = {}) {
  useFilterStore.getState().syncView('b1', 'gv', {
    ...defaultViewSettings(),
    gantt: { ...defaultGanttSettings(), zoom: 'days', columnId: 'plan', ...gantt },
  });
  return render(<GanttView board={board} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  mocks.items = items();
  useFilterStore.setState({ activeView: {}, views: {} });
  useTimelineUi.setState({ scroll: {}, paneHidden: {}, settingsOpen: {} });
  useTableStore.getState().reset(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GanttView', () => {
  it('draws an arrow for a two-item dependency, from the prerequisite to the dependent', () => {
    const { container } = open();
    expect(screen.getByRole('group', { name: 'Gantt' })).toBeInTheDocument();
    const edge = container.querySelector('[data-edge="i2:i1"]');
    expect(edge).not.toBeNull();
    expect(edge?.getAttribute('data-violated')).toBeNull();
  });

  it('draws the arrow in the violation state, with a tooltip, when the dates overlap', () => {
    mocks.items = [
      makeItem({
        id: 'i1',
        name: 'Design',
        groupId: 'g1',
        position: 'a0',
        values: { plan: { from: '2026-10-05', to: '2026-10-16' } },
      }),
      items()[1]!,
    ];
    const { container } = open();
    const edge = container.querySelector('[data-edge="i2:i1"]');
    expect(edge?.getAttribute('data-violated')).toBe('true');
    expect(edge?.querySelector('title')?.textContent).toBe('Starts before Design finishes');
  });

  it('draws no arrows without a Dependency column', () => {
    const { container } = open(withoutDeps);
    expect(container.querySelector('[data-edge]')).toBeNull();
  });

  it('shows the Gantt settings and changes the Dependency column', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const two = makeBoard({
      ...withDeps,
      columns: [...withDeps.columns, column('deps2', 'dependency', 'Blocked by', 'a2')],
    });
    open(two);
    await user.click(screen.getByRole('button', { name: 'Gantt settings' }));
    expect(screen.getByRole('complementary', { name: 'Gantt settings' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Draw arrows from'), 'deps2');
    expect(currentViewState('b1').gantt?.dependencyColumnId).toBe('deps2');
  });

  it('explains in the settings panel when the board has no Dependency column', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open(withoutDeps);
    await user.click(screen.getByRole('button', { name: 'Gantt settings' }));
    expect(screen.getByText(/Add a Dependency column/)).toBeInTheDocument();
  });

  describe('baseline', () => {
    const baselineItems = (): ItemDoc[] => [
      makeItem({
        ...items()[0]!,
        values: {
          plan: { from: '2026-10-05', to: '2026-10-12' },
          base: { from: '2026-10-03', to: '2026-10-09' },
        },
      }),
      items()[1]!,
    ];

    it('draws a thin bar for items with a baseline value, and the header toggle hides it', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mocks.items = baselineItems();
      const { container } = open(withBaseline, { baselineColumnId: 'base', showBaseline: true });
      expect(container.querySelector('[data-baseline="i1"]')).not.toBeNull();
      expect(container.querySelector('[data-baseline="i2"]')).toBeNull();
      const toggle = screen.getByRole('button', { name: 'Baseline' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await user.click(toggle);
      expect(currentViewState('b1').gantt?.showBaseline).toBe(false);
      expect(container.querySelector('[data-baseline]')).toBeNull();
    });

    it('has no baseline or toggle without a baseline column', () => {
      mocks.items = baselineItems();
      const { container } = open(withBaseline);
      expect(container.querySelector('[data-baseline]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Baseline' })).toBeNull();
    });

    it('offers only other Timeline or Date columns in the settings and saves the choice', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      open(withBaseline);
      await user.click(screen.getByRole('button', { name: 'Gantt settings' }));
      const select = screen.getByLabelText('Planned dates in');
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['None', 'Planned', 'Due']);
      await user.selectOptions(select, 'base');
      expect(currentViewState('b1').gantt?.baselineColumnId).toBe('base');
    });
  });

  describe('critical path', () => {
    it('marks the arrows and bars of the longest chain, toggled from the header', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { container } = open();
      expect(container.querySelector('[data-edge][data-critical]')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Critical path' }));
      expect(currentViewState('b1').gantt?.showCriticalPath).toBe(true);
      expect(container.querySelector('[data-edge="i2:i1"]')?.getAttribute('data-critical')).toBe(
        'true',
      );
      expect(container.querySelector('[data-item="i1"]')?.getAttribute('data-critical')).toBe(
        'true',
      );
      expect(container.querySelector('[data-item="i2"]')?.getAttribute('data-critical')).toBe(
        'true',
      );
    });

    it('toggles from the settings panel and warns about a dependency loop', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mocks.items = [
        makeItem({ ...items()[0]!, values: { ...items()[0]!.values, deps: { item_ids: ['i2'] } } }),
        items()[1]!,
      ];
      const { container } = open(withDeps, { showCriticalPath: false });
      await user.click(screen.getByRole('button', { name: 'Gantt settings' }));
      expect(screen.queryByRole('status')).toBeNull();
      await user.click(screen.getByRole('checkbox', { name: 'Show critical path' }));
      expect(currentViewState('b1').gantt?.showCriticalPath).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent(/form a loop/);
      expect(container.querySelector('[data-critical]')).toBeNull();
    });
  });
});
