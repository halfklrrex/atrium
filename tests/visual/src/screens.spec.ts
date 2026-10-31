import {
  PARK_IN_HEADER,
  appReady,
  boardReady,
  expect,
  homeReady,
  calendarReady,
  kanbanReady,
  timelineReady,
  shoot,
  test,
} from './fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  FULL_VIEW_ITEM,
  IDS,
  CALENDAR_VIEW,
  KANBAN_VIEW,
  TIMELINE_VIEW,
  addCalendarView,
  addKanbanView,
  addTimelineView,
  addView,
  clearRecents,
  readFullViewDescription,
  resetFullViewDescription,
  createEmptyWorkspace,
  removeCalendarView,
  removeKanbanView,
  removeTimelineView,
  removeView,
  seedNotifications,
} from './seed';

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

/** Open the seeded full item view and wait for its description, subitems and update. */
async function fullViewReady(page: Page) {
  await page.goto(`/boards/${IDS.roadmap}/items/${FULL_VIEW_ITEM}`);
  const view = page.getByRole('dialog', { name: /^Item / });
  await expect(view).toBeVisible();
  await expect(view.getByText('Ship the pipeline')).toBeVisible();
  await expect(view.getByText('Write the workflow')).toBeVisible();
  await expect(view.getByText('The workflow runs on every pull request now.')).toBeVisible();
  await expect(page.getByText('Loading�')).toHaveCount(0);
}

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

    test('board: view tabs with unsaved changes', async ({ page }) => {
      await addView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/main`);
        await boardReady(page);
        await expect(page.getByRole('tab', { name: 'Due soon' })).toBeVisible();
        // Hiding a column is an unsaved change: a dot on the tab and "Save to this view".
        await page.getByRole('button', { name: 'Hide columns' }).click();
        await page
          .getByRole('dialog', { name: 'Hide columns' })
          .getByText('Budget', { exact: true })
          .click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Save to this view' })).toBeVisible();
        await expect(page.getByRole('img', { name: 'Unsaved changes' })).toBeVisible();
        await shoot(page, `board-views-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeView();
      }
    });

    test('board: Hide columns popover', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}/views/main`);
      await boardReady(page);
      await page.getByRole('button', { name: 'Hide columns' }).click();
      const panel = page.getByRole('dialog', { name: 'Hide columns' });
      await expect(panel.getByText('Budget', { exact: true })).toBeVisible();
      await panel.getByText('Area', { exact: true }).click();
      await shoot(page, `board-hide-popover-${theme}`, PARK_IN_HEADER);
    });

    test('board: Kanban view', async ({ page }) => {
      await addKanbanView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${KANBAN_VIEW}`);
        await kanbanReady(page);
        await shoot(page, `board-kanban-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeKanbanView();
      }
    });

    test('board: Kanban view with a collapsed lane', async ({ page }) => {
      await addKanbanView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${KANBAN_VIEW}`);
        await kanbanReady(page);
        await page.getByRole('button', { name: 'Collapse Done lane' }).click({ force: true });
        await expect(page.getByRole('button', { name: /^Expand Done lane/ })).toBeVisible();
        await shoot(page, `board-kanban-collapsed-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeKanbanView();
      }
    });

    test('board: Calendar view (month)', async ({ page }) => {
      await addCalendarView('month');
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${CALENDAR_VIEW}`);
        // Nine of the roadmap's dated items fall in October 2026.
        await calendarReady(page, 'October 2026', 9);
        await shoot(page, `board-calendar-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeCalendarView();
      }
    });

    test('board: Calendar view (week)', async ({ page }) => {
      await addCalendarView('week');
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${CALENDAR_VIEW}`);
        await calendarReady(page, 'Oct 19 \u2013 25, 2026', 3);
        await shoot(page, `board-calendar-week-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeCalendarView();
      }
    });

    test('board: Timeline view', async ({ page }) => {
      await addTimelineView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${TIMELINE_VIEW}`);
        // Fourteen of the roadmap's items have a date (nine in October, five in November).
        await timelineReady(page, 14);
        await shoot(page, `board-timeline-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeTimelineView();
      }
    });

    test('board: full item view', async ({ page }) => {
      await fullViewReady(page);
      await shoot(page, `item-full-view-${theme}`);
    });

    test('board: description slash menu open', async ({ page }) => {
      await fullViewReady(page);
      const editor = page.locator('.ProseMirror');
      await editor.getByText('Details live in the spec linked from this item.').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await expect(page.getByRole('listbox', { name: 'Blocks' })).toBeVisible();
      await shoot(page, `item-slash-menu-${theme}`);
      // Leave the shared description as it was found: undo the edit, wait until the autosave has
      // written the cleaned doc (so no save of the "/" can land later), then reseed it exactly.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect
        .poll(async () => JSON.stringify((await readFullViewDescription())?.doc).includes('"/"'))
        .toBe(false);
      await expect(editor).not.toContainText('/');
      await resetFullViewDescription();
    });

    test('board: description mention list open', async ({ page }) => {
      await fullViewReady(page);
      const editor = page.locator('.ProseMirror');
      await expect(editor.locator('span[data-type="mention"]')).toBeVisible();
      await editor.getByText('Details live in the spec linked from this item.').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('@');
      await expect(page.getByRole('listbox', { name: 'People' })).toBeVisible();
      await shoot(page, `item-mention-list-${theme}`);
      // Leave the shared description as it was found, like the slash menu screen above.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect
        .poll(async () => JSON.stringify((await readFullViewDescription())?.doc).includes('"@"'))
        .toBe(false);
      await resetFullViewDescription();
    });

    test('board: description colour popover open', async ({ page }) => {
      await fullViewReady(page);
      await page.locator('.ProseMirror').getByText('blocked').dblclick();
      await page.getByRole('button', { name: 'Text colour and highlight' }).click();
      await expect(page.getByRole('dialog', { name: 'Colours' })).toBeVisible();
      await shoot(page, `item-colour-popover-${theme}`);
    });

    test('board: description emoji picker open', async ({ page }) => {
      await fullViewReady(page);
      await page.getByRole('button', { name: 'Emoji', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Emoji' });
      await expect(picker.getByRole('button', { name: 'grinning' })).toBeVisible();
      await shoot(page, `item-emoji-picker-${theme}`);
    });

    test('board: description expanded', async ({ page }) => {
      await fullViewReady(page);
      await page.getByRole('button', { name: 'Expand', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Description' })).toBeVisible();
      await expect(
        page.getByRole('dialog', { name: 'Description' }).locator('table'),
      ).toBeVisible();
      await shoot(page, `item-description-expanded-${theme}`);
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

    // P4b: the board's Share dialog (kind choice, people with access, add people).
    test('board: share dialog', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('button', { name: /^Invite \/ \d+$/ }).click();
      const dialog = page.getByRole('dialog', { name: /^Share / });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radiogroup')).toBeVisible();
      await shoot(page, `board-share-dialog-${theme}`, PARK_IN_HEADER);
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

    // Change column type: the submenu of the column header menu, and the confirm dialog. Nothing is
    // converted: the dialog is closed again, so the shared seed is left as it was found.
    test('board: change column type submenu', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('columnheader', { name: 'Area' }).first().hover();
      await page.getByRole('button', { name: 'Options for Area' }).first().click();
      await page.getByRole('menuitem', { name: 'Change column type' }).hover();
      await expect(page.getByRole('menuitem', { name: 'Text', exact: true })).toBeVisible();
      await shoot(page, `board-change-type-submenu-${theme}`, PARK_IN_HEADER);
    });

    test('board: change column type dialog', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('columnheader', { name: 'Area' }).first().hover();
      await page.getByRole('button', { name: 'Options for Area' }).first().click();
      await page.getByRole('menuitem', { name: 'Change column type' }).hover();
      // Vibe's submenu item only reacts to a click once the pointer has settled on it (a real user
      // always hovers first); a bare Playwright click moves and presses in one go and is ignored.
      const target = page.getByRole('menuitem', { name: 'Text', exact: true });
      await target.hover();
      await target.click();
      await expect(page.getByTestId('change-type-counts')).toBeVisible();
      await shoot(page, `board-change-type-dialog-${theme}`, PARK_IN_HEADER);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('change-type-counts')).toHaveCount(0);
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

    test('notifications panel open, empty', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Notifications' });
      await expect(panel.getByText("You're all caught up!")).toBeVisible();
      await shoot(page, `notifications-panel-empty-${theme}`);
    });

    test('notifications panel open, with notifications', async ({ page }) => {
      await seedNotifications();
      await page.goto('/');
      await homeReady(page);
      // The bell carries the unread count: two of the three are unread.
      await page.getByRole('button', { name: 'Notifications, 2 unread' }).click();
      const panel = page.getByRole('complementary', { name: 'Notifications' });
      await expect(panel.getByText('Mentioned you in an update')).toBeVisible();
      await expect(panel.getByText('Replied to your update')).toBeVisible();
      await expect(panel.getByText('Assigned you to an item')).toBeVisible();
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

      test('full item view', async ({ page }) => {
        await fullViewReady(page);
        await shoot(page, `mobile-item-full-view-${theme}`);
      });

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
