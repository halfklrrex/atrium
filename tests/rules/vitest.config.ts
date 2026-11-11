import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The e2e suites import the Functions sources, which use the same alias (functions/tsconfig.json).
      '@atrium/mcp-core': fileURLToPath(
        new URL('../../packages/mcp-core/src/index.mjs', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // All suites share one Firestore emulator and clear it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
