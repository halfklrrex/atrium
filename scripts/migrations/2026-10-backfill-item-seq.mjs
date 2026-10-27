// One-off, idempotent migration (P2 numeric item IDs): gives every existing item its `seq`
// (account-wide number) and `boardSeq` (per-board creation number, separate sequence for subitems).
//
// New items get both from the `onItemCreated` Cloud Function; this only numbers the ones created
// before it was deployed. Run it right after the function is deployed. Items created while it runs
// are numbered by the function, which uses the same counters, so the two never hand out the same
// number: every commit here carries preconditions on the counter documents and on each item's
// `updateTime`, so if the function got in first the commit is refused, and the chunk is re-read and
// planned again (items that already have numbers are skipped).
//
//   Dry run (default, writes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-10-backfill-item-seq.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-10-backfill-item-seq.mjs --project atrium-board
//   Apply:         add --apply (to either)
//
// Order: every item of every board (archived and deleted ones too) that lacks a number, sorted by
// `createdAt` and then by id; `seq` continues from `counters/items`, `boardSeq` from
// `boards/{id}/counters/items` (`nextItem` for items, `nextSubitem` for subitems). Re-running it
// assigns nothing new. It never touches `updatedAt` / `updatedBy`.
//
// It authenticates like scripts/showcase: the emulator's bypass token, or `gcloud auth print-access-token`
// for production. Run it through tsx (it imports the TypeScript in @atrium/shared).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { SeedError, createClient } from '../showcase/seed-showcase.mjs';

/** Items per commit: 3 writes at most per item plus counters, well under 500. */
const CHUNK_SIZE = 150;
const MAX_ATTEMPTS = 10;
const ITEM_FIELDS = ['parentItemId', 'createdAt', 'seq', 'boardSeq'];

const HELP = `Backfill items.seq and items.boardSeq (P2 numeric item IDs). Dry run unless --apply is given.

Targets:
  (no flag)                Firestore emulator: FIRESTORE_EMULATOR_HOST, else this copy's port
  --project <id>           Production Firestore, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: Atrium's named database, see
                           FIRESTORE_DATABASE_ID in packages/shared/src/firebase-env.ts)

Options:
  --apply                  Write the numbers and the counters (without it nothing is written)
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

const isNumber = (value) => typeof value === 'number' && Number.isInteger(value) && value > 0;
const counter = (value) => (isNumber(value) ? value : 0);
const millis = (value) => (value instanceof Date ? value.getTime() : 0);

/** Items that lack `seq` or `boardSeq`, oldest first (ties by board id, then item id). */
export function sortCandidates(items) {
  return items
    .filter((item) => !isNumber(item.seq) || !isNumber(item.boardSeq))
    .sort(
      (a, b) =>
        millis(a.createdAt) - millis(b.createdAt) ||
        (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * Pure: assign the missing numbers of `chunk` (already in order) from the given counters.
 * @param {{ boardId: string, id: string, isSubitem: boolean, seq?: number, boardSeq?: number }[]} chunk
 * @param {number} global  last global number handed out
 * @param {Map<string, { nextItem: number, nextSubitem: number }>} boards  counters of the touched boards
 * @returns {{ assignments: { boardId: string, id: string, seq?: number, boardSeq?: number }[], global: number, boards: Map<string, { nextItem: number, nextSubitem: number }> }}
 */
export function assignNumbers(chunk, global, boards) {
  const next = new Map([...boards].map(([id, c]) => [id, { ...c }]));
  const assignments = [];
  let last = global;
  for (const item of chunk) {
    const numbers = {};
    if (!isNumber(item.seq)) {
      last += 1;
      numbers.seq = last;
    }
    if (!isNumber(item.boardSeq)) {
      const counters = next.get(item.boardId) ?? { nextItem: 0, nextSubitem: 0 };
      const key = item.isSubitem ? 'nextSubitem' : 'nextItem';
      counters[key] += 1;
      numbers.boardSeq = counters[key];
      next.set(item.boardId, counters);
    }
    assignments.push({ boardId: item.boardId, id: item.id, ...numbers });
  }
  return { assignments, global: last, boards: next };
}

const isConflict = (error) => error?.status === 409 || error?.status === 400;

/** Counter document + the precondition that it has not moved since it was read. */
async function readCounters(client, boardIds) {
  const globalDoc = await client.getDocMeta('counters/items');
  const boards = new Map();
  const preconditions = {
    global: globalDoc ? { updateTime: globalDoc.updateTime } : { exists: false },
    boards: new Map(),
  };
  for (const id of boardIds) {
    const doc = await client.getDocMeta(`boards/${id}/counters/items`);
    boards.set(id, {
      nextItem: counter(doc?.data.nextItem),
      nextSubitem: counter(doc?.data.nextSubitem),
    });
    preconditions.boards.set(id, doc ? { updateTime: doc.updateTime } : { exists: false });
  }
  return { global: counter(globalDoc?.data.next), boards, preconditions };
}

/** Scan every board and number the items that lack it. Returns what was (or would be) done. */
export async function runBackfill({ client, apply = false, log = console.log }) {
  const boardDocs = await client.listAllDocs('boards', { fields: ['name'] });
  const all = [];
  for (const board of boardDocs) {
    const items = await client.listAllDocs(`boards/${board.id}/items`, { fields: ITEM_FIELDS });
    for (const item of items) {
      all.push({
        boardId: board.id,
        id: item.id,
        isSubitem: item.data.parentItemId != null,
        createdAt: item.data.createdAt,
        seq: item.data.seq,
        boardSeq: item.data.boardSeq,
        updateTime: item.updateTime,
      });
    }
  }
  const candidates = sortCandidates(all);

  log(`${apply ? '' : 'Dry run: '}item seq / boardSeq backfill -> ${client.describe}`);
  log(`  boards     ${boardDocs.length} scanned`);
  log(`  items      ${all.length} scanned, ${candidates.length} to number`);

  let numbered = 0;
  let lastGlobal = null;
  if (!apply) {
    // Plan in memory from the current counters; nothing is written.
    const state = await readCounters(client, [...new Set(candidates.map((c) => c.boardId))]);
    const plan = assignNumbers(candidates, state.global, state.boards);
    numbered = plan.assignments.length;
    lastGlobal = plan.global;
    if (numbered > 0) {
      log(`  seq        ${state.global + 1} .. ${plan.global}`);
      log('Nothing was written. Run again with --apply to write these numbers.');
    }
    return { scanned: all.length, candidates: numbered, applied: false, lastGlobal };
  }

  for (let start = 0; start < candidates.length; start += CHUNK_SIZE) {
    let chunk = candidates.slice(start, start + CHUNK_SIZE);
    for (let attempt = 1; ; attempt += 1) {
      if (chunk.length === 0) break;
      const state = await readCounters(client, [...new Set(chunk.map((c) => c.boardId))]);
      const plan = assignNumbers(chunk, state.global, state.boards);
      const byId = new Map(chunk.map((c) => [`${c.boardId}/${c.id}`, c]));
      const writes = plan.assignments.map(({ boardId, id, ...numbers }) => ({
        op: 'patch',
        path: `boards/${boardId}/items/${id}`,
        data: numbers,
        precondition: { updateTime: byId.get(`${boardId}/${id}`).updateTime },
      }));
      if (plan.global !== state.global) {
        writes.push({
          op: 'set',
          path: 'counters/items',
          data: { next: plan.global },
          precondition: state.preconditions.global,
        });
      }
      for (const [boardId, counters] of plan.boards) {
        writes.push({
          op: 'set',
          path: `boards/${boardId}/counters/items`,
          data: counters,
          precondition: state.preconditions.boards.get(boardId),
        });
      }
      try {
        await client.commit(writes);
        numbered += plan.assignments.length;
        lastGlobal = plan.global;
        break;
      } catch (error) {
        if (!isConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
        // The Cloud Function (or another run) got there first: re-read what is left of the chunk.
        const fresh = [];
        for (const item of chunk) {
          const doc = await client.getDocMeta(`boards/${item.boardId}/items/${item.id}`);
          if (!doc) continue;
          const current = {
            ...item,
            seq: doc.data.seq,
            boardSeq: doc.data.boardSeq,
            updateTime: doc.updateTime,
          };
          if (!isNumber(current.seq) || !isNumber(current.boardSeq)) fresh.push(current);
        }
        chunk = fresh;
      }
    }
  }
  log(numbered === 0 ? 'Nothing to do.' : `Done: numbered ${numbered} items.`);
  return {
    scanned: all.length,
    candidates: candidates.length,
    numbered,
    applied: true,
    lastGlobal,
  };
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
