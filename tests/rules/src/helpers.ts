import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIRESTORE_DATABASE_ID } from '../../../packages/shared/src/firebase-env';

const RULES_PATH = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));
const STORAGE_RULES_PATH = fileURLToPath(new URL('../../../storage.rules', import.meta.url));
const PROJECT_ID = 'demo-atrium-rules';

type MockToken = string | Record<string, unknown> | undefined;

/**
 * `@firebase/rules-unit-testing` builds its contexts on the compat SDK, which can only open the
 * project's default database. Atrium uses a named database, so this wraps every context so that
 * `firestore()` returns a modular-SDK handle on the named database (same emulator, same mock auth
 * token the library would have used). The rules file under test is the same for every database: the
 * emulator applies the project's rules to all of its databases.
 */
function namedDatabaseContext(
  ctx: RulesTestContext,
  host: string,
  port: number,
  token: MockToken,
  apps: Set<FirebaseApp>,
): RulesTestContext {
  let cached: ReturnType<RulesTestContext['firestore']> | undefined;
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'firestore') {
        return () => {
          if (!cached) {
            const app = initializeApp(
              { projectId: PROJECT_ID },
              `rules-named-db-${Date.now()}-${Math.random()}`,
            );
            apps.add(app);
            const db = getFirestore(app, FIRESTORE_DATABASE_ID);
            connectFirestoreEmulator(db, host, port, { mockUserToken: token as never });
            // Tests only pass this to modular functions (`doc`, `getDoc`, ...), never compat methods.
            cached = db as unknown as ReturnType<RulesTestContext['firestore']>;
          }
          return cached;
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function createTestEnv(): Promise<RulesTestEnvironment> {
  const hostPort = process.env.FIRESTORE_EMULATOR_HOST;
  if (!hostPort) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run these tests through `pnpm test:rules` from the repo root.',
    );
  }
  // emulators:exec sets this to "host:port" (shifted by ATRIUM_PORT_OFFSET); split on the last colon.
  const sep = hostPort.lastIndexOf(':');
  const host = hostPort.slice(0, sep).replace(/^\[|\]$/g, '');
  const port = Number(hostPort.slice(sep + 1));

  const storageHostPort = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  let storageConfig: { rules: string; host: string; port: number } | undefined;
  if (storageHostPort) {
    const sSep = storageHostPort.lastIndexOf(':');
    const sHost = storageHostPort.slice(0, sSep).replace(/^\[|\]$/g, '');
    const sPort = Number(storageHostPort.slice(sSep + 1));
    storageConfig = {
      rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
      host: sHost,
      port: sPort,
    };
  }

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES_PATH, 'utf8'), host, port },
    ...(storageConfig ? { storage: storageConfig } : {}),
  });

  const apps = new Set<FirebaseApp>();
  const wrap = (ctx: RulesTestContext, token: MockToken) =>
    namedDatabaseContext(ctx, host, port, token, apps);

  // Only the members the suites use are replaced; everything else falls through to the library.
  const overrides: Partial<RulesTestEnvironment> = {
    authenticatedContext: (uid, tokenOptions) =>
      wrap(env.authenticatedContext(uid, tokenOptions), {
        ...tokenOptions,
        sub: uid,
        user_id: uid,
      }),
    unauthenticatedContext: () => wrap(env.unauthenticatedContext(), undefined),
    // The "owner" token makes the emulator skip the rules, exactly like the library's own.
    withSecurityRulesDisabled: (callback) =>
      env.withSecurityRulesDisabled((ctx) => callback(wrap(ctx, 'owner'))),
    clearFirestore: async () => {
      const origin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
      const response = await fetch(
        `${origin}/emulator/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error(await response.text());
    },
    cleanup: async () => {
      await env.cleanup();
      await Promise.all([...apps].map((app) => deleteApp(app)));
      apps.clear();
    },
  };
  return new Proxy(env, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop as keyof RulesTestEnvironment];
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Well-known users used across the suites. */
export const USERS = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
  viewer: 'viewer',
  outsider: 'outsider',
} as const;

export const WS = 'ws1';
export const MAIN_BOARD = 'boardMain';
export const PRIVATE_BOARD = 'boardPrivate';

const seedTs = Timestamp.fromMillis(1_700_000_000_000);

export function workspaceDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Team',
    description: '',
    icon: 'T',
    color: '#6161ff',
    ownerId: USERS.owner,
    memberIds: [USERS.owner, USERS.admin, USERS.member, USERS.viewer],
    roles: {
      [USERS.owner]: 'owner',
      [USERS.admin]: 'admin',
      [USERS.member]: 'member',
      [USERS.viewer]: 'viewer',
    },
    kind: 'open',
    createdAt: seedTs,
    createdBy: USERS.owner,
    updatedAt: seedTs,
    ...overrides,
  };
}

export function boardDoc(overrides: Record<string, unknown> = {}) {
  const access = (overrides.access as Record<string, string> | undefined) ?? {
    [USERS.owner]: 'owner',
  };
  return {
    workspaceId: WS,
    folderId: null,
    name: 'Board',
    description: '',
    kind: 'main',
    access,
    // Always the key set of `access` unless a test forges it explicitly.
    accessUids: Object.keys(access),
    position: 'a0',
    icon: null,
    columns: [],
    subitemColumns: [],
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    groups: [],
    itemTerminology: 'item',
    state: 'active',
    deletedAt: null,
    createdAt: seedTs,
    createdBy: USERS.owner,
    updatedAt: seedTs,
    ...overrides,
  };
}

export function itemDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Item',
    groupId: 'g1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: seedTs,
    createdBy: USERS.owner,
    updatedAt: seedTs,
    updatedBy: USERS.owner,
    ...overrides,
  };
}

export function updateDocData(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'i1',
    authorId: USERS.member,
    authorName: 'Member',
    authorPhotoUrl: null,
    content: 'First update',
    likes: [],
    repliesCount: 0,
    createdAt: seedTs,
    updatedAt: seedTs,
    ...overrides,
  };
}

export function replyDocData(overrides: Record<string, unknown> = {}) {
  return {
    updateId: 'u1',
    authorId: USERS.member,
    authorName: 'Member',
    authorPhotoUrl: null,
    content: 'First reply',
    likes: [],
    createdAt: seedTs,
    updatedAt: seedTs,
    ...overrides,
  };
}

/** Fresh-create payload for a workspace, as a client would send it. */
export function newWorkspacePayload(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Mine',
    description: '',
    icon: 'M',
    color: '#00c875',
    ownerId: uid,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    kind: 'open',
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Seeds the shared fixture: one workspace, a main board, a private board and an item on each. */
export async function seedFixture(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS), workspaceDoc());
    await setDoc(doc(db, 'workspaces', WS, 'folders', 'f1'), {
      name: 'Folder',
      parentFolderId: null,
      color: '#ffcb00',
      position: 'a0',
      createdAt: seedTs,
      createdBy: USERS.owner,
      updatedAt: seedTs,
    });
    await setDoc(doc(db, 'boards', MAIN_BOARD), boardDoc());
    await setDoc(
      doc(db, 'boards', PRIVATE_BOARD),
      boardDoc({
        kind: 'private',
        name: 'Secret',
        access: { [USERS.owner]: 'owner', [USERS.member]: 'viewer' },
      }),
    );
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'i1'), itemDoc());
    await setDoc(doc(db, 'boards', PRIVATE_BOARD, 'items', 'i1'), itemDoc());
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1'), updateDocData());
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1', 'replies', 'r1'),
      replyDocData(),
    );
    await setDoc(doc(db, 'users', USERS.member), {
      displayName: 'Member',
      email: 'member@example.com',
      photoURL: null,
      timezone: 'UTC',
      locale: 'en',
      lastWorkspaceId: WS,
      theme: 'system',
      createdAt: seedTs,
    });
  });
}
