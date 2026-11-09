import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import {
  CALENDAR_VIEW,
  FULL_VIEW_ITEM,
  IDS,
  KANBAN_VIEW,
  TIMELINE_VIEW,
  addCalendarView,
  addKanbanView,
  addTimelineView,
  clearAutomations,
  clearInbox,
  clearSenderThreads,
  removeCalendarView,
  removeKanbanView,
  removeTimelineView,
  seedAutomations,
  seedInbox,
  seedMyFeedback,
  seedNotifications,
} from './seed';

/**
 * The phone screens shared by the baseline project (`mobile-screens.spec.ts`, fourteen screenshots)
 * and the defect audit (`mobile-audit.spec.ts`, every screen at five sizes). Each screen knows how
 * to get itself on screen and what to wait for; no timers, only real content.
 */
export interface MobileScreen {
  /** Slug used in test titles, baseline names and the known-defects file. */
  name: string;
  /** Short human title for the audit report. */
  title: string;
  /** Render without the signed-in session (login only). */
  signedOut?: boolean;
  /**
   * CSS selector of an open dialog, panel or menu. The audit scrolls inside it and checks that the
   * page behind it stays put. Screens without one are plain pages.
   */
  overlay?: string;
  /** Runs once before the screen's tests, and `cleanup` once after (seed data, then remove it). */
  seed?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  /** Put the screen on `page` and wait until it has real content. */
  open: (page: Page) => Promise<void>;
}

/**
 * The signed-in shell is up. On a phone the sidebar is a closed drawer, so unlike the desktop
 * `appReady` this waits for the top bar and for the loaders to be gone.
 */
async function appReady(page: Page) {
  await expect(page.locator('header[data-print="hide"]')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

async function homeReady(page: Page) {
  await appReady(page);
  await expect(page.getByText('Good morning, Avery!')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Product roadmap' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: /Family/ })).toBeVisible();
}

const roadmap = (page: Page) =>
  expect(page.getByRole('heading', { name: 'Product roadmap', level: 2 })).toBeVisible();

async function boardTableReady(page: Page) {
  await appReady(page);
  await roadmap(page);
  await expect(page.locator('[role="row"][data-item-id]').first()).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

/** On a phone the drawer holds the navigation; the account menu sits in the top bar. */
async function openAccountMenu(page: Page) {
  await page.goto('/');
  await homeReady(page);
  await page.getByRole('button', { name: /account menu for/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Send feedback' })).toBeVisible();
}

/**
 * Choose an entry of the open account menu and wait for the dialog it opens. The click is retried
 * while the menu is still up: on a touch device a tap that lands as the menu animates can be lost.
 */
async function chooseAccountMenuEntry(page: Page, entry: string, dialogHeading: string) {
  const item = page.getByRole('menuitem', { name: entry });
  const heading = page.getByRole('dialog').getByRole('heading', { name: dialogHeading });
  await expect(async () => {
    if (await item.isVisible()) await item.click();
    await expect(heading).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

/** A Settings tab on a phone: the tab bar and the first heading of the tab are up. */
async function openSettingsTab(page: Page, tab: string, heading: string) {
  // Deterministic whatever the browser build offers: hide the push API.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager');
  });
  await page.goto(`/settings/${tab}`);
  await appReady(page);
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

export const MOBILE_SCREENS: MobileScreen[] = [
  {
    name: 'login',
    title: 'Login',
    signedOut: true,
    open: async (page) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Welcome to Atrium' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
    },
  },
  {
    name: 'privacy',
    title: 'Privacy notice',
    signedOut: true,
    open: async (page) => {
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your choices' })).toBeVisible();
    },
  },
  {
    name: 'home',
    title: 'Home',
    open: async (page) => {
      await page.goto('/');
      await homeReady(page);
    },
  },
  {
    name: 'my-work',
    title: 'My work',
    open: async (page) => {
      await page.goto('/my-work');
      await appReady(page);
      await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
      await expect(page.getByRole('grid', { name: 'Without a date' })).toBeVisible();
    },
  },
  {
    name: 'workspace',
    title: 'Workspace page',
    open: async (page) => {
      await page.goto(`/workspaces/${IDS.personalWorkspace}`);
      await appReady(page);
      const recents = page.getByRole('list', { name: 'Recently visited boards' });
      await expect(recents.getByRole('listitem')).toHaveCount(3);
    },
  },
  {
    name: 'sidebar-drawer',
    title: 'Sidebar drawer open',
    overlay: '#app-sidebar',
    open: async (page) => {
      await page.goto('/');
      await homeReady(page);
      // From 768 px up the sidebar is always there and the menu button is gone.
      const toggle = page.getByRole('button', { name: 'Open navigation' });
      if (await toggle.isVisible()) await toggle.click();
      const sidebar = page.locator('#app-sidebar');
      await expect(sidebar.getByText('Q4 planning')).toBeVisible();
      await expect(sidebar.getByText('Product roadmap')).toBeVisible();
    },
  },
  {
    name: 'search',
    title: 'Global search dialog',
    overlay: '[role="dialog"]',
    open: async (page) => {
      await page.goto('/');
      await homeReady(page);
      // The Search icon is hidden in the top bar on the narrowest sizes: Ctrl+K opens it everywhere.
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Search everything' });
      await expect(dialog.getByRole('searchbox', { name: 'Search everything' })).toBeVisible();
      await dialog.getByRole('searchbox', { name: 'Search everything' }).fill('sign-in');
      await expect(dialog.getByRole('group', { name: 'Items' })).toBeVisible();
    },
  },
  {
    name: 'board-table',
    title: 'Board table',
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardTableReady(page);
    },
  },
  {
    name: 'kanban',
    title: 'Kanban view',
    seed: addKanbanView,
    cleanup: removeKanbanView,
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}/views/${KANBAN_VIEW}`);
      await appReady(page);
      await roadmap(page);
      await expect(page.locator('[data-card]').first()).toBeVisible();
    },
  },
  {
    name: 'calendar',
    title: 'Calendar view',
    seed: () => addCalendarView('month'),
    cleanup: removeCalendarView,
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}/views/${CALENDAR_VIEW}`);
      await appReady(page);
      await expect(page.getByRole('grid', { name: 'October 2026' })).toBeVisible();
      await expect(page.locator('[data-item]').first()).toBeVisible();
    },
  },
  {
    name: 'timeline',
    title: 'Timeline view',
    seed: addTimelineView,
    cleanup: removeTimelineView,
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}/views/${TIMELINE_VIEW}`);
      await appReady(page);
      await expect(page.getByRole('group', { name: 'Timeline' })).toBeVisible();
      await expect(page.locator('[data-item]').first()).toBeVisible();
    },
  },
  {
    name: 'item-view',
    title: 'Item view (full)',
    overlay: '[role="dialog"]',
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}/items/${FULL_VIEW_ITEM}`);
      const view = page.getByRole('dialog', { name: /^Item / });
      await expect(view).toBeVisible();
      await expect(view.getByText('Ship the pipeline')).toBeVisible();
      await expect(view.getByText('The workflow runs on every pull request now.')).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
    },
  },
  {
    name: 'notifications-panel',
    title: 'Notifications panel',
    overlay: '#notifications-panel',
    // Not a `seed`: the per-test reset of the user's state would wipe notifications seeded earlier.
    open: async (page) => {
      await seedNotifications();
      await page.goto('/');
      await homeReady(page);
      await page.getByRole('button', { name: 'Notifications, 2 unread' }).click();
      const panel = page.getByRole('complementary', { name: 'Notifications' });
      await expect(panel.getByText('Mentioned you in an update')).toBeVisible();
    },
  },
  {
    name: 'settings-profile',
    title: 'Settings: Profile',
    open: async (page) => {
      await openSettingsTab(page, 'profile', 'Time zone');
      await expect(page.getByRole('combobox', { name: 'Your time zone' })).toBeEnabled();
    },
  },
  {
    name: 'settings-appearance',
    title: 'Settings: Appearance',
    open: (page) => openSettingsTab(page, 'appearance', 'Theme'),
  },
  {
    name: 'settings-notifications',
    title: 'Settings: Notifications',
    open: (page) => openSettingsTab(page, 'notifications', 'On this device'),
  },
  {
    name: 'settings-account',
    title: 'Settings: Account',
    open: (page) => openSettingsTab(page, 'account', 'Account'),
  },
  {
    name: 'settings-privacy',
    title: 'Settings: Privacy and data',
    open: (page) => openSettingsTab(page, 'privacy', 'Your data'),
  },
  {
    name: 'profile-menu',
    title: 'Profile menu',
    overlay: '[role="menu"]',
    open: openAccountMenu,
  },
  {
    name: 'about',
    title: 'About dialog',
    overlay: '[role="dialog"]',
    open: async (page) => {
      await openAccountMenu(page);
      await chooseAccountMenuEntry(page, 'About Atrium', 'About Atrium');
    },
  },
  {
    name: 'feedback-dialog',
    title: 'Send feedback dialog',
    overlay: '[role="dialog"]',
    open: async (page) => {
      await openAccountMenu(page);
      await chooseAccountMenuEntry(page, 'Send feedback', 'Send feedback');
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Subject').fill('Keyboard shortcut for new item');
      await dialog
        .getByLabel('Message')
        .fill('A shortcut to add a new item to the top group would save me a lot of clicks.');
    },
  },
  {
    name: 'automation-center',
    title: 'Automation center',
    overlay: '[role="dialog"]',
    seed: seedAutomations,
    cleanup: clearAutomations,
    open: async (page) => {
      await page.goto(`/boards/${IDS.roadmap}`);
      await boardTableReady(page);
      await page.getByRole('button', { name: 'Automate' }).click();
      const dialog = page.getByRole('dialog', { name: /^Automations/ });
      await dialog.getByRole('tab', { name: /^Manage/ }).click();
      await expect(dialog.getByRole('table', { name: 'Automations' })).toBeVisible();
    },
  },
  {
    name: 'admin-inbox',
    title: 'Admin: Inbox list',
    seed: seedInbox,
    cleanup: clearInbox,
    open: async (page) => {
      await page.goto('/admin/inbox');
      await appReady(page);
      await expect(page.getByRole('heading', { name: 'Site admin' })).toBeVisible();
      await page
        .getByRole('group', { name: 'Status' })
        .getByRole('button', { name: 'All', exact: true })
        .click();
      await expect(
        page.getByRole('list', { name: 'Conversations' }).getByRole('listitem'),
      ).toHaveCount(3);
    },
  },
  {
    name: 'my-feedback',
    title: 'My feedback',
    seed: seedMyFeedback,
    cleanup: clearSenderThreads,
    open: async (page) => {
      await page.goto('/feedback');
      await appReady(page);
      await expect(page.getByRole('heading', { name: 'My feedback', level: 1 })).toBeVisible();
    },
  },
  {
    name: 'trash',
    title: 'Trash',
    open: async (page) => {
      await page.goto(`/workspaces/${IDS.personalWorkspace}/trash`);
      await appReady(page);
      await expect(page.getByRole('heading', { name: /trash/i }).first()).toBeVisible();
    },
  },
];

/** The screens that also get a committed light baseline on a phone. */
export const BASELINE_SCREENS = [
  'login',
  'privacy',
  'home',
  'workspace',
  'sidebar-drawer',
  'board-table',
  'kanban',
  'item-view',
  'notifications-panel',
  'settings-profile',
  'settings-notifications',
  'profile-menu',
  'feedback-dialog',
  'admin-inbox',
] as const;
