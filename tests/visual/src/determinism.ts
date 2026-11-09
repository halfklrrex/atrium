import type { BrowserContext, Page } from '@playwright/test';
import { FROZEN_TIME, LOCALE, TIMEZONE } from './env';

export type Theme = 'light' | 'dark' | 'black';

/** Context options shared by the suite and the sign-in setup, so both see the same world. */
export const CONTEXT_OPTIONS = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: LOCALE,
  timezoneId: TIMEZONE,
  colorScheme: 'light',
  reducedMotion: 'reduce',
} as const;

/**
 * Makes a context deterministic: time frozen at 2026-10-24 09:00Z and every external request blocked
 * (Google avatars, analytics and the like). The fonts are self-hosted by the app, so they need no routing.
 */
export async function makeDeterministic(context: BrowserContext): Promise<void> {
  // Date is fixed, timers keep running, so Firebase's networking and React's scheduling still work.
  await context.clock.setFixedTime(FROZEN_TIME);

  // A frozen clock breaks Firestore's IndexedDB tab-lease renewal (Date.now() doesn't advance),
  // causing queries to deadlock on Loading... Signal the app to use memoryLocalCache here.
  await context.addInitScript(() => {
    (window as unknown as { __ATRIUM_DETERMINISTIC__?: boolean }).__ATRIUM_DETERMINISTIC__ = true;
  });

  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, async (route) =>
    route.abort(),
  );
}

/** Choose the Vibe theme the way the app persists it (zustand `atrium.theme` in localStorage). */
export async function setTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addInitScript((preference) => {
    try {
      localStorage.setItem('atrium.theme', JSON.stringify({ state: { preference }, version: 1 }));
    } catch {
      /* storage unavailable: the app falls back to its default theme */
    }
  }, theme);
}

/** Wait until web fonts are loaded and two frames have painted, so layout has settled. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
