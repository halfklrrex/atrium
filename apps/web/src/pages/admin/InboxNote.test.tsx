import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxNote } from './InboxNote';
import { NOTE_SAVE_DEBOUNCE_MS } from './inbox';

const mocks = vi.hoisted(() => ({
  note: null as { text: string } | null,
  saveNote: vi.fn(),
}));
vi.mock('../../data/inbox', () => ({
  useInboxNote: () => ({ data: mocks.note, loading: false, error: null }),
  inboxWrites: { saveNote: mocks.saveNote },
}));

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.note = null;
  mocks.saveNote.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('InboxNote', () => {
  it('says only site admins see it and shows the stored note', () => {
    mocks.note = { text: 'Called on Monday' };
    render(<InboxNote threadId="t1" uid="admin1" />);
    expect(screen.getByText('Only site admins see this.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Internal note' })).toHaveValue('Called on Monday');
  });

  it('saves after a short pause in typing and says Saved', async () => {
    render(<InboxNote threadId="t1" uid="admin1" />);
    const user = setup();
    await user.type(screen.getByRole('textbox', { name: 'Internal note' }), 'hi');
    expect(mocks.saveNote).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(NOTE_SAVE_DEBOUNCE_MS + 10);
    });
    expect(mocks.saveNote).toHaveBeenCalledTimes(1);
    expect(mocks.saveNote).toHaveBeenCalledWith('t1', 'admin1', 'hi');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('saves on blur right away, once', async () => {
    render(<InboxNote threadId="t1" uid="admin1" />);
    const user = setup();
    await user.type(screen.getByRole('textbox', { name: 'Internal note' }), 'abc');
    await user.tab();
    expect(mocks.saveNote).toHaveBeenCalledWith('t1', 'admin1', 'abc');
    await act(async () => {
      vi.advanceTimersByTime(NOTE_SAVE_DEBOUNCE_MS * 2);
    });
    expect(mocks.saveNote).toHaveBeenCalledTimes(1);
  });

  it('does not save when nothing changed', async () => {
    mocks.note = { text: 'same' };
    render(<InboxNote threadId="t1" uid="admin1" />);
    const user = setup();
    await user.click(screen.getByRole('textbox', { name: 'Internal note' }));
    await user.tab();
    expect(mocks.saveNote).not.toHaveBeenCalled();
  });

  it('tells the admin when saving fails', async () => {
    mocks.saveNote.mockRejectedValue(new Error('denied'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<InboxNote threadId="t1" uid="admin1" />);
    const user = setup();
    await user.type(screen.getByRole('textbox', { name: 'Internal note' }), 'x');
    await user.tab();
    expect(await screen.findByText('Could not save the note. Try again.')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('limits the note to 2000 characters', () => {
    render(<InboxNote threadId="t1" uid="admin1" />);
    expect(screen.getByRole('textbox', { name: 'Internal note' })).toHaveAttribute(
      'maxlength',
      '2000',
    );
  });
});
