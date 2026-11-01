// Builds the Firestore REST client for a config: the emulator (tests) or production, authenticated
// with `gcloud auth print-access-token` like the showcase seeder (no key files, no ADC).
import { execFileSync } from 'node:child_process';
import { createFirestoreRest } from '../../showcase/firestore-rest.mjs';
import { McpUserError } from './errors.mjs';

const PRODUCTION_ORIGIN = 'https://firestore.googleapis.com';

function gcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      shell: process.platform === 'win32', // gcloud is a .cmd file on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new McpUserError(
      `Could not get an access token from gcloud (${String(error.stderr || error.message).trim()}). ` +
        'Run `gcloud auth login` and try again.',
    );
  }
}

export function createClient(config) {
  if (config.emulator) {
    return createFirestoreRest({
      origin: `http://${config.emulator}`,
      project: config.project,
      database: config.database,
      getToken: () => 'owner', // the emulator's rules-bypassing token
    });
  }
  // Access tokens last an hour; refresh a little before that.
  let token;
  let fetchedAt = 0;
  return createFirestoreRest({
    origin: PRODUCTION_ORIGIN,
    project: config.project,
    database: config.database,
    quotaProject: config.project,
    getToken: () => {
      if (!token || Date.now() - fetchedAt > 45 * 60 * 1000) {
        token = gcloudAccessToken();
        fetchedAt = Date.now();
      }
      return token;
    },
  });
}
