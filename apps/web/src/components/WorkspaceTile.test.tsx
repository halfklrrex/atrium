import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceTile } from './WorkspaceTile';
import { findWorkspaceIcon } from './workspace-icons/icons';

describe('WorkspaceTile', () => {
  it('renders a Phosphor icon as an inline svg using the fill weight', () => {
    const { container } = render(
      <WorkspaceTile icon="ph:rocket-launch" color="#579bfc" name="Rocket" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 256 256');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg?.getAttribute('data-icon-key')).toBe('rocket-launch');
    const def = findWorkspaceIcon('ph:rocket-launch');
    expect(svg?.querySelector('path')).toHaveAttribute('d', def?.fill);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a legacy mi: value as its mapped Phosphor icon', () => {
    const { container } = render(<WorkspaceTile icon="mi:home" color="#579bfc" name="Home" />);
    expect(container.querySelector('svg')?.getAttribute('data-icon-key')).toBe('house');
  });

  it('falls back to the first letter of the name for an unknown or malformed key', () => {
    const { container, rerender } = render(
      <WorkspaceTile icon="ph:no-such-icon" color="#579bfc" name="garden club" />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('G')).toBeInTheDocument();
    rerender(<WorkspaceTile icon="ph:Bad Key" color="#579bfc" />);
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
