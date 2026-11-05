import { defaultWidgetSettings, type DashboardWidget } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardDoc } from '../../data';
import { makeBoard, makeDashboard, makeItem, makeWorkspace } from '../../test/fixtures';
import { useUiStore } from '../AppShell/ui-store';
import { DashboardPage } from './DashboardPage';
import { column, statusColumn } from './widgets/widget-test-data';

const mocks = vi.hoisted(() => ({
  dashboard: null as unknown,
  loading: false,
  role: 'owner' as string,
  items: {
    boards: [] as unknown[],
    entries: [],
    unreadableBoardIds: [] as string[],
    inactiveBoardIds: [],
    loading: false,
    error: null as Error | null,
    truncatedFrom: 0,
    retry: vi.fn(),
  },
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, rememberWorkspace: vi.fn() }),
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useDashboard: () => ({ data: mocks.dashboard, loading: mocks.loading, error: null }),
  useWorkspace: () => ({
    data: makeWorkspace({ id: 'w1', roles: { u1: mocks.role as 'owner' } }),
    loading: false,
    error: null,
  }),
  useDashboardItems: () => mocks.items,
  dashboardWrites: {
    updateDashboard: vi.fn(),
    setWidgetLayouts: vi.fn().mockResolvedValue(undefined),
    duplicateWidget: vi.fn(),
    removeWidget: vi.fn(),
    setDashboardState: vi.fn(),
  },
}));

const widget = (id: string, type: 'numbers' | 'battery', title: string): DashboardWidget =>
  ({
    id,
    type,
    title,
    layout: { x: id === 'n1' ? 0 : 3, y: 0, w: 3, h: 3 },
    boardIds: [],
    settings: defaultWidgetSettings(type),
  }) as DashboardWidget;

const sales = makeBoard({
  id: 'b1',
  name: 'Sales',
  columns: [column('amount', 'numbers', 'Amount'), statusColumn('status')],
});

function renderPage(dashboard: DashboardDoc | null) {
  mocks.dashboard = dashboard;
  render(
    <MemoryRouter initialEntries={['/dashboards/d1']}>
      <Routes>
        <Route path="/dashboards/:dashboardId" element={<DashboardPage />} />
        <Route path="*" element={<p>other page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useUiStore.setState({ dialog: null });
  mocks.loading = false;
  mocks.role = 'owner';
  mocks.items = {
    boards: [],
    entries: [],
    unreadableBoardIds: [],
    inactiveBoardIds: [],
    loading: false,
    error: null,
    truncatedFrom: 0,
    retry: vi.fn(),
  };
});

describe('DashboardPage', () => {
  it('shows a spinner while the dashboard loads', () => {
    mocks.loading = true;
    renderPage(null);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the not-found page for a missing or unreadable dashboard', () => {
    renderPage(null);
    expect(screen.getByText("We couldn't find that page")).toBeInTheDocument();
  });

  it('asks for boards first when the dashboard reads none', async () => {
    renderPage(makeDashboard({ id: 'd1', name: 'Team overview' }));
    expect(screen.getByText('Team overview')).toBeInTheDocument();
    expect(screen.getByText('Choose the boards this dashboard reads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add widget' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose boards' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'dashboardBoards', dashboardId: 'd1' });
  });

  it('invites to add a first widget once boards are chosen', async () => {
    mocks.items.boards = [{ board: sales, items: [] }];
    renderPage(makeDashboard({ id: 'd1', boardIds: ['b1'] }));
    expect(screen.getByText('Add your first widget')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add widget' })[0]!);
    expect(await screen.findByRole('radio', { name: /Numbers/ })).toBeInTheDocument();
  });

  it('renders Numbers and Battery widgets from live items', () => {
    mocks.items.boards = [
      {
        board: sales,
        items: [
          makeItem({ id: 'i1', values: { status: { index: 1 } } }),
          makeItem({ id: 'i2', values: { status: { index: 0 } } }),
        ],
      },
    ];
    renderPage(
      makeDashboard({
        id: 'd1',
        boardIds: ['b1'],
        widgets: [widget('n1', 'numbers', 'Open items'), widget('bat', 'battery', 'Progress')],
      }),
    );
    expect(screen.getByRole('group', { name: '2 items: 2' })).toHaveTextContent('2');
    expect(screen.getByText('50% done')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Dashboard widgets' })).toBeInTheDocument();
  });

  it('says how many boards are hidden because the user cannot open them', () => {
    mocks.items.boards = [{ board: sales, items: [] }];
    mocks.items.unreadableBoardIds = ['x'];
    renderPage(
      makeDashboard({ id: 'd1', boardIds: ['b1', 'x'], widgets: [widget('n1', 'numbers', 'N')] }),
    );
    expect(screen.getByText("1 board you can't access is hidden.")).toBeInTheDocument();
  });

  it('offers a retry when none of the boards could be read', async () => {
    mocks.items.error = new Error('nope');
    renderPage(makeDashboard({ id: 'd1', boardIds: ['b1'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.items.retry).toHaveBeenCalled();
  });

  it('is read-only for viewers', () => {
    mocks.role = 'guest';
    mocks.items.boards = [{ board: sales, items: [] }];
    renderPage(
      makeDashboard({
        id: 'd1',
        kind: 'private',
        access: { u1: 'viewer' },
        boardIds: ['b1'],
        widgets: [widget('n1', 'numbers', 'Open items')],
      }),
    );
    expect(screen.getByRole('button', { name: 'Add widget' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
  });

  it('offers owners to restore a deleted dashboard', async () => {
    renderPage(makeDashboard({ id: 'd1', state: 'deleted' }));
    expect(screen.getByText('This dashboard was deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore dashboard' })).toBeInTheDocument(),
    );
  });
});
