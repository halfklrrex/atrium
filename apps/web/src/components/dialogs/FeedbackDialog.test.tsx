import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../toast-store';
import { FeedbackDialog } from './FeedbackDialog';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../lib/callables', () => ({
  inboxCalls: { send: mocks.send },
  describeCallableError: (_e: unknown, fallback: string) => fallback,
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function setup(props: Partial<React.ComponentProps<typeof FeedbackDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <FeedbackDialog onClose={onClose} {...props} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, user: userEvent.setup() };
}

const subjectBox = () => screen.getByLabelText('Subject');
const messageBox = () => screen.getByLabelText('Message');
const sendButton = () => screen.getByRole('button', { name: 'Send' });

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ threadId: 'th1' });
  useToastStore.setState({ toasts: [] });
});

describe('FeedbackDialog', () => {
  it('defaults to Idea and needs a subject and a message', async () => {
    const { user } = setup();
    expect(screen.getByRole('radio', { name: 'Idea' })).toBeChecked();
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');
    await user.type(subjectBox(), 'Dark mode');
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');
    await user.type(messageBox(), 'Please.');
    expect(sendButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('sends the feedback, closes and toasts with a View action', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('radio', { name: 'Bug' }));
    await user.type(subjectBox(), '  Calendar crashes ');
    await user.type(messageBox(), 'It goes blank.');
    await user.click(sendButton());
    expect(mocks.send).toHaveBeenCalledWith({
      action: 'feedback',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      category: 'bug',
      subject: 'Calendar crashes',
      text: 'It goes blank.',
    });
    expect(onClose).toHaveBeenCalled();
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.text).toBe('Thanks, your feedback was sent.');
    expect(toast.action?.label).toBe('View');
    toast.action?.onClick();
    expect(await screen.findByText('/feedback/th1')).toBeInTheDocument();
  });

  it('starts from the given category and subject (Automation center)', () => {
    setup({ initialCategory: 'idea', initialSubject: 'Automation center' });
    expect(subjectBox()).toHaveValue('Automation center');
  });

  it('shows the exact limit text and keeps the dialog open; a retry reuses the request id', async () => {
    mocks.send.mockRejectedValueOnce({
      code: 'functions/resource-exhausted',
      details: { reason: 'open-thread-limit' },
    });
    const { user, onClose } = setup();
    await user.type(subjectBox(), 'Hi');
    await user.type(messageBox(), 'There');
    await user.click(sendButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can have 3 open conversations at a time. Wait for a reply or for one to close.',
    );
    expect(onClose).not.toHaveBeenCalled();
    await user.click(sendButton());
    const [first, second] = mocks.send.mock.calls.map((c) => c[0].requestId);
    expect(first).toBe(second);
  });

  it('refuses a subject over 120 characters', async () => {
    const { user } = setup();
    await user.click(subjectBox());
    await user.paste('a'.repeat(121));
    await user.type(messageBox(), 'x');
    expect(screen.getByText('The subject can have up to 120 characters.')).toBeInTheDocument();
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('refuses a message over 2000 characters', async () => {
    const { user } = setup();
    await user.type(subjectBox(), 'Hi');
    await user.click(messageBox());
    await user.paste('a'.repeat(2001));
    expect(screen.getByText('2001 / 2000')).toBeInTheDocument();
    expect(sendButton()).toHaveAttribute('aria-disabled', 'true');
  });
});
