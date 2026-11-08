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
