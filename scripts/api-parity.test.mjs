// Guard for the public API docs (P8 PR 5): the route definitions in functions/src/api/routes/*.ts, the
// OpenAPI operation table in functions/src/api/openapi.ts and the route table on the /developers page
// must list exactly the same routes, and the limits the page states must equal the source constants.
//
// Approach: the sources are TypeScript, so they are read as text and the route literals pulled out with
// small regular expressions (`method: 'get', path: '/x'` in the route files, `'GET /x'` keys in the
// OpenAPI table, `method: 'GET', path: '/x'` in the page content). That needs no build step and no TS
// loader; the vitest suite in functions/src/api/openapi.test.ts additionally compares the built document
// with the real route objects, so a wrong regex here cannot hide a drift for long.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');
const toOpenApiPath = (path) => path.replace(/:(\w+)/g, '{$1}');
const sorted = (list) => [...new Set(list)].sort();

const routesDir = join(repoRoot, 'functions/src/api/routes');
const fromRoutes = sorted(
  readdirSync(routesDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) =>
      [
        ...read('functions/src/api/routes', file).matchAll(
          /method:\s*'(get|post|patch|put|delete)',\s*path:\s*'([^']+)'/g,
        ),
      ].map((m) => `${m[1].toUpperCase()} ${toOpenApiPath(m[2])}`),
    ),
);

// The incoming-webhook route (functions/src/api/hooks.ts) is outside /api/v1: its base path is a constant
// and its routes are `router.post('/:token', ...)` calls. Its OpenAPI key is the full path.
const hooksSource = read('functions/src/api/hooks.ts');
const hooksBase = hooksSource.match(/export const HOOKS_BASE_PATH = '([^']+)'/)?.[1] ?? '';
const fromHooks = sorted(
  [...hooksSource.matchAll(/router\.(get|post|patch|put|delete)\('(\/[^']*)'/g)].map(
    (m) => `${m[1].toUpperCase()} ${toOpenApiPath(hooksBase + m[2])}`,
  ),
);

const allFromOpenApi = sorted(
  [
    ...read('functions/src/api/openapi.ts').matchAll(
      /^\s*'(GET|POST|PATCH|PUT|DELETE) (\/[^']*)':/gm,
    ),
  ].map((m) => `${m[1]} ${m[2]}`),
);
// The /api/v1 entries (the strict check below) and the hook entries (checked on their own).
const fromOpenApi = allFromOpenApi.filter((r) => !r.split(' ')[1].startsWith(`${hooksBase}/`));
const hooksFromOpenApi = allFromOpenApi.filter((r) => r.split(' ')[1].startsWith(`${hooksBase}/`));

const fromPage = sorted(
  [
    ...read('apps/web/src/pages/developers/developers-content.ts').matchAll(
      /method:\s*'(GET|POST|PATCH|PUT|DELETE)',\s*path:\s*'([^']+)'/g,
    ),
  ].map((m) => `${m[1]} ${m[2]}`),
);

test('the route files define routes (the extraction works)', () => {
  assert.ok(fromRoutes.length >= 14, `found only ${fromRoutes.length} routes`);
  assert.ok(fromRoutes.includes('GET /boards/{id}/items'));
  assert.ok(fromRoutes.includes('POST /items/{id}/archive'));
});

test('every route has an OpenAPI entry and every OpenAPI path has a route', () => {
  const missing = fromRoutes.filter((r) => !fromOpenApi.includes(r));
  const extra = fromOpenApi.filter((r) => !fromRoutes.includes(r));
  assert.deepEqual(missing, [], `routes with no OpenAPI entry: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `OpenAPI entries with no route: ${extra.join(', ')}`);
});

test('the incoming-webhook route has an OpenAPI entry, and only that one', () => {
  assert.equal(hooksBase, '/api/hooks');
  assert.deepEqual(fromHooks, ['POST /api/hooks/{token}']);
  assert.deepEqual(hooksFromOpenApi, fromHooks);
});

test('the /developers page documents the incoming-webhook route', () => {
  const page = read('apps/web/src/pages/developers/developers-content.ts');
  for (const route of fromHooks) {
    const path = route.split(' ')[1].replace('{token}', '');
    assert.ok(page.includes(path), `${path} not on the page`);
  }
  assert.match(page, /INCOMING_HOOK_CALLS_PER_MINUTE/);
  assert.match(page, /INCOMING_HOOK_DAILY_CALLS/);
  assert.match(page, /INCOMING_HOOK_BODY_MAX_BYTES/);
});

test('the incoming-webhook limits are the shared constants the page and the document read', () => {
  const shared = read('packages/shared/src/incoming-hooks.ts');
  assert.match(shared, /INCOMING_HOOK_CALLS_PER_MINUTE = 60;/);
  assert.match(shared, /INCOMING_HOOK_DAILY_CALLS = 1000;/);
  assert.match(shared, /INCOMING_HOOK_BODY_MAX_BYTES = 64 \* 1024;/);
  const openapi = read('functions/src/api/openapi.ts');
  for (const name of ['INCOMING_HOOK_CALLS_PER_MINUTE', 'INCOMING_HOOK_DAILY_CALLS']) {
    assert.match(openapi, new RegExp(name));
  }
  assert.match(openapi, /INCOMING_HOOK_BODY_MAX_BYTES/);
});

test('the /developers route table matches the routes', () => {
  const missing = fromRoutes.filter((r) => !fromPage.includes(r));
  const extra = fromPage.filter((r) => !fromRoutes.includes(r));
  assert.deepEqual(missing, [], `routes missing on the page: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `page rows with no route: ${extra.join(', ')}`);
});

test('the limits on the page equal the source constants', () => {
  const limits = read('functions/src/api/limits.ts');
  const page = read('apps/web/src/pages/developers/developers-content.ts');
  const number = (source, name) =>
    Number(source.match(new RegExp(`export const ${name} = ([\\d_]+)`))?.[1].replaceAll('_', ''));
  for (const name of ['API_CALLS_PER_MINUTE', 'API_DAILY_CALLS', 'API_DAILY_WRITES']) {
    assert.ok(number(limits, name) > 0, `${name} not found in limits.ts`);
    assert.equal(number(page, name), number(limits, name), name);
  }
  const idempotency = read('functions/src/api/idempotency.ts');
  assert.match(idempotency, /IDEMPOTENCY_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.equal(number(page, 'IDEMPOTENCY_HOURS'), 24);
});

test('the error codes on the page equal the API error codes', () => {
  const errors = read('functions/src/api/errors.ts');
  const union = errors.match(/export type ApiErrorCode =([^;]+);/)?.[1] ?? '';
  const codes = sorted([...union.matchAll(/'(\w+)'/g)].map((m) => m[1]));
  const page = read('apps/web/src/pages/developers/developers-content.ts');
  const documented = sorted([...page.matchAll(/\bcode:\s*'(\w+)'/g)].map((m) => m[1]));
  assert.deepEqual(documented, codes);
});
