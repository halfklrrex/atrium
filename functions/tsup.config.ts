import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// `@atrium/shared` and `@atrium/mcp-core` are resolved through the tsconfig `paths` aliases and inlined
// into lib/index.js, so the deployed package.json needs no `workspace:` dependency (architecture
// section 3). Real npm packages (firebase-admin, firebase-functions, zod) stay external and are
// installed by Cloud Build.
//
// `@atrium/mcp-core` is plain ESM (`index.mjs`) with hand-written types (`index.d.mts`). tsconfig lists
// the types first so `tsc` sees them; esbuild would pick that same `.d.mts`, so the bundle gets an
// explicit alias to the implementation.
const MCP_CORE = fileURLToPath(new URL('../packages/mcp-core/src/index.mjs', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ['@atrium/shared', '@atrium/mcp-core'],
  esbuildOptions(options) {
    options.alias = { ...options.alias, '@atrium/mcp-core': MCP_CORE };
  },
});
