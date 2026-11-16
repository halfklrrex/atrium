import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { appReady, expect, test } from './fixtures';
import {
  IDS,
  OVERLAP_BIG_NEXT,
  OVERLAP_BIG_PARENT,
  OVERLAP_SMALL_NEXT,
  OVERLAP_SMALL_PARENT,
  addOverlapFixture,
  removeOverlapFixture,
} from './seed';

/**
 * SUBITEMS PR 5: an open subitem block pushes the next item row down. Geometry, not pixels: for
 * the parent's sortable entry (its row plus the block) and the next item row,
 * `next.top >= entry.bottom - 1`. Runs in a small group (plain rows) and in a group of more than
 * 50 rows (virtualised, absolutely positioned rows), after expanding, after adding a subitem and
 * after collapsing again.
 *
 * Set `OVERLAP_SHOTS=<dir>` to also write screenshots of each step there (not baselines).
 */

const shotDir = process.env.OVERLAP_SHOTS;
if (shotDir) mkdirSync(shotDir, { recursive: true });

const row = (page: Page, id: string): Locator => page.locator(`[role="row"][data-item-id="${id}"]`);

/** Bottom of the parent's entry (the lowest descendant of its sortable wrapper) and the next row's top. */
async function geometry(page: Page, parentId: string, nextId: string) {
  return page.evaluate(
    ([parent, next]) => {
      const parentRow = document.querySelector(`[role="row"][data-item-id="${parent}"]`);
      const nextRow = document.querySelector(`[role="row"][data-item-id="${next}"]`);
      if (!parentRow || !nextRow) return null;
      const wrapper = parentRow.parentElement!;
      let bottom = parentRow.getBoundingClientRect().bottom;
      for (const el of wrapper.querySelectorAll('*')) {
        const box = el.getBoundingClientRect();
        if (box.height > 0) bottom = Math.max(bottom, box.bottom);
      }
      return { bottom, nextTop: nextRow.getBoundingClientRect().top };
    },
    [parentId, nextId],
  );
}

async function expectPushed(page: Page, parentId: string, nextId: string, step: string) {
  await expect
    .poll(
      async () => {
        const g = await geometry(page, parentId, nextId);
        return g ? Math.round((g.nextTop - g.bottom) * 10) / 10 : null;
      },
      { message: `${step}: next row top minus entry bottom`, timeout: 5_000 },
    )
    .toBeGreaterThanOrEqual(-1);
}

async function shot(page: Page, name: string, theme: string) {
  if (!shotDir) return;
  await page.mouse.move(800, 70);
  await page.screenshot({ path: `${shotDir}/${name}-${theme}.png` });
}

/** Scroll the board's scroll container so the group's `index`th row is near the top. */
async function scrollGroupTo(page: Page, groupTitle: string, index: number) {
  await page.evaluate(
    ([title, i]) => {
      const grid = document.querySelector(`[role="grid"][aria-label="${title} items"]`)!;
      let el: HTMLElement | null = grid.parentElement;
      while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
      const top =
        grid.getBoundingClientRect().top - el!.getBoundingClientRect().top + el!.scrollTop;
      el!.scrollTop = top + Number(i) * 36 - 150;
    },
    [groupTitle, index] as const,
  );
}

async function addSubitem(page: Page, parentId: string, name: string) {
  const entry = row(page, parentId).locator('..');
  await entry.getByText('+ Add subitem').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(entry.getByText(name)).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme: subitem block pushes the next row`, () => {
    test.use({ theme });

    test.beforeEach(async () => {
      await addOverlapFixture();
    });
    test.afterEach(async () => {
      await removeOverlapFixture();
    });

    test('small group (plain rows)', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await appReady(page);
      await expect(row(page, OVERLAP_SMALL_PARENT)).toBeVisible();
      await row(page, OVERLAP_SMALL_PARENT)
        .getByRole('button', { name: /^Expand subitems of/ })
        .click();
      await expect(page.getByText('Overlap subitem 4')).toBeVisible();
      await expectPushed(page, OVERLAP_SMALL_PARENT, OVERLAP_SMALL_NEXT, 'expanded');
      await shot(page, 'small-expanded', theme);

      await addSubitem(page, OVERLAP_SMALL_PARENT, 'Fifth overlap subitem');
      await expectPushed(page, OVERLAP_SMALL_PARENT, OVERLAP_SMALL_NEXT, 'after adding');
      await shot(page, 'small-added', theme);

      await row(page, OVERLAP_SMALL_PARENT)
        .getByRole('button', { name: /^Collapse subitems of/ })
        .click();
      await expectPushed(page, OVERLAP_SMALL_PARENT, OVERLAP_SMALL_NEXT, 'collapsed');
    });

    test('virtualised group (more than 50 rows), scrolled to the middle', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await appReady(page);
      const title = 'VF · Visual fidelity';
      await expect(page.getByRole('region', { name: title })).toBeVisible();
      await scrollGroupTo(page, title, 36);
      await expect(row(page, OVERLAP_BIG_PARENT)).toBeVisible();
      await row(page, OVERLAP_BIG_PARENT)
        .getByRole('button', { name: /^Expand subitems of/ })
        .click();
      await expect(page.getByText('Overlap big subitem 4')).toBeVisible();
      await expectPushed(page, OVERLAP_BIG_PARENT, OVERLAP_BIG_NEXT, 'expanded');
      await shot(page, 'big-expanded', theme);

      await addSubitem(page, OVERLAP_BIG_PARENT, 'Fifth big subitem');
      await expectPushed(page, OVERLAP_BIG_PARENT, OVERLAP_BIG_NEXT, 'after adding');
      await shot(page, 'big-added', theme);

      await row(page, OVERLAP_BIG_PARENT)
        .getByRole('button', { name: /^Collapse subitems of/ })
        .click();
      await expectPushed(page, OVERLAP_BIG_PARENT, OVERLAP_BIG_NEXT, 'collapsed');
    });
  });
}
