// Runs the Firestore rules tests inside the emulator, on this copy's shifted ports.
// The tests read the emulator address from FIRESTORE_EMULATOR_HOST, which emulators:exec sets.
import { spawn } from 'node:child_process';
import { writeEmulatorConfig } from './emulator-config.mjs';
import { portOffset, ports, repoRoot } from './env.mjs';
import { firebaseCli } from './firebase-cli.mjs';

const p = ports();
const configFile = writeEmulatorConfig(p);
console.log(
  `[test:rules] ATRIUM_PORT_OFFSET=${portOffset()}  firestore:${p.firestore}  storage:${p.storage}`,
);

const args = [
  firebaseCli,
  'emulators:exec',
  '--config',
  configFile,
  '--only',
  'firestore,storage',
  '--project',
  'demo-atrium-rules',
  'pnpm --filter @atrium/rules-tests test:rules',
];

const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
