// Shared env + port helper for the local scripts (emulators, rules tests, dev server).
//
// ATRIUM_PORT_OFFSET is an integer (default 0) read from the process environment or from a
// gitignored repo-root `.env.local` (`ATRIUM_PORT_OFFSET=100`). The environment wins over the file.
// Each working copy picks its own offset so several copies can run emulators side by side:
// home copy 0, Claude worktrees 10, 20, ..., Antigravity 100.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Base ports (offset 0). Every one of them is shifted by ATRIUM_PORT_OFFSET.
 *
 * Two copies collide when a port of one equals a different service's port in the other, i.e. when
 * two bases differ by exactly the gap between their offsets. The Firebase defaults auth 9099,
 * storage 9199, eventarc 9299 and hub 4400, logging 4500 are all 100 apart, so offsets 0 and 100
 * (home copy and Antigravity) would collide. Storage, logging and eventarc therefore sit at
 * 9198, 4505 and 9297 instead. scripts/env.test.mjs checks that offsets 0, 10, ..., 200 never
 * collide. Keep apps/web/src/lib/firebase.ts and firebase.json in step with these numbers.
 */
export const BASE_PORTS = {
  auth: 9099,
  firestore: 8080,
  firestoreWebsocket: 9150,
  functions: 5001,
  storage: 9198,
  hosting: 5000,
  ui: 4000,
  hub: 4400,
  logging: 4505,
  eventarc: 9297,
  vite: 5173,
};

/** Reads `KEY=value` lines from a dotenv-style file; returns {} when it does not exist. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

/** Looks a variable up in the process env first, then in the repo-root `.env.local`. */
export function readEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  return readEnvFile(resolve(repoRoot, '.env.local'))[name];
}

/** The port offset for this working copy (integer, default 0). */
export function portOffset() {
  const raw = readEnv('ATRIUM_PORT_OFFSET');
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 20000) {
    throw new Error(`ATRIUM_PORT_OFFSET must be an integer from 0 to 20000, got "${raw}".`);
  }
  return value;
}

/** All service ports for this working copy: base port + offset. */
export function ports(offset = portOffset()) {
  return Object.fromEntries(
    Object.entries(BASE_PORTS).map(([name, base]) => [name, base + offset]),
  );
}
