import type { ThemePreference } from '@atrium/shared';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../components/toast-store';
import { adoptedKey, THEME_SAVE_ERROR, useAccountThemeSync } from './account-theme';
import { useThemeStore } from './theme';

const mocks = vi.hoisted(() => ({
  doc: null as { theme: ThemePreference } | null,
  setTheme: vi.fn(),
}));

vi.mock('../data/user-settings', () => ({
  useMyUserDoc: () => ({ data: mocks.doc, loading: false }),
  userWrites: { setTheme: mocks.setTheme },
}));

function Harness({ uid = 'u1' }: { uid?: string }) {
  useAccountThemeSync(uid);
  return null;
}

const flush = () => act(async () => {});

describe('useAccountThemeSync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.doc = null;
    mocks.setTheme.mockReset().mockResolvedValue(undefined);
    useThemeStore.setState({ preference: 'system' });
    useToastStore.setState({ toasts: [] });
  });

  it('adopts a Dark browser choice into a system account once, and sets the flag', async () => {
    useThemeStore.setState({ preference: 'dark' });
    mocks.doc = { theme: 'system' };
    const view = render(<Harness />);
    await flush();
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith('u1', 'dark');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(localStorage.getItem(adoptedKey('u1'))).not.toBeNull();

    // The account now says dark: no write-back, no loop across snapshots or re-renders.
    mocks.doc = { theme: 'dark' };
    view.rerender(<Harness />);
    await flush();
    mocks.doc = { theme: 'system' };
    view.rerender(<Harness />);
    await flush();
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
  });

  it('does not adopt again on a device that already has the flag (account wins)', async () => {
    localStorage.setItem(adoptedKey('u1'), '1');
    useThemeStore.setState({ preference: 'dark' });
    mocks.doc = { theme: 'system' };
    render(<Harness />);
    await flush();
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('lets a Dark account win over a Light browser, without writing back', async () => {
    useThemeStore.setState({ preference: 'light' });
    mocks.doc = { theme: 'dark' };
    render(<Harness />);
    await flush();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(localStorage.getItem(adoptedKey('u1'))).not.toBeNull();
  });

  it('does nothing when both are system', async () => {
    mocks.doc = { theme: 'system' };
    render(<Harness />);
    await flush();
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it('writes a local change once, and not when it equals the account value', async () => {
    mocks.doc = { theme: 'light' };
    render(<Harness />);
    await flush();
    act(() => useThemeStore.getState().setPreference('black'));
    await flush();
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith('u1', 'black');
  });

  it('applies a later account change from another device without writing back', async () => {
    mocks.doc = { theme: 'light' };
    const view = render(<Harness />);
    await flush();
    mocks.doc = { theme: 'black' };
    view.rerender(<Harness />);
    await flush();
    expect(useThemeStore.getState().preference).toBe('black');
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it('shows the toast and keeps the local choice when a write is refused', async () => {
    mocks.doc = { theme: 'light' };
    const view = render(<Harness />);
    await flush();
    mocks.setTheme.mockRejectedValueOnce(new Error('permission-denied'));
    act(() => useThemeStore.getState().setPreference('dark'));
    await flush();
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(THEME_SAVE_ERROR);
    expect(useThemeStore.getState().preference).toBe('dark');
    // The rollback snapshot (account still light) does not flip the device back.
    view.rerender(<Harness />);
    await flush();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
  });

  it('shows the toast and does not retry when the adoption write is refused', async () => {
    mocks.setTheme.mockRejectedValue(new Error('permission-denied'));
    useThemeStore.setState({ preference: 'dark' });
    mocks.doc = { theme: 'system' };
    const view = render(<Harness />);
    await flush();
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(THEME_SAVE_ERROR);
    view.rerender(<Harness />);
    await flush();
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(localStorage.getItem(adoptedKey('u1'))).not.toBeNull();
  });
});
