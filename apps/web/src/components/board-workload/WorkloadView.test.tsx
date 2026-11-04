import {
  columnRegistry,
  defaultViewSettings,
  defaultWorkloadSettings,
  type ColumnDef,
  type WorkloadSettings,
} from '@atrium/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, useFilterStore } from '../board-filters';
import { useTableStore } from '../board-table/table-store';
import { useTimelineUi } from '../board-timeline/timeline-store';
import { WorkloadView } from './WorkloadView';

const mocks = vi.hoisted(() => ({ items: [] as unknown[], open: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../board-table/open-item', () => ({ openItemFull: mocks.open, openItem: vi.fn() }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  useUserLookup: () => (uid: string) => ({ name: uid === 'u1' ? 'Avery Quinn' : 'Mika Lane' }),
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
const full = makeBoard({
  id: 'b1',
  columns: [
    column('who', 'people', 'Owner', 'a0'),
    column('plan', 'timeline', 'Plan', 'a1'),
    column('st', 'status', 'Status', 'a2'),
  ],
  groups: group,
});
const noDate = makeBoard({
  id: 'b1',
  columns: [column('who', 'people', 'Owner', 'a0')],
  groups: group,
});

const items = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Design',
    values: {
      plan: { from: '2026-10-26', to: '2026-10-27' },
      who: { personsAndTeams: [{ id: 'u1', kind: 'person' }] },
    },
  }),
  makeItem({
    id: 'i2',
    name: 'Review',
    position: 'a1',
    values: {
      plan: { from: '2026-10-27', to: '2026-10-27' },
      who: { personsAndTeams: [{ id: 'u1', kind: 'person' }] },
    },
  }),
  makeItem({ id: 'i3', name: 'Someday', position: 'a2', values: {} }),
];

function open(board = full, workload: Partial<WorkloadSettings> = {}) {
  useFilterStore.getState().syncView('b1', 'wv', {
    ...defaultViewSettings(),
    workload: { ...defaultWorkloadSettings(), zoom: 'days', ...workload },
  });
  return render(<WorkloadView board={board} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 24, 12, 0, 0) });
  mocks.items = items();
  mocks.open.mockClear();
  useFilterStore.setState({ activeView: {}, views: {} });
  useTimelineUi.setState({ scroll: {}, paneHidden: {}, settingsOpen: {} });
  useTableStore.getState().reset(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WorkloadView', () => {
  it('renders a row per person plus Unassigned, with the load of each day', () => {
    open();
    expect(screen.getByRole('grid', { name: 'Workload' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Avery Quinn/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Unassigned/ })).toBeInTheDocument();
    // Both items overlap on Tue 27: two items against a capacity of one is over.
    const over = screen.getByRole('button', { name: /Avery Quinn, .*October 27.*over capacity/ });
    expect(over).toHaveTextContent('2');
    const balanced = screen.getByRole('button', { name: /Avery Quinn, .*October 26.*balanced/ });
    expect(balanced).toHaveTextContent('1');
  });

  it('opens a popover with the items of a cell and opens an item card from it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open();
    await user.click(screen.getByRole('button', { name: /Avery Quinn, .*October 27/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Design')).toBeInTheDocument();
    expect(within(dialog).getByText('Review')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Review/ }));
    expect(mocks.open).toHaveBeenCalledWith('b1', 'i2');
  });

  it('lists the items without dates', () => {
    open();
    const strip = screen.getByRole('region', { name: 'No dates' });
    expect(within(strip).getByRole('button', { name: 'Someday' })).toBeInTheDocument();
  });

  it('asks for a date or timeline column when the board has none', () => {
    open(noDate);
    expect(screen.getByText(/Add a date or timeline column/)).toBeInTheDocument();
  });

  it('shows the settings panel and changes the capacity', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open();
    await user.click(screen.getByRole('button', { name: 'Workload settings' }));
    expect(screen.getByRole('complementary', { name: 'Workload settings' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Capacity per person per day'), '2');
    expect(currentViewState('b1').workload?.capacityPerDay).toBe(2);
  });

  it('explains the missing People column in the settings panel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open(
      makeBoard({ id: 'b1', columns: [column('plan', 'timeline', 'Plan', 'a0')], groups: group }),
    );
    await user.click(screen.getByRole('button', { name: 'Workload settings' }));
    expect(screen.getByText(/Add a People column/)).toBeInTheDocument();
  });
});
