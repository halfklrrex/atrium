/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `'true'` connects Firebase Auth/Firestore/Functions/Storage to the local emulators. */
  readonly VITE_USE_EMULATORS?: string;
  /** Emulator ports set by `pnpm dev` (base port + ATRIUM_PORT_OFFSET); base ports when unset. */
  readonly VITE_EMULATOR_AUTH_PORT?: string;
  readonly VITE_EMULATOR_FIRESTORE_PORT?: string;
  readonly VITE_EMULATOR_FUNCTIONS_PORT?: string;
  readonly VITE_EMULATOR_STORAGE_PORT?: string;
}

/** Git short SHA of the build (`dev` without git), injected by `vite.config.ts` through `define`. */
declare const __ATRIUM_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
