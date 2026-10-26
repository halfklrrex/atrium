import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Git short SHA of the commit being built (AGPL section 13: tells users which source they run). */
function atriumVersion(): string {
  try {
    const sha = execSync('git rev-parse --short=10 HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) return sha;
  } catch {
    // No git (or an untrusted checkout directory): fall back to the CI-provided commit.
  }
  return process.env.GITHUB_SHA?.slice(0, 10) || 'dev';
}

export default defineConfig({
  plugins: [react()],
  define: { __ATRIUM_VERSION__: JSON.stringify(atriumVersion()) },
  server: { port: 5173, strictPort: false },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
