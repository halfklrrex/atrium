import { useSyncExternalStore } from 'react';

/** True while the media query matches; re-renders when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone width. Must match the `@media (width < 768px)` blocks in the Settings CSS and theme. */
export const PHONE_QUERY = '(width < 768px)';

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
