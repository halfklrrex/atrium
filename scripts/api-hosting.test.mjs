// Guard for the Hosting rewrite of the public API (P8 section 4): `/api/**` must reach the `api`
// function in europe-west1, come before the SPA catch-all, never be cached, and not collide with a
// route of the web app.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const config = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
const app = config.hosting.find((site) => site.target === 'app');
const rewrites = app.rewrites;

test('/api/** is rewritten to the api function in europe-west1', () => {
  const rewrite = rewrites.find((entry) => entry.source === '/api/**');
  assert.ok(rewrite, 'no rewrite for /api/**');
  assert.deepEqual(rewrite.function, { functionId: 'api', region: 'europe-west1' });
});

test('the api rewrite precedes the catch-all', () => {
  const catchAll = rewrites.findIndex((entry) => entry.source === '**');
  assert.ok(catchAll >= 0, 'the app target lost its ** -> /index.html catch-all');
  const index = rewrites.findIndex((entry) => entry.source === '/api/**');
  assert.ok(index >= 0 && index < catchAll, '/api/** must come before the catch-all');
});

test('/api/** is never cached', () => {
  const rule = app.headers.find((entry) => entry.source === '/api/**');
  assert.ok(rule, 'no header rule for /api/**');
  assert.deepEqual(rule.headers, [{ key: 'Cache-Control', value: 'no-store' }]);
});

test('the web app has no route or static file under /api', () => {
  const publicDir = join(repoRoot, 'apps/web/public');
  let names = [];
  try {
    names = readdirSync(publicDir);
  } catch {
    // no public folder: nothing can collide
  }
  assert.ok(!names.includes('api'), 'apps/web/public/api would be shadowed by the rewrite');
  const routes = readFileSync(join(repoRoot, 'apps/web/src/App.tsx'), 'utf8');
  assert.ok(!/path=["']\/?api(\/|["'])/.test(routes), 'a web route under /api would be shadowed');
});
