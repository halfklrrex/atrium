// Starts the Firebase Emulator Suite with data persisted in .emulator-data/ (gitignored).
// Ports come from ATRIUM_PORT_OFFSET (see scripts/env.mjs) via a generated .firebase.emulators.json.
// `--import` fails when the directory has no export yet, so it is only passed once one exists.
// The CLI is launched through Node directly (no shell), which keeps paths with spaces intact on Windows.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeEmulatorConfig } from './emulator-config.mjs';
import { portOffset, ports, repoRoot } from './env.mjs';
import { firebaseCli } from './firebase-cli.mjs';

const p = ports();
const configFile = writeEmulatorConfig(p);
console.log(
  `[emulators] ATRIUM_PORT_OFFSET=${portOffset()}  ui:${p.ui} auth:${p.auth} firestore:${p.firestore} ` +
    `functions:${p.functions} storage:${p.storage} hosting:${p.hosting}`,
);

// ATRIUM_EPHEMERAL_EMULATORS=1 (set by the visual tests) starts with empty data and does not export
// on exit, so a test run neither reads nor overwrites the data you built up in `pnpm dev`.
const ephemeral = process.env.ATRIUM_EPHEMERAL_EMULATORS === '1';
const dataDir = resolve(repoRoot, '.emulator-data');

const args = [firebaseCli, 'emulators:start', '--config', configFile];
if (!ephemeral) {
  mkdirSync(dataDir, { recursive: true });
  args.push(`--export-on-exit=${dataDir}`);
  if (existsSync(resolve(dataDir, 'firebase-export-metadata.json'))) {
    args.push(`--import=${dataDir}`);
  }
}
args.push(...process.argv.slice(2));

const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
