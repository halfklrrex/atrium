// One-off, idempotent migration (SUBITEMS-as-items, docs/specs/SUBITEMS-as-items.md): subitems stop
// having their own columns and share the board's. For every board with `subitemColumns`, each legacy
// subitem column is
//   merged  into a board column with the same type and title (labels matched by text),
//   moved   into `board.columns` (id, title, settings, width kept) when any subitem has a value, or
//   dropped  when nobody filled it in.
//
//   Dry run (default, writes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-11-merge-subitem-columns.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-11-merge-subitem-columns.mjs --project atrium-board
//   One board:     add --board <boardId>
//   Apply:         add --apply (to either). Only a human runs production with --apply, after the
//                  owner approved the dry-run list.
//
// Authenticates like scripts/showcase: the emulator's bypass token, or `gcloud auth print-access-token`
// for production. Run it through tsx (it imports the TypeScript in @atrium/shared).
//
// What --apply writes, per board, in this order (so a failure part-way is safe to rerun: the board
// still lists `subitemColumns` until step 3, and steps 1 and 2 are repeatable):
//   1. board `columns` (merge-target labels added, moved columns appended), `subitemColumns` untouched;
//   2. copies: field-path writes `values.<boardColumn>` on subitems (never the whole `values` map);
//   3. board `subitemColumns: []`, `columnLocks`, `updatedAt`, `updatedBy` (a board owner);
//   4. removals: field-path deletes of `values.<legacyColumn>` on subitems (merged and dropped columns).
// Item writes never touch `updatedAt` / `updatedBy`, so they leave no activity entries and notify
// nobody. Subitems are read in every state (active, archived, deleted). A value that cannot move
// cleanly is kept on the item and listed as a conflict. Boards with a type change running are skipped.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID, planSubitemColumnMerge } from '@atrium/shared';
import { SeedError, createClient } from '../showcase/seed-showcase.mjs';

export const CHUNK_SIZE = 400; // Firestore allows 500 writes per commit.
const BOARD_FIELDS = ['columns', 'subitemColumns', 'columnLocks', 'access', 'workspaceId'];
const ITEM_FIELDS = ['parentItemId', 'values', 'state'];

const HELP = `Merge subitem columns into the board's columns (SUBITEMS-as-items). Dry run unless --apply is given.

Targets:
  (no flag)                Firestore emulator: FIRESTORE_EMULATOR_HOST, else this copy's port
  --project <id>           Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: Atrium's named database, see
                           FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Options:
  --board <id>             Only this board
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
      board: { type: 'string' },
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
  if (values.board !== undefined && !/^[A-Za-z0-9]{1,64}$/.test(values.board)) {
    throw new SeedError(`"${values.board}" is not a valid board id.`);
  }
  const production = Boolean(values.project);
  return {
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    board: values.board,
    apply: values.apply,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  };
}

/** The uid of the board's first owner (so the board write has an author), or `null`. */
export function boardOwnerUid(access) {
  for (const [uid, role] of Object.entries(access ?? {})) if (role === 'owner') return uid;
  return null;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Pure: the plan for one board, or `null` when it has nothing to migrate.
 * @param {{ id: string, data: object }} board
 * @param {{ id: string, data: object }[]} items  every item of the board, any state
 */
export function planBoard(board, items) {
  const subitemColumns = Array.isArray(board.data.subitemColumns) ? board.data.subitemColumns : [];
  if (subitemColumns.length === 0) return null;
  const columns = Array.isArray(board.data.columns) ? board.data.columns : [];
  const subitems = items
    .filter((i) => i.data.parentItemId !== null && i.data.parentItemId !== undefined)
    .map((i) => ({ id: i.id, values: i.data.values ?? {} }));
  const plan = planSubitemColumnMerge(
    columns,
    subitemColumns,
    subitems,
    board.data.columnLocks ?? [],
  );
  const owner = boardOwnerUid(board.data.access);
  if (!owner) plan.problems.push('the board has no owner to attribute the write to');
  return {
    boardId: board.id,
    owner,
    subitemCount: subitems.length,
    columnsChanged: !sameJson(plan.columns, columns),
    original: { columns, subitemColumns },
    ...plan,
  };
}

function describeDecision(d) {
  const base = `    ${d.action.padEnd(5)} "${d.title}" (${d.type}, ${d.columnId}): ${d.filledCount} subitem value(s)`;
  if (d.action === 'merge') {
    const labels = d.addedLabels.length > 0 ? `, adds labels ${JSON.stringify(d.addedLabels)}` : '';
    return `${base} -> board column "${d.targetTitle}" (${d.targetId})${labels}`;
  }
  if (d.action === 'move') {
    return `${base} -> new board column "${d.movedTitle}"${d.note ? ` (${d.note})` : ''}`;
  }
  return `${base}${d.note ? ` (${d.note})` : ''}`;
}

function logPlan(plan, log) {
  log(`  boards/${plan.boardId}: ${plan.subitemCount} subitem(s) in all states`);
  for (const d of plan.decisions) log(describeDecision(d));
  log(
    `    writes: ${plan.copies.length} item(s) copied, ${plan.removals.length} item(s) cleaned` +
      `, board columns ${plan.columnsChanged ? 'changed' : 'unchanged'}, subitemColumns -> []`,
  );
  for (const c of plan.conflicts) log(`    conflict: ${c}`);
  for (const p of plan.problems) log(`    SKIPPED: ${p}`);
}

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );

/** Writes one planned board. Throws when the board changed under the migration. */
export async function applyBoard(client, plan, board) {
  const path = `boards/${plan.boardId}`;
  // 1. Board columns first, so every copied label exists before a value points at it.
  if (plan.columnsChanged) {
    await client.commit([
      {
        op: 'update',
        path,
        set: { columns: plan.columns, updatedBy: plan.owner },
        serverTimestamp: ['updatedAt'],
        precondition: { updateTime: board.updateTime },
      },
    ]);
  }
  // 2. Copies into merge targets (field paths only).
  for (const batch of chunks(plan.copies, CHUNK_SIZE)) {
    await client.commit(
      batch.map((w) => ({
        op: 'update',
        path: `boards/${plan.boardId}/items/${w.itemId}`,
        set: Object.fromEntries(Object.entries(w.set).map(([id, v]) => [`values.${id}`, v])),
      })),
    );
  }
  // 3. The board stops carrying subitem columns. Re-read it first: refuse if it moved on.
  const fresh = await client.getDoc(path);
  const expectedColumns = plan.columnsChanged ? plan.columns : plan.original.columns;
  if (
    !fresh ||
    !sameJson(fresh.subitemColumns ?? [], plan.original.subitemColumns) ||
    !sameJson(fresh.columns ?? [], expectedColumns)
  ) {
    throw new Error(
      `boards/${plan.boardId} changed while it was migrated; nothing more was written. Rerun later.`,
    );
  }
  await client.commit([
    {
      op: 'update',
      path,
      set: { subitemColumns: [], columnLocks: plan.columnLocks, updatedBy: plan.owner },
      serverTimestamp: ['updatedAt'],
    },
  ]);
  // 4. Remove the legacy values of merged and dropped columns (field paths only).
  for (const batch of chunks(plan.removals, CHUNK_SIZE)) {
    await client.commit(
      batch.map((w) => ({
        op: 'update',
        path: `boards/${plan.boardId}/items/${w.itemId}`,
        remove: w.remove.map((id) => `values.${id}`),
      })),
    );
  }
}

/** Scan the boards and (with `apply`) migrate each one. Returns the plans. */
export async function runMigration({ client, apply = false, boardId, log = console.log }) {
  const all = await client.listAllDocs('boards', { fields: BOARD_FIELDS });
  const boards = all.filter((b) => !boardId || b.id === boardId);
  log(`${apply ? '' : 'Dry run: '}merge subitem columns -> ${client.describe}`);
  log(`  boards     ${boards.length} scanned`);

  const plans = [];
  const results = [];
  for (const board of boards) {
    if (!Array.isArray(board.data.subitemColumns) || board.data.subitemColumns.length === 0) {
      continue; // nothing to do: a rerun is a no-op
    }
    const items = await client.listAllDocs(`boards/${board.id}/items`, { fields: ITEM_FIELDS });
    const plan = planBoard(board, items);
    if (!plan) continue;
    plans.push(plan);
    logPlan(plan, log);
    if (plan.problems.length > 0) {
      results.push({ boardId: board.id, status: 'skipped' });
      continue;
    }
    if (!apply) {
      results.push({ boardId: board.id, status: 'planned' });
      continue;
    }
    try {
      await applyBoard(client, plan, board);
      results.push({ boardId: board.id, status: 'migrated' });
      log(`  boards/${board.id}: done`);
    } catch (error) {
      results.push({ boardId: board.id, status: 'failed', error: String(error?.message ?? error) });
      log(`  boards/${board.id}: FAILED: ${error?.message ?? error}`);
    }
  }

  log(`  to migrate ${plans.length} board(s)`);
  if (!apply && plans.length > 0) {
    log('Nothing was written. Run again with --apply to write these changes.');
  } else if (plans.length === 0) {
    log('Nothing to do.');
  }
  return { plans, results, applied: apply };
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  const { results } = await runMigration({
    client: createClient(options),
    apply: options.apply,
    boardId: options.board,
  });
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof SeedError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
