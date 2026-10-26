import { defineConfig } from 'tsup';

// `@atrium/shared` is resolved through the tsconfig `paths` alias and inlined into lib/index.js, so the
// deployed package.json needs no `workspace:` dependency (architecture section 3). Real npm packages
// (firebase-admin, firebase-functions, zod) stay external and are installed by Cloud Build.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ['@atrium/shared'],
});
