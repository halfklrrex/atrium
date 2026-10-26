import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portOffset, ports, repoRoot } from '../../../scripts/env.mjs';

/** Every address the suite talks to, shifted by this working copy's ATRIUM_PORT_OFFSET. */
const p = ports();

export const PORT_OFFSET: number = portOffset();
export const REPO_ROOT: string = repoRoot;

/** Same project id the web app is configured with, so seeded data is what the app reads. */
export const PROJECT_ID = 'atrium-board';
export const FUNCTIONS_REGION = 'europe-west1';

export const HUB_URL = `http://127.0.0.1:${p.hub}/`;
export const WEB_URL = `http://localhost:${p.vite}`;
export const AUTH_HOST = `127.0.0.1:${p.auth}`;
export const FIRESTORE_HOST = `127.0.0.1:${p.firestore}`;
export const FUNCTIONS_URL = `http://127.0.0.1:${p.functions}`;

export const STORAGE_STATE = join(
  fileURLToPath(new URL('..', import.meta.url)),
  '.auth',
  'avery.json',
);

/** The one instant every screenshot is taken at: 09:00 UTC, so the greeting is "Good morning". */
export const FROZEN_TIME = '2026-10-24T09:00:00Z';
export const LOCALE = 'en-GB';
export const TIMEZONE = 'UTC';

/** Point the Admin SDK at the emulators. Idempotent; call before using firebase-admin. */
export function useEmulatorEnv(): void {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
}
