import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GROUPS, ICON_KEY_PATTERN, OUTPUT_FILE, render } from './generate-workspace-icons.mjs';

test('icons.generated.ts is up to date with the generator', () => {
  assert.equal(
    readFileSync(OUTPUT_FILE, 'utf8'),
    render(),
    'Run `pnpm icons:generate` and commit the result.',
  );
});

test('the curated list has unique, valid keys', () => {
  const keys = GROUPS.flatMap((g) => g.icons.map(([key]) => key));
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, ICON_KEY_PATTERN);
});

test('every curated icon exists in the package, in both weights', () => {
  // render() throws when a regular or fill file is missing or is not a single path.
  const output = render();
  for (const g of GROUPS) assert.ok(g.icons.length > 0, `group ${g.id} is empty`);
  const count = GROUPS.reduce((n, g) => n + g.icons.length, 0);
  assert.ok(count >= 190 && count <= 210, `expected 190 to 210 icons, got ${count}`);
  assert.equal(output.match(/regular: "/g)?.length, count);
  assert.equal(output.match(/fill: "/g)?.length, count);
});

test('the generator is deterministic', () => {
  assert.equal(render(), render());
});
