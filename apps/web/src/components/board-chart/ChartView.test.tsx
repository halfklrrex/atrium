import {
  columnRegistry,
  defaultChartSettings,
  defaultViewSettings,
  type ChartSettings,
  type ColumnDef,
} from '@atrium/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { currentViewState, isViewDirty, useFilterStore, viewKey } from '../board-filters';
import { useTableStore } from '../board-table/table-store';
import { useChartUi } from './chart-store';
import { ChartView } from './ChartView';

const mocks = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  useUserLookup: () => (uid: string) => (uid === 'u1' ? { name: 'Avery Quinn' } : undefined),
  usePresence: () => ({ viewers: [] }),
  updateBoardStructure: vi.fn(),
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

const board = makeBoard({
  id: 'b1',
  columns: [
    column('status', 'status', 'Status', 'a0', {
      labels: [
        { id: 'todo', index: 0, label: 'To do', color: '#579bfc' },
        { id: 'done', index: 1, label: 'Done', color: '#00c875' },
      ],
    }),
    column('budget', 'numbers', 'Budget', 'a1'),
  ],
  groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
});

const sample = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Design',
    position: 'a0',
    values: { status: { index: 0 }, budget: 10 },
  }),
  makeItem({
    id: 'i2',
    name: 'Build',
    position: 'a1',
    values: { status: { index: 1 }, budget: 30 },
  }),
  makeItem({ id: 'i3', name: 'Ship', position: 'a2', values: { status: { index: 1 } } }),
];

function open(chart: Partial<ChartSettings> = {}) {
  useFilterStore.getState().syncView('b1', 'cv', {
    ...defaultViewSettings(),
    chart: { ...defaultChartSettings(), ...chart },
  });
  return render(<ChartView board={board} />);
}

beforeEach(() => {
  mocks.items = sample();
  useFilterStore.setState({ activeView: {}, views: {} });
  useChartUi.setState({ settingsOpen: {} });
  useTableStore.getState().reset(null);
});

describe('ChartView', () => {
  it('draws a bar chart with a summary, a title, a legend and a table for screen readers', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Items by Status' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Bar chart, items by Status: To do 1, Done 2',
    );
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('Done', { selector: 'td' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(3);
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument();
    expect(document.querySelectorAll('rect')).toHaveLength(2);
  });

  it('hides the legend when the settings say so', () => {
    open({ showLegend: false });
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });

  it('draws values above the bars, unless they are switched off', () => {
    const { unmount } = open();
    expect(document.querySelectorAll('text[class*=valueText]')).toHaveLength(2);
    unmount();
    useFilterStore.setState({ activeView: {}, views: {} });
    open({ showValues: false });
    expect(document.querySelectorAll('text[class*=valueText]')).toHaveLength(0);
  });

  it.each([
    ['line', 'path'],
    ['pie', 'path'],
    ['donut', 'path'],
    ['stacked_bar', 'rect'],
  ] as const)('draws a %s chart', (chartType, tag) => {
    open({ chartType });
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/chart, items by Status/);
    expect(document.querySelectorAll(`svg ${tag}`).length).toBeGreaterThan(0);
  });

  it('shows the total in the middle of a donut', () => {
    open({ chartType: 'donut' });
    expect(screen.getAllByText('3', { selector: 'text' }).length).toBeGreaterThan(0);
  });

  it('shows a tooltip while a bar is hovered', () => {
    open();
    const bar = document.querySelectorAll('rect')[1]!;
    fireEvent.pointerEnter(bar, { clientX: 10, clientY: 10 });
    expect(screen.getByText('Done · 2 items · 67%')).toBeInTheDocument();
    fireEvent.pointerLeave(bar);
    expect(screen.queryByText('Done · 2 items · 67%')).toBeNull();
  });

  it('measures Budget by status with a sum', () => {
    open({ yMode: 'sum', yColumnId: 'budget' });
    expect(screen.getByRole('heading', { name: 'Sum of Budget by Status' })).toBeInTheDocument();
  });

  it('says so when there is nothing to chart', () => {
    mocks.items = [];
    open();
    expect(screen.getByText('No items to chart')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('opens the settings from the toolbar gear, and a change is an unsaved view change', () => {
    open();
    expect(screen.queryByRole('complementary', { name: 'Chart settings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }));
    const panel = screen.getByRole('complementary', { name: 'Chart settings' });
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')])).toBe(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'Donut' }));
    expect(currentViewState('b1').chart?.chartType).toBe('donut');
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'cv')])).toBe(true);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^Donut chart/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close chart settings' }));
    expect(screen.queryByRole('complementary', { name: 'Chart settings' })).toBeNull();
  });

  it('has Search, Person and Filter in the toolbar, but no New item or Sort', () => {
    open();
    const toolbar = screen.getByRole('toolbar', { name: 'Board tools' });
    expect(within(toolbar).getByRole('button', { name: /Search/ })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: /New item/ })).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: /Sort/ })).toBeNull();
  });
});
