import {
  PARK_IN_HEADER,
  appReady,
  boardReady,
  expect,
  homeReady,
  calendarReady,
  kanbanReady,
  timelineReady,
  ganttReady,
  workloadReady,
  chartReady,
  formBuilderReady,
  formPageReady,
  dashboardReady,
  shoot,
  test,
} from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { CONTEXT_OPTIONS, makeDeterministic, setTheme } from './determinism';
import { WEB_URL } from './env';
import { signInWithPassword } from './sign-in';
import {
  FULL_VIEW_ITEM,
  IDS,
  INBOX_THREADS,
  CALENDAR_VIEW,
  KANBAN_VIEW,
  TIMELINE_VIEW,
  GANTT_VIEW,
  WORKLOAD_VIEW,
  GANTT_BARS,
  CHART_VIEW,
  FORM_VIEW,
  DASHBOARD_ID,
  addCalendarView,
  addActionButton,
  addKanbanView,
  addTimelineView,
  addGanttView,
  addWorkloadView,
  addChartView,
  addFormView,
  addDashboard,
  addView,
  clearActivity,
  clearInbox,
  clearSenderThreads,
  seedBlockedAppeal,
  seedMyFeedback,
  SENDER_THREADS,
  BLAKE,
  clearAutomations,
  clearRichUpdate,
  clearRecents,
  readFullViewDescription,
  resetFullViewDescription,
  createEmptyWorkspace,
  removeCalendarView,
  removeActionButton,
  removeKanbanView,
  removeTimelineView,
  removeGanttView,
  removeWorkloadView,
  removeChartView,
  removeFormView,
  removeDashboard,
  removeView,
  removeSavedTemplate,
  seedSavedTemplate,
  seedActivity,
  seedAutomations,
  seedInbox,
  seedNotifications,
  seedRichUpdate,
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

/** The description's editor: the update composer also has a ProseMirror, and it carries an aria-label. */
const descriptionEditor = (page: Page) => page.locator('.ProseMirror:not([aria-label])');

/** Open the seeded full item view and wait for its description, subitems and update. */
async function fullViewReady(page: Page) {
  await page.goto(`/boards/${IDS.roadmap}/items/${FULL_VIEW_ITEM}`);
  const view = page.getByRole('dialog', { name: /^Item / });
  await expect(view).toBeVisible();
  await expect(view.getByText('Ship the pipeline')).toBeVisible();
  await expect(view.getByText('Write the workflow')).toBeVisible();
  await expect(view.getByText('The workflow runs on every pull request now.')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
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
      // Avery is assigned on the Product roadmap: the date sections load once its listener answers.
      await expect(page.getByRole('grid', { name: 'Past dates' })).toBeVisible();
      await expect(page.getByRole('grid', { name: 'Without a date' })).toBeVisible();
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

    // Print layout: the same board with `@media print` emulated. Black on white in both themes,
    // no sidebar, top bar or board tools (theme/print.css).
    test('board: print layout', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
      await shoot(page, `board-print-${theme}`, PARK_IN_HEADER);
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

    test('board: button column settings with three actions', async ({ page }) => {
      await addActionButton();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/main`);
        await boardReady(page);
        await page.getByRole('columnheader', { name: 'Ship' }).first().hover();
        await page.getByRole('button', { name: 'Options for Ship' }).first().click();
        // Vibe menu items only react once the pointer has settled on them.
        const settings = page.getByRole('menuitem', { name: 'Settings' });
        await settings.hover();
        await settings.click({ delay: 100 });
        const panel = page.getByRole('dialog', { name: 'Ship settings' });
        const third = panel.getByRole('group', { name: /^Action 3:/ });
        await expect(third).toBeVisible();
        // The popover scrolls inside the window height: show the end of the list, with action 3.
        await third
          .getByRole('radio', { name: /Done|P1/ })
          .last()
          .scrollIntoViewIfNeeded();
        await shoot(page, `board-button-actions-${theme}`);
      } finally {
        await removeActionButton();
      }
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

    test('board: Gantt view', async ({ page }) => {
      await addGanttView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${GANTT_VIEW}`);
        // Seven planned items and seven arrows (one is violated).
        await ganttReady(page, GANTT_BARS, 7);
        // Six baselines, and the longest chain (five items, four arrows) is highlighted.
        await expect(page.locator('[data-baseline]')).toHaveCount(6);
        await expect(page.locator('[data-edge][data-critical="true"]')).toHaveCount(4);
        await shoot(page, `board-gantt-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeGanttView();
      }
    });

    test('board: Workload view', async ({ page }) => {
      await addWorkloadView();
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${WORKLOAD_VIEW}`);
        await workloadReady(page);
        await shoot(page, `board-workload-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeWorkloadView();
      }
    });

    test('dashboard', async ({ page }) => {
      await addDashboard();
      try {
        await page.goto(`/dashboards/${DASHBOARD_ID}`);
        await dashboardReady(page);
        await shoot(page, `dashboard-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeDashboard();
      }
    });

    test('board: Chart view (bar, by Status)', async ({ page }) => {
      await addChartView('bar');
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${CHART_VIEW}`);
        // All five labelled statuses are in use, so five bars.
        await chartReady(page, 'Items by Status', 5);
        await shoot(page, `board-chart-bar-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeChartView();
      }
    });

    test('board: Chart view (donut, by group)', async ({ page }) => {
      await addChartView('donut');
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${CHART_VIEW}`);
        await chartReady(page, 'Items by Group', 3);
        await shoot(page, `board-chart-donut-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeChartView();
      }
    });

    test('board: Form view (builder)', async ({ page }) => {
      await addFormView(false);
      try {
        await page.goto(`/boards/${IDS.roadmap}/views/${FORM_VIEW}`);
        await formBuilderReady(page);
        await shoot(page, `form-builder-${theme}`, PARK_IN_HEADER);
      } finally {
        await removeFormView();
      }
    });

    test('public form page', async ({ page }) => {
      await addFormView(true);
      try {
        await page.goto(`/forms/${IDS.roadmap}/${FORM_VIEW}`);
        await formPageReady(page);
        await shoot(page, `form-public-${theme}`);
      } finally {
        await removeFormView();
      }
    });

    test('board: full item view', async ({ page }) => {
      await fullViewReady(page);
      await shoot(page, `item-full-view-${theme}`);
    });

    test('board: description slash menu open', async ({ page }) => {
      await fullViewReady(page);
      const editor = descriptionEditor(page);
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
      const editor = descriptionEditor(page);
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
      await descriptionEditor(page).getByText('blocked').dblclick();
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

    // P1d: the update composer opened with some formatting typed (nothing is posted).
    test('board: update composer open with formatting', async ({ page }) => {
      await fullViewReady(page);
      const composer = page.getByRole('textbox', {
        name: 'Write an update and mention others with @',
      });
      await composer.click();
      await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
      await page.keyboard.type('Heads up: ');
      await page.keyboard.press('Control+b');
      await page.keyboard.type('the pipeline is live');
      await page.keyboard.press('Control+b');
      await page.keyboard.type(' for review');
      await page.keyboard.press('Enter');
      await page.keyboard.type('- Check the preview deploys');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Sign off the rollback step');
      await expect(composer.locator('ul > li')).toHaveCount(2);
      await shoot(page, `item-update-composer-${theme}`);
    });

    // P1d: an update written in the rich composer, shown from its stored contentDoc.
    test('board: update with rich text', async ({ page }) => {
      await seedRichUpdate();
      try {
        await fullViewReady(page);
        const update = page.getByRole('article', { name: 'Item update' }).first();
        await update.scrollIntoViewIfNeeded();
        await expect(update.locator('strong')).toHaveText('all checks are green');
        await expect(update.getByText('@Jordan Lee')).toBeVisible();
        await expect(update.getByRole('link', { name: 'the spec' })).toBeVisible();
        await expect(update.getByText('Add the rollback step')).toBeVisible();
        await shoot(page, `item-update-rich-${theme}`);
      } finally {
        await clearRichUpdate();
      }
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

    // P4: the item card's Activity Log tab and the board's Activity log panel, seeded with fixed entries.
    test('board: item card Activity Log tab', async ({ page }) => {
      await seedActivity();
      try {
        await page.goto(`/boards/${IDS.roadmap}`);
        await boardReady(page);
        await page
          .getByRole('button', { name: 'Updates for Firebase project and emulators', exact: true })
          .click();
        const card = page.getByRole('dialog', { name: 'Item card' });
        await card.getByRole('tab', { name: 'Activity Log' }).click();
        const list = card.getByRole('list', { name: 'Item activity' });
        await expect(list.getByRole('listitem')).toHaveCount(5);
        await expect(list.getByText('Created')).toBeVisible();
        await shoot(page, `item-card-activity-${theme}`, PARK_IN_HEADER);
      } finally {
        await clearActivity();
      }
    });

    test('board: Activity log panel', async ({ page }) => {
      await seedActivity();
      try {
        await page.goto(`/boards/${IDS.roadmap}`);
        await boardReady(page);
        await page
          .getByRole('main')
          .getByRole('button', { name: 'Options for Product roadmap' })
          .click();
        // Vibe menus swallow a click that arrives before the first hover has settled.
        const entry = page.getByRole('menuitem', { name: 'Activity log' });
        await entry.hover();
        await entry.click({ delay: 100 });
        const panel = page.getByRole('complementary', { name: 'Activity log' });
        // The options menu closes after the click; keep it out of the screenshot.
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(panel.getByRole('listitem')).toHaveCount(7);
        await expect(
          panel.getByText('Avery Atrium renamed the group Visuals to VF · Visual fidelity'),
        ).toBeVisible();
        await shoot(page, `board-activity-panel-${theme}`, PARK_IN_HEADER);
      } finally {
        await clearActivity();
      }
    });

    // P5b: the Automation center with one recipe on and one off (with its reason).
    test('board: Automation center', async ({ page }) => {
      await seedAutomations();
      try {
        await page.goto(`/boards/${IDS.roadmap}`);
        await boardReady(page);
        await page.getByRole('button', { name: 'Automate' }).click();
        const dialog = page.getByRole('dialog', { name: /^Automations/ });
        // The center opens on Create; this screenshot is of Manage.
        await dialog.getByRole('tab', { name: /^Manage/ }).click();
        const table = dialog.getByRole('table', { name: 'Automations' });
        // Two data rows; the header row is excluded.
        await expect(table.locator('tbody').getByRole('row')).toHaveCount(2);
        // The breaker-off recipe shows its reason as a warning line and a "Needs attention" chip.
        await expect(dialog.getByText('Turned off after 5 failed runs in a row.')).toBeVisible();
        await expect(dialog.getByText('Needs attention')).toBeVisible();
        await shoot(page, `automation-center-${theme}`, PARK_IN_HEADER);
      } finally {
        await clearAutomations();
      }
    });

    // The recipe builder with a value picker open: it must draw above the full-screen modal.
    test('board: Automation builder value picker', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      await page.getByRole('button', { name: 'Automate' }).click();
      const dialog = page.getByRole('dialog', { name: /^Automations/ });
      await dialog.getByRole('button', { name: /Create from scratch/ }).click();
      await dialog.getByRole('button', { name: /^Trigger:/ }).click();
      await page.getByRole('option', { name: 'an item is created' }).click();
      await dialog.getByRole('button', { name: /^Action:/ }).click();
      await page.getByRole('option', { name: 'set a value' }).click();
      await dialog.getByRole('button', { name: /^Column to set:/ }).click();
      await page.getByRole('option', { name: 'Status' }).first().click();
      await dialog.getByRole('button', { name: /^Value for Status:/ }).click();
      const editor = page.getByRole('dialog', { name: /./ }).last();
      await expect(editor).toBeVisible();
      await expect.poll(() => isOnTop(editor)).toBe(true);
      await shoot(page, `automation-builder-picker-${theme}`, PARK_IN_HEADER);
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

    // Description & default value panel. The text and the default are typed but never saved: the
    // panel is cancelled, so the shared seed is left as it was found.
    test('board: column description and default value', async ({ page }) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardReady(page);
      const header = page.getByRole('columnheader', { name: 'Budget' }).first();
      await header.scrollIntoViewIfNeeded();
      await header.hover();
      await page.getByRole('button', { name: 'Options for Budget' }).first().click();
      const entry = page.getByRole('menuitem', { name: 'Description & default value' });
      await entry.hover();
      await entry.click({ delay: 100 });
      const panel = page.getByRole('dialog', { name: 'Budget description and default value' });
      await expect(panel).toBeVisible();
      await panel.getByRole('textbox', { name: 'Description' }).fill('Planned spend in dollars.');
      await panel.getByTestId('default-value-box').click();
      const input = panel.getByRole('textbox', { name: 'Budget' });
      await input.fill('500');
      await input.press('Enter');
      await expect(panel.getByTestId('default-value-box')).toContainText('500');
      await shoot(page, `board-column-details-${theme}`, PARK_IN_HEADER);
      await panel.getByRole('button', { name: 'Cancel' }).click();
      await expect(panel).toHaveCount(0);
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

    test('global search dialog with a term', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Quick Search' }).click();
      const dialog = page.getByRole('dialog', { name: 'Search everything' });
      await expect(dialog.getByRole('searchbox', { name: 'Search everything' })).toBeFocused();
      await dialog.getByRole('searchbox', { name: 'Search everything' }).fill('sign-in');
      await expect(dialog.getByRole('group', { name: 'Items' })).toBeVisible();
      await expect(dialog.getByRole('status')).toHaveCount(0);
      await shoot(page, `global-search-${theme}`);
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

    test('create board dialog, template gallery', async ({ page }) => {
      await seedSavedTemplate();
      try {
        await page.goto('/');
        await homeReady(page);
        await page.getByRole('button', { name: 'Add to workspace' }).click();
        const item = page.getByRole('menuitem', { name: 'Board', exact: true });
        await item.hover();
        await item.click({ delay: 100 });
        const dialog = page.getByRole('dialog', { name: 'Create board' });
        await expect(dialog).toBeVisible();
        // The Vibe radio's native input is visually hidden: click its visible label text instead.
        await dialog.getByText('Template', { exact: true }).click();
        await expect(dialog.getByRole('radio', { name: 'Template' })).toBeChecked();
        await expect(dialog.getByRole('radio', { name: /Weekly review/ })).toBeVisible();
        await dialog.getByRole('radio', { name: /Project tracker/ }).click();
        await shoot(page, `new-board-templates-${theme}`);
      } finally {
        await removeSavedTemplate();
      }
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

    test('admin: Inbox list', async ({ page }) => {
      await seedInbox();
      try {
        await page.goto('/admin/inbox');
        await appReady(page);
        await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
        // The default filter is Open: the appeal and the bug report. Show the answered idea too.
        await page
          .getByRole('group', { name: 'Status' })
          .getByRole('button', { name: 'All', exact: true })
          .click();
        const list = page.getByRole('list', { name: 'Conversations' });
        await expect(list.getByRole('listitem')).toHaveCount(3);
        await expect(list.getByText('Casey Morgan')).toBeVisible();
        await expect(page.getByTestId('inbox-unread-count')).toHaveText('1');
        await shoot(page, `admin-inbox-list-${theme}`);
      } finally {
        await clearInbox();
      }
    });

    test('admin: appeal thread', async ({ page }) => {
      await seedInbox();
      try {
        await page.goto(`/admin/inbox/${INBOX_THREADS.appeal}`);
        await appReady(page);
        await expect(page.getByRole('heading', { name: 'Appeal', level: 1 })).toBeVisible();
        await expect(page.getByText('Site Administrator')).toBeVisible();
        await expect(page.getByText('It was my brother using my laptop.').first()).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Internal note' })).toHaveValue(
          /40 addresses/,
        );
        await shoot(page, `admin-appeal-thread-${theme}`);
      } finally {
        await clearInbox();
      }
    });

    test('blocked screen with an answered appeal', async ({ browser }) => {
      await seedBlockedAppeal();
      // Blake is a second, blocked emulator user: a fresh context, not Avery's saved session.
      const context = await browser.newContext({ ...CONTEXT_OPTIONS, baseURL: WEB_URL });
      try {
        await makeDeterministic(context);
        await setTheme(context, theme);
        const page = await context.newPage();
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Welcome to Atrium' })).toBeVisible();
        await signInWithPassword(page, BLAKE);
        await expect(page.getByRole('heading', { name: 'Your account is blocked' })).toBeVisible();
        await expect(
          page.getByText('If you think this is a mistake, you can send an appeal below.'),
        ).toBeVisible();
        await expect(
          page.getByText('Can you tell us which board the invitations were for?'),
        ).toBeVisible();
        await expect(
          page.getByLabel('Admin message').getByText('Site Administrator'),
        ).toBeVisible();
        await expect(page.getByText("We'll show the reply here.")).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible();
        await shoot(page, `blocked-appeal-answered-${theme}`);
      } finally {
        await context.close();
        await clearSenderThreads();
      }
    });

    test('Send feedback dialog', async ({ page }) => {
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: /account menu for/i }).click();
      await page.getByRole('menuitem', { name: 'Send feedback' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Send feedback' })).toBeVisible();
      await dialog.getByLabel('Subject').fill('Keyboard shortcut for new item');
      await dialog
        .getByLabel('Message')
        .fill('A shortcut to add a new item to the top group would save me a lot of clicks.');
      await expect(dialog.getByText('78 / 2000')).toBeVisible();
      await shoot(page, `send-feedback-dialog-${theme}`);
    });

    test('My feedback thread', async ({ page }) => {
      await seedMyFeedback();
      try {
        await page.goto(`/feedback/${SENDER_THREADS.myFeedback}`);
        await appReady(page);
        await expect(
          page.getByRole('heading', { name: 'Keyboard shortcut for new item', level: 1 }),
        ).toBeVisible();
        await expect(
          page.getByLabel('Admin message').getByText('Site Administrator'),
        ).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible();
        await shoot(page, `my-feedback-thread-${theme}`);
      } finally {
        await clearSenderThreads();
      }
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
