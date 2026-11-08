import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxListState, InboxThreadDoc } from '../../data/inbox';
import { InboxTab } from './InboxTab';

const mocks = vi.hoisted(() => ({ useInboxList: vi.fn(), loadMore: vi.fn() }));
vi.mock('../../data/inbox', () => ({ useInboxList: mocks.useInboxList }));

const ts = (ms: number) => ({ toMillis: () => ms }) as never;

function thread(id: string, over: Partial<InboxThreadDoc> = {}): InboxThreadDoc {
  return {
    id,
    kind: 'feedback',
    category: 'idea',
    subject: 'Dark mode for the calendar',
    senderUid: `u-${id}`,
    senderName: 'Blake Rivera',
    senderEmail: 'blake@example.com',
    senderPhotoURL: null,
    status: 'open',
    outcome: null,
    messageCount: 1,
    lastMessageAt: ts(Date.now() - 3 * 3_600_000),
    lastMessageBy: 'sender',
    lastSnippet: 'It would be lovely to have it.',
    adminUnread: false,
    senderUnread: false,
    createdAt: ts(0),
    updatedAt: ts(0),
    closedAt: null,
    ...over,
  };
}

function state(over: Partial<InboxListState> = {}): InboxListState {
  return {
    threads: [],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: mocks.loadMore,
    ...over,
  };
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/admin/inbox']}>
      <Routes>
        <Route path="/admin/inbox" element={<InboxTab />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.useInboxList.mockReset().mockReturnValue(state());
  mocks.loadMore.mockReset();
});

describe('InboxTab', () => {
  it('starts on Open and All kinds', () => {
    renderTab();
    expect(mocks.useInboxList).toHaveBeenLastCalledWith('open', null);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Appeals' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('asks for the chosen status and kind', async () => {
    renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Closed' }));
    expect(mocks.useInboxList).toHaveBeenLastCalledWith('closed', null);
    await user.click(screen.getByRole('button', { name: 'Appeals' }));
    expect(mocks.useInboxList).toHaveBeenLastCalledWith('closed', 'appeal');
  });

  it('shows the row fields: name, email, kind, subject, snippet, time, unread dot', () => {
    mocks.useInboxList.mockReturnValue(
      state({
        threads: [
          thread('a', { adminUnread: true }),
          thread('b', {
            kind: 'appeal',
            category: null,
            subject: 'Appeal',
            senderName: 'Casey Morgan',
            senderEmail: 'casey@example.com',
            lastSnippet: 'Please unblock me.',
          }),
        ],
      }),
    );
    renderTab();
    const rows = within(screen.getByRole('list', { name: 'Conversations' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText('Blake Rivera')).toBeInTheDocument();
    expect(first.getByText('blake@example.com')).toBeInTheDocument();
    expect(first.getByText('Feedback · Idea')).toBeInTheDocument();
    expect(first.getByText('Dark mode for the calendar')).toBeInTheDocument();
    expect(first.getByText('It would be lovely to have it.')).toBeInTheDocument();
    expect(first.getByText('3h')).toBeInTheDocument();
    expect(first.getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    const second = within(rows[1]!);
    expect(second.getAllByText('Appeal')).toHaveLength(2); // the kind label and the fixed subject
    expect(second.queryByRole('img', { name: 'Unread' })).toBeNull();
  });

  it('renders message text as text, never as markup', () => {
    mocks.useInboxList.mockReturnValue(
      state({ threads: [thread('x', { lastSnippet: '<img src=x onerror=alert(1)>' })] }),
    );
    const { container } = renderTab();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('opens a conversation on click', async () => {
    mocks.useInboxList.mockReturnValue(state({ threads: [thread('abc')] }));
    renderTab();
    await userEvent.setup().click(screen.getByRole('button', { name: /Blake Rivera/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/inbox/abc');
  });

  it.each([
    ['open', /Nothing is waiting for you/],
    ['answered', /No answered messages yet/],
    ['closed', /No closed messages/],
    ['all', /No messages yet/],
  ])('shows the %s empty state', async (filter, text) => {
    renderTab();
    const user = userEvent.setup();
    const label = filter.charAt(0).toUpperCase() + filter.slice(1);
    await user.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: label }),
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a loader, and a quiet error', () => {
    mocks.useInboxList.mockReturnValue(state({ loading: true }));
    const { unmount } = renderTab();
    expect(screen.getByRole('status', { name: 'Loading the Inbox' })).toBeInTheDocument();
    unmount();
    mocks.useInboxList.mockReturnValue(state({ error: new Error('x') }));
    renderTab();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the Inbox');
    expect(screen.queryByText(/Nothing is waiting/)).toBeNull();
  });

  it('offers Load more only when there may be more', async () => {
    mocks.useInboxList.mockReturnValue(state({ threads: [thread('a')], hasMore: false }));
    const { unmount } = renderTab();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    unmount();
    mocks.useInboxList.mockReturnValue(state({ threads: [thread('a')], hasMore: true }));
    renderTab();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  });
});
