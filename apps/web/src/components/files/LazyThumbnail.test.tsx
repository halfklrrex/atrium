import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUrlCache, MAX_CONCURRENT_FETCHES, resolveUrl } from './file-url-cache';
import { LazyThumbnail } from './LazyThumbnail';

let observers: { cb: IntersectionObserverCallback; el: Element }[] = [];

beforeEach(() => {
  clearUrlCache();
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        observers.push({ cb: this.cb, el });
      }
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const reveal = (i = 0) =>
  act(() =>
    observers[i]!.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );

const signed = (url: string, expiresAt = Date.now() + 300_000) => ({ downloadUrl: url, expiresAt });

describe('LazyThumbnail', () => {
  it('fetches only once it is visible, then shows the image', async () => {
    const fetchUrl = vi.fn().mockResolvedValue(signed('https://example.com/a.png'));
    const { container } = render(
      <LazyThumbnail cacheKey="k1" mimeType="image/png" fetchUrl={fetchUrl} />,
    );
    expect(fetchUrl).not.toHaveBeenCalled();
    reveal();
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(fetchUrl).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached URL for the same key until it expires', async () => {
    const fetchUrl = vi.fn().mockResolvedValue(signed('https://example.com/a.png'));
    const first = render(<LazyThumbnail cacheKey="k2" mimeType="image/png" fetchUrl={fetchUrl} />);
    reveal();
    await waitFor(() => expect(first.container.querySelector('img')).not.toBeNull());
    first.unmount();
    const second = render(<LazyThumbnail cacheKey="k2" mimeType="image/png" fetchUrl={fetchUrl} />);
    expect(second.container.querySelector('img')).not.toBeNull();
    expect(fetchUrl).toHaveBeenCalledTimes(1);

    // An URL that is about to expire is fetched again.
    await resolveUrl('k3', () =>
      Promise.resolve(signed('https://example.com/b.png', Date.now() + 1000)),
    );
    const again = vi.fn().mockResolvedValue(signed('https://example.com/c.png'));
    await resolveUrl('k3', again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('keeps the type icon when the fetch fails and never fetches non-images', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('nope'));
    const { container } = render(
      <LazyThumbnail cacheKey="k4" mimeType="image/png" fetchUrl={failing} />,
    );
    reveal();
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();

    const pdf = vi.fn();
    render(<LazyThumbnail cacheKey="k5" mimeType="application/pdf" fetchUrl={pdf} />);
    expect(observers).toHaveLength(1);
    expect(pdf).not.toHaveBeenCalled();
  });
});

describe('resolveUrl queue', () => {
  it('runs at most four fetches at once', async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const fetcher = (n: number) => () =>
      new Promise<ReturnType<typeof signed>>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        releases.push(() => {
          active -= 1;
          resolve(signed(`https://example.com/${n}.png`));
        });
      });
    const all = Array.from({ length: 10 }, (_, n) => resolveUrl(`q${n}`, fetcher(n)));
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(MAX_CONCURRENT_FETCHES);
    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
    expect(peak).toBe(MAX_CONCURRENT_FETCHES);
  });
});

describe('resolveUrl errors', () => {
  it('rejects a fetcher that throws synchronously and keeps the queue moving', async () => {
    const throwing = () => {
      throw new Error('sync');
    };
    const all = Array.from({ length: 5 }, (_, n) => resolveUrl(`t${n}`, throwing));
    for (const p of all) await expect(p).rejects.toThrow('sync');
    await expect(
      resolveUrl('after', () => Promise.resolve(signed('https://example.com/ok.png'))),
    ).resolves.toBe('https://example.com/ok.png');
  });
});
