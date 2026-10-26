import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyLicense,
  findDisallowed,
  parseSpdx,
  renderNotices,
} from './third-party-notices.mjs';

const ok = (license) => assert.equal(classifyLicense(license).ok, true, license);
const bad = (license) => assert.equal(classifyLicense(license).ok, false, license);

test('allows permissive and AGPL-compatible licences', () => {
  for (const id of [
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Apache-2.0',
    '0BSD',
    'CC0-1.0',
    'Unlicense',
    'MPL-2.0',
    'BlueOak-1.0.0',
    'Python-2.0',
    'BSL-1.0',
    'LGPL-3.0-or-later',
    'GPL-3.0-only',
    'GPL-2.0+',
    'AGPL-3.0-only',
    'Apache-2.0 WITH LLVM-exception',
  ]) {
    ok(id);
  }
});

test('rejects proprietary, source-available and GPL-incompatible licences', () => {
  for (const id of [
    'SSPL-1.0',
    'BUSL-1.1',
    'Elastic-2.0',
    'Commons-Clause',
    'Sustainable-Use-1.0',
    'Hippocratic-2.1',
    'UNLICENSED',
    'Proprietary',
    'GPL-2.0-only',
    'GPL-2.0',
    'EPL-1.0',
    'EPL-2.0',
    'CDDL-1.0',
    'CC-BY-NC-4.0',
    'BSD-4-Clause',
  ]) {
    bad(id);
  }
});

test('rejects unknown, missing and malformed licences', () => {
  for (const id of ['', 'UNKNOWN', 'SEE LICENSE IN LICENSE.md', 'Totally-Made-Up', '(MIT OR']) {
    bad(id);
  }
});

test('handles AND, OR and parentheses', () => {
  ok('(MIT OR CC0-1.0)');
  ok('(MPL-2.0 OR Apache-2.0)');
  ok('MIT AND Zlib');
  ok('(BSD-2-Clause OR MIT OR Apache-2.0)');
  ok('EPL-2.0 OR GPL-2.0-or-later');
  ok('(MIT AND (CC0-1.0 OR SSPL-1.0))');
  bad('MIT AND SSPL-1.0');
  bad('SSPL-1.0 OR BUSL-1.1');
  bad('EPL-2.0 OR GPL-2.0-only');
});

test('explains why a licence is rejected', () => {
  assert.match(classifyLicense('SSPL-1.0').reasons[0], /SSPL/);
  assert.match(classifyLicense('EPL-2.0').reasons[0], /secondary GPL/);
  assert.match(classifyLicense('Totally-Made-Up').reasons[0], /unknown licence/);
});

test('parseSpdx builds the expected tree', () => {
  assert.deepEqual(parseSpdx('(MIT OR ISC) AND Zlib'), {
    op: 'AND',
    items: [{ op: 'OR', items: [{ id: 'MIT' }, { id: 'ISC' }] }, { id: 'Zlib' }],
  });
  assert.deepEqual(parseSpdx('Apache-2.0 WITH LLVM-exception'), {
    id: 'Apache-2.0',
    exception: 'LLVM-exception',
  });
  assert.throws(() => parseSpdx('MIT AND'));
});

const entry = (name, license, licenseTexts = []) => ({
  name,
  version: '1.0.0',
  license,
  repository: `https://example.test/${name}`,
  licenseTexts,
  noticeTexts: [],
});

test('findDisallowed lists only the offending packages', () => {
  const found = findDisallowed([entry('good', 'MIT'), entry('evil', 'SSPL-1.0')]);
  assert.deepEqual(
    found.map((f) => f.name),
    ['evil'],
  );
});

test('renderNotices prints a long shared text once and is deterministic', () => {
  const long = `Licence header\n${'x'.repeat(3500)}`;
  const entries = [entry('a', 'Apache-2.0', [long]), entry('b', 'Apache-2.0', [long])];
  const first = renderNotices({ entries });
  assert.equal(first.split(long).length - 1, 1);
  assert.match(first, /see \[shared text T1\]/);
  assert.equal(renderNotices({ entries }), first);
});
