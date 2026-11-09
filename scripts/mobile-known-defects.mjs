// Rebuilds tests/visual/src/mobile-known-defects.json from the findings the phone audit recorded.
//
//   MOBILE_AUDIT_WRITE=1 pnpm test:visual --project=mobile-audit   # records, never fails
//   node scripts/mobile-known-defects.mjs                           # rewrites the list
//
// A key is `screen|WxH|check`. An existing description is kept, so hand-written one-liners survive.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './env.mjs';

const findingsFile = resolve(repoRoot, process.argv[2] ?? 'tests/visual/.audit/findings.ndjson');
const listFile = resolve(repoRoot, 'tests/visual/src/mobile-known-defects.json');

const previous = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : {};
const next = {};
for (const line of readFileSync(findingsFile, 'utf8').split('\n').filter(Boolean)) {
  const { key, detail } = JSON.parse(line);
  next[key] = previous[key] ?? detail;
}
const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(listFile, JSON.stringify(sorted, null, 2) + '\n');
console.log(`${Object.keys(sorted).length} known defects written to ${listFile}`);
