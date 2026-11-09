import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MOBILE_SCREENS } from './mobile-screens';

/**
 * Phone layout audit. It takes no screenshots: for every screen at five phone/tablet sizes it
 * measures the page and records defects. Findings are compared with `mobile-known-defects.json`:
 * the test fails on any NEW defect and on any listed defect that no longer reproduces, so the list
 * only ever shrinks as the app gets fixed. Run it with `pnpm test:visual --project=mobile-audit`;
 * every run appends its findings to `tests/visual/.audit/findings.ndjson`; set
 * `MOBILE_AUDIT_WRITE=1` to record without failing, then `node scripts/mobile-known-defects.mjs` rebuilds the list. See
 * docs/visual-testing.md. WebKit on Linux is not iOS Safari: the owner still checks a real iPhone.
 */

const SIZES = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
] as const;

type Check =
  | 'overflow-x' // the document scrolls sideways
  | 'offscreen-x' // an element sticks out past a viewport edge without a scroll container around it
  | 'topbar-covered' // something is painted over the top bar on a plain page
  | 'topbar-moved' // the top bar is no longer at the top of the screen
  | 'scroll-leak' // scrolling inside a dialog or panel scrolled the page or shifted the visual viewport
  | 'input-font-size'; // a text field under 16px, which makes iOS Safari zoom in on focus

const here = dirname(fileURLToPath(import.meta.url));
const KNOWN_FILE = join(here, 'mobile-known-defects.json');
const FINDINGS_FILE = join(here, '..', '.audit', 'findings.ndjson');
const WRITE_MODE = process.env.MOBILE_AUDIT_WRITE === '1';

/** `screen|WxH|check` -> one-line description. */
const known: Record<string, string> = JSON.parse(readFileSync(KNOWN_FILE, 'utf8'));

interface Finding {
  check: Check;
  detail: string;
}

/** Everything is measured inside the page, in one round trip, so the numbers are of one moment. */
function measure(page: Page, hasOverlay: boolean): Promise<Finding[]> {
  return page.evaluate((overlayMode) => {
    const out: { check: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const describe = (el: Element) => {
      // CSS-module classes look like `_card_100ck_60`; drop the build hash so descriptions are stable.
      const raw =
        typeof el.className === 'string' ? (el.className.trim().split(/\s+/)[0] ?? '') : '';
      const cls = raw.replace(/^_?(.*?)_[0-9a-z]{4,6}_\d+$/, '$1');
      const label = el.getAttribute('aria-label') ?? el.getAttribute('role') ?? '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${label ? `[${label}]` : ''}`;
    };
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
        return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };

    // 1. The document scrolls sideways.
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > vw + 1) {
      out.push({ check: 'overflow-x', detail: `scrollWidth ${root.scrollWidth} > ${vw}` });
    }

    // 2. Elements that straddle a viewport edge, unless a scroll container clips them. Only the
    //    outermost straddler is reported, since its children inherit the problem.
    const straddles = (box: DOMRect) =>
      (box.right > vw + 1 && box.left < vw) || (box.left < -1 && box.right > 0);
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    const culprits: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || (el.closest('svg') !== null && el.tagName !== 'svg')) continue;
      const box = el.getBoundingClientRect();
      if (!straddles(box) || clipped(el)) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && straddles(parent.getBoundingClientRect())) continue;
      culprits.push(`${describe(el)} ${Math.round(box.left)}..${Math.round(box.right)}`);
    }
    if (culprits.length) {
      out.push({
        check: 'offscreen-x',
        detail: `${culprits.length} element(s) past the edge, e.g. ${culprits.slice(0, 3).join('; ')}`,
      });
    }

    // 3. On a plain page nothing may sit on top of the top bar (an open overlay may, on purpose).
    const bar = document.querySelector('header[data-print="hide"]');
    if (bar && !overlayMode) {
      const box = bar.getBoundingClientRect();
      const points = [0.15, 0.5, 0.85].map((f) => [
        box.left + box.width * f,
        box.top + box.height / 2,
      ]);
      const covering = new Set<string>();
      for (const [x = 0, y = 0] of points) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !bar.contains(hit)) covering.add(describe(hit));
      }
      if (covering.size) {
        out.push({ check: 'topbar-covered', detail: `covered by ${[...covering].join(', ')}` });
      }
    }

    // 4. Text fields under 16px.
    const small: string[] = [];
    const fields = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
    for (const el of document.querySelectorAll(fields)) {
      if (
        el instanceof HTMLInputElement &&
        /^(checkbox|radio|hidden|file|range|color|button|submit)$/.test(el.type)
      )
        continue;
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) small.push(`${describe(el)} ${size}px`);
    }
    if (small.length) {
      out.push({
        check: 'input-font-size',
        detail: `${small.length} field(s) under 16px, e.g. ${[...new Set(small)].slice(0, 3).join('; ')}`,
      });
    }
    return out;
  }, hasOverlay) as Promise<Finding[]>;
}

/**
 * Approximates the owner's bug: with an overlay open, scroll inside it and see whether the page or
 * the visual viewport moved. Mobile WebKit has no mouse wheel and Playwright has no touch swipe, so
 * the scrolling is done in the page: every scrollable box in the overlay goes to its end and the
 * last element is scrolled into view, which also scrolls any ancestor that can scroll (the document
 * included), as an overscrolling finger would. A page that can scroll at all behind the overlay is
 * reported too, since that is what lets a real swipe chain out of the dialog on iOS.
 */
async function scrollInsideOverlay(page: Page, selector: string): Promise<Finding[]> {
  const before = await page.evaluate(() => ({
    bar: document.querySelector('header[data-print="hide"]')?.getBoundingClientRect().top ?? 0,
  }));
  const pageScrolls = await page.evaluate((sel) => {
    const all = document.querySelectorAll(sel);
    const root = all[all.length - 1];
    if (!root) return false;
    const scrollers = [root, ...root.querySelectorAll('*')].filter((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return /(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight + 1;
    });
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    let leaf: Element = root;
    while (leaf.lastElementChild) leaf = leaf.lastElementChild;
    leaf.scrollIntoView({ block: 'end' });
    const doc = document.scrollingElement ?? document.documentElement;
    const locked = /(hidden|clip)/.test(getComputedStyle(document.documentElement).overflowY);
    return !locked && doc.scrollHeight > doc.clientHeight + 1;
  }, selector);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const after = await page.evaluate(() => ({
    scrollY: window.scrollY,
    docTop: (document.scrollingElement ?? document.documentElement).scrollTop,
    vvTop: window.visualViewport?.offsetTop ?? 0,
    vvPage: window.visualViewport?.pageTop ?? 0,
    vvLeft: window.visualViewport?.offsetLeft ?? 0,
    bar: document.querySelector('header[data-print="hide"]')?.getBoundingClientRect().top ?? 0,
  }));
  const found: Finding[] = [];
  const leaked = [
    after.scrollY !== 0 && `window.scrollY ${after.scrollY}`,
    after.docTop !== 0 && `document scrollTop ${after.docTop}`,
    (after.vvTop !== 0 || after.vvLeft !== 0) &&
      `visualViewport offset ${after.vvLeft},${after.vvTop}`,
    after.vvPage !== 0 && `visualViewport pageTop ${after.vvPage}`,
  ].filter(Boolean);
  if (pageScrolls && !leaked.length)
    leaked.push('the page itself can scroll behind the open overlay');
  if (leaked.length) found.push({ check: 'scroll-leak', detail: leaked.join(', ') });
  if (Math.abs(after.bar - before.bar) > 0.5 || Math.abs(after.bar) > 0.5) {
    found.push({
      check: 'topbar-moved',
      detail: `top bar at y=${after.bar} after scrolling inside the overlay (was ${before.bar})`,
    });
  }
  return found;
}

// The baseline workflow runs every project with --update-snapshots and a screen filter; this one has no
// snapshots to update, so it stays out of that run.
// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed',
    'the phone audit takes no screenshots',
  );
});

for (const screen of MOBILE_SCREENS) {
  test.describe(screen.name, () => {
    test.use(screen.signedOut ? { storageState: { cookies: [], origins: [] } } : {});
    if (screen.seed) test.beforeAll(screen.seed);
    if (screen.cleanup) test.afterAll(screen.cleanup);

    for (const size of SIZES) {
      const label = `${size.width}x${size.height}`;
      test.describe(label, () => {
        test.use({ viewport: size });

        test(`${screen.title} at ${label}`, async ({ page }) => {
          await screen.open(page);
          // Let layout settle after the content arrived (fonts, a second frame).
          await page.evaluate(() => document.fonts.ready);
          const findings = await measure(page, Boolean(screen.overlay));
          if (screen.overlay) findings.push(...(await scrollInsideOverlay(page, screen.overlay)));

          const prefix = `${screen.name}|${label}|`;
          // Every run records its findings (CI uploads the file), so the list can be rebuilt from them.
          mkdirSync(dirname(FINDINGS_FILE), { recursive: true });
          const lines = findings.map((f) =>
            JSON.stringify({ key: prefix + f.check, detail: f.detail }),
          );
          if (lines.length) appendFileSync(FINDINGS_FILE, lines.join('\n') + '\n');
          if (WRITE_MODE) return;

          const found = new Map(findings.map((f) => [prefix + f.check, f.detail]));
          const unexpected = [...found].filter(([key]) => !(key in known));
          const fixed = Object.keys(known).filter(
            (key) => key.startsWith(prefix) && !found.has(key),
          );
          expect(
            unexpected.map(([key, detail]) => `NEW defect ${key}: ${detail}`),
            'new defects (fix them, or add them to mobile-known-defects.json with a description)',
          ).toEqual([]);
          expect(
            fixed.map((key) => `FIXED ${key}: ${known[key]}`),
            'listed defects that no longer reproduce (remove them from mobile-known-defects.json)',
          ).toEqual([]);
        });
      });
    }
  });
}
