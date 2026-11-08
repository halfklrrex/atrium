// Fails when the build output lacks the PWA files. The hosting SPA rewrite would serve index.html
// for a missing /sw.js or /manifest.webmanifest, hiding the problem. Run by `apps/web` build and by
// scripts/pwa.test.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './env.mjs';

export const DIST_FILES = ['sw.js', 'manifest.webmanifest'];

/** Returns a list of problems (empty when the dist folder is fine). */
export function checkPwaDist(distDir = resolve(repoRoot, 'apps/web/dist')) {
  const problems = [];
  for (const file of DIST_FILES) {
    const path = resolve(distDir, file);
    if (!existsSync(path)) problems.push(`${file} is missing from ${distDir}`);
    else if (readFileSync(path, 'utf8').trimStart().startsWith('<'))
      problems.push(`${file} looks like HTML`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkPwaDist();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}
