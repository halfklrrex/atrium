import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import type { NotificationDoc } from '../../data/model';
import { ts } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';
import { NotificationsPanel } from './NotificationsPanel';
import { useUiStore } from './ui-store';

const mockMarkRead = vi.fn();
const mockMarkUnread = vi.fn();
const mockMarkAllRead = vi.fn();
const mockRemove = vi.fn();
const mockLoadMore = vi.fn();
let mockList: NotificationDoc[] = [];
let mockUnreadIds: string[] = [];
let mockHasMore = false;

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/notifications', () => ({
  useNotifications: () => ({
    data: mockList,
    loading: false,
    error: null,
    hasMore: mockHasMore,
    loadMore: mockLoadMore,
  }),
  useUnreadNotifications: () => ({
    count: mockUnreadIds.length,
    ids: mockUnreadIds,
    loading: false,
  }),
  notificationWrites: {
    markRead: (...args: unknown[]) => mockMarkRead(...args),
    markUnread: (...args: unknown[]) => mockMarkUnread(...args),
    markAllRead: (...args: unknown[]) => mockMarkAllRead(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
  },
}));

const auth = {
  status: 'ready',
  user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
} as unknown as AuthContextValue;

function note(id: string, over: Partial<NotificationDoc> = {}): NotificationDoc {
  return {
    id,
    kind: 'mention',
    actorId: 'u2',
    actorName: 'Jordan Lee',
    actorPhotoURL: null,
    workspaceId: 'w1',
    boardId: 'b1',
    boardName: 'Roadmap',
    itemId: 'i1',
    itemName: 'Ship the pipeline',
    updateId: 'up1',
    replyId: null,
    columnId: null,
    snippet: 'Can you take a look?',
    createdAt: ts(Date.now() - 5 * 60_000),
    readAt: null,
    ...over,
  };
}

/** Opens a Vibe menu and lets it finish mounting, so the first hover on an item is not lost. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger);
  await screen.findByRole('menu');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const setOpen = (open: boolean) => act(() => useUiStore.getState().setNotificationsOpen(open));

function Where() {
  const location = useLocation();
  const state = location.state as { updateId?: string; replyId?: string | null } | null;
  return (
    <p data-testid="where">
      {location.pathname}|{state?.updateId ?? ''}|{state?.replyId ?? ''}
    </p>
  );
}

function renderPanel() {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/']}>
        <button type="button" data-notifications-trigger="">
          <span>Bell</span>
        </button>
        <p>Outside</p>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <NotificationsPanel />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const sample = () => [
  note('n1', { kind: 'mention', actorName: 'Jordan Lee', snippet: 'Can you take a look?' }),
  note('n2', {
    kind: 'assigned',
    actorId: 'u3',
    actorName: 'Sam Rivera',
    itemName: 'Plan the offsite',
    itemId: 'i2',
    updateId: null,
    snippet: '',
    readAt: ts(),
  }),
  note('n3', {
    kind: 'reply',
    actorId: 'u2',
    actorName: 'Jordan Lee',
    replyId: 'r1',
    snippet: 'Thanks, done.',
  }),
];

beforeEach(() => {
  mockList = [];
  mockUnreadIds = [];
  mockHasMore = false;
  mockMarkRead.mockResolvedValue(undefined);
  mockMarkUnread.mockResolvedValue(undefined);
  mockMarkAllRead.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

afterEach(() => {
  setOpen(false);
  useUiStore.setState({ dialog: null });
  vi.clearAllMocks();
});

describe('NotificationsPanel shell', () => {
  it('is inert until it is opened', () => {
    renderPanel();
    const panel = screen.getByLabelText('Notifications', { selector: 'aside' });
    expect(panel).toHaveAttribute('inert');
    setOpen(true);
    expect(panel).not.toHaveAttribute('inert');
  });

  it('shows the all-caught-up state with its four tabs and search', () => {
    renderPanel();
    setOpen(true);
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    for (const name of ['All', 'Unread', 'I was mentioned', 'Assigned to me']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: "You're all caught up!" })).toBeInTheDocument();
    expect(screen.getByLabelText('Search notifications')).toBeInTheDocument();
  });

  it('closes with Escape, the close button and an outside click', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().notificationsOpen).toBe(false);

    setOpen(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
    expect(useUiStore.getState().notificationsOpen).toBe(false);

    setOpen(true);
    await userEvent.click(screen.getByText('Outside'));
    expect(useUiStore.getState().notificationsOpen).toBe(false);
  });

  it('ignores clicks inside the panel and on the bell', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('heading', { name: 'Notifications' }));
    expect(useUiStore.getState().notificationsOpen).toBe(true);
    await userEvent.click(screen.getByText('Bell'));
    expect(useUiStore.getState().notificationsOpen).toBe(true);
  });
});

describe('NotificationsPanel list', () => {
  beforeEach(() => {
    mockList = sample();
    mockUnreadIds = ['n1', 'n3'];
  });

  it('renders the cards with their action text, snippet and item', () => {
    renderPanel();
    setOpen(true);
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText('Jordan Lee')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Mentioned you in an update')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Can you take a look?')).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/Ship the pipeline/)).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Assigned you to an item')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Replied to your update')).toBeInTheDocument();
    expect(cards[0]).toHaveAttribute('data-unread', 'true');
    expect(cards[1]).toHaveAttribute('data-unread', 'false');
  });

  it('filters by tab', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(screen.getByRole('tab', { name: 'I was mentioned' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Assigned to me' }));
    const only = screen.getAllByRole('listitem');
    expect(only).toHaveLength(1);
    expect(within(only[0]!).getByText('Sam Rivera')).toBeInTheDocument();
  });

  it('shows a per-tab empty state', async () => {
    mockList = [note('n2', { kind: 'assigned', readAt: ts() })];
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getByRole('heading', { name: 'No unread notifications' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'I was mentioned' }));
    expect(screen.getByRole('heading', { name: 'No mentions yet' })).toBeInTheDocument();
  });

  it('searches actor, item, board and snippet, and highlights the match', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.type(screen.getByLabelText('Search notifications'), 'offsite');
    // Vibe's search box debounces what it reports.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getAllByRole('listitem')[0]!.querySelector('mark')).toHaveTextContent('offsite');

    await userEvent.clear(screen.getByLabelText('Search notifications'));
    await userEvent.type(screen.getByLabelText('Search notifications'), 'nothing like this');
    expect(
      await screen.findByRole('heading', { name: 'No matching notifications' }),
    ).toBeInTheDocument();
  });

  it('marks a card read from the hover check', async () => {
    renderPanel();
    setOpen(true);
    const card = screen.getAllByRole('listitem')[0]!;
    await userEvent.click(within(card).getByRole('button', { name: 'Mark as read' }));
    expect(mockMarkRead).toHaveBeenCalledWith('u1', 'n1');
    expect(useUiStore.getState().notificationsOpen).toBe(true);
  });

  it('has no check on a read card', () => {
    renderPanel();
    setOpen(true);
    const card = screen.getAllByRole('listitem')[1]!;
    expect(within(card).queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
  });

  it('marks read on click and opens the item with the update to show', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByText('Can you take a look?'));
    expect(mockMarkRead).toHaveBeenCalledWith('u1', 'n1');
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1/items/i1|up1|');
    expect(useUiStore.getState().notificationsOpen).toBe(false);
  });

  it('shows a description mention and opens the item without an update target', async () => {
    mockList = [
      note('n9', {
        updateId: null,
        replyId: null,
        snippet: 'Ask @Avery Quinn about the trip',
      }),
    ];
    renderPanel();
    setOpen(true);
    expect(screen.getByText('Mentioned you in a description')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Ask @Avery Quinn about the trip'));
    expect(mockMarkRead).toHaveBeenCalledWith('u1', 'n9');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/boards\/b1\/items\/i1\|\|$/);
  });

  it('opens a read assigned notification on the item alone, without marking it', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByText('Assigned you to an item'));
    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1/items/i2||');
  });

  it('passes the reply id for a reply notification', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByText('Thanks, done.'));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1/items/i1|up1|r1');
  });

  it('marks unread and deletes from the card menu', async () => {
    renderPanel();
    setOpen(true);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const read = screen.getAllByRole('listitem')[1]!;
    await openMenu(user, within(read).getByRole('button', { name: 'Notification actions' }));
    await chooseMenuItem(user, 'Mark as unread');
    await waitFor(() => expect(mockMarkUnread).toHaveBeenCalledWith('u1', 'n2'), {
      timeout: 5000,
    });

    const first = screen.getAllByRole('listitem')[0]!;
    await openMenu(user, within(first).getByRole('button', { name: 'Notification actions' }));
    await chooseMenuItem(user, 'Delete');
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('u1', 'n1'), { timeout: 5000 });
  });

  it('marks everything read from the header menu', async () => {
    renderPanel();
    setOpen(true);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await openMenu(user, screen.getByRole('button', { name: 'More notification actions' }));
    await chooseMenuItem(user, 'Mark all as read');
    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalled(), { timeout: 5000 });
    const [uid, ids] = mockMarkAllRead.mock.calls[0] as [string, string[]];
    expect(uid).toBe('u1');
    expect([...new Set(ids)].sort()).toEqual(['n1', 'n3']);
    // The panel stays open: choosing a menu item is not an outside click.
    expect(useUiStore.getState().notificationsOpen).toBe(true);
  });

  it('opens the settings dialog from the icon', async () => {
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('button', { name: 'Notification settings' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'notificationSettings' });
  });

  it('opens the settings dialog from the header menu', async () => {
    renderPanel();
    setOpen(true);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await openMenu(user, screen.getByRole('button', { name: 'More notification actions' }));
    await chooseMenuItem(user, 'Notification settings');
    await waitFor(
      () => expect(useUiStore.getState().dialog).toEqual({ type: 'notificationSettings' }),
      { timeout: 5000 },
    );
  });

  it('offers Load more when there may be older notifications', async () => {
    mockHasMore = true;
    renderPanel();
    setOpen(true);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(mockLoadMore).toHaveBeenCalled();
  });
});
