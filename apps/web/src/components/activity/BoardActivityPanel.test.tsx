import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityDoc, ActivityFilters, ActivityState } from '../../data/activity';
import { makeActivity } from '../../test/activity';
import { makeBoard } from '../../test/fixtures';
import { useUiStore } from '../AppShell/ui-store';
import { BoardActivityPanel } from './BoardActivityPanel';

const mockOpenItem = vi.fn();
const mockLoadMore = vi.fn();
const mockRetry = vi.fn();
const lastCall: { boardId?: string; filters?: ActivityFilters } = {};
let mockState: Partial<ActivityState> = {};

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../board-table/open-item', () => ({
  openItem: (...args: unknown[]) => mockOpenItem(...args),
}));
vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Unknown',
  useUserLookup: () => () => undefined,
  useWorkspaceMembers: () => ({
    workspaceId: 'w1',
    loading: false,
    members: [
      { id: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
      { id: 'u2', displayName: 'Jordan Lee', email: 'jordan@example.com', photoURL: null },
    ],
  }),
}));
vi.mock('../../data/activity', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../data/activity');
  return {
    ...actual,
    useBoardActivity: (boardId: string | undefined, filters: ActivityFilters): ActivityState => {
      lastCall.boardId = boardId;
      lastCall.filters = filters;
      return {
        data: [],
        loading: false,
        error: null,
        hasMore: false,
        loadMore: mockLoadMore,
        retry: mockRetry,
        ...mockState,
      };
    },
  };
});

const board = makeBoard({
  id: 'b1',
  accessUids: ['u1', 'u2'],
  columns: [{ id: 'status', type: 'status', title: 'Status', position: 'a0', settings: {} }],
});

const entries = (): ActivityDoc[] => [
  makeActivity('e1', {
    columnId: 'status',
    columnTitle: 'Status',
    columnType: 'status',
    data: { fromText: 'Building', toText: 'Done' },
  }),
  makeActivity('e2', {
    kind: 'group_renamed',
    itemId: null,
    itemName: null,
    groupTitle: 'Shipped',
    data: { fromText: 'Done', toText: 'Shipped' },
  }),
  makeActivity('e3', { kind: 'item_deleted', itemId: 'i9', itemName: 'Old task' }),
];

function renderPanel(open = true) {
  if (open) useUiStore.getState().openActivityPanel('b1');
  return render(<BoardActivityPanel board={board} />);
}

describe('BoardActivityPanel', () => {
  beforeEach(() => {
    useUiStore.getState().closeActivityPanel();
    mockState = {};
    lastCall.boardId = undefined;
    lastCall.filters = undefined;
    vi.clearAllMocks();
  });

  it('does not listen while closed', () => {
    renderPanel(false);
    expect(lastCall.boardId).toBeUndefined();
  });

  it('lists entries, board-level ones as sentences', () => {
    mockState = { data: entries() };
    renderPanel();
    const list = screen.getByRole('list', { name: 'Board activity' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(list).getByText('Avery Quinn renamed the group Done to Shipped'),
    ).toBeInTheDocument();
    expect(within(list).getByText('Building')).toBeInTheDocument();
    expect(lastCall.boardId).toBe('b1');
  });

  it('opens the item card from an entry, and offers no link for deleted items', async () => {
    mockState = { data: entries() };
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Ship the pipeline' }));
    expect(mockOpenItem).toHaveBeenCalledWith('b1', 'i1');
    expect(screen.queryByRole('button', { name: 'Old task' })).not.toBeInTheDocument();
    expect(screen.getByText('Old task')).toBeInTheDocument();
  });

  it('shows the loading, error and empty states', async () => {
    mockState = { loading: true };
    const { unmount } = renderPanel();
    expect(screen.getByRole('status', { name: 'Loading activity' })).toBeInTheDocument();
    unmount();

    mockState = { error: new Error('nope') };
    const failed = renderPanel();
    expect(screen.getByText('Activity is unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRetry).toHaveBeenCalled();
    failed.unmount();

    mockState = {};
    renderPanel();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('shows "Load more" when there are more entries', async () => {
    mockState = { data: entries(), hasMore: true };
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(mockLoadMore).toHaveBeenCalled();
  });

  it('turns the date filter into a lower bound and can clear it', async () => {
    renderPanel();
    expect(lastCall.filters).toMatchObject({ actorIds: [], columnId: null, since: null });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('combobox', { name: 'Filter by date' }));
    await user.click(await screen.findByText('Last 7 days'));
    expect(lastCall.filters?.since).toBeInstanceOf(Date);
    expect(screen.getByText('No activity matches these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(lastCall.filters?.since).toBeNull();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('closes with the close button', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Close activity log' }));
    expect(useUiStore.getState().activityPanelBoardId).toBeNull();
  });

  it('closes with Escape from inside the panel only', async () => {
    renderPanel();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close activity log' })).toHaveFocus(),
    );
    // Escape while focus is elsewhere belongs to someone else (the item card).
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().activityPanelBoardId).toBe('b1');
    screen.getByRole('button', { name: 'Close activity log' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().activityPanelBoardId).toBeNull();
  });
});
