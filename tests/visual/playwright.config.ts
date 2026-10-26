import { defineConfig } from '@playwright/test';
import { CONTEXT_OPTIONS } from './src/determinism';
import { HUB_URL, PORT_OFFSET, REPO_ROOT, STORAGE_STATE, WEB_URL } from './src/env';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  globalSetup: './src/global-setup.ts',

  // One worker on purpose: all tests share one emulator and one signed-in user, and a screenshot
  // suite is only as trustworthy as it is repeatable. No retries either: a flake must show up.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  timeout: 45_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',

  // `{platform}` keeps Linux (committed, made in CI) apart from win32/darwin (local, gitignored).
  snapshotPathTemplate: '{testDir}/../__screenshots__/{arg}-{platform}{ext}',

  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      stylePath: './src/screenshot.css',
    },
  },

  use: {
    ...CONTEXT_OPTIONS,
    baseURL: WEB_URL,
    storageState: STORAGE_STATE,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

  // Fresh, empty emulators (so the seed is the only data) plus the Vite dev server, through the same
  // scripts `pnpm dev` uses, so ATRIUM_PORT_OFFSET applies. Readiness is polled, never slept on.
  webServer: [
    {
      command:
        'pnpm --filter @atrium/functions build && node scripts/emulators.mjs --only auth,firestore,functions',
      cwd: REPO_ROOT,
      env: { ATRIUM_EPHEMERAL_EMULATORS: '1' },
      url: HUB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      stdout: 'pipe',
      stderr: 'pipe',
      name: `emulators (offset ${PORT_OFFSET})`,
    },
    {
      command: 'node scripts/web-dev.mjs',
      cwd: REPO_ROOT,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'pipe',
      name: 'web',
    },
  ],
});
