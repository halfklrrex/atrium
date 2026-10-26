import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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

const require = createRequire(import.meta.url);

/** Font files come from pinned npm packages, never from Google, so text renders the same every run. */
const FONTS: { family: string; pkg: string; slug: string; weights: number[] }[] = [
  { family: 'Figtree', pkg: '@fontsource/figtree', slug: 'figtree', weights: [400, 500, 600, 700] },
  { family: 'Poppins', pkg: '@fontsource/poppins', slug: 'poppins', weights: [500, 600] },
  { family: 'Roboto', pkg: '@fontsource/roboto', slug: 'roboto', weights: [500] },
];
const FONT_HOST = 'https://fonts.gstatic.com/atrium-local/';

function fontFile(font: (typeof FONTS)[number], weight: number): string {
  const pkgDir = dirname(require.resolve(`${font.pkg}/package.json`));
  return join(pkgDir, 'files', `${font.slug}-latin-${weight}-normal.woff2`);
}

function fontCss(): string {
  return FONTS.flatMap((font) =>
    font.weights.map(
      (weight) =>
        `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${weight};` +
        `font-display:block;src:url(${FONT_HOST}${font.slug}-${weight}.woff2) format('woff2');}`,
    ),
  ).join('\n');
}

/**
 * Makes a context deterministic: time frozen at 2026-10-24 09:00Z, fonts served locally, and every
 * other external request blocked (Google avatars, analytics and the like).
 */
export async function makeDeterministic(context: BrowserContext): Promise<void> {
  // Date is fixed, timers keep running, so Firebase's networking and React's scheduling still work.
  await context.clock.setFixedTime(FROZEN_TIME);

  // A frozen clock breaks Firestore's IndexedDB tab-lease renewal (Date.now() doesn't advance),
  // causing queries to deadlock on Loading... Signal the app to use memoryLocalCache here.
  await context.addInitScript(() => {
    (window as unknown as { __ATRIUM_DETERMINISTIC__?: boolean }).__ATRIUM_DETERMINISTIC__ = true;
  });

  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ contentType: 'text/css', body: fontCss() });
    }
    if (url.hostname === 'fonts.gstatic.com' && url.pathname.startsWith('/atrium-local/')) {
      const [, slug, weight] =
        /^(\w+)-(\d+)\.woff2$/.exec(url.pathname.split('/').pop() ?? '') ?? [];
      const font = FONTS.find((f) => f.slug === slug);
      if (font && weight) {
        return route.fulfill({
          contentType: 'font/woff2',
          body: readFileSync(fontFile(font, Number(weight))),
        });
      }
    }
    return route.abort();
  });
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
