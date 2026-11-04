import {
  columnRegistry,
  defaultGanttSettings,
  defaultViewSettings,
  type ColumnDef,
  type GanttSettings,
} from '@atrium/shared';
import { render, screen } from '@testing-library/react';
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
});
