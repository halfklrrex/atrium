import { useSyncExternalStore } from 'react';

/**
 * True while the browser is preparing or showing the print layout. Big groups of the board table
 * are virtualised on screen (only the rows near the viewport exist), so printing would cut them
 * off; while this is true they render every row instead.
 *
 * `beforeprint` fires before the browser lays out the page, and `useSyncExternalStore` re-renders
 * synchronously, so the full list is in the DOM by the time the page is measured. The
 * `matchMedia('print')` listener covers browsers that only report the media change (and the
 * `emulateMedia({ media: 'print' })` used by the visual tests).
 */
let printing = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (printing === next) return;
  printing = next;
  listeners.forEach((listener) => listener());
}

let attached: (() => void) | null = null;

function attach(): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  const onBefore = () => set(true);
  const onAfter = () => set(media?.matches ?? false);
  const onMedia = (event: MediaQueryListEvent) => set(event.matches);
  window.addEventListener('beforeprint', onBefore);
  window.addEventListener('afterprint', onAfter);
  media?.addEventListener?.('change', onMedia);
  if (media?.matches) set(true);
  return () => {
    window.removeEventListener('beforeprint', onBefore);
    window.removeEventListener('afterprint', onAfter);
    media?.removeEventListener?.('change', onMedia);
    printing = false;
  };
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) attached = attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      attached?.();
      attached = null;
    }
  };
}

export function usePrinting(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => printing,
    () => false,
  );
}
