import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

function setup(onSubmit = vi.fn().mockResolvedValue(undefined), disabled = false) {
  render(
    <Composer
      label="Reply"
      submitLabel="Send"
      onSubmit={onSubmit}
      describeError={() => 'It failed.'}
      disabled={disabled}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('Composer', () => {
  it('sends trimmed text with a uuid and clears the box', async () => {
    const { onSubmit, user } = setup();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '  Hello  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('Hello', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it('reuses the request id on retry and uses a new one after success', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const { user } = setup(onSubmit);
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('It failed.');
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Next');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const ids = onSubmit.mock.calls.map((c) => c[1]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('refuses text over 2000 characters', async () => {
    setup();
    const box = screen.getByRole('textbox', { name: 'Reply' });
    await userEvent.setup().click(box);
    await userEvent.setup().paste('a'.repeat(2001));
    expect(screen.getByText('2001 / 2000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('is off when disabled', () => {
    setup(undefined, true);
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
  });
});
