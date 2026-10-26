// One-off, idempotent migration (FW1, extended by FW2): sets `derivedColumnIds` and
// `serverManagedColumnIds` on every existing board.
//
// New boards get both fields from the client, and the `onBoardColumnsWritten` Cloud Function keeps
// them in step from then on, so this only fills in boards created before the fields existed. FW2
// matters most here: boards that already hold `button` columns (and later files / time tracking)
// need `serverManagedColumnIds` before the rules protect those cells. The function would also
// backfill a board the next time it is written; this does it for all of them at once. Run it again
// whenever a column type becomes derived or server-managed (the function only reacts to board
// writes).
//
//   Dry run (default, writes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs --project atrium-board
//   Apply:         add --apply (to either)
//
// It authenticates like scripts/showcase: the emulator's bypass token, or `gcloud auth print-access-token`
// for production. It changes only those two fields, on boards where either is missing or wrong (both
// are written together, like the function does), and never creates a document. It uses the same computation as the Cloud Function, so the two always agree.
//
// Run it through tsx (it imports the TypeScript in @atrium/shared).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID, nextColumnIdLists } from '@atrium/shared';
import { SeedError, createClient } from '../showcase/seed-showcase.mjs';

const BATCH_SIZE = 400; // Firestore allows 500 writes per commit.
const FIELDS = ['columns', 'subitemColumns', 'derivedColumnIds', 'serverManagedColumnIds'];

const HELP = `Backfill boards.derivedColumnIds (FW1) and boards.serverManagedColumnIds (FW2). Dry run unless --apply is given.

Targets:
  (no flag)                Firestore emulator: FIRESTORE_EMULATOR_HOST, else this copy's port
  --project <id>           Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: Atrium's named database, see
                           FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Options:
  --apply                  Write the changes (without it nothing is written)
  --no-quota-project       Do not send x-goog-user-project (production only)
  --help
`;

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      database: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'no-quota-project': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return values;
}

export function resolveOptions(values) {
  if (values.project && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  if (values.database !== undefined && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(values.database)) {
    throw new SeedError(`"${values.database}" is not a valid Firestore database id.`);
  }
  const production = Boolean(values.project);
  return {
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    apply: values.apply,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  };
}

/**
 * Work out which boards need `derivedColumnIds` / `serverManagedColumnIds` set and to what.
 * @param {{ id: string, data: object }[]} boards
 * @returns {{ id: string, derivedColumnIds: string[], serverManagedColumnIds: string[], had: unknown, hadServerManaged: unknown }[]}
 */
export function planBackfill(boards) {
  const changes = [];
  for (const { id, data } of boards) {
    const next = nextColumnIdLists(data);
    if (next !== null) {
      changes.push({
        id,
        ...next,
        had: data.derivedColumnIds,
        hadServerManaged: data.serverManagedColumnIds,
      });
    }
  }
  return changes;
}

/** Scan every board and (with `apply`) patch the ones that need it. Returns the plan. */
export async function runBackfill({ client, apply = false, log = console.log }) {
  const boards = await client.listAllDocs('boards', { fields: FIELDS });
  const changes = planBackfill(boards);

  log(
    `${apply ? '' : 'Dry run: '}derivedColumnIds / serverManagedColumnIds backfill -> ${client.describe}`,
  );
  log(`  boards     ${boards.length} scanned, ${changes.length} to update`);
  for (const change of changes) {
    const show = (v) => (v === undefined ? 'missing' : JSON.stringify(v));
    log(
      `  boards/${change.id}  derived ${show(change.had)} -> ${JSON.stringify(change.derivedColumnIds)}` +
        `, serverManaged ${show(change.hadServerManaged)} -> ${JSON.stringify(change.serverManagedColumnIds)}`,
    );
  }

  if (apply) {
    for (let i = 0; i < changes.length; i += BATCH_SIZE) {
      await client.commit(
        changes.slice(i, i + BATCH_SIZE).map((c) => ({
          op: 'patch',
          path: `boards/${c.id}`,
          data: {
            derivedColumnIds: c.derivedColumnIds,
            serverManagedColumnIds: c.serverManagedColumnIds,
          },
        })),
      );
    }
    log(changes.length === 0 ? 'Nothing to do.' : 'Done.');
  } else if (changes.length > 0) {
    log('Nothing was written. Run again with --apply to write these changes.');
  }
  return { scanned: boards.length, changes, applied: apply };
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  await runBackfill({ client: createClient(options), apply: options.apply });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof SeedError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
