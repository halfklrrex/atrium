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
});
