// Seeds the "🧪 Atrium Showcase" board: realistic fake data in a real workspace, so the owner can
// watch what each new feature looks like. Idempotent: running it again converges to the same state.
//
//   Emulator:    pnpm showcase                                   (finds the workspace itself)
//                pnpm showcase --workspace <id> --owner <uid> [--reset]
//   Production:  pnpm showcase --project atrium-board --workspace <id> --owner <uid> [--reset] --yes
//                (without --yes it only prints a dry-run; it authenticates with `gcloud`)
//
// Safety: the script only ever creates, updates or deletes the documents it owns (see
// `isOwnedPath` in data.mjs): the `showcase-*` boards with their items, updates, replies and views, and the
// owner's favourite/recent entries for them, plus the 3 fake members' `members` profile docs. It refuses to run when the workspace is missing or the
// owner is not a member, and aborts if a write would fall outside that allow-list.
//
// Run through tsx (it imports the TypeScript in @atrium/shared): see the `showcase` package script.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { portOffset, ports } from '../env.mjs';
import {
  buildShowcase,
  isOwnedPath,
  SHOWCASE_BOARD_IDS,
  SHOWCASE_MEMBER_UIDS,
  anchorOf,
} from './data.mjs';
import { createFirestoreRest } from './firestore-rest.mjs';

const PRODUCTION_ORIGIN = 'https://firestore.googleapis.com';
const BATCH_SIZE = 400; // Firestore allows 500 writes per commit.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** A named Firestore database id: 4-63 chars, lowercase letters, digits and hyphens. */
const DATABASE_PATTERN = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;

/** A problem the user can fix (bad arguments, missing workspace, ...). Printed without a stack. */
export class SeedError extends Error {}

const HELP = `Seed the "Atrium Showcase" board with realistic fake data.

Targets:
  --emulator                 Firestore emulator (the default): FIRESTORE_EMULATOR_HOST, else this
                             copy's port from ATRIUM_PORT_OFFSET
  --project <id>             Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>            Firestore database id (default: Atrium's named database, see
                             FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Required (optional with --emulator, which picks the first workspace it finds):
  --workspace <id>           Workspace the boards are created in (must exist)
  --owner <uid>              Workspace member who owns the boards and the favourite

Options:
  --reset                    Delete the showcase boards recursively first, then recreate them
  --yes                      Required to write to production; without it you get a dry-run
  --dry-run                  Print what would change and write nothing
  --now <YYYY-MM-DD>         Lay the dates out around this day (default: today, UTC)
  --no-quota-project         Do not send x-goog-user-project (production only)
  --help
`;

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      emulator: { type: 'boolean', default: false },
      project: { type: 'string' },
      database: { type: 'string' },
      workspace: { type: 'string' },
      owner: { type: 'string' },
      reset: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      now: { type: 'string' },
      'no-quota-project': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return values;
}

/** Validates the parsed arguments and returns the normalised options (throws a `SeedError`). */
export function resolveOptions(values) {
  if (values.emulator && values.project) {
    throw new SeedError('Pass one target: --emulator or --project <id>, not both.');
  }
  for (const [flag, value] of [
    ['--workspace', values.workspace],
    ['--owner', values.owner],
  ]) {
    if (value !== undefined && !ID_PATTERN.test(value)) {
      throw new SeedError(`${flag} must be a plain id (letters, digits, "-" or "_").`);
    }
  }
  if (values.project && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  if (values.database !== undefined && !DATABASE_PATTERN.test(values.database)) {
    throw new SeedError(`"${values.database}" is not a valid Firestore database id.`);
  }
  if (values.project && (!values.workspace || !values.owner)) {
    throw new SeedError('Production needs both --workspace <id> and --owner <uid>.');
  }
  let anchor = anchorOf();
  if (values.now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.now) || Number.isNaN(Date.parse(values.now))) {
      throw new SeedError('--now must be a YYYY-MM-DD date.');
    }
    anchor = anchorOf(new Date(`${values.now}T00:00:00Z`));
  }
  const production = Boolean(values.project);
  return {
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    workspaceId: values.workspace,
    ownerUid: values.owner,
    reset: values.reset,
    // Production only writes with an explicit --yes; everything else is a dry-run.
    dryRun: values['dry-run'] || (production && !values.yes),
    needsYes: production && !values.yes,
    anchor,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  };
}

/** The Firestore emulator's address; refuses anything that is not this machine. */
export function emulatorHost(env = process.env) {
  const host = env.FIRESTORE_EMULATOR_HOST || `127.0.0.1:${ports(portOffset()).firestore}`;
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new SeedError(
      `FIRESTORE_EMULATOR_HOST is "${host}", which is not a local address. Refusing to continue.`,
    );
  }
  return host;
}

function gcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      shell: process.platform === 'win32', // gcloud is a .cmd file on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new SeedError(
      `Could not get an access token from gcloud (${String(error.stderr || error.message).trim()}). ` +
        'Run `gcloud auth login` and try again.',
    );
  }
}

export function createClient(options) {
  if (options.target === 'emulator') {
    return createFirestoreRest({
      origin: `http://${emulatorHost()}`,
      project: options.project,
      database: options.database,
      getToken: () => 'owner', // the emulator's rules-bypassing token
    });
  }
  let token;
  return createFirestoreRest({
    origin: PRODUCTION_ORIGIN,
    project: options.project,
    database: options.database,
    quotaProject: options.quotaProject,
    getToken: () => (token ??= gcloudAccessToken()),
  });
}

/** Emulator convenience: pick the workspace (and owner) when they were not given. */
async function discoverWorkspace(client, { workspaceId, ownerUid }) {
  if (workspaceId && ownerUid) return { workspaceId, ownerUid };
  if (workspaceId) {
    const ws = await client.getDoc(`workspaces/${workspaceId}`);
    if (!ws) throw new SeedError(`Workspace "${workspaceId}" does not exist.`);
    return { workspaceId, ownerUid: ws.ownerId };
  }
  const all = await client.listDocs('workspaces');
  const candidates = all.filter((w) => !ownerUid || (w.data.memberIds ?? []).includes(ownerUid));
  if (candidates.length === 0) {
    throw new SeedError(
      'No workspace found in the emulator. Sign in to the app once (that creates your personal ' +
        'workspace), or pass --workspace and --owner.',
    );
  }
  const [chosen] = candidates;
  return {
    workspaceId: chosen.id,
    ownerUid: ownerUid ?? chosen.data.ownerId,
    chosenFrom: candidates.length,
  };
}

/** Every document path below `docPath`, at any depth (sub-collections are discovered, not assumed). */
async function collectTree(client, docPath) {
  const paths = [];
  for (const collection of await client.listCollectionIds(docPath)) {
    for (const id of await client.listDocIds(`${docPath}/${collection}`)) {
      const path = `${docPath}/${collection}/${id}`;
      paths.push(path, ...(await collectTree(client, path)));
    }
  }
  return paths;
}

/** The items, updates, replies and saved views of a board (the part of it this script keeps in sync). */
async function collectContent(client, boardId) {
  const paths = [];
  for (const viewId of await client.listDocIds(`boards/${boardId}/views`)) {
    paths.push(`boards/${boardId}/views/${viewId}`);
  }
  for (const itemId of await client.listDocIds(`boards/${boardId}/items`)) {
    const item = `boards/${boardId}/items/${itemId}`;
    paths.push(item);
    for (const updateId of await client.listDocIds(`${item}/updates`)) {
      const update = `${item}/updates/${updateId}`;
      paths.push(update);
      for (const replyId of await client.listDocIds(`${update}/replies`)) {
        paths.push(`${update}/replies/${replyId}`);
      }
    }
  }
  return paths;
}

const ITEM_PATH = /^boards\/[^/]+\/items\/[^/]+$/;

const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

/**
 * Check the target, work out what to write and delete, and (unless `dryRun`) apply it.
 * Returns the plan, so tests and callers can inspect it.
 */
export async function runSeed({
  client,
  workspaceId,
  ownerUid,
  reset = false,
  dryRun = false,
  anchor = anchorOf(),
  log = console.log,
}) {
  // ---- 1. Preflight: the workspace exists and the owner is a member ----
  const workspace = await client.getDoc(`workspaces/${workspaceId}`);
  if (!workspace)
    throw new SeedError(`Workspace "${workspaceId}" does not exist in ${client.describe}.`);
  const role = workspace.roles?.[ownerUid];
  if (!(workspace.memberIds ?? []).includes(ownerUid) || !role) {
    throw new SeedError(`User "${ownerUid}" is not a member of workspace "${workspaceId}".`);
  }
  if (role === 'viewer') {
    throw new SeedError(`User "${ownerUid}" is only a viewer of workspace "${workspaceId}".`);
  }

  // Never take over a board that lives somewhere else.
  for (const boardId of SHOWCASE_BOARD_IDS) {
    const existing = await client.getDoc(`boards/${boardId}`);
    if (existing && existing.workspaceId !== workspaceId) {
      throw new SeedError(
        `Board "${boardId}" already exists in another workspace ("${existing.workspaceId}"). Refusing to touch it.`,
      );
    }
  }

  // ---- 2. Build the documents (throws if anything is invalid) ----
  const profile = await client.getDoc(`users/${ownerUid}`);
  const { docs, summary } = buildShowcase({
    workspaceId,
    ownerUid,
    ownerName: profile?.displayName || undefined,
    ownerPhotoUrl: profile?.photoURL ?? null,
    anchor,
  });
  const desired = new Set(docs.map((d) => d.path));

  // Item numbers (`seq`, `boardSeq`) are assigned by the onItemCreated function and are never
  // seeded. An upsert replaces whole documents, so carry the numbers of items that already exist
  // over, or a re-run would wipe them (the function only numbers newly created items). After a
  // reset the items are created afresh and get new numbers.
  if (!reset) {
    for (const doc of docs) {
      if (!ITEM_PATH.test(doc.path)) continue;
      const existing = await client.getDoc(doc.path);
      for (const field of ['seq', 'boardSeq']) {
        if (Number.isInteger(existing?.[field])) doc.data[field] = existing[field];
      }
    }
  }

  // ---- 3. Plan the deletions ----
  const deletes = new Set();
  for (const boardId of SHOWCASE_BOARD_IDS) {
    if (reset) {
      const tree = await collectTree(client, `boards/${boardId}`);
      for (const path of tree) deletes.add(path);
      if (tree.length > 0 || (await client.getDoc(`boards/${boardId}`))) {
        deletes.add(`boards/${boardId}`);
      }
    } else {
      for (const path of await collectContent(client, boardId)) {
        if (!desired.has(path)) deletes.add(path);
      }
    }
  }
  // A reset also recreates the fake members' profile docs from scratch.
  if (reset) {
    for (const uid of SHOWCASE_MEMBER_UIDS) {
      const path = `workspaces/${workspaceId}/members/${uid}`;
      if (await client.getDoc(path)) deletes.add(path);
    }
  }
  const operations = [
    ...[...deletes].map((path) => ({ op: 'delete', path })),
    ...docs.map(({ path, data }) => ({ op: 'set', path, data })),
  ];
  const writeCount = docs.length;
  const deleteCount = operations.length - writeCount;

  // ---- 4. The allow-list: nothing outside the showcase may be touched ----
  for (const { path } of operations) {
    if (!isOwnedPath(path, ownerUid, workspaceId)) {
      throw new Error(
        `Safety check failed: "${path}" is not a showcase document. Nothing was written.`,
      );
    }
  }

  log(`${dryRun ? 'Dry run: ' : ''}Atrium Showcase -> ${client.describe}`);
  log(`  workspace  ${workspaceId} ("${workspace.name}")  owner ${ownerUid} (${role})`);
  log(
    `  mode       ${reset ? 'reset (delete showcase boards, then recreate)' : 'upsert (converge)'}`,
  );
  log(
    `  content    ${summary.items} active items (+${summary.subitems} subitems), ${summary.archived} archived, ${summary.trashed} trashed, ` +
      `${summary.updates} updates, ${summary.replies} replies, ${SHOWCASE_BOARD_IDS.length} boards, ` +
      `${summary.members} fake member profiles`,
  );
  log(`  documents  ${writeCount} to write, ${deleteCount} to delete`);
  for (const boardId of SHOWCASE_BOARD_IDS) log(`  board      boards/${boardId}`);

  // ---- 5. Apply ----
  if (!dryRun) {
    const deletions = operations.filter((o) => o.op === 'delete');
    for (const batch of chunk(deletions, BATCH_SIZE)) await client.commit(batch);
    for (const batch of chunk(
      operations.filter((o) => o.op === 'set'),
      BATCH_SIZE,
    )) {
      await client.commit(batch);
    }
    log('Done.');
  }
  return { operations, writeCount, deleteCount, summary, dryRun };
}

export async function main(argv = process.argv.slice(2)) {
  // `pnpm showcase -- --reset` forwards the literal `--`; parseArgs would treat the rest as positionals.
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  const client = createClient(options);

  let { workspaceId, ownerUid } = options;
  if (options.target === 'emulator') {
    const found = await discoverWorkspace(client, options);
    ({ workspaceId, ownerUid } = found);
    if (found.chosenFrom) {
      console.log(
        `Using workspace "${workspaceId}" (owner "${ownerUid}") from ${found.chosenFrom} found in the emulator. ` +
          'Pass --workspace and --owner to choose another.',
      );
    }
  }

  await runSeed({
    client,
    workspaceId,
    ownerUid,
    reset: options.reset,
    dryRun: options.dryRun,
    anchor: options.anchor,
  });
  if (options.needsYes) {
    console.log('\nThis was a dry run. Add --yes to write to production.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof SeedError ? `Error: ${error.message}` : error);
    process.exit(1);
  });
}
