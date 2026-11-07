import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADING_TOAST_MAX_MS, showToast, updateToast, useToastStore } from './toast-store';

const texts = () => useToastStore.getState().toasts.map((t) => t.text);

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('toast-store', () => {
  it('shows a loading toast and replaces it in place with update', () => {
    const id = showToast('Updating 3 selected items', { loading: true });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ id, loading: true, type: 'normal' });
    updateToast(id, 'Updated 3 items', { type: 'positive' });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, text: 'Updated 3 items', type: 'positive' });
    expect(toasts[0]!.loading).toBeUndefined();
  });

  it('store.update is a no-op for a dismissed toast, and updateToast re-shows it', () => {
    const id = showToast('Updating', { loading: true });
    useToastStore.getState().dismiss(id);
    useToastStore.getState().update(id, { text: 'ignored' });
    expect(texts()).toEqual([]);
    updateToast(id, 'Updated 2 items');
    expect(texts()).toEqual(['Updated 2 items']);
  });

  it('keeps at most three toasts without silently evicting a loading one', () => {
    const loading = showToast('Updating', { loading: true });
    showToast('a');
    showToast('b');
    showToast('c');
    expect(texts()).toEqual(['Updating', 'b', 'c']);
    expect(useToastStore.getState().toasts.some((t) => t.id === loading)).toBe(true);
    showToast('d');
    expect(texts()).toEqual(['Updating', 'c', 'd']);
  });

  it('auto-dismisses a loading toast after the safety timeout', () => {
    showToast('Updating', { loading: true });
    vi.advanceTimersByTime(LOADING_TOAST_MAX_MS - 1);
    expect(texts()).toEqual(['Updating']);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it('does not dismiss a loading toast that was updated into a result, nor touch other toasts', () => {
    const id = showToast('Updating', { loading: true });
    showToast('Plain');
    updateToast(id, 'Updated');
    vi.advanceTimersByTime(LOADING_TOAST_MAX_MS * 2);
    expect(texts()).toEqual(['Updated', 'Plain']);
  });

  it('restarts the safety timer when a toast is updated but still loading', () => {
    const id = showToast('Updating', { loading: true });
    vi.advanceTimersByTime(LOADING_TOAST_MAX_MS - 1000);
    updateToast(id, 'Still updating', { loading: true });
    vi.advanceTimersByTime(LOADING_TOAST_MAX_MS - 1000);
    expect(texts()).toEqual(['Still updating']);
    vi.advanceTimersByTime(1000);
    expect(texts()).toEqual([]);
  });
});
