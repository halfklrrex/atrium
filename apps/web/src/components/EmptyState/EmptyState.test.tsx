import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { EmptyMyWork } from '../illustrations';
import { EmptyState } from './EmptyState';

const renderState = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/elsewhere" element={<p>Elsewhere page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('EmptyState', () => {
  it('names its section after the title and shows the body', () => {
    renderState(
      <EmptyState size="page" title="This is your home base" body="Items show up here." />,
    );
    const section = screen.getByRole('region', { name: 'This is your home base' });
    expect(section).toHaveAttribute('data-size', 'page');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('This is your home base');
    expect(screen.getByText('Items show up here.')).toBeInTheDocument();
  });

  it('keeps the illustration decorative', () => {
    const { container } = render(
      <EmptyState size="page" illustration={<EmptyMyWork />} title="Title" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 250 120');
  });

  it('renders each size', () => {
    for (const size of ['page', 'panel', 'inline'] as const) {
      const { container, unmount } = render(<EmptyState size={size} title="T" />);
      expect(container.querySelector(`[data-size="${size}"]`)).not.toBeNull();
      unmount();
    }
  });

  it('runs a primary action button and a secondary link', async () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    renderState(
      <EmptyState
        size="page"
        title="Empty"
        primaryAction={{ label: 'Create board', onClick: onPrimary }}
        secondaryAction={{ label: 'Add folder', onClick: onSecondary }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('does not run a disabled action', () => {
    const onClick = vi.fn();
    renderState(
      <EmptyState
        size="page"
        title="Empty"
        primaryAction={{ label: 'Create board', onClick, disabled: true }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Create board' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link action as an anchor to its route', async () => {
    renderState(
      <EmptyState
        size="page"
        title="Missing"
        primaryAction={{ label: 'Go to Home', to: '/elsewhere', variant: 'link' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Go to Home' });
    expect(link).toHaveAttribute('href', '/elsewhere');
    await userEvent.click(link);
    expect(screen.getByText('Elsewhere page')).toBeInTheDocument();
  });

  it('navigates from a button action that has a route', async () => {
    renderState(
      <EmptyState size="page" title="Missing" primaryAction={{ label: 'Go', to: '/elsewhere' }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByText('Elsewhere page')).toBeInTheDocument();
  });

  it('accepts a ready-made element as an action', () => {
    renderState(
      <EmptyState
        size="page"
        title="Empty"
        primaryAction={<button type="button">Custom</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
  });
});
