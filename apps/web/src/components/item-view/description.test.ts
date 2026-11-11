import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from './description';

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs only the last scheduled save, after 800ms of quiet', () => {
    const d = createDebouncer(800);
    const save = vi.fn();
    d.schedule(() => save('a'));
    vi.advanceTimersByTime(500);
    d.schedule(() => save('b'));
    vi.advanceTimersByTime(500);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('b');
  });

  it('flushes a pending save at once and can cancel it', () => {
    const d = createDebouncer(800);
    const save = vi.fn();
    d.schedule(save);
    d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    d.schedule(save);
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
