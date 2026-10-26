// Guards the visual-test CI wiring: the Docker image must match the installed Playwright exactly
// (a different browser build renders pixels differently), and the baseline workflow must refuse main.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const read = (file) => readFileSync(resolve(repoRoot, file), 'utf8');
const playwrightVersion = JSON.parse(read('tests/visual/package.json')).devDependencies[
  '@playwright/test'
];

test('@playwright/test is pinned to an exact version', () => {
  assert.match(playwrightVersion, /^\d+\.\d+\.\d+$/, `got "${playwrightVersion}"`);
});

for (const file of ['.github/workflows/ci.yml', '.github/workflows/update-visual-baselines.yml']) {
  test(`${file} runs in the Playwright image of the installed version`, () => {
    const images = [...read(file).matchAll(/image:\s*(mcr\.microsoft\.com\/playwright:\S+)/g)];
    assert.ok(images.length > 0, 'no Playwright container image found');
    for (const [, image] of images) {
      assert.equal(image, `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`);
    }
  });
}

test('the baseline workflow refuses to run on main', () => {
  const workflow = read('.github/workflows/update-visual-baselines.yml');
  assert.match(workflow, /main \| master/);
  assert.match(workflow, /exit 1/);
});
