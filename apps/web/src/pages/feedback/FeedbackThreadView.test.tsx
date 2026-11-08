import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessageDoc, InboxThreadDoc } from '../../data/inbox';
import { FeedbackThreadView } from './FeedbackThreadView';

const mocks = vi.hoisted(() => ({
  thread: vi.fn(),
  messages: vi.fn(),
  markRead: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../../data/inbox', () => ({
  useInboxThread: mocks.thread,
  useInboxMessages: mocks.messages,
  inboxWrites: { markSenderRead: mocks.markRead },
}));
vi.mock('../../lib/callables', () => ({
  inboxCalls: { send: mocks.send },
  describeCallableError: (_e: unknown, fallback: string) => fallback,
}));

const ts = (ms: number) => ({ toMillis: () => ms }) as never;

function thread(over: Partial<InboxThreadDoc> = {}): InboxThreadDoc {
  return {
    id: 't1',
    kind: 'feedback',
    category: 'bug',
    subject: 'Calendar crashes',
    senderUid: 'u1',
    senderName: 'Avery Quinn',
    senderEmail: 'avery@example.com',
    senderPhotoURL: null,
    status: 'answered',
    outcome: null,
    messageCount: 2,
    lastMessageAt: ts(Date.now()),
    lastMessageBy: 'admin',
    lastSnippet: '',
    adminUnread: false,
    senderUnread: true,
    createdAt: ts(Date.UTC(2026, 9, 20)),
    updatedAt: ts(0),
    closedAt: null,
    ...over,
  };
}

const messages: InboxMessageDoc[] = [
  {
    id: 'm1',
    seq: 1,
    authorRole: 'sender',
    authorUid: 'u1',
    authorName: 'Avery Quinn',
    authorPhotoURL: null,
    text: 'It goes blank.',
    createdAt: ts(Date.now() - 3_600_000),
  },
  {
    id: 'm2',
    seq: 2,
    authorRole: 'admin',
    authorUid: null,
    authorName: null,
    authorPhotoURL: null,
    text: 'Thanks, we are on it.',
    createdAt: ts(Date.now() - 60_000),
  },
];

function setup() {
  render(
    <MemoryRouter initialEntries={['/feedback/t1']}>
      <Routes>
        <Route path="feedback/:threadId" element={<FeedbackThreadView />} />
        <Route path="feedback" element={<p>the list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.thread.mockReturnValue({ data: thread(), loading: false, error: null });
  mocks.messages.mockReturnValue({ data: messages, loading: false, error: null });
  mocks.markRead.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ threadId: 't1' });
});

describe('FeedbackThreadView', () => {
  it('shows the subject, status, messages and a reply box; admin messages say Site Administrator', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Calendar crashes' })).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText('It goes blank.')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin message')).toHaveTextContent('Site Administrator');
    expect(screen.getByLabelText('Reply')).toBeInTheDocument();
  });

  it('opening an unread thread writes senderUnread false once', () => {
    setup();
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
    expect(mocks.markRead).toHaveBeenCalledWith('t1');
  });

  it('writes nothing when the thread is already read', () => {
    mocks.thread.mockReturnValue({
      data: thread({ senderUnread: false }),
      loading: false,
      error: null,
    });
    setup();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('sends a reply with a request id', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reply'), 'More info');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocks.send).toHaveBeenCalledWith({
      action: 'reply',
      threadId: 't1',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      text: 'More info',
    });
  });

  it('shows the exact limit text when a reply is refused', async () => {
    mocks.send.mockRejectedValue({
      code: 'functions/resource-exhausted',
      details: { reason: 'thread-full' },
    });
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Reply'), 'More');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This conversation has reached 200 messages. Start a new one.',
    );
  });

  it('a closed conversation shows the notice instead of a reply box', () => {
    mocks.thread.mockReturnValue({
      data: thread({ status: 'closed', senderUnread: false }),
      loading: false,
      error: null,
    });
    setup();
    expect(screen.getByText('This conversation is closed.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).toBeNull();
  });

  it('shows quiet states for an error, a missing thread and loading', () => {
    mocks.thread.mockReturnValue({ data: null, loading: false, error: new Error('denied') });
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this conversation.');
  });

  it('a missing thread says it no longer exists', () => {
    mocks.thread.mockReturnValue({ data: null, loading: false, error: null });
    setup();
    expect(screen.getByText('This conversation no longer exists.')).toBeInTheDocument();
  });

  it('shows a loader while loading', () => {
    mocks.thread.mockReturnValue({ data: null, loading: true, error: null });
    setup();
    expect(screen.getByRole('status', { name: 'Loading the conversation' })).toBeInTheDocument();
  });

  it('Back goes to My feedback', async () => {
    setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to My feedback' }));
    expect(screen.getByText('the list')).toBeInTheDocument();
  });
});
