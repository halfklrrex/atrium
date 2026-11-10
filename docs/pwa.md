# PWA: install (and later push)

Status: PWA-1 (install), PWA-3 (Functions send) and PWA-4 (the settings screen and the service worker's push handlers) are described here; see `docs/specs/P4-pwa-web-push.md`.

## How it works

- `apps/web/public/manifest.webmanifest` gives the app its name, icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`), `display: standalone` and colours. A manifest is JSON and cannot read CSS tokens, so `theme_color` and `background_color` repeat the `theme-color` meta in `apps/web/index.html`; `scripts/pwa.test.mjs` fails when they differ.
- `apps/web/index.html` links the manifest and carries the iOS meta tags (`apple-mobile-web-app-*`) plus the existing `apple-touch-icon`.
- `apps/web/public/sw.js` is a minimal hand-written service worker: `skipWaiting` on install, `clients.claim` on activate, and the `push` / `notificationclick` handlers (see "Receiving" below). It has **no fetch handler and no caches**, so it can never serve stale JS after a deploy and Atrium has no offline mode.
- `apps/web/src/lib/register-sw.ts` registers it after window load, in production builds only. The dev server, vitest and the Playwright visual runs (which use the dev server) never register it. Failures are logged with `console.warn`.
- `firebase.json` serves `/sw.js` and `/manifest.webmanifest` with `Cache-Control: no-cache`, `/sw.js` also with `Service-Worker-Allowed: /`, and the manifest as `application/manifest+json`.
- The web `build` script runs `scripts/check-pwa-dist.mjs`, which fails when `dist/sw.js` or `dist/manifest.webmanifest` is missing. The hosting SPA rewrite would otherwise serve `index.html` in its place and hide the mistake.

## Debugging

Chrome DevTools > Application: **Manifest** shows parse errors and icon previews; **Service workers** shows the registration, state and an Unregister button. Use a production build (`pnpm build` then `pnpm --filter @atrium/web preview`); nothing registers in `pnpm dev`.

`sw.js` must never be cached by the HTTP cache or a CDN: browsers check it for updates, and a cached copy would delay every worker change. That is why it has `no-cache`.

## Privacy

The worker makes no network requests and stores nothing. Permission is asked only when someone presses Enable (see below).

## Sending (PWA-3)

### How it works

- Every notification writer builds its store with `adminNotificationStore` (`functions/src/lib/admin-notifications.ts`). That store is wrapped by `withPushOnCreate` (`functions/src/lib/push.ts`): after `createNotification` returns `true` (the notification was newly written; a retried trigger gets `false` and pushes nothing) or after an Inbox `upsertNotification`, it calls `sendPush`, from the same Function invocation, awaited inside its own try/catch. A push can never fail or block a notification. No new Cloud Function is added, so the Firestore trigger and callable CPU quota notes in `docs/architecture.md` are unchanged.
- `sendPush` reads the user's `users/{uid}/pushTokens` docs (none: stop), maps the notification kind to a push switch, reads `notificationPrefs.push` (missing: `DEFAULT_PUSH_PREFS`, so automation off, the rest on), and sends with `sendEachForMulticast` in chunks of 500. Tokens FCM answers with `messaging/registration-token-not-registered` or `messaging/invalid-registration-token` have their doc deleted.
- Kind to switch: `assigned`, `reply`, `mention`, `button`, `automation` map to the key of the same name; `automation_disabled` follows `automation` (as in the bell); `account_request` and `account_approved` follow `account`; `inbox_new` and `inbox_reply` have their own `inbox` switch (owner decision, on by default). Someone who turns a switch off still sees those events in the bell. A kind that is not listed pushes nothing.

### The message

A **data-only** message (no `notification` field), so the service worker builds the notification: `{ title, body, url, tag, kind }`. Title is the bell's text (actor name plus action), body is the snippet (already capped at 200 characters) or "item . board". `url` follows the bell's routes: the item, `/admin/inbox/{id}`, `/feedback/{id}`, `/admin`, or the app root. `tag` is one per item (or thread), so a burst replaces rather than stacks. The update or reply to scroll to is router state in the web app, so the link opens the item.

### Privacy

The payload carries only what the bell shows. Never an email, never an admin identity (`inbox_reply` already carries the fixed "Site Administrator" name). Push services see it in transit encrypted to the device. Logs hold the uid, the notification id, counts and FCM error codes only: never a token and never message text.

### Debugging a missing push

1. No token docs under `users/{uid}/pushTokens`: the device never enabled push (PWA-4) or the token was pruned as dead.
2. The switch is off in `notificationPrefs.push` (automation is off by default), or the kind has no switch.
3. Functions logs (`Push: ...`): a `Push: send failed` with code `messaging/mismatched-credential`, `messaging/third-party-auth-error` or a 403 permission error means the IAM step below is missing. `Push: done` shows `devices`, `sent` and `pruned` counts.

### One-time IAM step (owner)

> **ONE-TIME IAM STEP FOR THE OWNER.** The Functions runtime service account needs permission to send through FCM. Run once, with your own project number in place of the placeholder (find it with `gcloud projects describe atrium-board --format='value(projectNumber)'`):
>
> ```
> gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --role="roles/firebasecloudmessaging.admin"
> ```
>
> Until it is granted, every send fails with a logged permission error and nothing else breaks: notifications and the bell work as before.

## The settings screen and device registration (PWA-4)

Open the bell, the gear (Settings > Notifications, `/settings/notifications`). The tab is one "What notifies you" matrix: a row per event (assigned, reply, mention, button, automation, account, inbox) with an "In the bell" switch (account and inbox always reach the bell) and a "Push" switch, and this device's push state (chip, Enable / Disable) in the card header. Each switch saves at once and writes the whole `notificationPrefs.push` map, because the rules require all seven booleans. Code: `apps/web/src/pages/settings/NotificationsTab.tsx`, the logic in `apps/web/src/lib/push.ts` (pure, dependencies injected) and the real browser and Firebase wiring in `push-runtime.ts`.

### States of "On this device"

| State                 | When                                                                                                    | Shown                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| iPhone, not installed | iOS and not running from the Home Screen (checked first: Safari hides the push APIs until installed)    | "Install Atrium first: tap Share, then Add to Home Screen", no Enable button |
| Not supported         | the browser lacks `Notification`, service workers, `PushManager` or `isSupported()`                     | "This browser can't receive push notifications."                             |
| Not set up yet        | `VAPID_PUBLIC_KEY` is empty (not the case now)                                                          | "Push notifications are not set up yet.", no prompt                          |
| Blocked               | `Notification.permission` is `denied`                                                                   | how to allow notifications in the site settings                              |
| Off                   | none of the above                                                                                       | **Enable**                                                                   |
| On                    | permission granted, this browser remembers the device for the signed-in person and its token doc exists | "This device receives push notifications." and **Disable**                   |

### How a device registers

1. **Enable** (the only place a permission prompt can start; never on page load): `Notification.requestPermission()`.
2. `getToken(messaging, { vapidKey, serviceWorkerRegistration })` with the registration of `/sw.js`.
3. The token doc `users/{uid}/pushTokens/{sha-256 hex of the token}` is created with exactly `{ token, userAgent (max 200), platform: ios | android | desktop, createdAt, lastSeenAt }` (both timestamps are server times; the rules require that). If the doc already exists, only `lastSeenAt` is refreshed.
4. If the person has no `notificationPrefs.push` yet, the defaults are written (everything on except automation).
5. The browser remembers `{ uid, doc id, last refresh }` in `localStorage` (`atrium.push.device`) so the dialog can tell it is on without asking Firebase for a token.

On every app load an enabled device refreshes `lastSeenAt` (only that key) at most once a day.

### How to turn it off

- **Disable** in the dialog: deletes the token doc and calls `deleteToken` (the browser's FCM token), then the section says off.
- **Sign out** does the same for this device before signing out (also on desktop; best effort, it waits at most 3 seconds and never blocks the sign-out).
- A browser's own site settings (blocking notifications) also stops them; the token doc is then pruned by the Functions on the next failed send.

### Receiving

`sw.js` reads the data-only payload `{ title, body, url, tag, kind }` defensively (a malformed push is ignored) and calls `showNotification` with the Atrium icon and badge, `tag` (a burst replaces rather than stacks) and `data: { url }`. It shows nothing when an Atrium window is focused and visible, because the in-app bell already tells the person. **Exception: iPhone and iPad.** WebKit revokes a push subscription that gets pushes without a visible notification, so there the worker always shows it. A click closes the notification, focuses an Atrium window and navigates it to the url, or opens a new window. Only same-origin urls are ever opened; anything else is ignored.

### How the VAPID key is set

`VAPID_PUBLIC_KEY` in `apps/web/src/lib/firebase.ts` is public by design, like the web config. It was generated in the Firebase console (Project settings > Cloud Messaging > Web Push certificates) on 2026-11-08. To rotate it, generate a new key pair there and replace the value in a PR; devices that enabled push with the old key must press Disable and Enable again. If the value is ever empty, no code path asks for permission or calls `getToken` and the dialog says push is not set up yet.

### Not tested by agents

A real permission prompt, a real FCM token and a real push cannot be exercised in unit tests or in the CI browser. The tests cover the state machine, the written doc shape, disable and sign-out, the daily refresh and the service worker handlers with mocks; the live check is in `docs/plans/owner-check-list.md`.
