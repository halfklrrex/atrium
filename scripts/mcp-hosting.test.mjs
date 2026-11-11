// Guard for the Hosting rewrites of the hosted MCP connector (OPS4 section 3): the seven paths must
// reach the `mcp` function in europe-west1 and come before the SPA catch-all of the app target.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const config = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
const app = config.hosting.find((site) => site.target === 'app');
const rewrites = app.rewrites;

const MCP_PATHS = [
  '/mcp',
  '/authorize',
  '/token',
  '/register',
  '/revoke',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource/mcp',
];

test('each connector path is rewritten to the mcp function in europe-west1', () => {
  for (const source of MCP_PATHS) {
    const rewrite = rewrites.find((entry) => entry.source === source);
    assert.ok(rewrite, `no rewrite for ${source}`);
    assert.deepEqual(rewrite.function, { functionId: 'mcp', region: 'europe-west1' }, source);
  }
});

test('the connector rewrites precede the catch-all', () => {
  const catchAll = rewrites.findIndex((entry) => entry.source === '**');
  assert.ok(catchAll >= 0, 'the app target lost its ** -> /index.html catch-all');
  assert.equal(rewrites[catchAll].destination, '/index.html');
  for (const source of MCP_PATHS) {
    const index = rewrites.findIndex((entry) => entry.source === source);
    assert.ok(index >= 0 && index < catchAll, `${source} must come before the catch-all`);
  }
});

test('/mcp is never cached', () => {
  const rule = app.headers.find((entry) => entry.source === '/mcp');
  assert.ok(rule, 'no header rule for /mcp');
  assert.deepEqual(rule.headers, [{ key: 'Cache-Control', value: 'no-store' }]);
});
