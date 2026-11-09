import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from '../../theme/theme';
import { AppearanceTab } from './AppearanceTab';

describe('AppearanceTab', () => {
  beforeEach(() => useThemeStore.setState({ preference: 'system' }));

  it('offers System, Light, Dark and Black as one radio group', () => {
    render(<AppearanceTab />);
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'system',
      'light',
      'dark',
      'black',
    ]);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('writes the choice to the theme store', async () => {
    render(<AppearanceTab />);
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }));
    expect(useThemeStore.getState().preference).toBe('black');
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked();
  });

  it('is operable with the keyboard', async () => {
    render(<AppearanceTab />);
    screen.getByRole('radio', { name: 'System' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(useThemeStore.getState().preference).toBe('light');
  });
});
