import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { makeDeterministic, setTheme, settle, type Theme } from './determinism';
import { resetUserState } from './seed';

export { expect };

interface Fixtures {
  /** Vibe theme to start in; set per describe block with `test.use({ theme })`. */
  theme: Theme;
  /** Puts favourites, recents and the remembered workspace back to the seeded state. */
  seededState: void;
  /** Fails the test when the page threw an uncaught error (a crash jsdom would not show). */
  pageErrors: void;
}

export const test = base.extend<Fixtures>({
  theme: ['light', { option: true }],

  seededState: [
    // Playwright requires the first argument to be a destructuring pattern, even an empty one.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await resetUserState();
      await use();
    },
    { auto: true },
  ],

  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (page: Page) => page.on('pageerror', (error) => errors.push(String(error)));
      context.pages().forEach(watch);
      context.on('page', watch);
      await use();
      expect(errors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],

  context: async ({ context, theme, seededState: _seeded }, use) => {
    await makeDeterministic(context);
    await setTheme(context, theme);
    await use(context);
  },
});

/** Anything that can differ between runs: remote images (avatars) and explicitly marked nodes. */
const dynamicContent = (page: Page): Locator[] => [
  page.locator('img[src^="http"]'),
  page.locator('[data-visual-mask]'),
];

/** True when the document itself (not an inner panel) scrolls. */
const documentScrolls = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);

/**
 * Take the screenshot of `name`: wait for fonts and paint, park the mouse out of the way (no stray
 * hover states or tooltips), then compare. Full-page only when the page itself scrolls.
 */
export async function shoot(
  page: Page,
  name: string,
  options: { park?: { x: number; y: number } } = {},
): Promise<void> {
  await settle(page);
  const viewport = page.viewportSize();
  // Board tables run to the window edges, so there the mouse parks in the board header instead.
  if (options.park) await page.mouse.move(options.park.x, options.park.y);
  else if (viewport) await page.mouse.move(viewport.width - 2, viewport.height - 2);
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: await documentScrolls(page),
    mask: dynamicContent(page),
  });
}

/** The signed-in app shell is up and nothing is still loading. */
export async function appReady(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

/** An empty spot in the board header: no hover state of the table or the sidebar is triggered. */
export const PARK_IN_HEADER = { park: { x: 800, y: 70 } } as const;

/** The seeded "Product roadmap" table: header, three groups and all 18 items loaded. */
export async function boardReady(page: Page): Promise<void> {
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Product roadmap', level: 2 })).toBeVisible();
  for (const group of ['P0 · Foundations', 'VF · Visual fidelity', 'P1 · Core boards']) {
    await expect(page.getByRole('region', { name: group })).toBeVisible();
  }
  await expect(page.locator('[role="row"][data-item-id]')).toHaveCount(18);
}

/** The seeded roadmap as a Kanban view: lanes for the status labels and all 18 cards. */
export async function kanbanReady(page: Page): Promise<void> {
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Product roadmap', level: 2 })).toBeVisible();
  for (const lane of ['Done', 'Building', 'In review', 'Stuck', 'Not started']) {
    await expect(page.getByRole('region', { name: lane })).toBeVisible();
  }
  await expect(page.locator('[data-card]')).toHaveCount(18);
}

/** The seeded roadmap as a Calendar view: the month (or week) of the frozen day, with its dated items. */
export async function calendarReady(page: Page, title: string, pills: number): Promise<void> {
  await appReady(page);
  await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
  await expect(page.getByRole('grid', { name: title })).toBeVisible();
  await expect(page.locator('[data-item]')).toHaveCount(pills);
}

/** Home with all four seeded boards and both workspaces rendered (snapshots arrive separately). */
export async function homeReady(page: Page): Promise<void> {
  await appReady(page);
  await expect(page.getByText('Good morning, Avery!')).toBeVisible();
  const main = page.getByRole('main');
  for (const board of ['Product roadmap', 'Meeting notes', 'Sprint planning', 'Summer trip']) {
    await expect(main.getByRole('link', { name: board })).toBeVisible();
  }
  await expect(main.getByRole('link', { name: /Avery's workspace/ })).toBeVisible();
  await expect(main.getByRole('link', { name: /Family/ })).toBeVisible();
  // The sidebar tree and favourites come from separate listeners.
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar.getByText('Q4 planning')).toBeVisible();
  await expect(sidebar.getByText('Meeting notes')).toBeVisible();
  await expect(sidebar.getByText('Product roadmap')).toBeVisible();
}
