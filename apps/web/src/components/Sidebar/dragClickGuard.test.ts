import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragClickGuard, guardedNavigate } from './dragClickGuard';

describe('dragClickGuard', () => {
  afterEach(() => vi.useRealTimers());

  it('swallows the click that ends a drag, then allows clicks on the next tick', () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    const preventDefault = vi.fn();
    const click = guardedNavigate(onNavigate);

    dragClickGuard.start();
    dragClickGuard.end();
    click({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();

    vi.runAllTimers();
    click({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('a plain click navigates', () => {
    const onNavigate = vi.fn();
    guardedNavigate(onNavigate)({ preventDefault: vi.fn() });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('cancels the native link follow even when dnd-kit stops propagation', () => {
    vi.useFakeTimers();
    const link = document.createElement('a');
    link.href = '/boards/x';
    document.body.appendChild(link);
    const dndKit = (e: Event) => e.stopPropagation();
    document.addEventListener('click', dndKit, true);

    dragClickGuard.start();
    const during = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    dragClickGuard.end();
    vi.advanceTimersByTime(200);
    const after = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);

    document.removeEventListener('click', dndKit, true);
    link.remove();
  });
});
