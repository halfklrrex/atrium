// The connector's tool logic, free of any MCP wiring. Every function takes plain arguments and returns
// plain JSON, so it can be tested against an in-memory Firestore. See docs/mcp-connector.md.
//
// Safety rules enforced here (both clients bypass security rules, so we mirror them):
//   - the actor is one Atrium user (`actor.uid`); only the workspaces whose `memberIds` list them,
//     and, with `actor.workspaceFilter`, only that one workspace;
//   - only boards with `state = active` where the actor has a role, computed like the rules'
//     `boardRole()` (board `access`, or the workspace role on a `main` board); a board outside the
//     actor's memberships reads as "not found"; viewers read only; structure changes need `owner`,
//     item changes `editor` or `owner`;
//   - never writes derivedColumnIds / serverManagedColumnIds / requiredColumnIds / seq / boardSeq /
//     activity / notifications, and never empties a required cell (REQ-1);
//   - no hard deletes; only the documents of one board are ever touched.
import {
  boardRoleFromWorkspaceRole,
  columnRegistry,
  columnsForSubitems,
  isColumnValueEmpty,
} from '@atrium/shared';
import { McpUserError, assertId } from './errors.mjs';
import { findColumn } from './refs.mjs';
import { peopleInputHasEmail, peopleInputHasTeam, readableCell, toValidCell } from './values.mjs';
import { EDIT_ROLES, MAX_ITEMS_PER_CALL } from './service/constants.mjs';
import { boardsService } from './service/boards.mjs';
import { columnsService } from './service/columns.mjs';
import { createLinkResolver } from './service/links.mjs';
import { createMirrorReader } from './service/mirror.mjs';
import { docsService } from './service/docs.mjs';
import { itemsService } from './service/items.mjs';
import { membersService } from './service/members.mjs';
import { myWorkService } from './service/mywork.mjs';
import { teamsService } from './service/teams.mjs';
import { updatesService } from './service/updates.mjs';
import { viewsService } from './service/views.mjs';

export { MAX_ITEMS_PER_CALL };

/** How long a workspace membership lookup is reused (bounds how long a removal takes to bite). */
const MEMBERSHIP_TTL_MS = 60_000;

export const PICK_WORKSPACE_MESSAGE = 'Give workspaceId; call atrium_list_workspaces first.';

export function createService({ client, actor, now = () => new Date() }) {
  const uid = assertId(actor?.uid, 'actor.uid');
  const workspaceFilter =
    actor.workspaceFilter == null ? null : assertId(actor.workspaceFilter, 'workspaceFilter');

  /** workspaceId -> { expires, pending: Promise<membership|null> } */
  const memberships = new Map();

  const shapeMembership = (id, ws) => {
    const role = ws.roles?.[uid];
    if (!(ws.memberIds ?? []).includes(uid) || !role) return null;
    return {
      id,
      name: typeof ws.name === 'string' ? ws.name : id,
      role,
      roles: ws.roles ?? {},
      memberUids: ws.memberIds ?? [],
    };
  };

  /**
   * The actor's membership of one workspace (`{ id, name, role, roles, memberUids }`), or `null`
   * when they are not a member, the workspace does not exist, or it is outside `workspaceFilter`.
   * Cached for a short while; the role is checked again on every call that needs it.
   */
  function membership(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId === '') return Promise.resolve(null);
    if (workspaceFilter && workspaceId !== workspaceFilter) return Promise.resolve(null);
    const cached = memberships.get(workspaceId);
    if (cached && cached.expires > now().getTime()) return cached.pending;
    const pending = (async () => {
      const ws = await client.getDoc(`workspaces/${workspaceId}`);
      return ws ? shapeMembership(workspaceId, ws) : null;
    })();
    memberships.set(workspaceId, { expires: now().getTime() + MEMBERSHIP_TTL_MS, pending });
    pending.catch(() => memberships.delete(workspaceId));
    return pending;
  }

  /** Like {@link membership}, for a workspace the caller named: a non-member gets a plain error. */
  async function workspace(workspaceId) {
    assertId(workspaceId, 'workspaceId');
    const found = await membership(workspaceId);
    if (!found) {
      throw new McpUserError(
        `Workspace "${workspaceId}" was not found among your workspaces. Call atrium_list_workspaces.`,
      );
    }
    return found;
  }

  /** Every workspace the actor is a member of (within the filter): `{ id, name, role }`, by name. */
  async function listWorkspaces() {
    const rows = await client.runQuery('workspaces', { memberIds: { arrayContains: uid } });
    const out = [];
    for (const row of rows) {
      if (workspaceFilter && row.id !== workspaceFilter) continue;
      const found = shapeMembership(row.id, row.data);
      if (!found) continue;
      memberships.set(row.id, {
        expires: now().getTime() + MEMBERSHIP_TTL_MS,
        pending: Promise.resolve(found),
      });
      out.push({ id: found.id, name: found.name, role: found.role });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /**
   * The workspace a workspace-level call works in: the one given, or the actor's only workspace.
   * With several, the caller must choose (so Claude never guesses where a board lands).
   */
  async function resolveWorkspace(workspaceId) {
    if (workspaceId !== undefined && workspaceId !== null) return workspace(workspaceId);
    const mine = await listWorkspaces();
    if (mine.length === 1) return workspace(mine[0].id);
    if (mine.length === 0) {
      throw new McpUserError(
        workspaceFilter
          ? `You are not a member of workspace "${workspaceFilter}".`
          : 'You are not a member of any workspace.',
      );
    }
    throw new McpUserError(PICK_WORKSPACE_MESSAGE);
  }

  /** The actor's role on a board, as the rules' `boardRole()` computes it; `null` when none. */
  async function roleOn(board) {
    const ws = await membership(board.workspaceId);
    if (!ws) return null;
    const direct = board.access?.[uid];
    if (direct) return direct;
    // Main boards are open to workspace members through their workspace role.
    if (board.kind === 'main') return boardRoleFromWorkspaceRole(ws.role);
    return null;
  }

  /** Loads a board and applies the safety checks. `need` is 'read', 'edit' or 'owner'. */
  async function loadBoard(boardId, need = 'edit', { states = ['active'], ownerMessage } = {}) {
    assertId(boardId, 'boardId');
    const meta = await client.getDocMeta(`boards/${boardId}`);
    // Same message for "missing" and "not yours": never reveal boards outside the memberships.
    const notFound = new McpUserError(`Board "${boardId}" was not found in your workspaces.`);
    if (!meta) throw notFound;
    const role = await roleOn(meta.data);
    if (!role) throw notFound;
    if (!states.includes(meta.data.state)) {
      throw new McpUserError(`Board "${boardId}" is ${meta.data.state}, not active.`);
    }
    if (need === 'owner' && role !== 'owner') {
      throw new McpUserError(
        ownerMessage ?? "Changing a board's structure needs the board owner role.",
      );
    }
    if (need === 'edit' && !EDIT_ROLES.includes(role)) {
      throw new McpUserError('You can only view this board.');
    }
    return {
      id: boardId,
      board: meta.data,
      updateTime: meta.updateTime,
      role,
      workspaceId: meta.data.workspaceId,
    };
  }

  /** Read-modify-write of the board doc with an `updateTime` precondition; retried once. */
  async function mutateBoard(boardId, change, { need = 'owner', ...options } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await loadBoard(boardId, need, options);
      const { patch, result } = await change(loaded.board);
      try {
        await client.commit([
          {
            op: 'patch',
            path: `boards/${boardId}`,
            data: { ...patch, updatedAt: now(), updatedBy: uid },
            precondition: { updateTime: loaded.updateTime },
          },
        ]);
        return result;
      } catch (error) {
        const raced = error?.status === 409 || error?.status === 400;
        if (!raced || attempt >= 1) throw error;
      }
    }
  }

  const resolveLinkCells = createLinkResolver({ client, roleOn, itemsOf: (id) => itemsOf(id) });
  const prepareMirrors = createMirrorReader({ client, roleOn });

  async function cellContext(loaded) {
    return { uid, memberUids: (await workspace(loaded.workspaceId)).memberUids };
  }

  /** Checks that a person may write this column on this board; returns nothing. */
  function assertWritableColumn(loaded, column) {
    if (column.migrating) {
      throw new McpUserError(`Column "${column.title}" is changing type; try again in a minute.`);
    }
    if ((loaded.board.columnLocks ?? []).includes(column.id) && loaded.role !== 'owner') {
      throw new McpUserError(`Column "${column.title}" is locked to board owners.`);
    }
  }

  /** `{ "<column title or id>": input }` -> `{ <columnId>: storedValue }`, fully validated. */
  async function convertValues(
    loaded,
    values = {},
    columns = loaded.board.columns,
    itemContext = {},
  ) {
    const ctx = await cellContext(loaded);
    const links = await resolveLinkCells(loaded, columns, values, itemContext);
    if (links.size > 0) ctx.links = links;
    const peopleInputs = Object.entries(values)
      .filter(([ref]) => {
        const column = columns.find(
          (c) => c.id === ref || c.title.toLowerCase() === String(ref).trim().toLowerCase(),
        );
        return column?.type === 'people';
      })
      .map(([, input]) => input);
    if (peopleInputs.some(peopleInputHasEmail)) {
      ctx.emailToUid = new Map();
      const profiles = await memberProfiles(loaded.workspaceId);
      for (const memberUid of ctx.memberUids) {
        const email = profiles.get(memberUid)?.email;
        if (typeof email === 'string') ctx.emailToUid.set(email.trim().toLowerCase(), memberUid);
      }
    }
    if (peopleInputs.some(peopleInputHasTeam)) {
      ctx.teams = [...(await teamsOf(loaded.workspaceId)).values()];
    }
    const out = {};
    for (const [ref, input] of Object.entries(values)) {
      const column = findColumn({ columns }, ref);
      if (columnRegistry.isDerived(column.type) || columnRegistry.isServerManaged(column.type)) {
        throw new McpUserError(
          `Column "${column.title}" is calculated by Atrium and cannot be set.`,
        );
      }
      assertWritableColumn(loaded, column);
      out[column.id] = toValidCell(column, input, ctx);
    }
    return out;
  }

  /**
   * REQ-1, as `requiredCellsOk` in firestore.rules: an item update may not empty a cell of a column in
   * `board.requiredColumnIds` (or marked `required`). Only cells the write changes count, so clearing
   * a cell that is not stored at all is a no-op and passes. Creation is exempt (items start empty).
   */
  function assertRequiredKept(loaded, columns, item, cells) {
    const required = new Set(loaded.board.requiredColumnIds ?? []);
    for (const column of columns) if (column.required) required.add(column.id);
    for (const [columnId, value] of Object.entries(cells)) {
      if (!required.has(columnId)) continue;
      const column = columns.find((c) => c.id === columnId);
      if (!isColumnValueEmpty(column.type, value)) continue;
      if (value === null && item.values?.[columnId] === undefined) continue; // nothing to remove
      throw new McpUserError(`Column "${column.title}" is required and cannot be emptied.`);
    }
  }

  const itemsOf = (boardId, fields) => client.listAllDocs(`boards/${boardId}/items`, { fields });

  async function loadItem(boardId, itemId) {
    assertId(itemId, 'itemId');
    const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
    if (!item) throw new McpUserError(`Item "${itemId}" was not found on this board.`);
    if (item.state !== 'active') throw new McpUserError(`Item "${itemId}" is ${item.state}.`);
    return item;
  }

  /**
   * The workspace's member docs by uid (`workspaces/{ws}/members/{uid}`: name, email and the shared
   * profile). Any member may read them under the rules; other people's `users/{uid}` docs are private.
   */
  async function memberProfiles(workspaceId) {
    const rows = await client.listAllDocs(`workspaces/${workspaceId}/members`);
    return new Map(rows.map((row) => [row.id, row.data]));
  }

  /** The workspace's teams by id: `{ id, name, color, memberUids }`. */
  async function teamsOf(workspaceId) {
    const rows = await client.listAllDocs(`workspaces/${workspaceId}/teams`);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: typeof row.data.name === 'string' ? row.data.name : row.id,
          color: row.data.color ?? null,
          memberUids: Array.isArray(row.data.memberUids) ? row.data.memberUids : [],
        },
      ]),
    );
  }

  /** What a member doc shows of a person: the name (display name, else email, else uid). */
  const memberName = (profile, memberUid) => profile?.displayName || profile?.email || memberUid;

  /** The shared profile fields a member doc carries and the person has set: title, location, time zone. */
  function sharedProfile(profile) {
    const shared = profile?.profile;
    const out = {};
    for (const key of ['title', 'location', 'timeZone']) {
      if (typeof shared?.[key] === 'string' && shared[key] !== '') out[key] = shared[key];
    }
    return out;
  }

  /**
   * What `readableCell` needs to show a board's cells: the columns for calculated values, and the
   * workspace's people and teams when a column holds them. Load it once per call.
   */
  async function readContext(boardId, workspaceId, columns) {
    const context = { boardId, columns, people: undefined, teams: undefined };
    if (columns.some((c) => c.type === 'people')) {
      const [profiles, teams] = await Promise.all([
        memberProfiles(workspaceId),
        teamsOf(workspaceId),
      ]);
      context.people = new Map(
        [...profiles].map(([memberUid, p]) => [memberUid, memberName(p, memberUid)]),
      );
      context.teams = teams;
    }
    return context;
  }

  /** The readable cell of one column of one item doc (`columns`: the item's columns, for calculated ones). */
  function readCell(context, doc, columns, column) {
    return readableCell(column, doc.data.values?.[column.id], {
      ...context,
      columns,
      item: {
        id: doc.id,
        values: doc.data.values ?? {},
        createdAt: doc.data.createdAt,
        createdBy: doc.data.createdBy,
        updatedAt: doc.data.updatedAt,
        updatedBy: doc.data.updatedBy,
        groupId: doc.data.groupId,
        seq: doc.data.seq,
        boardSeq: doc.data.boardSeq,
      },
    });
  }

  /** `{ "<title>": readable cell }` of one item doc (empty cells left out), calculated columns included. */
  function readValues(context, doc, columns, titleOf) {
    return Object.fromEntries(
      columns.flatMap((c) => {
        const cell = readCell(context, doc, columns, c);
        return cell === null ? [] : [[titleOf(c), cell]];
      }),
    );
  }

  /** Workspace members who can read the board: `{ uid, name, email, role }` (role on the board). */
  async function boardMembers(board) {
    const { roles, memberUids } = await workspace(board.workspaceId);
    const profiles = await memberProfiles(board.workspaceId);
    const out = [];
    for (const memberUid of memberUids) {
      const role =
        board.access?.[memberUid] ??
        (board.kind === 'main' && roles[memberUid]
          ? boardRoleFromWorkspaceRole(roles[memberUid])
          : null);
      if (!role) continue;
      const profile = profiles.get(memberUid) ?? {};
      out.push({
        uid: memberUid,
        name: memberName(profile, memberUid),
        email: profile.email ?? null,
        role,
        ...sharedProfile(profile),
      });
    }
    return out;
  }

  const iso = (value) => (value instanceof Date ? value.toISOString() : null);

  const sortedPositions = (docs) => docs.map((d) => d.data.position);

  /** Subitems of `parentId` (any state unless `active`), sorted by position. */
  async function subitemDocs(boardId, parentId, { active = true } = {}) {
    const docs = await itemsOf(boardId);
    return docs
      .filter((d) => d.data.parentItemId === parentId && (!active || d.data.state === 'active'))
      .sort((a, b) => (a.data.position < b.data.position ? -1 : 1));
  }

  /**
   * The columns a board's subitems use: the board's own columns (subitems share them), or, on a
   * board the subitem-column migration has not reached yet, its legacy subitem columns.
   */
  const subitemColumnsOf = (board) => columnsForSubitems(board);

  // The helpers every domain module works with; they close over the client, the actor and the caches.
  const helpers = {
    client,
    uid,
    now,
    membership,
    workspace,
    listWorkspaces,
    resolveWorkspace,
    roleOn,
    loadBoard,
    mutateBoard,
    cellContext,
    assertWritableColumn,
    convertValues,
    assertRequiredKept,
    itemsOf,
    loadItem,
    memberProfiles,
    teamsOf,
    memberName,
    sharedProfile,
    readContext,
    readCell,
    readValues,
    prepareMirrors,
    boardMembers,
    iso,
    sortedPositions,
    subitemDocs,
    subitemColumnsOf,
  };

  const columns = columnsService(helpers);
  helpers.prepareColumn = columns.prepareColumn;
  const { prepareColumn: _prepareColumn, ...columnsApi } = columns;

  return {
    ...boardsService(helpers),
    ...itemsService(helpers),
    ...updatesService(helpers),
    ...membersService(helpers),
    ...myWorkService(helpers),
    ...docsService(helpers),
    ...teamsService(helpers),
    ...viewsService(helpers),
    ...columnsApi,
    async verify() {
      const profile = await client.getDoc(`users/${uid}`);
      if (!profile) throw new McpUserError(`User "${uid}" does not exist in Atrium.`);
      if (workspaceFilter) await workspace(workspaceFilter);
      return { uid, workspaces: await listWorkspaces() };
    },
  };
}
