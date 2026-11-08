import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { useUiStore } from '../../components/AppShell/ui-store';
import type { InboxThreadDoc } from '../../data/inbox';
import { MyFeedbackPage } from './MyFeedbackPage';

const mocks = vi.hoisted(() => ({ threads: vi.fn() }));
vi.mock('../../data/inbox', () => ({ useMyFeedbackThreads: mocks.threads }));

const auth = { user: { uid: 'u1' } } as unknown as AuthContextValue;
const ts = (ms: number) => ({ toMillis: () => ms }) as never;

function thread(id: string, over: Partial<InboxThreadDoc> = {}): InboxThreadDoc {
  return {
    id,
    kind: 'feedback',
    category: 'idea',
    subject: 'Keyboard shortcut for new item',
    senderUid: 'u1',
    senderName: 'Avery Quinn',
    senderEmail: 'avery@example.com',
    senderPhotoURL: null,
    status: 'answered',
    outcome: null,
    messageCount: 2,
    lastMessageAt: ts(Date.now() - 3_600_000),
    lastMessageBy: 'admin',
    lastSnippet: 'Good idea, we have added it to the list.',
    adminUnread: false,
    senderUnread: true,
    createdAt: ts(0),
    updatedAt: ts(0),
    closedAt: null,
    ...over,
  };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function setup() {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/feedback']}>
        <Routes>
          <Route path="*" element={<MyFeedbackPage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  mocks.threads.mockReset();
  useUiStore.setState({ dialog: null });
});

describe('MyFeedbackPage', () => {
  it("lists only the signed-in person's threads (asks by uid)", () => {
    mocks.threads.mockReturnValue({ data: [], loading: false, error: null });
    setup();
    expect(mocks.threads).toHaveBeenCalledWith('u1');
  });

  it('shows status chip, unread dot, snippet and time, and opens the thread', async () => {
    mocks.threads.mockReturnValue({
      data: [thread('t1'), thread('t2', { status: 'open', senderUnread: false, subject: 'Other' })],
      loading: false,
      error: null,
    });
    setup();
    const list = screen.getByRole('list', { name: 'Your conversations' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Answered')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText('Good idea, we have added it to the list.'),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText('1h')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('img', { name: 'Unread reply' })).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Waiting for a reply')).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('img', { name: 'Unread reply' })).toBeNull();
    await userEvent.setup().click(within(rows[0]!).getByRole('button'));
    expect(screen.getByTestId('where')).toHaveTextContent('/feedback/t1');
  });

  it('shows an empty state, a loader and a quiet error', () => {
    mocks.threads.mockReturnValue({ data: [], loading: false, error: null });
    setup();
    expect(screen.getByText('You have not sent any feedback yet.')).toBeInTheDocument();
  });

  it('shows a quiet error when the listener fails', () => {
    mocks.threads.mockReturnValue({ data: [], loading: false, error: new Error('x') });
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your feedback');
  });

  it('shows a loader while loading', () => {
    mocks.threads.mockReturnValue({ data: [], loading: true, error: null });
    setup();
    expect(screen.getByRole('status', { name: 'Loading your feedback' })).toBeInTheDocument();
  });

  it('Send feedback opens the dialog', async () => {
    mocks.threads.mockReturnValue({ data: [], loading: false, error: null });
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'feedback' });
  });
});
