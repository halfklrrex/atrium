import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme, useThemeStore } from './theme';

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    useThemeStore.setState({ preference: 'system' });
  });

  it('resolves "system" from the OS preference and passes explicit choices through', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('black', false)).toBe('black');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('puts exactly one Vibe theme class on the root element', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark-app-theme');
    applyTheme('black');
    expect(document.documentElement).toHaveClass('black-app-theme');
    expect(document.documentElement).not.toHaveClass('dark-app-theme');
    applyTheme('light');
    expect(document.documentElement.classList.contains('black-app-theme')).toBe(false);
    expect(document.documentElement).toHaveClass('light-app-theme');
  });

  it('stores the chosen preference', () => {
    useThemeStore.getState().setPreference('black');
    expect(useThemeStore.getState().preference).toBe('black');
  });
});
