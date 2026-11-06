// One-off, idempotent migration (P5d time-based automations): gives every existing item its
// server-maintained `dateKeys` field ("<columnId>:<YYYY-MM-DD>" for each date column holding a date;
// a subitem uses the board's subitem columns), which the scheduler queries with `array-contains`.
//
// New and edited items get it from the item-index Cloud Function; this only fills the ones written
// before it was deployed. Run it right after the function is deployed. Every commit
// carries a precondition on each item's `updateTime`, so if the function (or a person) wrote the item
// meanwhile the commit is refused, and the chunk is re-read and planned again.
//
//   Dry run (default, writes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-11-backfill-item-date-keys.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-11-backfill-item-date-keys.mjs --project atrium-board
//   Apply:         add --apply (to either)
//
// It writes only the items whose stored field differs from the computed one (so a re-run writes
// nothing), only that field (field mask), never `updatedAt` / `updatedBy`, and skips deleted
// items (the function indexes them if they are restored). Batches of 400.
//
// It authenticates like scripts/showcase: the emulator's bypass token, or `gcloud auth print-access-token`
// for production. Run it through tsx (it imports the TypeScript in @atrium/shared).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID, dateKeysOf } from '@atrium/shared';
import { SeedError, createClient } from '../showcase/seed-showcase.mjs';

/** Items per commit; one write each, well under Firestore's 500. */
export const CHUNK_SIZE = 400;
const MAX_ATTEMPTS = 10;
const BOARD_FIELDS = ['columns', 'subitemColumns'];
const ITEM_FIELDS = ['name', 'values', 'parentItemId', 'state', 'dateKeys'];

const HELP = `Backfill items.dateKeys (P5d time-based automations). Dry run unless --apply is given.

Targets:
  (no flag)                Firestore emulator: FIRESTORE_EMULATOR_HOST, else this copy's port
  --project <id>           Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: Atrium's named database, see
                           FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Options:
  --apply                  Write the field (without it nothing is written)
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

const sameList = (a, b) =>
  Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Pure: the fields to write for one item, or `null` when it needs nothing (deleted, or already right).
 * @param {{ columns?: unknown[], subitemColumns?: unknown[] }} board
 * @param {Record<string, unknown>} item  decoded item fields
 */
export function planItem(board, item) {
  if (item.state === 'deleted') return null;
  const columns = (item.parentItemId != null ? board.subitemColumns : board.columns) ?? [];
  const dateKeys = dateKeysOf(item.values, columns);
  if (sameList(item.dateKeys, dateKeys)) return null;
  return { dateKeys };
}

const isConflict = (error) => error?.status === 409 || error?.status === 400;

/** Scan every board and index the items that lack (or have stale) dateKeys. */
export async function runBackfill({ client, apply = false, log = console.log }) {
  const boardDocs = await client.listAllDocs('boards', { fields: BOARD_FIELDS });
  log(`${apply ? '' : 'Dry run: '}item dateKeys backfill -> ${client.describe}`);

  let scanned = 0;
  let candidates = 0;
  let written = 0;
  for (const board of boardDocs) {
    const items = await client.listAllDocs(`boards/${board.id}/items`, { fields: ITEM_FIELDS });
    scanned += items.length;
    const todo = [];
    for (const item of items) {
      const fields = planItem(board.data, item.data);
      if (fields) todo.push({ id: item.id, fields, updateTime: item.updateTime });
    }
    candidates += todo.length;
    if (!apply) continue;

    for (let start = 0; start < todo.length; start += CHUNK_SIZE) {
      let chunk = todo.slice(start, start + CHUNK_SIZE);
      for (let attempt = 1; chunk.length > 0; attempt += 1) {
        const writes = chunk.map(({ id, fields, updateTime }) => ({
          op: 'patch',
          path: `boards/${board.id}/items/${id}`,
          data: { dateKeys: fields.dateKeys },
          precondition: { updateTime },
        }));
        try {
          await client.commit(writes);
          written += chunk.length;
          break;
        } catch (error) {
          if (!isConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
          // An item was written meanwhile (the function, or a person): re-read and plan again.
          const fresh = [];
          for (const { id } of chunk) {
            const doc = await client.getDocMeta(`boards/${board.id}/items/${id}`);
            if (!doc) continue;
            const fields = planItem(board.data, doc.data);
            if (fields) fresh.push({ id, fields, updateTime: doc.updateTime });
          }
          chunk = fresh;
        }
      }
    }
  }

  log(`  boards     ${boardDocs.length} scanned`);
  log(`  items      ${scanned} scanned, ${candidates} to index`);
  if (!apply) {
    if (candidates > 0) log('Nothing was written. Run again with --apply to write this field.');
    return { scanned, candidates, written: 0, applied: false };
  }
  log(written === 0 ? 'Nothing to do.' : `Done: indexed ${written} items.`);
  return { scanned, candidates, written, applied: true };
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
