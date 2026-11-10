// SUBITEMS-as-items guard: `board.subitemColumns` is being retired, and every reader must go through
// `columnsForItem` (packages/shared/src/subitems.ts). This fails on a read of `subitemColumns` in a
// file that is not on the allow list. Each follow-up PR shrinks the list; PR 6 leaves the schema
// and the migration. Tests, and the places named below, may use the field.
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
 * Source files that may still mention `subitemColumns`, with why. The first group is permanent
 * (schema, helper, migration); the rest is the legacy surface that PRs 2 to 6 convert.
 */
const ALLOWED = new Map([
  // Permanent.
  ['packages/shared/src/subitems.ts', 'columnsForItem and the migration plan'],
  ['packages/shared/src/schemas/board.ts', 'the deprecated schema field'],
  [
    'packages/shared/src/derived-ids.ts',
    'derived / required / server-managed id lists span both lists',
  ],
  ['scripts/migrations/2026-11-merge-subitem-columns.mjs', 'the migration'],
  // Transition: legacy code paths removed by SUBITEMS PRs 2 to 6.
  ['packages/shared/src/boards.ts', 'new boards are created with []'],
  ['packages/shared/src/schemas/column-type-change.ts', 'the legacy column scope'],
  ['packages/shared/src/schemas/template.ts', 'templates carry []'],
  ['packages/shared/src/templates/built-in.ts', 'built-in templates carry []'],
  ['packages/shared/src/item-index.ts', 'the index board shape (passed to columnsForItem)'],
  ['functions/src/lib/activity.ts', 'the board shape (passed to columnsForItem)'],
  ['functions/src/lib/notifications.ts', 'the board shape (passed to columnsForItem)'],
  ['functions/src/lib/required-revert.ts', 'the board shape (passed to columnsForItem)'],
  ['functions/src/lib/column-type-change.ts', 'the legacy column scope'],
  ['functions/src/lib/admin.ts', 'loads the board; legacy column scope'],
  ['functions/src/lib/admin-notifications.ts', 'loads the board'],
  ['functions/src/lib/admin-required-revert.ts', 'loads the board'],
  ['functions/src/lib/admin-activity.ts', 'loads the board'],
  [
    'scripts/migrations/2026-11-backfill-item-date-keys.mjs',
    'older backfill, run before the merge',
  ],
  ['scripts/migrations/2026-11-backfill-item-index.mjs', 'older backfill, run before the merge'],
  ['scripts/migrations/2026-11-backfill-required-column-ids.mjs', 'older backfill'],
  ['scripts/migrations/2026-10-backfill-derived-column-ids.mjs', 'older backfill'],
  ['scripts/showcase/data.mjs', 'the showcase board carries []'],
  ['scripts/e2e-membership.mjs', 'board fixture with []'],
  [
    'apps/web/src/components/board-table/table-actions.ts',
    'legacy column scope (until the migration ran)',
  ],
  ['apps/web/src/data/firestore.ts', 'new and duplicated boards are created with []'],
  ['apps/web/src/data/structure-writes.ts', 'legacy column scope (until the migration ran)'],
  [
    'scripts/mcp/lib/service.mjs',
    'legacy boards (not yet migrated) still list their subitem columns',
  ],
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
