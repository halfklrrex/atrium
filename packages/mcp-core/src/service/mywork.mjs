// Service methods: My Work, search and notifications. Receives the shared helpers of `createService`
// (see ../service.mjs). Mirrors `apps/web/src/data/my-work.ts`, `apps/web/src/data/search.ts` and
// `apps/web/src/data/notifications.ts`, with the same queries and re-checks.
import {
  assigneeTeamIdsOf,
  assigneeUidsOf,
  boardRoleFromWorkspaceRole,
  columnsForItem,
  nameTokensOf,
  searchWordsOf,
} from '@atrium/shared';
import { McpUserError } from '../errors.mjs';
import { ts } from '../builders.mjs';
import { sortedByPosition } from '../refs.mjs';

/** My Work reads at most this many boards (most recently visited first, then name); the web's cap. */
export const MY_WORK_BOARD_CAP = 100;
/** `array-contains-any` takes at most 30 values (the web's `MY_WORK_TEAM_QUERY_CAP`). */
const TEAM_QUERY_CAP = 30;
/** Boards queried at once (the web's `SEARCH_CONCURRENCY`). */
const CONCURRENCY = 10;
/** Items one board answers with in a search (the web's `SEARCH_ITEMS_PER_BOARD`). */
const ITEMS_PER_BOARD = 10;
/** Docs whose text a search reads, and the snippet length. */
const DOC_TEXT_CAP = 100;
const SNIPPET_LENGTH = 160;
/** Notifications read when filtering (unread only) or marking all. */
const NOTIFICATION_SCAN = 300;
const MARK_ALL_CAP = 500;
const COMMIT_CHUNK = 400;
const MIN_ITEM_CHARS = 2;

/** Lowercase, accents removed: the same folding the item tokens use. */
const fold = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

const wordsIn = (text) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);

/** The web's `nameMatchesWords`: every typed word starts some word of the name. */
function nameMatchesWords(name, words) {
  if (words.length === 0) return false;
  const tokens = new Set(nameTokensOf(name));
  const nameWords = wordsIn(name);
  return words.every((word) =>
    [...word].length >= MIN_ITEM_CHARS
      ? tokens.has(word) || nameWords.some((w) => w.startsWith(word))
      : nameWords.some((w) => w.startsWith(word)),
  );
}

/** Runs `task` over `list`, `size` at a time, keeping the order of the results. */
async function inChunks(list, size, task) {
  const out = [];
  for (let at = 0; at < list.length; at += size) {
    out.push(...(await Promise.all(list.slice(at, at + size).map(task))));
  }
  return out;
}

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Today's `YYYY-MM-DD` in a time zone (UTC when the zone is missing or unknown). */
function todayIn(timeZone, now) {
  const format = (zone) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/** The bucket of a date relative to today: weeks run Monday to Sunday, `this_week` starts today. */
function bucketsOf(today) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const thisWeekEnd = addDays(today, (7 - weekday) % 7);
  const nextWeekEnd = addDays(thisWeekEnd, 7);
  return (date) => {
    if (date === null) return 'no_date';
    if (date < today) return 'overdue';
    if (date === today) return 'today';
    if (date <= thisWeekEnd) return 'this_week';
    if (date <= nextWeekEnd) return 'next_week';
    return 'later';
  };
}

/** The date a stored date or timeline cell starts on, or `null`. */
function dateOf(column, value) {
  if (!column || value === null || typeof value !== 'object') return null;
  const raw = column.type === 'timeline' ? value.from : value.date;
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

const millis = (value) => (value instanceof Date ? value.getTime() : null);

export function myWorkService(h) {
  const {
    client,
    uid,
    now,
    listWorkspaces,
    workspace,
    teamsOf,
    memberProfiles,
    memberName,
    readValues,
    iso,
  } = h;

  /** The workspaces a call covers: the one named, or every workspace of the actor. */
  async function scopeOf(workspaceId) {
    if (workspaceId !== undefined) return [await workspace(workspaceId)];
    const mine = await listWorkspaces();
    return Promise.all(mine.map((w) => workspace(w.id)));
  }

  /** Active boards the actor can read in the workspaces: board `access`, or a main board by workspace role. */
  async function readableBoards(workspaces) {
    const lists = await inChunks(workspaces, CONCURRENCY, async (ws) => {
      const rows = await client.runQuery('boards', { workspaceId: ws.id });
      return rows
        .filter(
          (b) =>
            b.data.state === 'active' &&
            (Boolean(b.data.access?.[uid]) ||
              (b.data.kind === 'main' && boardRoleFromWorkspaceRole(ws.role) !== null)),
        )
        .map((b) => ({ id: b.id, ...b.data }));
    });
    return lists.flat();
  }

  // ---- My Work ----

  /** Names for the People cells of one workspace, loaded at most once per call. */
  function readContexts() {
    const byWorkspace = new Map();
    return async (board) => {
      const context = {
        boardId: board.id,
        columns: board.columns,
        people: undefined,
        teams: undefined,
      };
      if (!board.columns.some((c) => c.type === 'people')) return context;
      if (!byWorkspace.has(board.workspaceId)) {
        byWorkspace.set(
          board.workspaceId,
          Promise.all([memberProfiles(board.workspaceId), teamsOf(board.workspaceId)]),
        );
      }
      const [profiles, teams] = await byWorkspace.get(board.workspaceId);
      context.people = new Map(
        [...profiles].map(([memberUid, p]) => [memberUid, memberName(p, memberUid)]),
      );
      context.teams = teams;
      return context;
    };
  }

  /** Boards in the order My Work listens to them: most recent visit first, then name. */
  async function orderForMyWork(boards) {
    if (boards.length <= MY_WORK_BOARD_CAP) return boards;
    const recents = await client.listAllDocs(`users/${uid}/recents`);
    const visited = new Map(recents.map((r) => [r.id, millis(r.data.visitedAt) ?? -1]));
    return [...boards].sort((a, b) => {
      const av = visited.get(a.id) ?? -1;
      const bv = visited.get(b.id) ?? -1;
      if (av !== bv) return bv - av;
      return (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
      );
    });
  }

  return {
    async myWork({ workspaceId, includeTeams = true, dateColumn, due, limit = 50 } = {}) {
      const workspaces = await scopeOf(workspaceId);
      const all = await readableBoards(workspaces);
      const boards = (await orderForMyWork(all)).slice(0, MY_WORK_BOARD_CAP);

      // My teams per workspace (sorted by id, at most 30: one `array-contains-any` query).
      const myTeams = new Map();
      if (includeTeams) {
        await Promise.all(
          workspaces.map(async (ws) => {
            const teams = [...(await teamsOf(ws.id)).values()]
              .filter((t) => t.memberUids.includes(uid))
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, TEAM_QUERY_CAP);
            if (teams.length > 0) myTeams.set(ws.id, teams);
          }),
        );
      }

      const profile = await client.getDoc(`users/${uid}`);
      const today = todayIn(profile?.timezone, now());
      const bucket = bucketsOf(today);
      const contextOf = readContexts();
      const wanted = dateColumn === undefined ? null : String(dateColumn).trim().toLowerCase();

      const perBoard = await inChunks(boards, CONCURRENCY, async (board) => {
        const itemsPath = `boards/${board.id}/items`;
        const teams = myTeams.get(board.workspaceId) ?? [];
        const [direct, byTeam] = await Promise.all([
          client.runQuery(itemsPath, { assigneeUids: { arrayContains: uid } }),
          teams.length > 0
            ? client.runQuery(itemsPath, {
                assigneeTeamIds: { arrayContainsAny: teams.map((t) => t.id) },
              })
            : [],
        ]);
        // The hints are re-checked against the board's current columns (a deleted People column
        // leaves a stale hint until the item's next write); archived and trashed items are dropped.
        const found = new Map();
        for (const doc of direct) {
          if (doc.data.state !== 'active') continue;
          const columns = columnsForItem(board, doc.data);
          if (assigneeUidsOf(columns, doc.data.values).includes(uid))
            found.set(doc.id, { doc, via: 'me' });
        }
        for (const doc of byTeam) {
          if (doc.data.state !== 'active' || found.has(doc.id)) continue;
          const assigned = new Set(
            assigneeTeamIdsOf(columnsForItem(board, doc.data), doc.data.values),
          );
          const team = teams.find((t) => assigned.has(t.id));
          if (team) found.set(doc.id, { doc, via: team.name });
        }
        if (found.size === 0) return [];

        const context = await contextOf(board);
        const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
        const titleOf = (c) => c.title;
        const dateCol = wanted
          ? board.columns.find(
              (c) =>
                ['date', 'timeline'].includes(c.type) &&
                (c.id === dateColumn || c.title.trim().toLowerCase() === wanted),
            )
          : sortedByPosition(board.columns).find((c) => c.type === 'date');
        return [...found.values()].map(({ doc, via }) => {
          const columns = columnsForItem(board, doc.data);
          const date = dateOf(dateCol, doc.data.values?.[dateCol?.id]);
          return {
            boardId: board.id,
            boardName: board.name,
            itemId: doc.id,
            name: doc.data.name,
            group: groupTitle.get(doc.data.groupId) ?? doc.data.groupId,
            via,
            date,
            ...(doc.data.parentItemId ? { subitemOf: doc.data.parentItemId } : {}),
            values: readValues(context, doc, columns, titleOf),
          };
        });
      });

      const rows = perBoard
        .flat()
        .filter((row) => due === undefined || bucket(row.date) === due)
        .sort((a, b) => {
          if ((a.date === null) !== (b.date === null)) return a.date === null ? 1 : -1;
          return (
            (a.date ?? '').localeCompare(b.date ?? '') ||
            String(a.name).localeCompare(String(b.name)) ||
            a.itemId.localeCompare(b.itemId)
          );
        });
      const items = rows.slice(0, limit).map((row) => ({ ...row, due: bucket(row.date) }));
      return {
        today,
        timeZone: profile?.timezone || 'UTC',
        total: rows.length,
        shown: items.length,
        ...(all.length > MY_WORK_BOARD_CAP
          ? {
              note: `Only the ${MY_WORK_BOARD_CAP} most recently visited of your ${all.length} boards were searched.`,
            }
          : {}),
        items,
      };
    },

    // ---- Search ----

    async search({ query, workspaceId, kinds, includeDocText = false, limit = 25 }) {
      const term = String(query).trim();
      const wanted = new Set(kinds ?? ['items', 'boards', 'docs']);
      const workspaces = await scopeOf(workspaceId);
      const needle = fold(term);
      const startsFirst = (rows) =>
        rows
          .map((row, index) => ({ row, index, rank: fold(row.name).startsWith(needle) ? 0 : 1 }))
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map((x) => x.row);
      const notes = [];

      const boards =
        wanted.has('boards') || wanted.has('items') ? await readableBoards(workspaces) : [];
      const boardResults = wanted.has('boards')
        ? startsFirst(
            boards
              .filter((b) => fold(b.name).includes(needle))
              .map((b) => ({
                kind: 'board',
                id: b.id,
                name: b.name,
                boardId: b.id,
                boardName: b.name,
              })),
          )
        : [];

      // Docs: the list shape of the rules (a main doc, or the actor in `accessUids`) plus a role.
      let docResults = [];
      if (wanted.has('docs')) {
        const lists = await inChunks(workspaces, CONCURRENCY, async (ws) => {
          const rows = await client.runQuery('docs', { workspaceId: ws.id });
          return rows
            .filter(
              (d) =>
                d.data.state === 'active' &&
                (d.data.kind === 'main' || (d.data.accessUids ?? []).includes(uid)) &&
                Boolean(
                  d.data.access?.[uid] ||
                  (d.data.kind === 'main' && boardRoleFromWorkspaceRole(ws.role) !== null),
                ),
            )
            .map((d) => ({ id: d.id, name: String(d.data.name ?? '') }));
        });
        const docs = lists.flat();
        const byName = docs.filter((d) => fold(d.name).includes(needle));
        const snippets = new Map();
        if (includeDocText) {
          const lowered = term.toLowerCase();
          const scanned = docs.slice(0, DOC_TEXT_CAP);
          if (docs.length > DOC_TEXT_CAP) {
            notes.push(
              `Only the text of the first ${DOC_TEXT_CAP} of ${docs.length} docs was searched.`,
            );
          }
          await inChunks(scanned, CONCURRENCY, async (d) => {
            const body = await client.getDoc(`docs/${d.id}/content/body`);
            const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ') : '';
            const at = text.toLowerCase().indexOf(lowered);
            if (at < 0) return;
            const start = Math.max(0, at - Math.floor((SNIPPET_LENGTH - term.length) / 2));
            snippets.set(d.id, text.slice(start, start + SNIPPET_LENGTH));
          });
        }
        const hit = new Set([...byName.map((d) => d.id), ...snippets.keys()]);
        docResults = startsFirst(
          docs
            .filter((d) => hit.has(d.id))
            .map((d) => ({
              kind: 'doc',
              id: d.id,
              name: d.name,
              ...(snippets.has(d.id) ? { snippet: snippets.get(d.id) } : {}),
            })),
        );
      }

      // Items: `nameTokens array-contains <longest word>` per readable board, then every word must match.
      let itemResults = [];
      if (wanted.has('items')) {
        const words = searchWordsOf(term);
        const first = words[0];
        if (!first || [...first].length < MIN_ITEM_CHARS) {
          notes.push('Items are searched from two characters.');
        } else {
          let failed = 0;
          let capped = false;
          const lists = await inChunks(boards, CONCURRENCY, async (board) => {
            try {
              const rows = await client.runQuery(
                `boards/${board.id}/items`,
                { nameTokens: { arrayContains: first }, state: 'active' },
                { limit: ITEMS_PER_BOARD },
              );
              if (rows.length >= ITEMS_PER_BOARD) capped = true;
              const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
              return rows
                .filter((row) => nameMatchesWords(row.data.name, words))
                .map((row) => ({
                  kind: 'item',
                  id: row.id,
                  name: String(row.data.name ?? ''),
                  boardId: board.id,
                  boardName: board.name,
                  group: groupTitle.get(row.data.groupId) ?? row.data.groupId,
                }));
            } catch {
              failed += 1;
              return [];
            }
          });
          itemResults = startsFirst(lists.flat());
          if (capped)
            notes.push(
              `Each board answers with at most ${ITEMS_PER_BOARD} items; narrow the query for more.`,
            );
          if (failed > 0) notes.push(`${failed} board(s) could not be searched.`);
        }
      }

      const results = [...boardResults, ...docResults, ...itemResults];
      return {
        query: term,
        total: results.length,
        shown: Math.min(results.length, limit),
        results: results.slice(0, limit),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },

    // ---- Notifications ----

    async listNotifications({ unreadOnly = false, limit = 30 } = {}) {
      const path = `users/${uid}/notifications`;
      let rows;
      let scanned = false;
      if (unreadOnly) {
        // `readAt == null` alone (the web's query), newest first in memory: no composite index.
        rows = await client.runQuery(path, { readAt: null }, { limit: NOTIFICATION_SCAN });
        scanned = rows.length >= NOTIFICATION_SCAN;
        rows.sort((a, b) => (millis(b.data.createdAt) ?? 0) - (millis(a.data.createdAt) ?? 0));
      } else {
        rows = await client.runQuery(
          path,
          {},
          { orderBy: { field: 'createdAt', direction: 'desc' }, limit },
        );
      }
      const notifications = rows.slice(0, limit).map(({ id, data }) => {
        const isDocMention = typeof data.docId === 'string' && data.docId !== '';
        return {
          id,
          kind: data.kind,
          actor: data.actorName ?? null,
          boardId: isDocMention ? null : (data.boardId ?? null),
          boardName: isDocMention ? null : (data.boardName ?? null),
          itemId: isDocMention ? null : (data.itemId ?? null),
          itemName: isDocMention ? null : (data.itemName ?? null),
          docId: isDocMention ? data.docId : null,
          docName: isDocMention ? (data.docName ?? null) : null,
          text: data.snippet ?? '',
          createdAt: iso(data.createdAt),
          read: data.readAt !== null && data.readAt !== undefined,
        };
      });
      return {
        shown: notifications.length,
        ...(scanned
          ? { note: `Only the newest ${NOTIFICATION_SCAN} unread notifications were checked.` }
          : {}),
        notifications,
      };
    },

    async markNotificationsRead({ ids, all } = {}) {
      if ((ids === undefined) === (all === undefined)) {
        throw new McpUserError('Give either ids (up to 100) or all: true.');
      }
      const base = `users/${uid}/notifications`;
      const targets = [];
      const alreadyRead = [];
      const notFound = [];
      let more = false;
      if (all) {
        const rows = await client.runQuery(base, { readAt: null }, { limit: MARK_ALL_CAP });
        more = rows.length >= MARK_ALL_CAP;
        for (const row of rows) targets.push(row.id);
      } else {
        // Only the actor's own collection is ever read, so another person's id is simply not found.
        for (const id of [...new Set(ids)]) {
          const doc = await client.getDoc(`${base}/${id}`);
          if (!doc) notFound.push(id);
          else if (doc.readAt !== null && doc.readAt !== undefined) alreadyRead.push(id);
          else targets.push(id);
        }
      }
      // The rules allow exactly `readAt` to change, to the request time.
      for (let at = 0; at < targets.length; at += COMMIT_CHUNK) {
        await client.commit(
          targets.slice(at, at + COMMIT_CHUNK).map((id) => ({
            op: 'update',
            path: `${base}/${id}`,
            set: { readAt: ts(now()) },
          })),
        );
      }
      return {
        marked: targets.length,
        ...(alreadyRead.length > 0 ? { alreadyRead } : {}),
        ...(notFound.length > 0 ? { notFound } : {}),
        ...(more ? { note: `Only ${MARK_ALL_CAP} were marked; call again for the rest.` } : {}),
      };
    },
  };
}
