import { PARK_IN_HEADER, appReady, boardReady, expect, homeReady, shoot, test } from './fixtures';
import type { Locator } from '@playwright/test';
import { IDS, clearRecents, createEmptyWorkspace } from './seed';

/** True when `target` is what a click at its centre would hit, i.e. nothing is painted over it. */
const isOnTop = (target: Locator) =>
  target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && el.contains(hit);
  });

/**
 * Key screens, each compared against a committed Linux baseline (see docs/visual-testing.md).
 * Names are `<screen>-<theme>`. Expect other PRs to change some of these on purpose: refresh the
 * baselines with the "Update visual baselines" workflow and review the image diff in the PR.
 */

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme });

    test.describe('signed out', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('login', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Welcome to Atrium' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
        await shoot(page, `login-${theme}`);
      });
    });

    test('home', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await shoot(page, `home-${theme}`);
    });

    test('my work', async ({ page }) => {
      await page.goto('/my-work');
      await appReady(page);
      await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
      await shoot(page, `my-work-${theme}`);
    });

    test('workspace: recents tab', async ({ page }) => {
      await page.goto(`/workspaces/${IDS.personalWorkspace}`);
      await appReady(page);
      const recents = page.getByRole('list', { name: 'Recently visited boards' });
      await expect(recents.getByRole('listitem')).toHaveCount(3);
      await expect(page.getByRole('tab', { name: 'Recents' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await shoot(page, `workspace-recents-${theme}`);
    });

    test('workspace: content tab', async ({ page }) => {
      await page.goto(`/workspaces/${IDS.personalWorkspace}`);
      await appReady(page);
      await page.getByRole('tab', { name: 'Content' }).click();
      const table = page.getByRole('table', { name: 'Workspace content' });
      await table.getByRole('button', { name: 'Q4 planning' }).click();
      for (const name of ['Product roadmap', 'Sprint planning', 'Meeting notes']) {
        await expect(table.getByRole('link', { name })).toBeVisible();
      }
      await shoot(page, `workspace-content-${theme}`);
    });

    test('board page', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await shoot(page, `board-${theme}`, PARK_IN_HEADER);
    });

    test('board: status picker open', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.locator('[data-cell="roadmap-item-02:status"]').click();
      const picker = page.getByRole('dialog', { name: 'Status labels' });
      await expect(picker.getByRole('option', { name: 'Done' })).toBeVisible();
      await shoot(page, `board-status-picker-${theme}`, PARK_IN_HEADER);
    });

    test('board: collapsed group', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('button', { name: 'Collapse group VF · Visual fidelity' }).click();
      await expect(
        page.getByRole('button', { name: 'Expand group VF · Visual fidelity' }),
      ).toBeVisible();
      await shoot(page, `board-collapsed-group-${theme}`, PARK_IN_HEADER);
    });

    test('board: batch bar', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page
        .getByRole('checkbox', { name: 'Select Firebase project and emulators', exact: true })
        .click();
      await page
        .getByRole('checkbox', { name: 'Select Architecture and data model spec', exact: true })
        .click();
      const bar = page.getByRole('region', { name: 'Selected items' });
      await expect(bar.getByText('Items selected')).toBeVisible();
      await shoot(page, `board-batch-bar-${theme}`, PARK_IN_HEADER);
    });

    // Regression: floating menus used to paint underneath the table's sticky header row.
    test('board: board options menu over the table', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Options for Product roadmap' })
        .click();
      const permissions = page.getByRole('menuitem', { name: 'Board permissions' });
      await expect(permissions).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Delete board' })).toBeVisible();
      await expect.poll(() => isOnTop(permissions)).toBe(true);
      await shoot(page, `board-options-menu-${theme}`, PARK_IN_HEADER);
    });

    test('board: column header menu over the table', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('columnheader', { name: 'Area' }).first().hover();
      await page.getByRole('button', { name: 'Options for Area' }).first().click();
      const menu = page.getByRole('menu').last();
      await expect(menu).toBeVisible();
      await expect.poll(() => isOnTop(menu.getByRole('menuitem').last())).toBe(true);
      await shoot(page, `board-column-menu-${theme}`, PARK_IN_HEADER);
    });

    test('board: scrolled to the last columns', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      // The Item column stays pinned (with its soft shadow) while the other columns scroll past.
      await page.getByLabel('Board table').evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await expect(page.getByRole('columnheader', { name: 'Budget' }).first()).toBeInViewport();
      await shoot(page, `board-scrolled-${theme}`, PARK_IN_HEADER);
    });

    test('board: date picker open', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.locator('[data-cell="roadmap-item-01:date"]').click();
      await expect(
        page.getByRole('dialog', { name: 'Date' }).getByRole('button', { name: 'Today' }),
      ).toBeVisible();
      await shoot(page, `board-date-picker-${theme}`, PARK_IN_HEADER);
    });

    test('board: search highlights matches', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('toolbar').getByRole('button', { name: 'Search' }).click();
      await page.getByRole('textbox', { name: 'Search this board' }).fill('sign-in');
      await expect(page.locator('mark').first()).toBeVisible();
      await shoot(page, `board-search-${theme}`, PARK_IN_HEADER);
    });

    test('sidebar collapsed', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await shoot(page, `sidebar-collapsed-${theme}`);
    });

    test('workspace switcher open', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.locator('#app-sidebar').getByRole('button', { name: "Avery's workspace" }).click();
      const switcher = page.getByRole('dialog', { name: 'Switch workspace' });
      await expect(switcher.getByText('My workspaces')).toBeVisible();
      await expect(switcher.getByRole('menuitemradio')).not.toHaveCount(0);
      await shoot(page, `workspace-switcher-${theme}`);
    });

    test('add to workspace menu open', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Add to workspace' }).click();
      await expect(page.getByRole('menuitem', { name: 'New workspace' })).toBeVisible();
      await shoot(page, `add-menu-${theme}`);
    });

    test('create board dialog', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Add to workspace' }).click();
      // Vibe menu items only react once they are hovered: a bare click can land too early.
      const item = page.getByRole('menuitem', { name: 'Board', exact: true });
      await item.hover();
      await item.click({ delay: 100 });
      const dialog = page.getByRole('dialog', { name: 'Create board' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Board name' })).toBeFocused();
      await shoot(page, `create-board-dialog-${theme}`);
    });

    test('notifications panel open', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Notifications' });
      await expect(panel.getByText("You're all caught up!")).toBeVisible();
      await shoot(page, `notifications-panel-${theme}`);
    });

    test('404 page', async ({ page }) => {
      await page.goto('/this-page-does-not-exist');
      await appReady(page);
      await expect(page.getByText("We couldn't find that page")).toBeVisible();
      await shoot(page, `not-found-${theme}`);
    });

    test('empty workspace', async ({ page }) => {
      await createEmptyWorkspace();
      await page.goto(`/workspaces/${IDS.emptyWorkspace}`);
      await appReady(page);
      await expect(page.getByText('This workspace is empty')).toBeVisible();
      await shoot(page, `workspace-empty-${theme}`);
    });

    test('home with no recents', async ({ page }) => {
      await clearRecents();
      await page.goto('/');
      await appReady(page);
      await expect(page.getByText('Good morning, Avery!')).toBeVisible();
      await expect(page.getByText('No boards visited yet')).toBeVisible();
      await expect(page.getByRole('main').getByRole('link', { name: /Family/ })).toBeVisible();
      await shoot(page, `home-no-recents-${theme}`);
    });

    test.describe('mobile 390x844', () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test('home, drawer closed', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Good morning, Avery!')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
        await expect(page.getByText('Loading…')).toHaveCount(0);
        await shoot(page, `mobile-home-${theme}`);
      });

      test('home, drawer open', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Good morning, Avery!')).toBeVisible();
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(page.getByRole('button', { name: 'Close navigation' }).first()).toBeVisible();
        const sidebar = page.locator('#app-sidebar');
        await expect(sidebar.getByText('Q4 planning')).toBeVisible();
        await expect(sidebar.getByText('Product roadmap')).toBeVisible();
        await shoot(page, `mobile-home-drawer-${theme}`);
      });
    });
  });
}

// Black is the third Vibe theme; the spec asks for it on Home and the board page only.
test.describe('black theme', () => {
  test.use({ theme: 'black' });

  test('home', async ({ page }) => {
    await page.goto('/');
    await homeReady(page);
    await shoot(page, 'home-black');
  });

  test('board page', async ({ page }) => {
    await page.goto(`/boards/${IDS.roadmap}`);
    await boardReady(page);
    await shoot(page, 'board-black', PARK_IN_HEADER);
  });
});
