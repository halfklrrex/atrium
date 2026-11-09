import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceTile } from './WorkspaceTile';

describe('WorkspaceTile', () => {
  it('renders a Material Symbols icon as an inline svg', () => {
    const { container } = render(<WorkspaceTile icon="mi:home" color="#579bfc" name="Home" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 -960 960 960');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg?.getAttribute('data-icon-key')).toBe('home');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the first letter of the name for an unknown or malformed key', () => {
    const { container, rerender } = render(
      <WorkspaceTile icon="mi:no_such_icon" color="#579bfc" name="garden club" />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('G')).toBeInTheDocument();
    rerender(<WorkspaceTile icon="mi:Bad Key" color="#579bfc" />);
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('still renders letters and emoji as text', () => {
    const { container, rerender } = render(<WorkspaceTile icon="A" color="#579bfc" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    rerender(<WorkspaceTile icon="🙂" color="#579bfc" />);
    expect(screen.getByText('🙂')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
});
