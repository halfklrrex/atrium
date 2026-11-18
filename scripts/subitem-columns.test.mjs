// SUBITEMS-as-items guard: `board.subitemColumns` is retired (always `[]`), and every reader gets a
// subitem's columns from `columnsForItem` (packages/shared/src/subitems.ts), which is `board.columns`.
// This fails on a mention of `subitemColumns` in a file that is not on the allow list. Tests, and the
// places named below, may use the field.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const THIS_TEST = 'scripts/subitem-columns.test.mjs';
const SCAN_ROOTS = ['apps', 'functions/src', 'packages', 'scripts', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.auth', 'test-results', '__screenshots__']);
const SOURCE_FILE = /\.(?:ts|tsx|mjs|cjs|js)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|(?:^|[\\/])tests?[\\/])/;

/**
 * Source files that may mention `subitemColumns`, with why. Nothing reads the field any more:
 * subitems share `board.columns`. Every entry below only declares the field or writes `[]`.
 */
const ALLOWED = new Map([
  ['packages/shared/src/subitems.ts', 'the migration plan names the legacy lists it merges'],
  [
    'packages/shared/src/schemas/board.ts',
    'the deprecated schema field (old documents still parse)',
  ],
  [
    'packages/shared/src/schemas/template.ts',
    'the template schema and the saved structure carry [] (the rules require the key, and []).',
  ],
  [
    'packages/shared/src/schemas/column-type-change.ts',
    'the wire format of the type-change callable and of stored snapshots keeps the old scope value',
  ],
  ['packages/shared/src/boards.ts', 'new boards are created with [] (the rules require the key)'],
  ['packages/shared/src/templates/built-in.ts', 'built-in templates carry [] (the rules need it)'],
  ['apps/web/src/data/firestore.ts', 'new and duplicated boards are created with []'],
  ['scripts/migrations/2026-11-merge-subitem-columns.mjs', 'the migration'],
  ['scripts/showcase/data.mjs', 'the showcase board carries [] (the rules require the key)'],
  ['scripts/e2e-membership.mjs', 'board fixture written with [] (the rules require the key)'],
]);

function sourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_FILE.test(name)) files.push(path);
  }
  return files;
}

const rel = (path) => relative(repoRoot, path).split(sep).join('/');
const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root))).map((file) => ({
  path: rel(file),
  source: readFileSync(file, 'utf8'),
}));
const mentions = (source) => /\bsubitemColumns\b/.test(source);

test('subitemColumns is only read in allow-listed files (everything else uses columnsForItem)', () => {
  const offenders = files
    .filter(({ path, source }) => path !== THIS_TEST && !TEST_FILE.test(path) && mentions(source))
    .filter(({ path }) => !ALLOWED.has(path))
    .map(({ path }) => path);
  assert.deepEqual(
    offenders,
    [],
    "Read a subitem's columns with columnsForItem(board, item) from @atrium/shared; add a file to ALLOWED only with a reason.",
  );
});

test('the allow list has no stale entries', () => {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const stale = [...ALLOWED.keys()].filter((path) => {
    const file = byPath.get(path);
    return file !== undefined && !mentions(file.source);
  });
  assert.deepEqual(
    stale,
    [],
    'These files no longer mention subitemColumns: remove them from ALLOWED.',
  );
});
