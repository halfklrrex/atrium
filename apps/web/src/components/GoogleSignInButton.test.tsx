import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton } from './GoogleSignInButton';

describe('GoogleSignInButton', () => {
  it('renders the label and the Google logo', () => {
    render(<GoogleSignInButton />);
    const button = screen.getByRole('button', { name: 'Continue with Google' });
    expect(button).toBeEnabled();
    expect(screen.getByTestId('google-logo')).toBeInTheDocument();
    expect(screen.queryByTestId('google-button-spinner')).not.toBeInTheDocument();
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<GoogleSignInButton onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled with a spinner and "Signing in…" label while loading', async () => {
    const onClick = vi.fn();
    render(<GoogleSignInButton loading onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('google-button-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('google-logo')).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
