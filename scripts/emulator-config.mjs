// Writes `.firebase.emulators.json` (gitignored): a copy of firebase.json whose emulator ports are
// shifted by ATRIUM_PORT_OFFSET. The emulator scripts pass it to the CLI with `--config`.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portOffset, ports, repoRoot } from './env.mjs';

export const emulatorConfigFile = resolve(repoRoot, '.firebase.emulators.json');

export function buildEmulatorConfig(p = ports()) {
  const base = JSON.parse(readFileSync(resolve(repoRoot, 'firebase.json'), 'utf8'));
  const config = { ...base };

  // Local runs only need the app site. Extra Hosting sites would each bind another port.
  if (Array.isArray(base.hosting)) {
    config.hosting = base.hosting.filter((site) => site.target === 'app');
  }

  config.emulators = {
    ...base.emulators,
    auth: { ...base.emulators?.auth, port: p.auth },
    functions: { ...base.emulators?.functions, port: p.functions },
    firestore: {
      ...base.emulators?.firestore,
      port: p.firestore,
      websocketPort: p.firestoreWebsocket,
    },
    hosting: { ...base.emulators?.hosting, port: p.hosting },
    storage: { ...base.emulators?.storage, port: p.storage },
    ui: { ...base.emulators?.ui, port: p.ui },
    hub: { port: p.hub },
    logging: { port: p.logging },
    eventarc: { port: p.eventarc },
  };
  return config;
}

/** Generates the file and returns its path. */
export function writeEmulatorConfig(p = ports()) {
  writeFileSync(emulatorConfigFile, `${JSON.stringify(buildEmulatorConfig(p), null, 2)}\n`);
  return emulatorConfigFile;
}

// `node scripts/emulator-config.mjs` just (re)generates the file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = writeEmulatorConfig();
  console.log(`Wrote ${file} (ATRIUM_PORT_OFFSET=${portOffset()})`);
}
