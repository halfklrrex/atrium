// PWA-1 guards: manifest matches index.html and the icons on disk, headers exist in firebase.json,
// and the checker for dist/sw.js + dist/manifest.webmanifest catches a missing file.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { checkPwaDist } from './check-pwa-dist.mjs';
import { repoRoot } from './env.mjs';

const pub = resolve(repoRoot, 'apps/web/public');
const manifest = JSON.parse(readFileSync(resolve(pub, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(resolve(repoRoot, 'apps/web/index.html'), 'utf8');

function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('manifest colours equal the index.html theme-color', () => {
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
  assert.ok(theme);
  assert.equal(manifest.theme_color, theme);
  assert.equal(manifest.background_color, theme);
});

test('manifest identity', () => {
  assert.equal(manifest.name, 'Atrium');
  assert.equal(manifest.short_name, 'Atrium');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
});

test('every manifest icon exists with the declared size', () => {
  assert.ok(manifest.icons.length >= 3);
  for (const icon of manifest.icons) {
    assert.equal(pngSize(resolve(pub, icon.src.replace(/^\//, ''))), icon.sizes, icon.src);
  }
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('firebase.json serves sw.js and the manifest uncached', () => {
  const config = JSON.parse(readFileSync(resolve(repoRoot, 'firebase.json'), 'utf8'));
  const app = config.hosting.find((h) => h.target === 'app');
  const headers = (source) =>
    Object.fromEntries(
      app.headers.find((h) => h.source === source).headers.map((h) => [h.key, h.value]),
    );
  assert.equal(headers('/sw.js')['Cache-Control'], 'no-cache');
  assert.equal(headers('/sw.js')['Service-Worker-Allowed'], '/');
  assert.equal(headers('/manifest.webmanifest')['Cache-Control'], 'no-cache');
  assert.equal(headers('/manifest.webmanifest')['Content-Type'], 'application/manifest+json');
});

test('sw.js has no fetch handler and no caches', () => {
  const sw = readFileSync(resolve(pub, 'sw.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(sw, /['"]fetch['"]|caches\./);
});

test('the dist checker fails on missing files and passes on a complete folder', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'pwa-dist-'));
  assert.equal(checkPwaDist(dir).length, 2);
  writeFileSync(resolve(dir, 'sw.js'), 'self.skipWaiting();');
  writeFileSync(resolve(dir, 'manifest.webmanifest'), '{}');
  assert.deepEqual(checkPwaDist(dir), []);
  mkdirSync(resolve(dir, 'x'));
});

// ---- sw.js handlers (PWA-4), run in a small sandbox ----------------------------------------------
import vm from 'node:vm';

const swSource = readFileSync(resolve(pub, 'sw.js'), 'utf8');
const ORIGIN = 'https://atrium.example';

function loadSw({ clients = [], userAgent = 'Mozilla/5.0 (X11; Linux x86_64)' } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const closed = [];
  const self = {
    location: { origin: ORIGIN },
    navigator: { userAgent },
    skipWaiting() {},
    registration: {
      showNotification: async (title, options) => void shown.push({ title, options }),
    },
    clients: {
      claim: async () => {},
      matchAll: async () => clients,
      openWindow: async (url) => void opened.push(url),
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  vm.runInNewContext(swSource, { self, URL });
  const run = async (type, event) => {
    const waits = [];
    event.waitUntil = (p) => waits.push(p);
    listeners[type](event);
    await Promise.all(waits);
  };
  const push = (payload, raw) =>
    run('push', {
      data: { json: () => (raw ? JSON.parse(raw) : payload) },
    });
  const click = (url) =>
    run('notificationclick', { notification: { close: () => closed.push(true), data: { url } } });
  return { shown, opened, closed, push, click, run };
}

const payload = {
  title: 'Jordan Lee mentioned you',
  body: 'Look',
  url: '/w/1',
  tag: 't1',
  kind: 'mention',
};

test('sw.js push shows the notification with the data-only payload', async () => {
  const sw = loadSw();
  await sw.push(payload);
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, payload.title);
  assert.equal(sw.shown[0].options.body, 'Look');
  assert.equal(sw.shown[0].options.tag, 't1');
  assert.equal(sw.shown[0].options.icon, '/icon-192.png');
  assert.equal(sw.shown[0].options.badge, '/icon-192.png');
  assert.deepEqual({ ...sw.shown[0].options.data }, { url: '/w/1' });
});

test('sw.js push ignores malformed payloads', async () => {
  const sw = loadSw();
  await sw.push(null, '{not json');
  await sw.push(null);
  await sw.push([1, 2]);
  await sw.push({ body: 'no title' });
  await sw.push({ title: 42 });
  await sw.run('push', { data: null });
  assert.equal(sw.shown.length, 0);
});

test('sw.js push stays silent when Atrium is focused and visible, shows otherwise', async () => {
  const front = loadSw({
    clients: [{ url: `${ORIGIN}/`, focused: true, visibilityState: 'visible' }],
  });
  await front.push(payload);
  assert.equal(front.shown.length, 0);
  const hidden = loadSw({
    clients: [{ url: `${ORIGIN}/`, focused: false, visibilityState: 'hidden' }],
  });
  await hidden.push(payload);
  assert.equal(hidden.shown.length, 1);
});

test('sw.js push always shows on iPhone (WebKit revokes silent pushes)', async () => {
  const sw = loadSw({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    clients: [{ url: `${ORIGIN}/`, focused: true, visibilityState: 'visible' }],
  });
  await sw.push(payload);
  assert.equal(sw.shown.length, 1);
});

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0';

test('sw.js push always shows on Macintosh Safari (iPadOS and macOS), not on other Mac browsers', async () => {
  const front = [{ url: `${ORIGIN}/`, focused: true, visibilityState: 'visible' }];
  const safari = loadSw({ userAgent: MAC_SAFARI, clients: front });
  await safari.push(payload);
  assert.equal(safari.shown.length, 1);
  for (const userAgent of [
    MAC_CHROME,
    MAC_FIREFOX,
    `${MAC_CHROME} Edg/120.0`,
    `${MAC_CHROME} OPR/100`,
  ]) {
    const other = loadSw({ userAgent, clients: front });
    await other.push(payload);
    assert.equal(other.shown.length, 0, userAgent);
  }
});

test('sw.js notificationclick closes, then focuses and navigates an existing window', async () => {
  const calls = [];
  const win = {
    url: `${ORIGIN}/`,
    focus: async () => (calls.push('focus'), win),
    navigate: async (u) => void calls.push(`navigate ${u}`),
  };
  const sw = loadSw({ clients: [win] });
  await sw.click('/w/1/b/2');
  assert.equal(sw.closed.length, 1);
  assert.deepEqual(calls, ['focus', `navigate ${ORIGIN}/w/1/b/2`]);
  assert.deepEqual(sw.opened, []);
});

test('sw.js notificationclick opens a window when none exists', async () => {
  const sw = loadSw();
  await sw.click('/admin/inbox/9');
  assert.deepEqual(sw.opened, [`${ORIGIN}/admin/inbox/9`]);
});

test('sw.js notificationclick refuses cross-origin urls', async () => {
  const sw = loadSw();
  await sw.click('https://evil.example/phish');
  await sw.click('//evil.example/phish');
  await sw.click('javascript:alert(1)');
  assert.equal(sw.closed.length, 3);
  assert.deepEqual(sw.opened, []);
});

test('sw.js compares every opened url with its own origin', () => {
  assert.match(swSource, /resolved\.origin === self\.location\.origin/);
  // openWindow only ever receives the checked href.
  for (const m of swSource.matchAll(/openWindow\(([^)]*)\)/g)) assert.equal(m[1], 'href');
});
