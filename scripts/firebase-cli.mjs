// Resolves the repo's pinned firebase-tools CLI so scripts can launch it through Node directly
// (no shell), which keeps paths with spaces intact on Windows.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('firebase-tools/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.firebase;

export const firebaseCli = resolve(dirname(pkgPath), bin);
