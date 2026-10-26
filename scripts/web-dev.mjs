// Starts the Vite dev server on this copy's shifted port and points the web app at this copy's
// shifted emulator ports (read in apps/web/src/lib/firebase.ts).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { portOffset, ports, repoRoot } from './env.mjs';

const webDir = resolve(repoRoot, 'apps/web');
const require = createRequire(resolve(webDir, 'package.json'));
const vitePkgPath = require.resolve('vite/package.json');
const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
const viteBin = resolve(
  dirname(vitePkgPath),
  typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin.vite,
);

const p = ports();
console.log(`[web] ATRIUM_PORT_OFFSET=${portOffset()}  vite:${p.vite}`);

const env = {
  ...process.env,
  VITE_EMULATOR_AUTH_PORT: String(p.auth),
  VITE_EMULATOR_FIRESTORE_PORT: String(p.firestore),
  VITE_EMULATOR_FUNCTIONS_PORT: String(p.functions),
  VITE_EMULATOR_STORAGE_PORT: String(p.storage),
};

// strictPort: fail loudly on a collision instead of silently moving to another port.
const args = [viteBin, '--port', String(p.vite), '--strictPort', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: webDir, env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
