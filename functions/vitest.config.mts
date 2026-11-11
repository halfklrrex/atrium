import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@atrium/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
      '@atrium/mcp-core': fileURLToPath(
        new URL('../packages/mcp-core/src/index.mjs', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
