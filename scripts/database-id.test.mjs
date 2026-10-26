// DB1 guard: the Firestore database id lives in one module (`packages/shared/src/firebase-env.ts`).
// This fails when the id, or the project's default database, is hard-coded anywhere else in the
// source, when a Firestore client or trigger is created without the shared constant, or when
// firebase.json deploys rules and indexes to a different database.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const CONSTANT_MODULE = 'packages/shared/src/firebase-env.ts';
const THIS_TEST = 'scripts/database-id.test.mjs';

const SCAN_ROOTS = ['apps', 'functions/src', 'packages', 'scripts', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.auth', 'test-results', '__screenshots__']);
const SOURCE_FILE = /\.(?:ts|tsx|mjs|cjs|js)$/;

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
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root)));

const constantSource = read(CONSTANT_MODULE);
const databaseId = /FIRESTORE_DATABASE_ID\s*=\s*'([^']+)'/.exec(constantSource)?.[1];

/** The text of the call whose opening parenthesis is at `open`, up to the matching one. */
function callArguments(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

test('the shared module exports a named database id', () => {
  assert.ok(databaseId, `${CONSTANT_MODULE} must export FIRESTORE_DATABASE_ID = '<id>'`);
  assert.notEqual(databaseId, '(default)', 'Atrium must use a named database');
});

test('no hard-coded database id outside the shared module', () => {
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (path === CONSTANT_MODULE || path === THIS_TEST) continue;
    const source = readFileSync(file, 'utf8');
    if (source.includes(databaseId)) offenders.push(`${path}: the id "${databaseId}"`);
    if (source.includes('(default)')) offenders.push(`${path}: "(default)"`);
  }
  assert.deepEqual(
    offenders,
    [],
    'Import FIRESTORE_DATABASE_ID from @atrium/shared instead of writing the database id.',
  );
});

test('every Firestore client and Firestore trigger names the database', () => {
  const calls =
    /\b(getFirestore|initializeFirestore|onDocument(?:Created|Updated|Deleted|Written))\(/g;
  const offenders = [];
  let seen = 0;
  for (const file of files) {
    const path = rel(file);
    if (path === THIS_TEST) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(calls)) {
      seen += 1;
      const args = callArguments(source, match.index + match[0].length - 1);
      if (!args.includes('FIRESTORE_DATABASE_ID')) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${path}:${line} ${match[1]}(...) does not use FIRESTORE_DATABASE_ID`);
      }
    }
  }
  assert.ok(
    seen >= 4,
    `expected to find the web, functions and test Firestore calls, found ${seen}`,
  );
  assert.deepEqual(offenders, []);
});

test('firebase.json deploys the rules and indexes to the same database', () => {
  const { firestore } = JSON.parse(read('firebase.json'));
  assert.ok(Array.isArray(firestore), 'firebase.json "firestore" must be the array form');
  assert.deepEqual(
    firestore.map((entry) => entry.database),
    [databaseId],
    'firebase.json must list exactly the shared database id',
  );
  assert.equal(firestore[0].rules, 'firestore.rules');
  assert.equal(firestore[0].indexes, 'firestore.indexes.json');
});
