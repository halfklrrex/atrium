# PWA: install (and later push)

Status: PWA-1 (install) only. Push arrives in PWA-2 to PWA-4; see `docs/specs/P4-pwa-web-push.md`.

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
