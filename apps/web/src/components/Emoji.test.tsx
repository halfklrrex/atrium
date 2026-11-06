import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as flags from '../lib/flag-emoji';
import { Emoji } from './Emoji';

const FR = '\u{1F1EB}\u{1F1F7}';

afterEach(() => vi.restoreAllMocks());

describe('Emoji', () => {
  it('passes native emoji through as text', () => {
    vi.spyOn(flags, 'needsFlagImage').mockReturnValue(false);
    const { container } = render(<Emoji emoji={FR} />);
    expect(container.textContent).toBe(FR);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a picture with the emoji as alt text where flags are missing', () => {
    vi.spyOn(flags, 'needsFlagImage').mockReturnValue(true);
    render(<Emoji emoji={FR} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', FR);
    expect(img).toHaveAttribute('src', `${flags.TWEMOJI_BASE_URL}1f1eb-1f1f7.svg`);
  });

  it('falls back to text when the picture fails to load', () => {
    vi.spyOn(flags, 'needsFlagImage').mockReturnValue(true);
    const { container } = render(<Emoji emoji={FR} />);
    fireEvent.error(screen.getByRole('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(FR);
  });
});
