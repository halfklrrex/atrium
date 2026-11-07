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

/**
 * Width in CSS px of a landscape page's printable area, kept below A4 (about 1030) and Letter
 * (about 965) so one value fits both. The table is scaled down to this, never up.
 */
export const PRINT_PAGE_WIDTH = 940;
/** Space around the groups inside the table's scroll area (its gutters), in CSS px. */
const TABLE_GUTTERS = 64;
const MIN_PRINT_SCALE = 0.5;
export const PRINT_SCALE_VAR = '--atrium-print-scale';

/** Zoom that fits `contentWidth` on a page: 1 when it already fits, never below 0.5. */
export function printScale(contentWidth: number, pageWidth = PRINT_PAGE_WIDTH): number {
  if (!(contentWidth > pageWidth) || !(pageWidth > 0)) return 1;
  return Math.max(MIN_PRINT_SCALE, Math.round((pageWidth / contentWidth) * 100) / 100);
}

/** Sets (or clears) the scale the print CSS applies to the board table, from its current layout. */
function applyPrintScale(on: boolean): void {
  const root = document.documentElement;
  if (!on) {
    root.style.removeProperty(PRINT_SCALE_VAR);
    return;
  }
  const groups = document.querySelectorAll<HTMLElement>("[data-print-page='board'] section");
  let widest = 0;
  groups.forEach((group) => {
    widest = Math.max(widest, group.offsetWidth);
  });
  root.style.setProperty(PRINT_SCALE_VAR, String(printScale(widest ? widest + TABLE_GUTTERS : 0)));
}

function set(next: boolean): void {
  if (printing === next) return;
  // Measure before the rows are all rendered: the width does not depend on them.
  applyPrintScale(next);
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
    applyPrintScale(false);
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
