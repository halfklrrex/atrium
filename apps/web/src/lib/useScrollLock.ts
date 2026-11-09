import { useEffect } from 'react';

let locks = 0;

/**
 * Locks the page behind an open overlay (the notifications panel, the phone drawer). While any lock
 * is held, `html[data-scroll-locked]` sets `overflow: hidden` (see index.css) so a swipe at the end
 * of the overlay's own scroll area can't move the page or the shell behind it. Counted, so two
 * overlays at once release in any order.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    locks += 1;
    document.documentElement.setAttribute('data-scroll-locked', '');
    return () => {
      locks -= 1;
      if (locks <= 0) {
        locks = 0;
        document.documentElement.removeAttribute('data-scroll-locked');
      }
    };
  }, [active]);
}
