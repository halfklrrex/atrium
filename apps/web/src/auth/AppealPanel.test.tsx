import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessageDoc, InboxThreadDoc } from '../data/inbox';
import { AppealPanel } from './AppealPanel';

const mocks = vi.hoisted(() => ({ appeal: vi.fn(), messages: vi.fn(), send: vi.fn() }));
vi.mock('../data/inbox', () => ({
  useMyLatestAppeal: mocks.appeal,
  useInboxMessages: mocks.messages,
}));
vi.mock('../lib/callables', () => ({
  inboxCalls: { send: mocks.send },
  describeCallableError: (_e: unknown, fallback: string) => fallback,
}));

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-24T09:00:00Z');
const ts = (ms: number) => ({ toMillis: () => ms }) as never;

function appeal(over: Partial<InboxThreadDoc> = {}): InboxThreadDoc {
  return {
    id: 't1',
    kind: 'appeal',
    category: null,
    subject: 'Appeal',
    senderUid: 'u1',
    senderName: 'Blake Rivera',
    senderEmail: 'blake@example.com',
    senderPhotoURL: null,
    status: 'open',
    outcome: null,
    messageCount: 1,
    lastMessageAt: ts(NOW - DAY),
    lastMessageBy: 'sender',
    lastSnippet: '',
    adminUnread: true,
    senderUnread: false,
    createdAt: ts(NOW - DAY),
    updatedAt: ts(NOW - DAY),
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
    authorName: 'Blake Rivera',
    authorPhotoURL: null,
    text: 'I think this was a mistake.',
    createdAt: ts(NOW - DAY),
  },
  {
    id: 'm2',
    seq: 2,
    authorRole: 'admin',
    authorUid: null,
    authorName: null,
    authorPhotoURL: null,
    text: 'Can you tell us more?',
    createdAt: ts(NOW - DAY / 2),
  },
];

function state(thread: InboxThreadDoc | null, over = {}) {
  mocks.appeal.mockReturnValue({ data: thread, loading: false, error: null, ...over });
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.messages.mockReturnValue({ data: messages, loading: false, error: null });
  mocks.send.mockResolvedValue({ threadId: 't1' });
});

describe('AppealPanel', () => {
  it('asks only for the blocked person own appeal (by uid)', () => {
    state(null);
    render(<AppealPanel uid="u1" now={NOW} />);
    expect(mocks.appeal).toHaveBeenCalledWith('u1');
  });

  it('with no appeal yet: a box and Send appeal, which sends an appeal', async () => {
    state(null);
    const user = userEvent.setup();
    render(<AppealPanel uid="u1" now={NOW} />);
    const send = screen.getByRole('button', { name: 'Send appeal' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByRole('textbox', { name: 'Your appeal' }), 'It was a mistake.');
    await user.click(send);
    expect(mocks.send).toHaveBeenCalledWith({
      action: 'appeal',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      text: 'It was a mistake.',
    });
  });

  it('shows the exact limit text when the server refuses', async () => {
    state(null);
    mocks.send.mockRejectedValue({
      code: 'functions/resource-exhausted',
      details: { reason: 'daily-message-limit' },
    });
    const user = userEvent.setup();
    render(<AppealPanel uid="u1" now={NOW} />);
    await user.type(screen.getByRole('textbox', { name: 'Your appeal' }), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send appeal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can send 10 messages a day. Try again tomorrow.',
    );
  });

  it.each(['open', 'answered'] as const)(
    'an %s appeal shows the thread, the reply hint and a reply box',
    async (status) => {
      state(appeal({ status }));
      const user = userEvent.setup();
      render(<AppealPanel uid="u1" now={NOW} />);
      expect(screen.getByText('I think this was a mistake.')).toBeInTheDocument();
      expect(
        within(screen.getByLabelText('Admin message')).getByText('Site Administrator'),
      ).toBeInTheDocument();
      expect(screen.getByText("We'll show the reply here.")).toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'More details');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(mocks.send).toHaveBeenCalledWith({
        action: 'reply',
        threadId: 't1',
        requestId: expect.any(String),
        text: 'More details',
      });
    },
  );

  it('an upheld appeal shows the dates and a disabled box until the wait ends', () => {
    state(appeal({ status: 'closed', outcome: 'upheld', closedAt: ts(NOW - 2 * DAY) }));
    render(<AppealPanel uid="u1" now={NOW} />);
    expect(
      screen.getByText(
        /^Your appeal was not accepted on .*\. You can send a new appeal from .*\.$/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your appeal' })).toBeDisabled();
  });

  it('after the wait the box is enabled again and sends a new appeal', () => {
    state(appeal({ status: 'closed', outcome: 'upheld', closedAt: ts(NOW - 7 * DAY) }));
    render(<AppealPanel uid="u1" now={NOW} />);
    expect(screen.getByRole('textbox', { name: 'Your appeal' })).toBeEnabled();
  });

  it('shows a quiet error when the listener fails', () => {
    state(null, { error: new Error('denied') });
    render(<AppealPanel uid="u1" now={NOW} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your appeal');
  });

  it('shows a loader while loading', () => {
    state(null, { loading: true });
    render(<AppealPanel uid="u1" now={NOW} />);
    expect(screen.getByRole('status', { name: 'Loading your appeal' })).toBeInTheDocument();
  });
});
