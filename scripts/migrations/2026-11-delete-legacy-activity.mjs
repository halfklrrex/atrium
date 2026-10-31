// One-off, idempotent migration (P4 activity log): deletes the legacy `button_clicked` activity docs
// that the `clickButton` callable wrote before the log existed. They have the old shape (`userId`,
// `data.columnLabel`, no `actorId`, no `expiresAt`), nothing could read them (the rules denied every
// read) and they would never expire, because the 90-day TTL policy keys on `expiresAt`.
//
// Run it once, after the P4 functions and rules are deployed. A doc is deleted only when its `kind`
// is `button_clicked` AND it has no `expiresAt`, so every entry the new code wrote is left alone, and
// a re-run finds nothing.
//
//   Dry run (default, deletes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-11-delete-legacy-activity.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-11-delete-legacy-activity.mjs --project atrium-board
//   Delete:        add --apply (to either)
//
// It authenticates like scripts/showcase: the emulator bypass token, or `gcloud auth print-access-token`
// for production. Run it through tsx (it imports @atrium/shared).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { SeedError, createClient } from '../showcase/seed-showcase.mjs';

/** Deletes per commit; well under the Firestore limit of 500. */
export const CHUNK_SIZE = 400;
const ACTIVITY_FIELDS = ['kind', 'expiresAt'];

const HELP = `Delete the legacy button_clicked activity docs (P4 activity log). Dry run unless --apply is given.

Targets:
  (no flag)                Firestore emulator: FIRESTORE_EMULATOR_HOST, else this copy's port
  --project <id>           Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: the named database of this project, see
                           FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Options:
  --apply                  Delete the docs (without it nothing is deleted)
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

/** Pure: true for a pre-P4 button click (old kind, never had an expiry). */
export function isLegacyActivity(data) {
  return (
    data.kind === 'button_clicked' && (data.expiresAt === undefined || data.expiresAt === null)
  );
}

/** Scan every board's activity and delete the legacy docs. */
export async function runMigration({ client, apply = false, log = console.log }) {
  const boardIds = await client.listDocIds('boards');
  log(`${apply ? '' : 'Dry run: '}legacy activity cleanup -> ${client.describe}`);

  let scanned = 0;
  const legacy = [];
  for (const boardId of boardIds) {
    const docs = await client.listAllDocs(`boards/${boardId}/activity`, {
      fields: ACTIVITY_FIELDS,
    });
    scanned += docs.length;
    for (const doc of docs) {
      if (isLegacyActivity(doc.data)) legacy.push(`boards/${boardId}/activity/${doc.id}`);
    }
  }

  log(`  boards     ${boardIds.length} scanned`);
  log(`  activity   ${scanned} scanned, ${legacy.length} legacy to delete`);
  if (!apply) {
    if (legacy.length > 0) log('Nothing was deleted. Run again with --apply to delete these docs.');
    return { scanned, candidates: legacy.length, deleted: 0, applied: false };
  }

  let deleted = 0;
  for (let start = 0; start < legacy.length; start += CHUNK_SIZE) {
    const chunk = legacy.slice(start, start + CHUNK_SIZE);
    await client.commit(chunk.map((path) => ({ op: 'delete', path })));
    deleted += chunk.length;
  }
  log(deleted === 0 ? 'Nothing to do.' : `Done: deleted ${deleted} legacy activity docs.`);
  return { scanned, candidates: legacy.length, deleted, applied: true };
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  await runMigration({ client: createClient(options), apply: options.apply });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof SeedError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
