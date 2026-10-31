import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem, makeWorkspace } from '../test/fixtures';
import { MyWorkPage } from './MyWorkPage';

const mocks = vi.hoisted(() => ({
  state: {
    entries: [] as { board: unknown; item: unknown }[],
    loading: false,
    error: null as Error | null,
    truncatedFrom: 0,
    retry: vi.fn(),
  },
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
  }),
}));
vi.mock('../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspaces: () => ({
    data: [makeWorkspace({ id: 'w1', name: 'Home base' })],
    loading: false,
    error: null,
  }),
}));
vi.mock('../data/my-work', () => ({
  MY_WORK_BOARD_CAP: 100,
  useMyWorkItems: () => mocks.state,
}));

const column = (id: string, type: string, position: string, settings: object = {}): ColumnDef =>
  ({ id, type, title: id, position, settings }) as ColumnDef;

const board = makeBoard({
  id: 'b1',
  name: 'Roadmap',
  workspaceId: 'w1',
  groups: [{ id: 'g1', title: 'Launch', color: '#579bfc', position: 'a0' }],
  columns: [
    column('status', 'status', 'a0', {
      labels: [
        { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
        { id: 'work', index: 0, label: 'Working', color: '#fdab3d' },
      ],
    }),
    column('due', 'date', 'a1'),
  ],
});

const entry = (id: string, name: string, values: Record<string, unknown>) => ({
  board,
  item: makeItem({ id, name, groupId: 'g1', values }),
});

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyWorkPage />
      <Location />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 28, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  mocks.state.entries = [];
  mocks.state.loading = false;
  mocks.state.error = null;
  mocks.state.truncatedFrom = 0;
  mocks.state.retry.mockClear();
});

describe('MyWorkPage', () => {
  it('groups assigned items by date, with Done collapsed', () => {
    mocks.state.entries = [
      entry('i1', 'Fix login', { due: { date: '2026-10-20' } }),
      entry('i2', 'Ship it', { due: { date: '2026-10-28' } }),
      entry('i3', 'Plan the quarter', { due: { date: '2026-12-01' } }),
      entry('i4', 'Someday task', {}),
      entry('i5', 'Old chore', { status: { index: 1 }, due: { date: '2026-10-01' } }),
    ];
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Past dates1', 'Today1', 'Later1', 'Without a date1', 'Done1']);
    const past = screen.getByRole('grid', { name: 'Past dates' });
    expect(within(past).getByText('Fix login')).toBeInTheDocument();
    expect(within(past).getByText('Roadmap')).toBeInTheDocument();
    expect(within(past).getByText('Home base')).toBeInTheDocument();
    expect(within(past).getByText('Launch')).toBeInTheDocument();
    // Done starts collapsed.
    expect(screen.queryByText('Old chore')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(screen.getByText('Old chore')).toBeInTheDocument();
  });

  it('filters with the search box and says when nothing matches', async () => {
    mocks.state.entries = [
      entry('i1', 'Fix login', { due: { date: '2026-10-20' } }),
      entry('i2', 'Ship it', { due: { date: '2026-10-28' } }),
    ];
    renderPage();
    const search = screen.getByRole('searchbox', { name: 'Search my work' });
    fireEvent.change(search, { target: { value: 'ship' } });
    // Vibe's Search debounces its onChange.
    await waitFor(() => expect(screen.queryByText('Fix login')).not.toBeInTheDocument());
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('No items match your search')).toBeInTheDocument();
  });

  it('opens the item when a row is clicked', () => {
    mocks.state.entries = [entry('i2', 'Ship it', { due: { date: '2026-10-28' } })];
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Ship it' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/boards/b1/items/i2');
  });

  it('opens the item from anywhere on the row', () => {
    mocks.state.entries = [entry('i2', 'Ship it', { due: { date: '2026-10-28' } })];
    renderPage();
    const [row] = screen.getAllByRole('row').slice(1);
    fireEvent.click(within(row!).getByText('Roadmap'));
    expect(screen.getByTestId('location')).toHaveTextContent('/boards/b1/items/i2');
  });

  it('shows the empty state when nothing is assigned', () => {
    renderPage();
    expect(screen.getByText('This is your home base')).toBeInTheDocument();
  });

  it('shows loading placeholders while the boards answer', () => {
    mocks.state.loading = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading your work' })).toBeInTheDocument();
    expect(screen.queryByText('This is your home base')).not.toBeInTheDocument();
  });

  it('shows an error with Retry', () => {
    mocks.state.error = new Error('nope');
    renderPage();
    expect(screen.getByText("Couldn't load your work")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.state.retry).toHaveBeenCalledTimes(1);
  });

  it('tells the user when only some boards are included', () => {
    mocks.state.truncatedFrom = 130;
    mocks.state.entries = [entry('i2', 'Ship it', { due: { date: '2026-10-28' } })];
    renderPage();
    expect(screen.getByText('Showing work from 100 of 130 boards')).toBeInTheDocument();
  });
});
