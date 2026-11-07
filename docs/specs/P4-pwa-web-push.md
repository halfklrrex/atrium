# P4 PWA and web push (incl. iPhone)

Roadmap item: "PWA & web push (incl. iPhone)" (P4). Status: **spec for the owner's review; no code yet.** Decisions below are the lead's proposals; the owner can change any of them. Open questions with defaults are at the end.

## Goal

1. Atrium can be installed to the home screen / dock (own window, icon, name) on iPhone, Android and desktop.
2. A person who opts in gets a push notification on that device for the same events that appear in the bell (assigned, reply, mention, button, automation, and account approval for admins), even when Atrium is closed.
3. No offline mode in this epic (see "Not in scope").

## Current state

- `apps/web/public/` holds only `favicon.svg`. No manifest, service worker, `vite-plugin-pwa` or `firebase/messaging` use. `apps/web/index.html` has `theme-color` and the SVG icon only.
- `firebase` ^13.1 is a web dependency. Functions use `firebase-admin`.
- Notifications are written only by Cloud Functions, at `users/{uid}/notifications/{kind}-{eventId}-{uid}`, through `createNotification` (`functions/src/lib/admin-notifications.ts`), which uses `ref.create()` and returns `false` if the doc exists (a retried trigger). Most kinds pass through `deliverNotifications` (`functions/src/lib/notifications.ts`), which applies the per-user prefs. The two account kinds call `createNotification` directly and are always delivered.
- Prefs: `users/{uid}.notificationPrefs = { assigned, reply, mention, button?, automation? }` (missing key = on). The schema is strict; `firestore.rules` `validNotificationPrefs` allows only those keys. UI: `NotificationSettingsDialog.tsx`, data layer `apps/web/src/data/notifications.ts`.
- Hosting (`firebase.json`, target `app`) rewrites every path to `/index.html`, so a missing `sw.js` would be answered with HTML. Headers exist only for `/assets/**` and `/index.html`.
- Auth domain is `atrium-workboards.web.app`; the service worker must be served from that origin's root.

## Decisions

1. **Transport: Firebase Cloud Messaging (FCM) web push.** It reuses the existing Firebase project and Admin SDK (`firebase-admin/messaging`), handles the Apple, Google and Mozilla push services behind one API, and needs one public VAPID key (public by design, lives in `apps/web/src/lib/firebase.ts` next to the web config). Rejected: the `web-push` library with our own VAPID keys (more code, our own subscription store and expiry handling, no benefit for a single-region personal app).
2. **One hand-written service worker, no precaching and no offline caching in v1.** File `apps/web/public/sw.js`, served from the site root (shape in PWA-1 and PWA-4). Rationale: the 2026-11 handoff records that browsers keep old JS chunks after a deploy; a caching worker would make that worse. Push and install do not need caching (iOS and current Chrome do not require a fetch handler). `vite-plugin-pwa`/Workbox is therefore **not** added (no new dependency, no new licence entry).
3. **Server hook: after `createNotification` returns `true`** (the notification was newly created, so a retried trigger never pushes twice). The push is sent from the same Function invocation, best-effort: a push failure is logged, never thrown, never blocks the notification. Rejected: a separate Firestore trigger on the notifications path (an extra deploy unit and cold start for no gain; the single store method already sees every writer).
4. **Respect prefs per channel.** `notificationPrefs` gains a nested `push` map with the same kinds (`assigned`, `reply`, `mention`, `button`, `automation`) and a master `pushEnabled` is **not** stored: a device is opted in by having a token document. Defaults for a freshly enabled device: assigned, reply, mention, button on; automation off (noisy). Account kinds always push to the people they target (admins, the approved person), as they always show in the bell.
5. **Device tokens at `users/{uid}/pushTokens/{tokenId}`** where `tokenId` is a hash (sha-256 hex, 64 chars) of the FCM token, doc `{ token, userAgent (max 200), platform: 'ios'|'android'|'desktop', createdAt, lastSeenAt }`. The owner of the user doc may create, update `lastSeenAt` and delete their own; Functions delete tokens FCM reports as unregistered. Never readable by anyone else (not even workspace members).
6. **Asking for permission only after a user action** (a button in the notification settings and in the install hint). Never on page load. iOS requires this and it is better practice.
7. **iPhone:** web push works only for a site added to the Home Screen (iOS 16.4+). The settings dialog shows an "Install Atrium" hint on iOS Safari when not installed (instructions: Share > Add to Home Screen), and hides the enable switch until installed.
8. **App identity:** name "Atrium", short name "Atrium", `display: standalone`, `theme_color` and `background_color` use the same value as the existing `theme-color` in `index.html` (a manifest is JSON, so it cannot read CSS tokens; a test keeps the two equal). Icons: our own mark in 192, 512 and maskable 512 PNG, plus a 180 apple-touch-icon. See open question 1.
9. **No monday names, logos or art** anywhere (icons and copy).

## Work packages (small PRs, in this order)

- **PWA-1: install.** `apps/web/public/manifest.webmanifest`, icons, `index.html` links and iOS meta (`apple-touch-icon`, `apple-mobile-web-app-capable`, status bar style), `firebase.json` headers (`/sw.js` and `/manifest.webmanifest`: `Cache-Control: no-cache`; `/sw.js` also `Service-Worker-Allowed: /`), and a minimal `sw.js` that only takes control immediately (`skipWaiting`, `clients.claim`) and has the push and notification-click handlers stubbed. Register it in `apps/web/src/main.tsx` in production builds only. A test fails if `dist/sw.js` is missing after `pnpm build` (the SPA rewrite would hide it). Touches the hot-spot `firebase.json`: minimal change, merge first.
- **PWA-2: tokens, rules, prefs (data layer).** `packages/shared`: `pushTokenSchema`, `pushPrefsSchema`, extend `notificationPrefs` with the optional `push` map and its limits. `firestore.rules` + emulator tests: a user creates, reads (own only), updates `lastSeenAt` of and deletes their own token docs, nobody else; shape and size limits; `validNotificationPrefs` accepts the optional `push` map of bools. Hot-spot files (`packages/shared`, `firestore.rules`, `tests/rules/**`): land alone and quickly.
- **PWA-3: Functions send.** `functions/src/lib/push.ts`: `sendPush(uid, notificationId, data)` reads the user's token docs and push prefs, builds a data-only FCM message (title, body, `url` deep link built from the notification: workspace, board, item, update), sends with `sendEachForMulticast`, deletes tokens with `messaging/registration-token-not-registered` or `invalid-registration-token`, never throws. Wired after a successful `createNotification`. The text uses the existing display fields; snippets are already capped at 200 chars. Collapse key per item so a burst replaces rather than stacks. **Ultrareview checkpoint before merging** (it sends data to third-party push services and handles user device identifiers).
- **PWA-4: web UI.** In `NotificationSettingsDialog`: an "On this device" section (status: not supported / install first on iOS / blocked in the browser / off / on), an Enable button (permission prompt, `getToken` with the VAPID key and the service-worker registration, save the token doc), a Disable button (delete the doc, `deleteToken`), and the per-kind push switches. `sw.js` shows the notification and, on click, focuses an existing window or opens the deep link. Refresh `lastSeenAt` at most once a day on app load. Light and dark, and visual baselines for the dialog.
- **Showcase and docs:** nothing to seed (tokens are per device). Add `docs/plans/owner-check-list.md` steps and a short `docs/pwa.md` (how it works, how to debug a missing push, privacy note).

## Security and privacy

- The VAPID public key and web config are public. The Functions use the existing service account; it needs **`roles/firebasecloudmessaging.admin`** (or the FCM send permission through `roles/firebase.sdkAdminServiceAgent`, which Functions normally already hold). The owner may have to grant it if the first send returns a permission error; Ophelia gives exact steps. IAM is the owner's to change.
- Push payloads carry the same text as the bell (actor name, item name, snippet). Push services see it in transit encrypted to the device (Web Push encryption); do not put anything more sensitive than the bell shows. Notification content respects the user's per-kind switches.
- Token docs are never listed to other users; deleting an account's data or signing out on a device removes that device's token (sign-out calls the disable path).
- No tracking, no analytics, no third-party scripts added.

## Tests

- Shared: schemas (token doc, prefs with the `push` map, unknown keys rejected).
- Rules (emulator): own token CRUD allowed with valid shape; someone else's refused; oversized fields refused; prefs `push` validation.
- Functions: `sendPush` unit tests with a fake messaging client (skips users with no tokens, respects kind switches and defaults, prunes dead tokens, swallows send errors, builds the deep link, called only when `createNotification` returned `true`).
- Web: settings dialog states (unsupported, iOS not installed, blocked, off, on) with a mocked `Notification`/`navigator.serviceWorker`; service-worker registration only in production; `dist/sw.js` exists after the build.
- Manual (owner, on a real iPhone and a desktop browser): the checks in the PWA-4 owner-check section.

## Not in scope

Offline mode and caching, background sync, badges counts on the app icon, email (separate epic "Email notifications & digests"), per-board mute, quiet hours, rich actions on the notification, the Windows/Android install banners beyond the browser default.

## Open questions for the owner (defaults stand unless changed)

1. **App icon and name.** Default: name "Atrium"; icon is a simple generated mark in the existing brand blue (Opus supplies an SVG, rendered to PNG sizes). You may provide your own artwork instead.
2. **Which kinds push by default** when a device is enabled. Default: assigned, reply, mention and button on; automation off.
3. **Desktop browsers too?** Default: yes (same code path); the settings dialog explains each browser's own permission prompt.
4. **Account kinds** (a new account asking for approval, approval granted) always push to the people concerned, as they always show in the bell. Default: yes.
5. **Sign-out behaviour.** Default: signing out on a device removes that device's push token so the next person on a shared device gets nothing.
