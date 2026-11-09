import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMenuItem } from '../../test/menu';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import type { InboxMessageDoc, InboxThreadDoc } from '../../data/inbox';
import { InboxThreadView } from './InboxThreadView';

const mocks = vi.hoisted(() => ({
  thread: null as unknown,
  threadState: { loading: false, error: null as Error | null },
  messages: [] as unknown[],
  manage: vi.fn(),
  setStatus: vi.fn(),
  markThreadRead: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../data/inbox', () => ({
  useInboxThread: () => ({
    data: mocks.thread,
    loading: mocks.threadState.loading,
    error: mocks.threadState.error,
  }),
  useInboxMessages: () => ({ data: mocks.messages, loading: false, error: null }),
  useInboxNote: () => ({ data: null, loading: false, error: null }),
  inboxWrites: { markThreadRead: mocks.markThreadRead, saveNote: vi.fn() },
}));
vi.mock('../../lib/callables', () => ({
  inboxCalls: { manage: mocks.manage },
  accountAdminCalls: { setStatus: mocks.setStatus },
  describeCallableError: (e: unknown, fallback: string) =>
    (e as { message?: string } | null)?.message ?? fallback,
}));
vi.mock('../../components/toast-store', () => ({ showToast: mocks.showToast }));

const ts = (ms: number) => ({ toMillis: () => ms }) as never;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function thread(over: Partial<InboxThreadDoc> = {}): InboxThreadDoc {
  return {
    id: 't1',
    kind: 'feedback',
    category: 'bug',
    subject: 'Calendar crashes',
    senderUid: 'u-blake',
    senderName: 'Blake Rivera',
    senderEmail: 'blake@example.com',
    senderPhotoURL: null,
    status: 'open',
    outcome: null,
    messageCount: 2,
    lastMessageAt: ts(Date.now() - 60_000),
    lastMessageBy: 'sender',
    lastSnippet: 'It crashes',
    adminUnread: false,
    senderUnread: false,
    createdAt: ts(Date.parse('2026-10-01T00:00:00Z')),
    updatedAt: ts(0),
    closedAt: null,
    ...over,
  };
}

function message(id: string, seq: number, over: Partial<InboxMessageDoc> = {}): InboxMessageDoc {
  return {
    id,
    seq,
    authorRole: 'sender',
    authorUid: 'u-blake',
    authorName: 'Blake Rivera',
    authorPhotoURL: null,
    text: 'It crashes when I open June.',
    createdAt: ts(Date.now() - 5 * 60_000),
    ...over,
  };
}

const auth = {
  status: 'ready',
  user: { uid: 'admin1', displayName: 'Ada Admin', email: 'ada@example.com', photoURL: null },
} as unknown as AuthContextValue;

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderView() {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/admin/inbox/t1']}>
        <Routes>
          <Route path="/admin/inbox/:threadId" element={<InboxThreadView />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  mocks.thread = thread();
  mocks.threadState = { loading: false, error: null };
  mocks.messages = [message('m1', 1)];
  mocks.manage.mockReset().mockResolvedValue({ threadId: 't1', status: 'answered' });
  mocks.setStatus.mockReset().mockResolvedValue({});
  mocks.markThreadRead.mockReset().mockResolvedValue(undefined);
  mocks.showToast.mockReset();
});

describe('InboxThreadView header and messages', () => {
  it('shows subject, sender, email, kind, status and the start date', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Calendar crashes' })).toBeInTheDocument();
    expect(screen.getAllByText('Blake Rivera').length).toBeGreaterThan(0);
    expect(screen.getByText('blake@example.com')).toBeInTheDocument();
    expect(screen.getByText('Feedback · Bug')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/Started Oct 1, 2026|Started 1 Oct 2026/)).toBeInTheDocument();
  });

  it('labels admin messages Site Administrator, never a person', () => {
    mocks.messages = [
      message('m1', 1),
      message('m2', 2, {
        authorRole: 'admin',
        authorUid: null,
        authorName: null,
        text: 'Thanks, we are on it.',
      }),
    ];
    renderView();
    const admin = screen.getByLabelText('Admin message');
    expect(within(admin).getByText('Site Administrator')).toBeInTheDocument();
    expect(within(admin).getByText('Thanks, we are on it.')).toBeInTheDocument();
  });

  it('renders message text as text, not markup', () => {
    mocks.messages = [message('m1', 1, { text: '<b onclick="x()">bold</b>\nnext line' })];
    const { container } = renderView();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/<b onclick="x\(\)">bold<\/b>/)).toBeInTheDocument();
  });

  it('shows the outcome of a closed appeal and the closed notice instead of a reply box', () => {
    mocks.thread = thread({ kind: 'appeal', category: null, status: 'closed', outcome: 'upheld' });
    renderView();
    expect(screen.getByText('Outcome: Kept blocked')).toBeInTheDocument();
    expect(
      screen.getByText('This conversation is closed. Reopen it to reply.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('says so when the conversation does not exist, and when it fails to load', () => {
    mocks.thread = null;
    const { unmount } = renderView();
    expect(screen.getByText('This conversation no longer exists.')).toBeInTheDocument();
    unmount();
    mocks.threadState = { loading: false, error: new Error('x') };
    renderView();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this conversation.');
  });

  it('shows the internal note panel', () => {
    renderView();
    expect(screen.getByText('Only site admins see this.')).toBeInTheDocument();
  });
});

describe('opening a thread', () => {
  it('clears adminUnread when it is true', async () => {
    mocks.thread = thread({ adminUnread: true });
    renderView();
    await waitFor(() => expect(mocks.markThreadRead).toHaveBeenCalledWith('t1'));
  });

  it('writes nothing when it is already read', () => {
    renderView();
    expect(mocks.markThreadRead).not.toHaveBeenCalled();
  });

  it('survives a refused write', async () => {
    mocks.thread = thread({ adminUnread: true });
    mocks.markThreadRead.mockRejectedValue(new Error('denied'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderView();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Calendar crashes' })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('replying', () => {
  it('sends the reply through manage with a generated requestId and clears the box', async () => {
    renderView();
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Reply' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await user.type(box, '  Thanks!  ');
    expect(screen.getByText('11 / 2000')).toBeInTheDocument();
    await user.click(send);
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(1));
    const arg = mocks.manage.mock.calls[0]![0] as Record<string, string>;
    expect(arg).toMatchObject({ action: 'reply', threadId: 't1', text: 'Thanks!' });
    expect(arg.requestId).toMatch(UUID);
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('reuses the requestId when the same text is retried after a failure', async () => {
    mocks.manage.mockRejectedValueOnce(new Error('Network down'));
    renderView();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Network down', { type: 'negative' }),
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(2));
    const [a, b] = mocks.manage.mock.calls.map((c) => (c[0] as { requestId: string }).requestId);
    expect(a).toBe(b);
  });
});

describe('feedback actions', () => {
  it('Close calls manage close', async () => {
    renderView();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({ action: 'close', threadId: 't1' }),
    );
  });

  it('Reopen calls manage reopen on a closed thread', async () => {
    mocks.thread = thread({ status: 'closed' });
    renderView();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({ action: 'reopen', threadId: 't1' }),
    );
  });

  it('has no appeal buttons on feedback', () => {
    renderView();
    expect(screen.queryByRole('button', { name: 'Unblock' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep blocked' })).toBeNull();
  });
});

describe('appeal actions', () => {
  beforeEach(() => {
    mocks.thread = thread({ kind: 'appeal', category: null, subject: 'Appeal' });
  });

  it('Unblock asks first, then approves the account', async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    expect(mocks.setStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect(mocks.setStatus).toHaveBeenCalledWith({ uid: 'u-blake', status: 'approved' }),
    );
    expect(mocks.manage).not.toHaveBeenCalled();
  });

  it('Cancel in the confirm dialog does nothing', async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it('Keep blocked without a message sends no text', async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Keep blocked' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep blocked' }));
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({ action: 'keepBlocked', threadId: 't1' }),
    );
  });

  it('Keep blocked with a final message sends requestId and text together', async () => {
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Keep blocked' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Final message (optional)' }),
      'Sorry, not this time.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep blocked' }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(1));
    const arg = mocks.manage.mock.calls[0]![0] as Record<string, string>;
    expect(arg).toMatchObject({
      action: 'keepBlocked',
      threadId: 't1',
      text: 'Sorry, not this time.',
    });
    expect(arg.requestId).toMatch(UUID);
  });

  it('a Keep blocked retry after a failure reuses the request id; a new opening gets a new one', async () => {
    mocks.manage.mockRejectedValueOnce(new Error('Network lost'));
    renderView();
    const user = userEvent.setup();
    const open = async () => {
      await user.click(screen.getByRole('button', { name: 'Keep blocked' }));
      const dialog = await screen.findByRole('dialog');
      await user.clear(within(dialog).getByRole('textbox', { name: 'Final message (optional)' }));
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Final message (optional)' }),
        'Not this time.',
      );
      return dialog;
    };
    const dialog = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Keep blocked' }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep blocked' }),
    );
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(2));
    const ids = mocks.manage.mock.calls.map((c) => (c[0] as { requestId: string }).requestId);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toBe(ids[0]);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const again = await open();
    await user.click(within(again).getByRole('button', { name: 'Keep blocked' }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(3));
    const third = (mocks.manage.mock.calls[2]![0] as { requestId: string }).requestId;
    expect(third).not.toBe(ids[0]);
  });

  it('shows a callable error as a toast and keeps the dialog open', async () => {
    mocks.setStatus.mockRejectedValue(new Error('Not allowed'));
    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Not allowed', { type: 'negative' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('asks with an irreversible warning, then deletes and goes back to the list', async () => {
    renderView();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await chooseMenuItem(user, 'Delete thread');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(mocks.manage).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({ action: 'delete', threadId: 't1' }),
    );
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/inbox'));
  });
});
