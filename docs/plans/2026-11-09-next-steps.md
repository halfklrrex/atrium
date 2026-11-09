# Next steps plan (2026-11-09)

Written by an Opus planner from the owner's bug-inbox comments of 2026-11-08 and 2026-11-09, checked against the code. Monday items are linked by id (ids are in `.private/project-ids.md` for the board).

## What already exists (checked)

- A theme switcher (System, Light, Dark, Black) is in `UserMenu.tsx`. It is saved only in the browser (`theme/theme.ts`, key `atrium.theme`), although `users/{uid}.theme` exists and the rules let users write it.
- The notification settings dialog (`NotificationSettingsDialog` plus `PushSettings`) opens only from the bell panel.
- There is no `/settings` route, no profile editing, no data export, no account deletion and no privacy notice.
- A workspace icon is a string of at most 8 characters (`iconSchema` and `firestore.rules`).
- Fonts load from fonts.googleapis.com in `index.html`.

## Ranked work list

| #   | Item                                                        | Size | Owner decision           | Hot spots                                           |
| --- | ----------------------------------------------------------- | ---- | ------------------------ | --------------------------------------------------- |
| 1   | Logo and favicon bug (3341474437)                           | S    | no                       | `firebase.json`, login/About baselines              |
| 2   | Default label colours (3340727026)                          | S    | yes (Priority colours)   | `packages/shared`                                   |
| 3   | Icon-set previews (3340735612)                              | S    | yes (which set)          | none (scratchpad page)                              |
| 4   | Icon-set build                                              | M    | after #3, spec first     | `iconSchema`, `firestore.rules`, lockfile, notices  |
| 5   | Mobile M0: Playwright WebKit project and audit (3341467776) | M    | no                       | `tests/visual/**`, baselines                        |
| 6   | Mobile M1: phone fixes across the app                       | M    | no                       | `tokens.css` maybe, baselines                       |
| 7   | Settings S1: the page (3341463097)                          | M    | information architecture | baselines                                           |
| 8   | Privacy page P1: static notice                              | S    | controller and contact   | none                                                |
| 9   | Self-host fonts                                             | S    | default yes              | `THIRD_PARTY_NOTICES`                               |
| 10  | Settings S2: display-name override                          | M    | past names?              | `packages/shared`, `firestore.rules`, `tests/rules` |
| 11  | GDPR G1: data export                                        | M    | no                       | strict in-session security review                   |
| 12  | GDPR G2: account deletion                                   | L    | yes (see questions)      | functions, rules; ultrareview candidate             |
| 13  | Lead-only: live QA, epic specs (P8 first), close review PRs | -    | -                        | -                                                   |

Order: wave 1 (items 1, 2, 3 and the lead's specs) in parallel; wave 2 mobile M0 then M1, fonts, privacy P1; wave 3 Settings S1 after M1, then S2 and the icon build (both touch `packages/shared` and the rules, so one after the other); wave 4 G1 then G2 with a strict review. Ultrareviews left (3): P8, G2 plus the whole-codebase pass, one spare.

## Logo and favicon: root causes and fix

**Blurry sign-in logo.** `BrandMark variant="icon"` loads `src/assets/brand/atrium-icon-{light,dark}.svg`. Every visible shape sits inside an SVG filter (`blur-soft`, `blur-edge`, bloom, glow, rays). WebKit (Safari and every iOS browser) draws filter output at low resolution and scales it up, so a 3x iPhone looks soft. Lines 24 to 27 of both files also have malformed filter regions (`x="-10%%"`). The About dialog uses the same icon. The `mark` variant has no filters and is fine.

Fix: render the icon to PNG at 64, 128 and 192 px (light and dark) with Playwright Chromium at `deviceScaleFactor: 3` or resvg; `BrandMark`'s icon variant becomes an `<img srcset>`; keep the SVGs as masters and fix the `%%`; test at DPR 3 in Playwright WebKit; update the login and About baselines.

**Old favicon in a fresh browser.** `/favicon.ico` returns 200 `text/html` (no `.ico` file, the catch-all rewrite answers). `/favicon.svg` is the old logo's URL, cached `max-age=3600`. `/` is served `max-age=3600` because the `/index.html` header rule does not match `/` or deep links. Browsers also remember favicons by page URL.

Fix: add a real multi-size `public/favicon.ico` (16, 32, 48 px) from the new art; version every icon URL (`?v=2`, PNGs, apple-touch icon, manifest icons); in `firebase.json` set `Cache-Control: no-cache` for pages, keep `/assets/**` immutable, `max-age=86400` for icon files; check the winning rule with `curl -I` on `/`, `/boards/x` and `/assets/...`; extend `brand-assets.test.ts` (require `favicon.ico`, assert the header); re-run the curl checks after the deploy.

## Default label colours

`DEFAULT_STATUS_LABELS` (`packages/shared/src/columns/status.ts`) already uses monday's colours but lacks the grey empty label and its ids differ from `DEFAULT_BOARD_STATUS_LABELS`. There is no Priority option in the Add column menu, only the template (`templates/built-in.ts`: High is purple, Low grey). Plan: align the two default sets (grey index 5 included), add a shared `DEFAULT_PRIORITY_LABELS` (Critical `#df2f4a`, High `#fdab3d`, Medium `#579bfc`, Low to be measured), use it in the template, add "Priority" to the Add column menu, no migration, update tests and showcase data. Caveat: monday's newer Priority default may be dark (Critical `#333333`, High `#401694`, Medium `#5559df`, Low `#579bfc`), which contradicts "Critical = red": measure a Priority column in the owner's monday (read-only) before building.

## Settings page and data protection

Not legal advice; a lawyer should confirm the controller question.

**Settings** (`/settings` with tabs, linked from the profile menu, a short theme shortcut stays): Profile (display name override, photo and email read-only, time zone, locale); Appearance (System/Light/Dark/Black saved to `users.theme` as well as the browser; room for seasonal and country themes later); Notifications (the bell switches, push on this device, iPhone install hint; the bell's gear links here); Account (connected Google account, sign out); Privacy and data (notice, Download my data, Delete my account, source link, About). S1 needs no rules change; S2 adds a `displayNameOverride` (max 80) written through a callable that also updates the user's `members` docs.

**Data protection:** privacy notice (who runs it, contact via the Feedback Inbox, what is collected, why, retention, rights, processors, no tracking or analytics). The public-repo privacy rule conflicts with naming the owner: keep the controller's name out of the repo and show it on the live site only. Processors: Google Cloud and Firebase (Auth, Firestore eur3, Storage and Functions europe-west1, Hosting CDN, FCM), the browser push services, Google Fonts until self-hosted. Only strictly necessary storage (Auth IndexedDB, theme and UI state, service worker), so a storage notice instead of a cookie banner. Retention: notifications (purge job), closed inbox threads (365 days), trash, Firestore backups until they expire, Cloud Logging (about 30 days). G1 export: JSON with the user doc, favourites, recents, notifications, memberships, push token metadata and inbox threads (board content stays on CSV and Excel). G2 erasure: delete the Auth user, `users/{uid}` and subcollections, `inboxLimits`, presence; remove `members` docs and uid from `memberIds` and `roles`; revoke invites they sent; sole-owner workspaces block deletion until ownership moves (or delete if no other members); updates in shared boards kept as "Deleted user"; inbox threads deleted at once; an audit row with no personal data.

## Mobile pass

Screens: login, Home, My work, workspaces, sidebar drawer, search, board table, Kanban, Calendar, Timeline, Gantt, item view and card, update composer, description editor, column popovers, notifications panel and settings dialog, profile menu, About, Feedback, Automation center and builder, dashboards, public form, invite, admin inbox, My feedback, Trash, Settings. Sizes 375x667, 390x844, 430x932, 360x800, 768.

M0: Playwright `mobile-webkit` project (`devices['iPhone 15']`) with about 12 light baselines, plus a non-baseline audit spec failing on sideways overflow, elements covering the top bar and a page scroll after scrolling inside a dialog; Chrome `resize_window` on the live site; the owner on a real iPhone for Safari's toolbar and the installed app. M1 first fixes: (1) dialog scrolling that moves the top bar (likely the Vibe modal handing scroll to the page and the `100dvh` shell resizing): `html, body { overflow: hidden; overscroll-behavior: none }`, `overscroll-behavior: contain` on modal content, `max-height: 100dvh` minus safe-area insets, full-screen sheet dialogs on phone widths; (2) iOS zooming into inputs below 16 px; (3) safe-area padding (`viewport-fit=cover`, `env(safe-area-inset-*)`). Then M2 board views, M3 item view and editors, M4 automations, dashboards, admin and forms.

## Questions for the owner (recommended defaults)

1. Which icon set? Default: Vibe icons (no new dependency), or Phosphor for more variety.
2. Icons for folders too, and keep emoji and letters as options? Default: yes to both.
3. Priority colours: Critical red, High orange, Medium blue, Low light blue? Default: yes, unless the measured monday defaults differ (then show both).
4. Does a renamed person's name change on past updates? Default: no.
5. Should the theme follow the user across devices? Default: yes.
6. Who is the data controller and how are they contacted? Default: name shown only on the live site, contact through the Feedback Inbox.
7. Account deletion and updates in shared boards? Default: keep, shown as "Deleted user"; sole-owner workspaces need an ownership transfer first.
8. Inbox threads when an account is deleted? Default: delete at once.
9. Self-host Google Fonts? Default: yes.
10. Seasonal and country themes? Default: later Roadmap item, no work now.
