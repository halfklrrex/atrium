# PWA: install (and later push)

Status: PWA-1 (install) and PWA-3 (Functions send) are described here. The web UI that registers devices arrives in PWA-4; see `docs/specs/P4-pwa-web-push.md`.

## How it works

- `apps/web/public/manifest.webmanifest` gives the app its name, icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`), `display: standalone` and colours. A manifest is JSON and cannot read CSS tokens, so `theme_color` and `background_color` repeat the `theme-color` meta in `apps/web/index.html`; `scripts/pwa.test.mjs` fails when they differ.
- `apps/web/index.html` links the manifest and carries the iOS meta tags (`apple-mobile-web-app-*`) plus the existing `apple-touch-icon`.
- `apps/web/public/sw.js` is a minimal hand-written service worker: `skipWaiting` on install, `clients.claim` on activate, and empty `push` / `notificationclick` stubs for PWA-4. It has **no fetch handler and no caches**, so it can never serve stale JS after a deploy and Atrium has no offline mode.
- `apps/web/src/lib/register-sw.ts` registers it after window load, in production builds only. The dev server, vitest and the Playwright visual runs (which use the dev server) never register it. Failures are logged with `console.warn`.
- `firebase.json` serves `/sw.js` and `/manifest.webmanifest` with `Cache-Control: no-cache`, `/sw.js` also with `Service-Worker-Allowed: /`, and the manifest as `application/manifest+json`.
- The web `build` script runs `scripts/check-pwa-dist.mjs`, which fails when `dist/sw.js` or `dist/manifest.webmanifest` is missing. The hosting SPA rewrite would otherwise serve `index.html` in its place and hide the mistake.

## Debugging

Chrome DevTools > Application: **Manifest** shows parse errors and icon previews; **Service workers** shows the registration, state and an Unregister button. Use a production build (`pnpm build` then `pnpm --filter @atrium/web preview`); nothing registers in `pnpm dev`.

`sw.js` must never be cached by the HTTP cache or a CDN: browsers check it for updates, and a cached copy would delay every worker change. That is why it has `no-cache`.

## Privacy

Nothing is sent anywhere yet. The worker makes no network requests, stores nothing and asks for no permission.

## Sending (PWA-3)

### How it works

- Every notification writer builds its store with `adminNotificationStore` (`functions/src/lib/admin-notifications.ts`). That store is wrapped by `withPushOnCreate` (`functions/src/lib/push.ts`): after `createNotification` returns `true` (the notification was newly written; a retried trigger gets `false` and pushes nothing) or after an Inbox `upsertNotification`, it calls `sendPush`, from the same Function invocation, awaited inside its own try/catch. A push can never fail or block a notification. No new Cloud Function is added, so the Firestore trigger and callable CPU quota notes in `docs/architecture.md` are unchanged.
- `sendPush` reads the user's `users/{uid}/pushTokens` docs (none: stop), maps the notification kind to a push switch, reads `notificationPrefs.push` (missing: `DEFAULT_PUSH_PREFS`, so automation off, the rest on), and sends with `sendEachForMulticast` in chunks of 500. Tokens FCM answers with `messaging/registration-token-not-registered` or `messaging/invalid-registration-token` have their doc deleted.
- Kind to switch: `assigned`, `reply`, `mention`, `button`, `automation` map to the key of the same name; `automation_disabled` follows `automation` (as in the bell); `account_request`, `account_approved`, `inbox_new` and `inbox_reply` follow `account`. The Inbox kinds were not specified by the owner: they are the same sort of person-to-admin message, and someone who turns `account` off still sees them in the bell. A kind that is not listed pushes nothing.

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
