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

test('the generator is deterministic', () => {
  assert.equal(render(), render());
});
