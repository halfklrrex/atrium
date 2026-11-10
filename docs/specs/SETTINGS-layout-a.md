# SETTINGS-layout-a: side nav, centred cards, notification matrix and phone drill-in

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Settings: layout A" (new item in the VF group; Opus creates it) · Builds on: `docs/specs/SETTINGS-1-page.md` (S1a, S1b merged), `docs/specs/SETTINGS-user-id.md` · Design: the approved previews (option A plus borrowings from B and C; the file is a local scratch preview, not in the repo) · Owner decision: 2026-11-10 (below) · Status: spec, nothing built

## Goal

The Settings page looks empty: a 220 px tab list and a 720 px column of bare headings, both pinned to the left of a wide page. Rebuild the layout so it reads like a finished product: a full-height grouped nav on the left, the content centred in the remaining space as a stack of titled cards, a proper identity card, real theme previews, one matrix for the bell and push switches, and a native-feeling drill-in on phones. Same five tabs, same URLs, same behaviour.

## Owner decision (2026-11-10, final)

1. **Option A**: a full-height grouped left nav plus a centred max-width card column.
2. **From option B**: the larger identity card (avatar, name, email, "From your Google account") at the top of Profile, and bigger theme previews (miniature app windows, with a "Selected" tick on the chosen one).
3. **From option C**: the Notifications **bell and push matrix**: one row per event, two switch columns, and the device's push state as a chip in the card header.
4. **Phones**: a `/settings` index route with the identity card and grouped rows that drill into each tab, replacing the sideways tab bar. Each tab gets a back button.
5. `/settings/:tab` deep links keep working (the bell's gear, the privacy page link, the profile menu).
6. **Planned settings are not built and get no placeholder**: no date format, first day of the week, default workspace, "Language and region" nav item, "More looks", accent colour or density. No dashed "Planned" cards, no greyed nav items.

## Facts this design rests on (checked against `main` at `14026f9`)

- **Routes** (`apps/web/src/App.tsx`, inside `AppShell`): `settings` redirects to `/settings/profile`; `settings/:tab` renders `SettingsPage`, which redirects an unknown tab to Profile.
- **Links into Settings:** `UserMenu.tsx` navigates to `/settings/profile`; `NotificationsPanel.tsx` (gear and menu item) to `/settings/notifications`; `PrivacyPage.tsx` links `/settings/privacy`.
- **`SettingsPage.tsx`** holds the `TABS` list, the `nav` (`aria-label="Settings sections"`, `NavLink`s) and `TabBody`. One CSS module, `Settings.module.css`, styles the page and every tab except Notifications.
- **`NotificationsTab.tsx`** still renders the old dialog's pieces with `components/dialogs/dialogs.module.css`: a "In the bell" list of five `Toggle`s (`KINDS`: assigned, reply, mention, button, automation), then `DeviceSection` and `PushSwitches` from `components/dialogs/PushSettings.tsx` (seven push kinds, `PUSH_KINDS` in `push-device.ts`: the five plus `account` and `inbox`). `PushSettings.tsx` has no other user.
- **Prefs model** (`packages/shared/src/schemas/notification.ts`): `notificationPrefs` has the five bell booleans plus an optional `push` map of seven booleans (`DEFAULT_PUSH_PREFS`, automation off). There is **no bell switch for `account` and `inbox`**: those notifications always land in the bell. No schema or rules change is needed for this spec.
- **Device push states** (`lib/push.ts`, `PushDeviceState`): `off`, `on`, `unsupported`, `ios-install`, `not-configured`, `blocked`; `STATUS_TEXT` in `push-device.ts` has the sentences for the last four; `null` while loading.
- **Theme previews today:** `AppearanceTab.tsx` draws two bars on a 64 px swatch; each half carries the class `light-app-theme`, `dark-app-theme` or `black-app-theme`, which scopes Vibe's and Atrium's colour variables to that theme. The new previews keep this trick, so they need no colour literals.
- **Surfaces:** `tokens.css` already has `--atrium-home-bg` (grey behind Home cards; the plain background in dark and black) and `--atrium-card-bg` (cards; `--secondary-background-color` in dark and black). Settings reuses them, so it matches Home in every theme.
- **Avatar:** `UserAvatar` wraps Vibe `Avatar`, whose sizes stop at `large` (48 px). Vibe `Avatar` also has a `customSize` prop (a number of px).
- **No viewport hook exists in the web app**; phone layout is CSS only today (`@media (width < 768px)`).
- **Visual tests:** desktop `settings: profile`, `settings: appearance`, `settings: notifications, push not supported` in `tests/visual/src/screens.spec.ts` (light and dark); phone screens `settings-profile`, `settings-appearance`, `settings-notifications`, `settings-account`, `settings-privacy` in `tests/visual/src/mobile-screens.ts`, of which `settings-profile` and `settings-notifications` are in `BASELINE_SCREENS`. The `openSettingsTab` helper waits for the `Settings sections` nav, which phones will no longer have. `mobile-known-defects.json` has no Settings entries.

## Scope

- Desktop and tablet (768 px and up): new page layout, nav groups and icons, centred card column, per-tab header, every tab's content in cards.
- Profile: identity card; Time zone and User ID become cards with the label-left, control-right row pattern.
- Appearance: miniature app-window previews with a "Selected" tick.
- Notifications: the matrix replaces the three stacked sections; `PushSettings.tsx` goes away.
- Account and Privacy and data: same rows, inside cards.
- Phones (below 768 px): the `/settings` index and the drill-in tab pages with a back button.
- Tokens in `apps/web/src/theme/settings-tokens.css`; unit tests; visual specs and baselines.

## Non-goals

- Any planned setting (owner decision 6), and any placeholder for one.
- Changing what a setting does, its saving behaviour, its toasts or its texts, except the headings and hints listed here.
- The Privacy tab's existing "Coming soon" rows for data download and deletion (GDPR-1 and GDPR-2 replace them; leave them as they are).
- Schema, rules, Functions or `packages/shared` changes.
- A cover banner or B's profile hero; C's one-page scroll.
- The profile menu's theme shortcut (stays).

## Design

### Desktop layout (768 px and up)

```
| app sidebar | Settings nav (full height, 240) | grey body: centred column, max 760 |
|             | Settings  (h1)                  |   Profile (h2)                      |
|             | YOU                             |   How you appear to others, ...     |
|             |  [person] Profile   (selected)  |   [ identity card              ]    |
|             |  [moon]   Appearance            |   [ Time zone card             ]    |
|             |  [bell]   Notifications         |   [ User ID card               ]    |
|             | ACCOUNT                         |                                     |
|             |  [key]    Account               |                                     |
|             |  [lock]   Privacy and data      |                                     |
```

- **Page** (`.page`): a grid of two columns, `var(--atrium-settings-nav-width)` and `minmax(0, 1fr)`, filling the AppShell content panel (`block-size: 100%`). It no longer uses `--atrium-page-max-width` or `--atrium-page-gutter`.
- **Nav panel** (`.nav`): full height, `background: var(--atrium-surface-bg)`, `border-inline-end: var(--border-width) var(--border-style) var(--layout-border-color)`, padding `var(--space-24) var(--space-12)`, scrolls on its own if it ever overflows. Top: the `h1` "Settings" (`--atrium-board-title-font`, padding-inline `var(--space-12)`, gap below `var(--space-16)`).
- **Groups:** two `<ul>`s, each preceded by a group label (a `<h2>` styled `--font-text2-bold`, `--secondary-text-color`, padding `var(--space-12) var(--space-12) var(--space-4)`). The label is visible and also labels its list (`aria-labelledby`). Groups and icons (`@vibe/icons`, `aria-hidden`):

  | Group     | Tab              | Icon            |
  | --------- | ---------------- | --------------- |
  | "You"     | Profile          | `Person`        |
  |           | Appearance       | `Moon`          |
  |           | Notifications    | `Notifications` |
  | "Account" | Account          | `Key`           |
  |           | Privacy and data | `Locked`        |

  The nav keeps `aria-label="Settings sections"` and the `NavLink` `aria-current="page"` behaviour.

- **Nav links:** `min-block-size: var(--atrium-settings-nav-link-height)`, gap `var(--space-8)` between icon and label, padding-inline `var(--space-12)`, `--border-radius-medium`, `--font-text1-normal`. Hover `--primary-background-hover-color`; active `--primary-selected-color` background, `--primary-color` text, `--font-text1-medium` (as today). Focus ring `--atrium-focus-ring` as today.
- **Body** (`.body`): `background: var(--atrium-settings-page-bg)`, its own vertical scroll (`overflow-y: auto`, composes the global `atrium-scroll`), padding `var(--space-32) var(--space-40)`.
- **Column** (`.column`): `max-inline-size: var(--atrium-settings-content-max-width)`, `margin-inline: auto`, a flex column with gap `var(--space-16)`.
- **Tab header** (new `SettingsTabHeader` in `SettingsPage.tsx` or its own file): an `h2` with the tab label (`--font-h2-medium`) and one hint line (`--font-text1-normal`, `--secondary-text-color`). Texts:

  | Tab              | Hint under the title                                           |
  | ---------------- | -------------------------------------------------------------- |
  | Profile          | How you appear to others, and the details Atrium uses for you. |
  | Appearance       | How Atrium looks on your devices.                              |
  | Notifications    | What notifies you, in the bell and on your devices.            |
  | Account          | How you sign in.                                               |
  | Privacy and data | Your data, the privacy notice and the source code.             |

- **Heading levels:** `h1` "Settings" (nav), `h2` group labels and the tab title, `h3` card titles. On phones the tab page's `h1` is the tab label (see Phone behaviour).

### Cards and rows (shared pieces, in `Settings.module.css`)

- **`.card`**: `background: var(--atrium-settings-card-bg)`, `border: var(--border-width) var(--border-style) var(--layout-border-color)`, `border-radius: var(--border-radius-medium)`. A `<section aria-labelledby>` per card.
- **`.cardHeader`**: padding `var(--space-16) var(--space-20) var(--space-4)`; a flex row with the title block on the left and an optional header control on the right (the Notifications chip). The card title is an `h3` in `--font-text1-bold`, `--primary-text-color` (`--font-h3-medium` is used only for the identity name); the card hint is `--font-text2-normal`, `--secondary-text-color`.
- **`.cardBody`**: padding `var(--space-8) var(--space-20) var(--space-16)`.
- **`.row`** (replaces today's `.row`): label on the left, control on the right; `min-block-size: var(--atrium-settings-row-min-height)`, padding-block `var(--space-8)`, gap `var(--space-16)`, `flex-wrap: wrap` so the control drops under the label when narrow; divider `var(--border-width) var(--border-style) var(--layout-border-color)` between rows, none after the last. `.rowText`, `.rowTitle`, `.rowValue` keep their current meaning.
- A small `SettingsCard` component (`pages/settings/SettingsCard.tsx`: `title`, optional `hint`, optional `headerEnd`, `children`, generated ids) keeps the five tabs consistent. Every tab uses it.

### Profile tab

1. **Identity card** (no visible title; `aria-label="Your Google account"` on the section): a flex row, padding `var(--space-20)`, gap `var(--space-16)`. `UserAvatar` at 64 px (add an optional `customSize?: number` passthrough to `UserAvatar`, forwarded to Vibe `Avatar`; the value comes from a named constant `IDENTITY_AVATAR_SIZE = 64` in `pages/settings/settings-layout.ts`, with a comment pointing at the token file; this is a Vibe numeric prop, not a style, so the lint rules do not apply). Text block: the name (`--font-h3-medium`), the email (`--font-text1-normal`, secondary), then "From your Google account" (`--font-text2-normal`, secondary). Long names and emails wrap (`overflow-wrap: anywhere`). The same component (`IdentityCard`) is reused on the phone index.
2. **"Time zone" card**, hint "Used for scheduled automations." One row: left "Your time zone" (the `<label>` of the select; keep the accessible name "Your time zone", the visual tests use it) with the value line "This device: Europe/Paris" (the device zone; omitted when unknown); right the native `<select>` with `min-inline-size: var(--atrium-settings-select-min-width)`. The "Use this device's time zone (…)" tertiary button stays, under the row, only when the stored zone differs from the device's. Behaviour unchanged.
3. **"User ID" card**, the hint text unchanged; the monospace id and the Copy button in one row. Behaviour unchanged.

### Appearance tab

- **"Theme" card**, hint "Your choice follows your account on every device." The fieldset of four radio cards stays (same `name="theme"`, same accessible names System, Light, Dark, Black, same store).
- **Grid:** `repeat(auto-fill, minmax(var(--atrium-settings-theme-card-min-width), 1fr))`, gap `var(--space-12)`: four across in the desktop column, two across on a 375 px phone.
- **Option card:** as today (border, `--border-radius-medium`, padding `var(--space-8)`, selected = `--primary-color` border plus the `var(--border-width)` ring), plus a name row: the label on the left and, on the selected card only, a "Selected" tick on the right (Vibe `Check` icon, `aria-hidden`, plus the word "Selected", `--font-text2-medium`, `--primary-color`). The word is visual only (`aria-hidden`); the checked radio already tells assistive tech.
- **Preview** (`ThemePreview`, replaces `Swatch` and `Half`, `aria-hidden`): `block-size: var(--atrium-settings-theme-preview-height)`, `--border-radius-small`, a `var(--border-width)` border in `--layout-border-color`, `overflow: hidden`. Inside, a miniature app window drawn in the preview's theme class:
  - background `var(--atrium-app-bg)`;
  - a sidebar strip on the left (`inline-size: var(--atrium-settings-theme-preview-sidebar-width)`, background `var(--atrium-surface-bg)`);
  - a content panel (background `var(--atrium-surface-bg)`, `--border-radius-small` top-start corner like the shell) holding one primary bar (`--primary-color`, `inline-size: var(--atrium-settings-theme-preview-bar-short)`) and two muted bars (`--ui-border-color`, `inline-size: var(--atrium-settings-theme-preview-bar-long)`), each `block-size: var(--atrium-settings-theme-preview-bar-height)`, `--border-radius-small`, gap `var(--space-4)`, aligned to the bottom, padding `var(--space-8)`.
  - **System** draws the light window on the left half and the dark window on the right half (two theme-scoped halves side by side, as today).
- Dark and Black must be told apart at a glance. If Vibe's variables make the two windows look the same, say so in the PR (with screenshots) instead of adding colours; Opus decides on a token.

### Notifications tab: the bell and push matrix

One **"What notifies you"** card, hint "One row per event. Push goes to every device where you turned it on."

- **Header end: the device chip and its button.** Vibe `Label` (`kind="line"`, small) plus a button where one applies:

  | `PushDeviceState` | Chip text (colour)                | Button                      | Line under the header           |
  | ----------------- | --------------------------------- | --------------------------- | ------------------------------- |
  | `null` (loading)  | none                              | none                        | none                            |
  | `on`              | "This device: push on" (positive) | "Disable" (tertiary, small) | none                            |
  | `off`             | "This device: push off" (dark)    | "Enable" (primary, small)   | none                            |
  | `unsupported`     | "No push here" (dark)             | none                        | `STATUS_TEXT.unsupported`       |
  | `ios-install`     | "Install first" (dark)            | none                        | `STATUS_TEXT['ios-install']`    |
  | `not-configured`  | "Push not set up" (dark)          | none                        | `STATUS_TEXT['not-configured']` |
  | `blocked`         | "Push blocked" (negative)         | none                        | `STATUS_TEXT.blocked`           |

  The buttons are disabled while `busy`, exactly as `DeviceSection` did. The `STATUS_TEXT` line sits in the card header under the hint (`--font-text2-normal`, secondary); the visual test waits for "This browser can't receive push notifications.", so the text must stay exactly that. On a narrow screen the header wraps and the chip moves under the title.

- **The table:** a real `<table>` (`caption` visually hidden: "Notification settings"). Columns: "Event" (`th scope="col"`, left), "In the bell" and "Push" (`th scope="col"`, centred, each `inline-size: var(--atrium-settings-matrix-switch-column)`). Header cells `--font-text2-bold`, secondary. One row per `PUSH_KINDS` entry, in that order (Assigned to me, Replies, Mentions, Button clicks, Automations, Account requests and approvals, Inbox messages):
  - first cell `th scope="row"`: the label (`--font-text1-medium`) and the hint (`--font-text2-normal`, secondary). Use the bell hint from `KINDS` where the kind has one (it is the fuller one for Automations), otherwise the `PUSH_KINDS` hint. Move both lists into one `NOTIFICATION_EVENTS` array in `NotificationsTab.tsx` (`kind`, `label`, `hint`, `inBell: boolean`) so the order and texts live in one place; keep `PUSH_KINDS` in `push-device.ts` if anything else imports it, otherwise derive from the new array.
  - "In the bell" cell: a Vibe `Toggle` (`aria-label="In the bell: <label>"`, `areLabelsHidden`) bound to `prefs[kind]`, for the five bell kinds. For `account` and `inbox` the cell shows the text "Always" (secondary): those always reach the bell.
  - "Push" cell: a `Toggle` (`aria-label="Push: <label>"`) bound to `(prefs.push ?? DEFAULT_PUSH_PREFS)[kind]`. The push switches stay enabled whatever this device's state: they are account-wide and apply to every device that has push on.
  - Row `min-block-size: var(--atrium-settings-row-min-height)`, cell padding `var(--space-8)`, dividers as `.row`.
  - Every toggle is disabled while prefs load; every change is saved straight away with `notificationWrites.setPrefs` and the same "Could not save your notification settings." toast. Enabling a device with no `push` map still writes `DEFAULT_PUSH_PREFS` first (the existing `usePushDevice` callback).
- Delete `components/dialogs/PushSettings.tsx`. Remove from `dialogs.module.css` the classes nothing uses any more (`settingsSection`, `settingsSectionFirst`, `switches`, `switchRow`, `switchText`, `switchLabel`, `switchHint`, `deviceRow`, `deviceText` and the `sectionTitle` rule if unused; `rg` each before deleting).

### Account tab

One **"Account"** card with the current rows (Signed in with, Email, the site-admin line, Sign out with its button). Texts and behaviour unchanged.

### Privacy and data tab

Two cards, **"Your data"** and **"About Atrium"**, with the current rows unchanged (including the existing "Coming soon" rows; see Non-goals).

## Phone behaviour (below 768 px)

- **Viewport hook:** new `apps/web/src/lib/use-media-query.ts`: `useMediaQuery(query: string): boolean` with `useSyncExternalStore` over `window.matchMedia(query)` (`change` listener; server snapshot `false`), and `export const PHONE_QUERY = '(width < 768px)'`, `export const useIsPhone = () => useMediaQuery(PHONE_QUERY)`. The CSS keeps its own `@media (width < 768px)`; a comment in both places says they must match. The test setup's `matchMedia` stub returns `matches: false`, so existing tests stay on the desktop layout.
- **Routes** (`App.tsx`): `settings` (index) renders a new `SettingsIndexRoute`: on a phone the `SettingsIndex` page, otherwise `<Navigate to="/settings/profile" replace />`. `settings/:tab` stays. The profile menu's Settings item navigates to **`/settings`** (desktop still lands on Profile through the redirect). The bell's gear and the privacy page keep their deep links.
- **`SettingsIndex`** (`pages/settings/SettingsIndex.tsx`), inside the same page padding as today's phone layout (`var(--space-16)` plus the safe-area insets, bottom included):
  1. `h1` "Settings" (`--atrium-board-title-font`).
  2. The `IdentityCard`.
  3. Two groups, the same "You" and "Account" labels and icons as the desktop nav, each a card (`.card`) holding a `<ul>` of rows. Each row is a `Link` to `/settings/<tab>`: icon, label, an optional value on the right (the Appearance row shows the current theme's label, for example "Dark", from `THEME_OPTIONS`), then a `NavigationChevronRight` icon (`aria-hidden`). `min-block-size: var(--atrium-settings-index-row-height)`, padding-inline `var(--space-16)`, dividers between rows, hover and focus as the nav links. Accessible name of each link: the label (the value is in a separate `aria-hidden` span plus the link's `aria-description`, or simply part of the name "Appearance, Dark"; pick one and test it).
  4. A **Sign out** button (secondary, full width) at the bottom: the same `signOut` from `useAuth` as the Account tab.
- **Tab pages on a phone** (`SettingsPage` with `useIsPhone()`): no nav is rendered. The column gets a phone header instead of `SettingsTabHeader`: a Vibe `IconButton` (`NavigationChevronLeft`, `ariaLabel="Back to Settings"`, `kind="tertiary"`) that **navigates to `/settings`** (not `history.back()`, so a deep link from the bell still has somewhere to go), then the tab label as the `h1`, then the hint line. The body is a single column at full width with the page padding above; cards keep their look; the card column has no max width.
- **Unknown tab on a phone:** redirect to `/settings` (the index). On desktop: `/settings/profile` as today.
- **Resizing** across 768 px simply re-renders the other layout; the desktop index redirect fires when a phone-width window grows (acceptable).
- **Phone rules from the mobile pass still hold:** no sideways page scroll, inputs and selects at 16 px (the global rule), toggle rows at least 44 px (`--atrium-settings-row-min-height` is above that), bottom safe-area padding.
- The old sideways tab bar CSS (`.nav` `overflow-x`, `.navList` row direction) is deleted in PR 3.

## Tokens

All new literals go in `apps/web/src/theme/settings-tokens.css` (not the hot-spot `tokens.css`). Components and modules use only these and Vibe or existing Atrium variables; Stylelint and the ESLint rule must pass with no new disable comments.

| Token                                           | Value                   | Change                                                     |
| ----------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `--atrium-settings-content-max-width`           | `760px`                 | was `720px`                                                |
| `--atrium-settings-nav-width`                   | `240px`                 | was `220px`                                                |
| `--atrium-settings-nav-item-height`             | `44px`                  | unchanged (still the minimum for a row with a control)     |
| `--atrium-settings-nav-link-height`             | `40px`                  | new: desktop nav links                                     |
| `--atrium-settings-row-min-height`              | `52px`                  | new: card rows and matrix rows                             |
| `--atrium-settings-index-row-height`            | `52px`                  | new: phone index rows                                      |
| `--atrium-settings-select-min-width`            | `240px`                 | new: time-zone select                                      |
| `--atrium-settings-matrix-switch-column`        | `96px`                  | new; `72px` below 768 px (redefine inside the media query) |
| `--atrium-settings-theme-card-min-width`        | `140px`                 | unchanged                                                  |
| `--atrium-settings-theme-preview-height`        | `96px`                  | new, replaces `--atrium-settings-swatch-height` (64 px)    |
| `--atrium-settings-theme-preview-sidebar-width` | `22%`                   | new                                                        |
| `--atrium-settings-theme-preview-bar-height`    | `6px`                   | new, replaces `--atrium-settings-swatch-bar-height`        |
| `--atrium-settings-theme-preview-bar-short`     | `45%`                   | new (primary bar)                                          |
| `--atrium-settings-theme-preview-bar-long`      | `70%`                   | new, replaces `--atrium-settings-swatch-bar-width` (60 %)  |
| `--atrium-settings-page-bg`                     | `var(--atrium-home-bg)` | new: grey body behind the cards (plain in dark and black)  |
| `--atrium-settings-card-bg`                     | `var(--atrium-card-bg)` | new                                                        |

Delete the three `--atrium-settings-swatch-*` tokens once nothing uses them. Keep the file's header comment and give each new token a short trailing comment like the existing ones.

## Files to touch

| File                                                                        | PR   | Change                                                                                                   |
| --------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `apps/web/src/theme/settings-tokens.css`                                    | 1–3  | tokens above (PR 1 adds all but the matrix and index tokens)                                             |
| `apps/web/src/pages/settings/Settings.module.css`                           | 1–3  | layout, nav groups, cards, rows, theme previews (1); matrix (2); index, phone header, delete tab bar (3) |
| `apps/web/src/pages/settings/SettingsPage.tsx`                              | 1, 3 | groups and icons, body and column, `SettingsTabHeader` (1); phone branch, back button (3)                |
| `apps/web/src/pages/settings/SettingsCard.tsx` (new)                        | 1    | the card component                                                                                       |
| `apps/web/src/pages/settings/IdentityCard.tsx` (new)                        | 1    | used by Profile (1) and the index (3)                                                                    |
| `apps/web/src/pages/settings/settings-layout.ts` (new)                      | 1    | `SETTINGS_GROUPS` (labels, tabs, icons, hints) shared by the nav and the index; `IDENTITY_AVATAR_SIZE`   |
| `apps/web/src/components/UserAvatar.tsx`                                    | 1    | optional `customSize` passthrough                                                                        |
| `apps/web/src/pages/settings/ProfileTab.tsx`                                | 1    | identity card, Time zone and User ID cards                                                               |
| `apps/web/src/pages/settings/AppearanceTab.tsx`                             | 1    | `ThemePreview`, Selected tick, card                                                                      |
| `apps/web/src/pages/settings/AccountTab.tsx`, `PrivacyTab.tsx`              | 1    | wrap in cards                                                                                            |
| `apps/web/src/pages/settings/NotificationsTab.tsx`                          | 1, 2 | wrap the current sections in a card (1, minimal); the matrix (2)                                         |
| `apps/web/src/components/dialogs/PushSettings.tsx`                          | 2    | delete                                                                                                   |
| `apps/web/src/components/dialogs/dialogs.module.css`                        | 2    | drop the unused classes                                                                                  |
| `apps/web/src/lib/use-media-query.ts` (new)                                 | 3    | `useMediaQuery`, `PHONE_QUERY`, `useIsPhone`                                                             |
| `apps/web/src/pages/settings/SettingsIndex.tsx` (new)                       | 3    | the phone index and `SettingsIndexRoute`                                                                 |
| `apps/web/src/App.tsx`                                                      | 3    | `settings` index route                                                                                   |
| `apps/web/src/components/AppShell/UserMenu.tsx`                             | 3    | navigate to `/settings`                                                                                  |
| tests next to each file, `tests/visual/src/*`                               | 1–3  | see Tests                                                                                                |
| `docs/visual-testing.md`, `tests/visual/src/mobile-screens.spec.ts` comment | 3    | "fourteen key screens" becomes fifteen                                                                   |

## Tests

### Unit (Vitest, next to the code)

- **`SettingsPage.test.tsx`** (desktop, the default stub): the nav is labelled "Settings sections" and has the two group labels "You" and "Account" with the five links in order; `aria-current="page"` on the active link; each tab shows its `h2` title and hint; an unknown tab goes to `/settings/profile`; switching tab keeps the URL in sync and the document title. **Phone** (stub `matchMedia` to match `(width < 768px)`): no nav; the `h1` is the tab label; "Back to Settings" navigates to `/settings`; an unknown tab goes to `/settings`.
- **`SettingsIndex.test.tsx`** (new): phone: the identity card (fictional "Avery Quinn", `avery@example.com`), the two groups, five links with the right `href`s in order, the Appearance row shows the current theme label, Sign out calls `signOut`. Desktop: `/settings` redirects to `/settings/profile`.
- **`use-media-query.test.ts`** (new): the initial value, and a `change` event re-renders.
- **`ProfileTab.test.tsx`**: the identity card (name, email, "From your Google account"); the time-zone and copy tests unchanged.
- **`AppearanceTab.test.tsx`**: four radios; only the checked one shows "Selected"; choosing one updates the store; previews are `aria-hidden`.
- **`NotificationsTab.test.tsx`** (rewrite of the move from the dialog; keep every behaviour test): the table has seven rows in order; five "In the bell: …" toggles and "Always" for the account and Inbox rows; seven "Push: …" toggles; a bell toggle writes its field, a push toggle writes the whole `push` map (starting from `DEFAULT_PUSH_PREFS` when absent); a failed write shows the toast; the chip text and button for each of the seven device states (`null` included); `STATUS_TEXT` shown for the four unavailable states; Enable and Disable call the device hook and are disabled while busy; enabling with no push map writes the defaults.
- **`UserMenu.test.tsx`**: Settings navigates to `/settings`. **`NotificationsPanel.test.tsx`**: unchanged (still `/settings/notifications`). **`PrivacyPage.test.tsx`**: unchanged.
- **`UserAvatar`**: if it has a test, add one for `customSize`.

### Visual (Playwright)

- **Desktop** (`screens.spec.ts`, light and dark): `settings: profile`, `settings: appearance`, `settings: notifications, push not supported` keep their names and waits (the time-zone combobox, the Black radio, the "can't receive push notifications" text); their baselines change.
- **Phone** (`mobile-screens.ts`):
  - `openSettingsTab(page, tab, heading)` stops waiting for the `Settings sections` nav. It waits for the heading, and for the "Back to Settings" button when the viewport is below 768 px wide, otherwise for the nav (the audit also runs at 768×1024, which is the desktop layout).
  - The `settings-notifications` screen waits for the heading "What notifies you" instead of "On this device".
  - New screen **`settings-index`** ("Settings: index"): hide `PushManager` as the helper does, `goto('/settings')`, `appReady`, wait for the `h1` "Settings" and the "Appearance" link. Add it to `BASELINE_SCREENS` (file `phone-settings-index-light-linux.png`) and to the mobile audit (it is in `MOBILE_SCREENS`, so automatically).
  - `phone-settings-profile` and `phone-settings-notifications` baselines change.
- The mobile audit must pass with no new entries in `mobile-known-defects.json`.
- **Baselines only through the workflow:** on each PR branch, `gh workflow run update-visual-baselines.yml -f branch=<branch>`, then `gh run watch`, review the image diffs in the PR's Files changed tab and list them in the PR description. Never commit `*-win32.png` or `*-darwin.png`, never hand-edit a `*-linux.png`; on a PNG conflict, rebase and re-run the workflow.

## Acceptance criteria

- [ ] Desktop (1280 and 1440 wide): the nav fills the content panel's height with the two labelled groups and icons; the card column is centred in the remaining space and at most 760 px wide; the empty space splits evenly on both sides.
- [ ] Every tab starts with its title and hint and shows its content in cards; no tab has a bare heading.
- [ ] Profile: a 64 px avatar, name, email and "From your Google account"; the time-zone select sits on the right of its row and does not stretch.
- [ ] Appearance: four miniature app windows drawn in their own theme; System shows light and dark halves; only the selected card has the ring and the "Selected" tick; keyboard selection works with the arrow keys.
- [ ] Notifications: one card, seven event rows, "In the bell" toggles for five and "Always" for two, seven push toggles; the device chip and Enable/Disable in the header; the unavailable states show their sentence; every toggle saves straight away as before.
- [ ] Phone (375 and 390 wide): `/settings` shows the identity card, the grouped rows and Sign out; each row opens its tab; each tab has "Back to Settings", which returns to the index; no sideways tab bar; no page overflow (mobile audit); inputs at 16 px; bottom safe-area padding.
- [ ] Desktop `/settings` lands on Profile; `/settings/notifications` (the bell's gear) and `/settings/privacy` open directly on both layouts; unknown tabs redirect (Profile on desktop, the index on phones).
- [ ] No planned setting and no placeholder for one anywhere in the UI.
- [ ] Tokens only: no hex, px or named colours in the module or TSX, no new lint-disable comments; new literals only in `settings-tokens.css`.
- [ ] Light, dark and black compared side by side (Opus visual QA); gaps fixed or logged in the VF group.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass; visual baselines updated through the workflow and listed in the PR.

## Task breakdown (Sonnet-ready)

Three PRs, merged in this order; each starts from fresh `origin/main` (rebased after the previous merge) in its own worktree under `/Users/lepetitchat/DevProjects/Atrium-worktrees/<task>` with its own `ATRIUM_PORT_OFFSET` in `.env.local`. All three touch `Settings.module.css`, `settings-tokens.css` and `tests/visual/__screenshots__/**`, so never run them in parallel. Open PRs touching phones (for example `claude/mobile-m2`) don't touch Settings; rebase if they land first.

| #   | Branch                                 | Offset | Depends on | Hot spots                         |
| --- | -------------------------------------- | ------ | ---------- | --------------------------------- |
| 1   | `claude/settings-layout-a`             | 10     | none       | `tests/visual/__screenshots__/**` |
| 2   | `claude/settings-notifications-matrix` | 20     | PR 1       | `tests/visual/__screenshots__/**` |
| 3   | `claude/settings-phone-drill-in`       | 40     | PR 2       | `tests/visual/__screenshots__/**` |

### PR 1: desktop layout, identity card, theme previews

1. Tokens: update and add the PR 1 tokens in `settings-tokens.css` (everything except `--atrium-settings-matrix-switch-column` and `--atrium-settings-index-row-height`); delete the `swatch` tokens when step 6 is done.
2. `settings-layout.ts`: `SETTINGS_GROUPS` (`{ label: 'You' | 'Account', tabs: { id, label, hint, icon }[] }[]`) and `IDENTITY_AVATAR_SIZE`. `SettingsPage` derives `TABS` and `isTab` from it.
3. `SettingsPage.tsx` and the module: the page grid, the full-height nav with group labels and icons, the scrolling grey body, the centred column, `SettingsTabHeader`. Below 768 px keep today's sideways tab bar for now (hide the group labels and icons in it) so phones are not broken between PRs.
4. `SettingsCard.tsx` and the `.card`, `.cardHeader`, `.cardBody`, `.row` styles.
5. `UserAvatar` `customSize`; `IdentityCard.tsx`; `ProfileTab` cards.
6. `AppearanceTab`: `ThemePreview`, the Selected tick, the card.
7. `AccountTab`, `PrivacyTab`: cards. `NotificationsTab`: wrap the three existing sections in one card without changing them (PR 2 replaces them).
8. Unit tests (SettingsPage desktop, ProfileTab, AppearanceTab). Run every check, then the baseline workflow (the three desktop screens in both themes, and the two phone Settings baselines change slightly).

### PR 2: the notifications matrix

1. `NOTIFICATION_EVENTS` and the matrix table; the header chip and buttons from `usePushDevice`; the `STATUS_TEXT` line.
2. `--atrium-settings-matrix-switch-column` (and its phone value) and the matrix styles.
3. Delete `PushSettings.tsx`; prune `dialogs.module.css` (search each class first).
4. Rewrite `NotificationsTab.test.tsx` as listed (keep every old behaviour).
5. Update the phone `settings-notifications` wait ("What notifies you"). Checks, then the baseline workflow (desktop notifications in both themes, phone notifications).

### PR 3: phone drill-in

1. `use-media-query.ts` and its test.
2. `SettingsIndex.tsx` (`SettingsIndex`, `SettingsIndexRoute`), reusing `IdentityCard` and `SETTINGS_GROUPS`; `App.tsx` index route; `UserMenu` to `/settings`.
3. `SettingsPage` phone branch: no nav, back header, unknown tab to `/settings`; delete the sideways tab bar CSS; add `--atrium-settings-index-row-height` and the index styles.
4. Tests: `SettingsPage` phone cases, `SettingsIndex.test.tsx`, `UserMenu.test.tsx`.
5. Visual: `openSettingsTab` change, the `settings-index` screen in `MOBILE_SCREENS` and `BASELINE_SCREENS`, the "fifteen key screens" wording in `mobile-screens.spec.ts` and `docs/visual-testing.md`. Run `pnpm test:visual` mobile audit locally if possible, then the baseline workflow.

Each PR: description says what changed, links the Roadmap item, lists the baseline diffs and has light and dark screenshots (and the phone ones for PR 3).

## What Ophelia (Opus) reviews

- Tokens only, and the theme previews use only theme-scoped variables (look at them in light, dark and black).
- The heading order (`h1`, `h2`, `h3`) and the nav and table semantics (labelled groups, `scope` on header cells, unique toggle labels).
- Notifications behaviour is identical: compare the old and new tests one by one; the defaults on enable; push toggles never disabled by device state.
- Phones: the bell's gear on a phone opens Notifications with a working back button; the index redirect never fires on phones; the audit shows no overflow at 360 px.
- Baselines came from the workflow and the diffs are only the Settings screens.

## Showcase, provenance, docs

- Showcase: no impact (no board feature or column type).
- Provenance: nothing copied; no new dependencies (Vibe icons are already in).
- Docs: a "Settings layout A" line in `HANDOFF.md` and a handoff note after PR 3; owner checks in `docs/plans/owner-check-list.md` (Opus, docs PR).

## Owner checks (production)

1. On the computer, open Settings from the profile menu: the nav on the left with "You" and "Account", the cards centred; click through the five tabs.
2. Appearance: four small app windows; pick Dark and see the tick move.
3. Notifications: the table, your device's push state in the corner; switch one push event off and back on.
4. On the phone: profile menu → Settings shows your card and the list; open Notifications, then "Back to Settings". The bell's gear opens Notifications directly, and its back button goes to the list.

## Risks

- **Full-height layout inside the shell.** The body gets its own scroll; check that the AppShell content panel does not also scroll (no double scroll bars) and that a long tab scrolls with the wheel and on touch.
- **Vibe `Avatar` `customSize`.** If initials or the icon fallback look off at 64 px, use `size="large"` and tell Opus; do not hand-size it with CSS.
- **The `matchMedia` branch** can make a test or screenshot depend on the viewport: every Settings visual test already sets its viewport through the project, and unit tests stub `matchMedia` explicitly.
