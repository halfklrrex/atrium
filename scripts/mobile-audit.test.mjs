// Guards the phone-audit wiring: the known-defects list only names real screens, sizes and checks, every
// entry has a description, the phone projects exist, and CI runs them in their own job.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const read = (file) => readFileSync(resolve(repoRoot, file), 'utf8');
const known = JSON.parse(read('tests/visual/src/mobile-known-defects.json'));
const screens = [
  ...read('tests/visual/src/mobile-screens.ts').matchAll(/^\s{4}name: '([\w-]+)',/gm),
].map((m) => m[1]);
const sizes = ['375x667', '390x844', '430x932', '360x800', '768x1024'];
const checks = [
  'overflow-x',
  'offscreen-x',
  'topbar-covered',
  'topbar-moved',
  'scroll-leak',
  'input-font-size',
];

test('the phone screens are found', () => {
  assert.ok(screens.length >= 20, `found ${screens.length}`);
});

for (const [key, description] of Object.entries(known)) {
  test(`known defect ${key} is well formed`, () => {
    const [screen, size, check] = key.split('|');
    assert.ok(screens.includes(screen), `unknown screen "${screen}"`);
    assert.ok(sizes.includes(size), `unknown size "${size}"`);
    assert.ok(checks.includes(check), `unknown check "${check}"`);
    assert.ok(typeof description === 'string' && description.trim().length > 0, 'no description');
  });
}

test('the phone projects exist and the desktop project ignores them', () => {
  const config = read('tests/visual/playwright.config.ts');
  assert.match(config, /name: 'mobile-webkit'/);
  assert.match(config, /name: 'mobile-audit'/);
  assert.match(config, /devices\['iPhone 15'\]/);
  assert.match(config, /testIgnore: '\*\*\/mobile-\*\.spec\.ts'/);
});

test('the visual scripts run the baseline projects and a separate audit script', () => {
  const scripts = JSON.parse(read('tests/visual/package.json')).scripts;
  assert.match(scripts['test:visual'], /--project=chromium --project=mobile-webkit/);
  assert.match(scripts['test:visual:update'], /--project=chromium --project=mobile-webkit/);
  assert.doesNotMatch(scripts['test:visual'], /mobile-audit/);
  assert.equal(scripts['test:visual:audit'], 'playwright test --project=mobile-audit');
});
