// Backfills `updatesCount` on items that already have updates (the row bubble reads it).
//
//   Emulator:    pnpm exec tsx scripts/backfill-updates-count.mjs [--board <id>]
//   Production:  pnpm exec tsx scripts/backfill-updates-count.mjs --project atrium-board [--board <id>] --yes
//                (without --yes it only prints a dry run; it authenticates with `gcloud`)
//
// For every item (all boards, or one with --board) it counts the documents of the item's `updates`
// sub-collection and sets `updatesCount` through a field mask, only where the stored value differs.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { createClient, emulatorHost, SeedError } from './showcase/seed-showcase.mjs';

const BATCH_SIZE = 400;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Item ids whose stored `updatesCount` (absent = 0) differs from the real number of updates. */
export function diffCounts(items, counts) {
  const changes = [];
  for (const { id, data } of items) {
    const actual = counts.get(id) ?? 0;
    const stored = Number.isInteger(data.updatesCount) ? data.updatesCount : 0;
    // An item without the field and without updates is already right: leave it alone.
    if (actual !== stored || (actual > 0 && data.updatesCount === undefined)) {
      changes.push({ id, from: data.updatesCount ?? null, to: actual });
    }
  }
  return changes;
}

export async function runBackfill({ client, boardId, dryRun = true, log = console.log }) {
  const boardIds = boardId ? [boardId] : await client.listDocIds('boards');
  const summary = { boards: 0, items: 0, changed: 0 };
  for (const id of boardIds) {
    const items = await client.listAllDocs(`boards/${id}/items`, { fields: ['updatesCount'] });
    const counts = new Map();
    for (const item of items) {
      counts.set(
        item.id,
        (await client.listDocIds(`boards/${id}/items/${item.id}/updates`)).length,
      );
    }
    const changes = diffCounts(items, counts);
    summary.boards += 1;
    summary.items += items.length;
    summary.changed += changes.length;
    for (const c of changes) log(`  boards/${id}/items/${c.id}: ${c.from ?? 'unset'} -> ${c.to}`);
    if (!dryRun) {
      const writes = changes.map((c) => ({
        op: 'patch',
        path: `boards/${id}/items/${c.id}`,
        data: { updatesCount: c.to },
      }));
      for (let i = 0; i < writes.length; i += BATCH_SIZE) {
        await client.commit(writes.slice(i, i + BATCH_SIZE));
      }
    }
  }
  log(
    `${dryRun ? 'Dry run: would update' : 'Updated'} ${summary.changed} of ${summary.items} items ` +
      `in ${summary.boards} boards -> ${client.describe}`,
  );
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      project: { type: 'string' },
      database: { type: 'string' },
      board: { type: 'string' },
      yes: { type: 'boolean', default: false },
      'no-quota-project': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (values.board !== undefined && !ID_PATTERN.test(values.board)) {
    throw new SeedError('--board must be a plain id.');
  }
  const production = Boolean(values.project);
  if (production && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  if (!production) emulatorHost(); // refuses a non-local emulator host
  const client = createClient({
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  });
  const dryRun = production && !values.yes;
  await runBackfill({ client, boardId: values.board, dryRun });
  if (dryRun) console.log('\nThis was a dry run. Add --yes to write to production.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof SeedError ? `Error: ${error.message}` : error);
    process.exit(1);
  });
}
