import { render, screen } from '@testing-library/react';
import { Home, MyWeek } from '@vibe/icons';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NavRow } from './NavRow';

function renderRows(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NavRow to="/" end icon={Home} label="Home" />
      <NavRow to="/my-work" icon={MyWeek} label="My work" />
    </MemoryRouter>,
  );
}

describe('NavRow', () => {
  it('marks only the row for the current route as active', () => {
    renderRows('/my-work');
    expect(screen.getByRole('link', { name: 'My work' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Home inactive on other pages', () => {
    renderRows('/workspaces/w1');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'My work' })).not.toHaveAttribute('aria-current');
  });
});
