import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

/**
 * Public web config - safe to commit; security comes from Firestore/Storage rules.
 * Google Analytics is enabled on the project but deliberately NOT initialised here.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyALTdxTTalvo5jWOyy6bIfrW2w6R5HVDPU',
  authDomain: 'atrium-workboards.web.app',
  projectId: 'atrium-board',
  storageBucket: 'atrium-board.firebasestorage.app',
  messagingSenderId: '392437318549',
  appId: '1:392437318549:web:36142ee226dd93799eac9c',
  measurementId: 'G-GHLTPT6MWW',
} as const;

export const FUNCTIONS_REGION = 'europe-west1';
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
function initFirestore() {
  const isDeterministic =
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __ATRIUM_DETERMINISTIC__?: boolean }).__ATRIUM_DETERMINISTIC__);

  if (!isDeterministic && typeof indexedDB !== 'undefined') {
    try {
      return initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        FIRESTORE_DATABASE_ID,
      );
    } catch (err) {
      console.warn(
        'Failed to initialize persistent Firestore cache, falling back to memory/default:',
        err,
      );
    }
  }
  try {
    return initializeFirestore(
      app,
      {
        localCache: memoryLocalCache(),
      },
      FIRESTORE_DATABASE_ID,
    );
  } catch {
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  }
}

/** Atrium's named Firestore database with persistent local cache across multiple tabs. */
export const db = initFirestore();
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);

/** Emulator port from the env (`pnpm dev` passes the per-copy shifted ports), else the base port. */
function emulatorPort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

// Guard against double-connecting on HMR re-evaluation.
const connectedKey = '__atriumEmulatorsConnected';
const globals = globalThis as unknown as Record<string, boolean | undefined>;
if (useEmulators && !globals[connectedKey]) {
  globals[connectedKey] = true;
  const env = import.meta.env;
  const authPort = emulatorPort(env.VITE_EMULATOR_AUTH_PORT, 9099);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', emulatorPort(env.VITE_EMULATOR_FIRESTORE_PORT, 8080));
  connectFunctionsEmulator(
    functions,
    '127.0.0.1',
    emulatorPort(env.VITE_EMULATOR_FUNCTIONS_PORT, 5001),
  );
  connectStorageEmulator(storage, '127.0.0.1', emulatorPort(env.VITE_EMULATOR_STORAGE_PORT, 9198));
}
