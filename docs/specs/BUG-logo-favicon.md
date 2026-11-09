# BUG: blurry sign-in logo and stale favicon (2026-11-09)

Owner report (monday item 3341474437): the logo on the sign-in screen is very blurry (iPhone screenshot), and a new browser that never signed in shows the OLD favicon. Plan: `docs/plans/2026-11-09-next-steps.md`.

## Root causes (verified by the planner on the live site and in the code; re-verify before changing)

1. **Blurry logo.** `BrandMark variant="icon"` (`apps/web/src/components/BrandMark.tsx`) loads `src/assets/brand/atrium-icon-{light,dark}.svg`. Every visible shape is inside an SVG filter (`blur-soft`, `blur-edge`, bloom, glow, rays, mullions, shadow). WebKit (Safari and every iOS browser) draws filter output at low resolution and scales it up, so a 3x iPhone looks soft. Lines 24 to 27 of both SVGs have malformed filter regions (`x="-10%%"`). The About dialog uses the same icon. The `mark` variant has no filters and is fine.
2. **Old favicon.** `/favicon.ico` returns 200 `text/html` because there is no `.ico` file and the catch-all rewrite answers. `/favicon.svg` is the old logo's URL and is cached `max-age=3600`. `/` and deep links are served `max-age=3600` because the `/index.html` header rule in `firebase.json` does not match them, so old page shells survive deploys.

## Fix

1. Render the icon art to PNG at 64, 128 and 192 px, light and dark (Playwright Chromium with `deviceScaleFactor: 3`, or resvg). Put the PNGs next to the SVGs. Make `BrandMark`'s icon variant an `<img srcset="…64.png 1x, …128.png 2x, …192.png 3x">` (keep the same alt text and size prop behaviour). Keep the SVGs as the master files and fix the `%%` in both.
2. Add a real multi-size `apps/web/public/favicon.ico` (16, 32 and 48 px) built from the new art.
3. Version every icon URL so stored copies go stale: `favicon.svg?v=2`, the PNG icons, the apple-touch icon and the manifest icons (`index.html`, `manifest.webmanifest`). Keep `scripts/pwa.test.mjs` and `brand-assets.test.ts` passing and update them for the new URLs.
4. `firebase.json` (hot spot, keep the change minimal): `Cache-Control: no-cache` for pages (a rule that also matches `/` and deep links), `/assets/**` stays immutable, icon files `max-age=86400`. Prove which rule wins with the Hosting emulator and `curl -I` on `/`, `/boards/x`, `/assets/<file>` and `/favicon.ico`; the service worker and manifest headers must stay as they are (`/sw.js` no-cache with `Service-Worker-Allowed`, `/manifest.webmanifest` no-cache).
5. Tests: extend `brand-assets.test.ts` (require `favicon.ico`, assert the page `Cache-Control` rule in `firebase.json`, no `%%` in the SVGs); a Playwright check at device scale factor 3 that the login logo is an `<img>` with a `srcset`.
6. Visual: update the login and About baselines with the workflow (`gh workflow run update-visual-baselines.yml -f branch=<branch>`), never hand-edit PNGs; read the new baseline images and say in the PR how they look.

## Owner follow-up (not for the agent)

After the deploy the lead re-runs the curl checks on the live site. A browser that already stored the old favicon for a page URL may need its own favicon cache cleared once.
