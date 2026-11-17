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
  columnsForItem,
  columnsForSubitems,
  hasLegacySubitemColumns,
  VOTE_COLUMN_CAP_MESSAGE,
  voteCapExceeded,
  isColumnValueEmpty,
  BUILT_IN_TEMPLATES,
  builtInTemplate,
  templateSampleItemSchema,
  templateStructureSchema,
} from '@atrium/shared';
import {
  addLabelsToSettings,
  buildBoardDoc,
  buildColumn,
  buildGroup,
  buildItemDoc,
  buildItemPatch,
  buildReplyDoc,
  buildUpdateDoc,
  positionRightAfter,
  positionBetween,
  evenPositions,
  ts,
  newDocId,
  positionAfter,
  validSettings,
} from './builders.mjs';
import { McpUserError, assertId } from './errors.mjs';
import { findColumn, findGroup, sortedByPosition } from './refs.mjs';
import { peopleInputHasEmail, readableCell, toValidCell } from './values.mjs';
import { buildRichBody, memberResolver } from './updates.mjs';
import {
  MAX_MARKDOWN_CHARS,
  appendDoc,
  docToMarkdown,
  markdownToDoc,
  richNodeTypes,
  toStoredDescription,
} from './description.mjs';

export const MAX_ITEMS_PER_CALL = 50;
const MAX_MOVED_SUBITEMS = 200;

/** Milliseconds of a stored timestamp (Date, Firestore timestamp or ISO string). */
const millis = (value) =>
  value instanceof Date
    ? value.getTime()
    : typeof value?.toMillis === 'function'
      ? value.toMillis()
      : new Date(value).getTime();

/** How long a workspace membership lookup is reused (bounds how long a removal takes to bite). */
const MEMBERSHIP_TTL_MS = 60_000;

const EDIT_ROLES = ['owner', 'editor'];
/** Workspace roles that may create boards (rules: `canCreateInWs`). */
const CREATE_BOARD_ROLES = ['owner', 'admin', 'member'];

export const PICK_WORKSPACE_MESSAGE = 'Give workspaceId; call atrium_list_workspaces first.';

function labelSummary(column) {
  const s = column.settings ?? {};
  if (column.type === 'status')
    return { labels: s.labels.map((l) => ({ label: l.label, color: l.color })) };
  if (column.type === 'dropdown') return { options: s.labels.map((l) => l.label) };
  if (column.type === 'tags') return { tags: (s.tags ?? []).map((t) => t.name) };
  if (column.type === 'rating') return { limit: s.limit, symbol: s.symbol };
  return {};
}

/**
 * @param {object} options
 * @param {object} options.client  A Firestore client (`getDoc`, `getDocMeta`, `listAllDocs`, `runQuery`, `commit`).
 * @param {{ uid: string, workspaceFilter?: string|null }} options.actor  The Atrium user every
 *   read and write is done as, and optionally the one workspace they may touch.
 * @param {() => Date} [options.now]
 */

const norm = (text) => String(text).trim().toLowerCase();

/** The label texts a status, dropdown or tags cell shows, or `null` for other types. */
function labelTexts(column, value) {
  const s = column.settings ?? {};
  if (column.type === 'status') {
    const found = (s.labels ?? []).find((l) => l.index === value.index);
    return [found ? found.label : null];
  }
  if (column.type === 'dropdown') {
    return (value.ids ?? []).map((id) => (s.labels ?? []).find((l) => l.id === id)?.label ?? null);
  }
  if (column.type === 'tags') {
    return (value.tag_ids ?? []).map((id) => (s.tags ?? []).find((t) => t.id === id)?.name ?? null);
  }
  return null;
}

/**
 * One cell, source column -> matching target column. Label columns map by label text (a label the
 * target lacks is reported through `drop` and skipped); a vote cell keeps its voters; other types
 * keep their native value. Returns the stored value, or `undefined` when nothing is left.
 */
function mapOneValue(from, to, value, ctx, drop) {
  const texts = labelTexts(from, value);
  if (texts) {
    const known = (
      to.type === 'tags' ? (to.settings?.tags ?? []) : (to.settings?.labels ?? [])
    ).map((l) => norm(l.label ?? l.name));
    const kept = [];
    for (const text of texts) {
      if (text === null) drop('label not found on the source column');
      else if (!known.includes(norm(text))) drop(`label "${text}" not on the target`);
      else kept.push(text);
    }
    if (kept.length === 0) return undefined;
    return toValidCell(to, to.type === 'status' ? kept[0] : kept, ctx);
  }
  if (from.type === 'vote') {
    const result = columnRegistry.validateCell(to, value);
    if (!result.ok) throw new McpUserError(result.message);
    return value;
  }
  return toValidCell(to, value, ctx);
}

export function createService({ client, actor, now = () => new Date() }) {
  const uid = assertId(actor?.uid, 'actor.uid');
  const workspaceFilter =
    actor.workspaceFilter == null ? null : assertId(actor.workspaceFilter, 'workspaceFilter');

  /** workspaceId -> { expires, pending: Promise<membership|null> } */
  const memberships = new Map();
  let profileCache;

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
  async function convertValues(loaded, values = {}, columns = loaded.board.columns) {
    const ctx = await cellContext(loaded);
    const needsEmails = Object.entries(values).some(([ref, input]) => {
      const column = columns.find(
        (c) => c.id === ref || c.title.toLowerCase() === String(ref).trim().toLowerCase(),
      );
      return column?.type === 'people' && peopleInputHasEmail(input);
    });
    if (needsEmails) {
      ctx.emailToUid = new Map();
      for (const memberUid of ctx.memberUids) {
        const email = (await profileOf(memberUid)).email;
        if (typeof email === 'string') ctx.emailToUid.set(email.trim().toLowerCase(), memberUid);
      }
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

  /** Item writes for a template's sample items: skips values the column rules would refuse. */
  function sampleItemWrites(boardId, board, sampleItems) {
    const columns = new Map(board.columns.map((c) => [c.id, c]));
    const groupIds = new Set(board.groups.map((g) => g.id));
    const last = new Map();
    const writes = [];
    for (const sample of sampleItems) {
      if (!groupIds.has(sample.groupId)) continue;
      const values = {};
      for (const [columnId, value] of Object.entries(sample.values ?? {})) {
        const column = columns.get(columnId);
        if (!column || value === null || value === undefined) continue;
        // People and vote values name accounts; derived and server-managed ones are not stored by clients.
        if (['people', 'vote', 'dependency'].includes(column.type)) continue;
        if (!columnRegistry.has(column.type)) continue;
        if (columnRegistry.isDerived(column.type) || columnRegistry.isServerManaged(column.type)) {
          continue;
        }
        try {
          values[columnId] = toValidCell(column, structuredClone(value));
        } catch {
          // A value that does not validate is left out; the item itself still goes in.
        }
      }
      const position = positionAfter(last.has(sample.groupId) ? [last.get(sample.groupId)] : []);
      last.set(sample.groupId, position);
      writes.push({
        op: 'set',
        path: `boards/${boardId}/items/${newDocId()}`,
        data: buildItemDoc({
          uid,
          name: sample.name,
          groupId: sample.groupId,
          position,
          values,
          now: now(),
        }),
        precondition: { exists: false },
      });
    }
    return writes;
  }

  const itemsOf = (boardId, fields) => client.listAllDocs(`boards/${boardId}/items`, { fields });

  async function loadItem(boardId, itemId) {
    assertId(itemId, 'itemId');
    const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
    if (!item) throw new McpUserError(`Item "${itemId}" was not found on this board.`);
    if (item.state !== 'active') throw new McpUserError(`Item "${itemId}" is ${item.state}.`);
    return item;
  }

  async function profileOf(memberUid) {
    return (await client.getDoc(`users/${memberUid}`)) ?? {};
  }

  /** Workspace members who can read the board: `{ uid, name, email, role }` (role on the board). */
  async function boardMembers(board) {
    const { roles, memberUids } = await workspace(board.workspaceId);
    const out = [];
    for (const memberUid of memberUids) {
      const role =
        board.access?.[memberUid] ??
        (board.kind === 'main' && roles[memberUid]
          ? boardRoleFromWorkspaceRole(roles[memberUid])
          : null);
      if (!role) continue;
      const profile = await profileOf(memberUid);
      out.push({
        uid: memberUid,
        name: profile.displayName || profile.email || memberUid,
        email: profile.email ?? null,
        role,
      });
    }
    return out;
  }

  const iso = (value) => (value instanceof Date ? value.toISOString() : null);

  async function authorProfile() {
    profileCache ??= await profileOf(uid);
    return profileCache;
  }

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

  /** `{ uid, name, ... }` of the members a post may mention, as the web's @ list would offer. */
  async function mentionResolver(loaded) {
    return memberResolver(await boardMembers(loaded.board), uid);
  }

  async function loadUpdate(boardId, itemId, updateId, replyId) {
    assertId(updateId, 'updateId');
    const update = await client.getDoc(`boards/${boardId}/items/${itemId}/updates/${updateId}`);
    if (!update) throw new McpUserError(`Update "${updateId}" was not found on this item.`);
    if (replyId === undefined)
      return {
        update,
        target: update,
        path: `boards/${boardId}/items/${itemId}/updates/${updateId}`,
      };
    assertId(replyId, 'replyId');
    const path = `boards/${boardId}/items/${itemId}/updates/${updateId}/replies/${replyId}`;
    const reply = await client.getDoc(path);
    if (!reply) throw new McpUserError(`Reply "${replyId}" was not found on this update.`);
    return { update, target: reply, path };
  }

  const shapePost = (id, post) => ({
    id,
    author: { uid: post.authorId, name: post.authorName ?? null },
    mine: post.authorId === uid,
    text: post.content,
    markdown: post.contentDoc ? docToMarkdown(post.contentDoc) : post.content,
    createdAt: iso(post.createdAt),
    edited: Boolean(post.updatedAt && post.createdAt && +post.updatedAt !== +post.createdAt),
    likes: (post.likes ?? []).length,
    mentions: post.mentions ?? [],
    attachments: (post.attachments ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
    })),
  });

  return {
    // ---- workspaces and boards (read) --------------------------------------------------------
    async listWorkspaces() {
      return { workspaces: await listWorkspaces() };
    },

    async listBoards({ workspaceId, state = 'active' } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const boards = await client.runQuery('boards', { workspaceId: ws.id });
      const visible = boards.filter((b) => {
        if (b.data.state !== state) return false;
        if (b.data.access?.[uid]) return true;
        return b.data.kind === 'main' && boardRoleFromWorkspaceRole(ws.role) !== null;
      });
      return {
        workspaceId: ws.id,
        boards: sortedByPosition(visible.map((b) => ({ ...b.data, id: b.id }))).map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          state: b.state,
        })),
      };
    },

    async getBoard({ boardId, includeItems = true, limit = 200 }) {
      const { board } = await loadBoard(boardId, 'read');
      const columnTitle = new Map();
      const titles = new Set();
      const legacy = hasLegacySubitemColumns(board);
      for (const column of legacy ? [...board.columns, ...board.subitemColumns] : board.columns) {
        const taken = titles.has(column.title.toLowerCase());
        titles.add(column.title.toLowerCase());
        columnTitle.set(column.id, taken ? `${column.title} (${column.id})` : column.title);
      }
      const result = {
        id: boardId,
        workspaceId: board.workspaceId,
        name: board.name,
        description: board.description,
        kind: board.kind,
        columns: sortedByPosition(board.columns).map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          ...labelSummary(c),
        })),
        groups: sortedByPosition(board.groups).map((g) => ({
          id: g.id,
          title: g.title,
          color: g.color,
        })),
      };
      // Only a board not yet migrated still has subitem columns of its own to list.
      if (legacy) {
        result.subitemColumns = sortedByPosition(board.subitemColumns).map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          ...labelSummary(c),
        }));
      }
      if (!includeItems) return result;

      const docs = (await itemsOf(boardId)).filter((d) => d.data.state === 'active');
      const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
      const groupOrder = new Map(sortedByPosition(board.groups).map((g, i) => [g.id, i]));
      const shape = (doc, columns) => ({
        id: doc.id,
        seq: doc.data.seq ?? null,
        name: doc.data.name,
        values: Object.fromEntries(
          columns.flatMap((c) => {
            const cell = readableCell(c, doc.data.values?.[c.id]);
            return cell === null ? [] : [[columnTitle.get(c.id), cell]];
          }),
        ),
      });
      const subitems = docs.filter((d) => d.data.parentItemId);
      const roots = docs
        .filter((d) => !d.data.parentItemId)
        .sort(
          (a, b) =>
            (groupOrder.get(a.data.groupId) ?? 0) - (groupOrder.get(b.data.groupId) ?? 0) ||
            (a.data.position < b.data.position ? -1 : 1),
        );
      result.itemCount = roots.length;
      result.items = roots.slice(0, limit).map((doc) => {
        const children = subitems
          .filter((s) => s.data.parentItemId === doc.id)
          .map((s) => shape(s, subitemColumnsOf(board)));
        return {
          ...shape(doc, board.columns),
          group: groupTitle.get(doc.data.groupId) ?? doc.data.groupId,
          ...(children.length > 0 ? { subitems: children } : {}),
        };
      });
      if (roots.length > limit) result.truncated = true;
      return result;
    },

    // ---- boards and structure ----------------------------------------------------------------
    async listTemplates({ workspaceId } = {}) {
      const ws = await resolveWorkspace(workspaceId);
      const saved = await client.listAllDocs(`workspaces/${ws.id}/templates`);
      const summary = (id, source, name, description, structure, sampleItems) => ({
        id,
        source,
        name,
        description,
        columns: sortedByPosition(structure.columns ?? []).map((c) => ({
          title: c.title,
          type: c.type,
        })),
        groups: sortedByPosition(structure.groups ?? []).map((g) => g.title),
        sampleItems: sampleItems.length,
      });
      return {
        workspaceId: ws.id,
        templates: [
          ...BUILT_IN_TEMPLATES.map((t) =>
            summary(t.id, 'built-in', t.name, t.description, t.structure, t.sampleItems),
          ),
          ...saved
            .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)))
            .flatMap((t) => {
              // One damaged saved template must not fail the whole listing.
              try {
                return [
                  summary(
                    t.id,
                    'workspace',
                    t.data.name,
                    t.data.description ?? '',
                    t.data.structure ?? {},
                    t.data.sampleItems ?? [],
                  ),
                ];
              } catch {
                return [];
              }
            }),
        ],
      };
    },

    async createBoard({ name, description, workspaceId, templateId, includeSampleItems }) {
      if (templateId === undefined && includeSampleItems !== undefined) {
        throw new McpUserError('includeSampleItems only applies together with templateId.');
      }
      const ws = await resolveWorkspace(workspaceId);
      if (!CREATE_BOARD_ROLES.includes(ws.role)) {
        throw new McpUserError(
          `Creating a board needs the member role or higher in workspace "${ws.name}" (you are a ${ws.role}).`,
        );
      }
      let template = null;
      if (templateId !== undefined) {
        assertId(templateId, 'templateId');
        const built = builtInTemplate(templateId);
        if (built) {
          template = { id: built.id, source: 'built-in', name: built.name, content: built };
        } else {
          const saved = await client.getDoc(`workspaces/${ws.id}/templates/${templateId}`);
          if (!saved) {
            throw new McpUserError(
              `Template "${templateId}" was not found. Call atrium_list_templates.`,
            );
          }
          const structure = templateStructureSchema.safeParse(saved.structure);
          if (!structure.success) {
            throw new McpUserError(`Template "${templateId}" is damaged and cannot be used.`);
          }
          template = {
            id: templateId,
            source: 'workspace',
            name: saved.name,
            content: {
              structure: structure.data,
              sampleItems: (Array.isArray(saved.sampleItems) ? saved.sampleItems : []).filter(
                (i) => templateSampleItemSchema.safeParse(i).success,
              ),
            },
          };
        }
      }
      const existing = await client.runQuery('boards', { workspaceId: ws.id });
      const roots = existing.filter((b) => b.data.folderId === null);
      const doc = buildBoardDoc({
        workspaceId: ws.id,
        uid,
        name,
        description,
        position: positionAfter(roots.map((b) => b.data.position)),
        now: now(),
        structure: template?.content.structure,
      });
      const id = newDocId();
      await client.commit([
        { op: 'set', path: `boards/${id}`, data: doc, precondition: { exists: false } },
      ]);
      const result = {
        id,
        workspaceId: ws.id,
        name: doc.name,
        columns: doc.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
        groups: doc.groups.map((g) => ({ id: g.id, title: g.title })),
      };
      if (!template) return result;
      result.template = { id: template.id, source: template.source, name: template.name };
      result.sampleItems = 0;
      if (includeSampleItems === false) return result;
      // Sample items are a second commit, as in the web: the item rules read the board, so it must
      // exist first. A failure leaves a good (empty) board, so it is reported rather than thrown.
      const writes = sampleItemWrites(id, doc, template.content.sampleItems);
      if (writes.length === 0) return result;
      try {
        await client.commit(writes);
        result.sampleItems = writes.length;
      } catch (error) {
        // stderr only: the stdio transport owns stdout.
        console.error(`atrium: sample items for board ${id} were not written: ${error?.message}`);
        result.warning = 'The board was created, but its sample items could not be added.';
      }
      return result;
    },

    async addGroup({ boardId, title, color }) {
      return mutateBoard(boardId, (board) => {
        const group = buildGroup({ title, color, existingGroups: board.groups });
        return {
          patch: { groups: [...board.groups, group] },
          result: { id: group.id, title: group.title, color: group.color },
        };
      });
    },

    async renameGroup({ boardId, group, title }) {
      return mutateBoard(boardId, (board) => {
        const target = findGroup(board, group);
        const renamed = board.groups.map((g) =>
          g.id === target.id ? { ...g, title: title.trim() } : g,
        );
        return { patch: { groups: renamed }, result: { id: target.id, title: title.trim() } };
      });
    },

    async deleteGroup({ boardId, group }) {
      const loaded = await loadBoard(boardId, 'owner');
      const target = findGroup(loaded.board, group);
      if (loaded.board.groups.length <= 1) {
        throw new McpUserError(
          'A board needs at least one group; add another before deleting this one.',
        );
      }
      const docs = await itemsOf(boardId, ['groupId', 'state']);
      const live = docs.filter((d) => d.data.groupId === target.id && d.data.state === 'active');
      if (live.length > 0) {
        throw new McpUserError(
          `Group "${target.title}" still has ${live.length} item(s). Move or delete them first.`,
        );
      }
      return mutateBoard(boardId, (board) => ({
        patch: { groups: board.groups.filter((g) => g.id !== target.id) },
        result: { deleted: target.id, title: target.title },
      }));
    },

    async reorderGroups({ boardId, groups }) {
      return mutateBoard(boardId, (board) => {
        const ids = groups.map((ref) => findGroup(board, ref).id);
        if (new Set(ids).size !== ids.length) {
          throw new McpUserError('A group is listed twice; list every group exactly once.');
        }
        if (ids.length !== board.groups.length) {
          const missing = board.groups
            .filter((g) => !ids.includes(g.id))
            .map((g) => `"${g.title}"`);
          throw new McpUserError(`List every group of the board; missing: ${missing.join(', ')}.`);
        }
        const positions = evenPositions(ids.length);
        const byId = new Map(board.groups.map((g) => [g.id, g]));
        const reordered = ids.map((id, i) => ({ ...byId.get(id), position: positions[i] }));
        return {
          patch: { groups: reordered },
          result: { groups: reordered.map((g) => ({ id: g.id, title: g.title })) },
        };
      });
    },

    async addColumn({ boardId, title, type, settings }) {
      return mutateBoard(boardId, (board) => {
        if (voteCapExceeded(type, board)) throw new McpUserError(VOTE_COLUMN_CAP_MESSAGE);
        const column = buildColumn({ title, type, settings, existingColumns: board.columns });
        return {
          patch: { columns: [...board.columns, column] },
          result: {
            id: column.id,
            title: column.title,
            type: column.type,
            ...labelSummary(column),
          },
        };
      });
    },

    async updateColumnSettings({ boardId, column, settings }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        if (target.migrating) throw new McpUserError(`Column "${target.title}" is changing type.`);
        if (!columnRegistry.has(target.type) || columnRegistry.isDerived(target.type)) {
          throw new McpUserError(`Column "${target.title}" cannot be changed here.`);
        }
        const { addLabels, ...rest } = settings;
        for (const key of ['labels', 'tags', 'type']) {
          if (key in rest) {
            throw new McpUserError(
              `"${key}" cannot be set directly. Add labels with "addLabels"; labels already in use are never removed.`,
            );
          }
        }
        let next = { ...target.settings, ...rest };
        if (addLabels !== undefined) next = addLabelsToSettings(target.type, next, addLabels);
        next = validSettings(target.type, next);
        const columns = board.columns.map((c) =>
          c.id === target.id ? { ...c, settings: next } : c,
        );
        return {
          patch: { columns },
          result: {
            id: target.id,
            title: target.title,
            type: target.type,
            ...labelSummary({ ...target, settings: next }),
          },
        };
      });
    },

    async renameColumn({ boardId, column, title }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        const next = title.trim();
        if (next === '') throw new McpUserError('The column title cannot be empty.');
        const clash = board.columns.find(
          (c) => c.id !== target.id && c.title.trim().toLowerCase() === next.toLowerCase(),
        );
        if (clash) throw new McpUserError(`A column called "${clash.title}" already exists.`);
        const columns = board.columns.map((c) => (c.id === target.id ? { ...c, title: next } : c));
        return { patch: { columns }, result: { id: target.id, title: next, was: target.title } };
      });
    },

    async deleteColumn({ boardId, column }) {
      const outcome = await mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        if (target.migrating) {
          throw new McpUserError(
            `Column "${target.title}" is changing type; try again in a minute.`,
          );
        }
        const patch = { columns: board.columns.filter((c) => c.id !== target.id) };
        // The lock goes with the column (as the web does), so no stale id stays in `columnLocks`.
        if ((board.columnLocks ?? []).includes(target.id)) {
          patch.columnLocks = board.columnLocks.filter((id) => id !== target.id);
        }
        const keepValues =
          columnRegistry.isDerived(target.type) ||
          columnRegistry.isServerManaged(target.type) ||
          target.required === true ||
          (board.requiredColumnIds ?? []).includes(target.id);
        return {
          patch,
          result: { id: target.id, title: target.title, type: target.type, keepValues },
        };
      });
      // Clear the stored cells, in chunks. Derived and server-managed columns store nothing the
      // client may write, and a required column's cells cannot be emptied until the server drops
      // its required flag (rules REQ-1); their leftovers are invisible without the column.
      let cleared = 0;
      let warning;
      if (!outcome.keepValues) {
        const withValue = (await itemsOf(boardId)).filter(
          (d) => d.data.values?.[outcome.id] !== undefined,
        );
        try {
          for (let at = 0; at < withValue.length; at += 200) {
            const chunk = withValue.slice(at, at + 200);
            await client.commit(
              chunk.map((d) => ({
                op: 'update',
                path: `boards/${boardId}/items/${d.id}`,
                set: { updatedAt: now(), updatedBy: uid },
                remove: [`values.${outcome.id}`],
              })),
            );
            cleared += chunk.length;
          }
        } catch {
          warning = `The column was deleted, but cleaning up its values stopped after ${cleared} of ${withValue.length} item(s); the rest keep invisible leftovers.`;
        }
      }
      return {
        deleted: outcome.id,
        title: outcome.title,
        valuesCleared: cleared,
        ...(warning ? { warning } : {}),
      };
    },

    async reorderColumns({ boardId, columns }) {
      return mutateBoard(boardId, (board) => {
        const ids = columns.map((ref) => findColumn(board, ref).id);
        if (new Set(ids).size !== ids.length) {
          throw new McpUserError('A column is listed twice; list every column exactly once.');
        }
        if (ids.length !== board.columns.length) {
          const missing = board.columns
            .filter((c) => !ids.includes(c.id))
            .map((c) => `"${c.title}"`);
          throw new McpUserError(`List every column of the board; missing: ${missing.join(', ')}.`);
        }
        const positions = evenPositions(ids.length);
        const byId = new Map(board.columns.map((c) => [c.id, c]));
        const reordered = ids.map((id, i) => ({ ...byId.get(id), position: positions[i] }));
        return {
          patch: { columns: reordered },
          result: { columns: reordered.map((c) => ({ id: c.id, title: c.title })) },
        };
      });
    },

    async setColumnLock({ boardId, column, locked }) {
      return mutateBoard(boardId, (board) => {
        const target = findColumn(board, column);
        const current = board.columnLocks ?? [];
        const isLocked = current.includes(target.id);
        const next = locked
          ? isLocked
            ? current
            : [...current, target.id]
          : current.filter((id) => id !== target.id);
        if (next.length > 200) throw new McpUserError('A board can lock at most 200 columns.');
        return {
          patch: { columnLocks: next },
          result: { id: target.id, title: target.title, locked, changed: isLocked !== locked },
        };
      });
    },

    async findItems({ boardId, name, group, where = [], limit = 25, offset = 0 }) {
      const { board } = await loadBoard(boardId, 'read');
      const groupId = group !== undefined ? findGroup(board, group).id : null;
      const filters = where.map((w) => {
        const column = findColumn(board, w.column);
        if (columnRegistry.isDerived(column.type) || columnRegistry.isServerManaged(column.type)) {
          throw new McpUserError(
            `Column "${column.title}" is a calculated or managed column, cannot filter on it.`,
          );
        }
        return { column, equals: w.equals };
      });
      const needle = name === undefined ? '' : name.trim().toLowerCase();
      const norm = (v) => String(v).trim().toLowerCase();
      const cellMatches = (column, stored, wanted) => {
        const cell = readableCell(column, stored);
        if (cell === null) return wanted === null;
        if (wanted === null) return false;
        const options = Array.isArray(cell)
          ? cell
          : typeof cell === 'string'
            ? [cell, ...cell.split(',')]
            : [cell];
        return options.some((o) => norm(o) === norm(wanted));
      };
      const groupTitle = new Map(board.groups.map((g) => [g.id, g.title]));
      const groupOrder = new Map(sortedByPosition(board.groups).map((g, i) => [g.id, i]));
      const found = (await itemsOf(boardId))
        .filter(
          (d) =>
            d.data.state === 'active' &&
            !d.data.parentItemId &&
            (groupId === null || d.data.groupId === groupId) &&
            (needle === '' ||
              String(d.data.name ?? '')
                .toLowerCase()
                .includes(needle)) &&
            filters.every((f) => cellMatches(f.column, d.data.values?.[f.column.id], f.equals)),
        )
        .sort(
          (a, b) =>
            (groupOrder.get(a.data.groupId) ?? Infinity) -
              (groupOrder.get(b.data.groupId) ?? Infinity) ||
            (a.data.groupId < b.data.groupId ? -1 : a.data.groupId > b.data.groupId ? 1 : 0) ||
            (a.data.position < b.data.position ? -1 : a.data.position > b.data.position ? 1 : 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      const page = found.slice(offset, offset + limit).map((d) => ({
        id: d.id,
        seq: d.data.seq ?? null,
        name: d.data.name,
        group: groupTitle.get(d.data.groupId) ?? d.data.groupId,
        values: Object.fromEntries(
          board.columns.flatMap((c) => {
            const cell = readableCell(c, d.data.values?.[c.id]);
            return cell === null ? [] : [[c.title, cell]];
          }),
        ),
      }));
      return {
        total: found.length,
        offset,
        shown: page.length,
        items: page,
        ...(offset + page.length < found.length ? { nextOffset: offset + page.length } : {}),
      };
    },

    // ---- items -------------------------------------------------------------------------------
    async createItems({ boardId, items }) {
      if (items.length === 0 || items.length > MAX_ITEMS_PER_CALL) {
        throw new McpUserError(`Create between 1 and ${MAX_ITEMS_PER_CALL} items per call.`);
      }
      const loaded = await loadBoard(boardId, 'edit');
      const orderedGroups = sortedByPosition(loaded.board.groups);
      const existing = await itemsOf(boardId, ['groupId', 'position', 'parentItemId']);
      // Last position per group, advanced as this call appends to it.
      const last = new Map();
      for (const doc of existing) {
        if (doc.data.parentItemId) continue;
        const prev = last.get(doc.data.groupId);
        if (prev === undefined || doc.data.position > prev)
          last.set(doc.data.groupId, doc.data.position);
      }
      const writes = [];
      const created = [];
      for (const input of items) {
        const group = input.group ? findGroup(loaded.board, input.group) : orderedGroups[0];
        const values = await convertValues(loaded, input.values);
        const position = positionAfter(last.has(group.id) ? [last.get(group.id)] : []);
        last.set(group.id, position);
        const id = newDocId();
        const data = buildItemDoc({
          uid,
          name: input.name,
          groupId: group.id,
          position,
          values,
          now: now(),
        });
        writes.push({
          op: 'set',
          path: `boards/${boardId}/items/${id}`,
          data,
          precondition: { exists: false },
        });
        created.push({ id, name: data.name, group: group.title });
      }
      await client.commit(writes);
      return { created };
    },

    async updateItem({ boardId, itemId, name, group, values }) {
      const loaded = await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const isSub = Boolean(item.parentItemId);
      const columns = columnsForItem(loaded.board, item);
      const cells = await convertValues(loaded, values, columns);
      assertRequiredKept(loaded, columns, item, cells);
      let groupId;
      let position;
      if (group !== undefined && isSub) {
        throw new McpUserError("A subitem stays in its parent's group; move the parent instead.");
      }
      if (group !== undefined) {
        groupId = findGroup(loaded.board, group).id;
        if (groupId !== item.groupId) {
          const docs = await itemsOf(boardId, ['groupId', 'position', 'parentItemId']);
          const positions = docs
            .filter((d) => d.id !== itemId && !d.data.parentItemId && d.data.groupId === groupId)
            .map((d) => d.data.position);
          position = positionAfter(positions);
        } else {
          groupId = undefined;
        }
      }
      if (name === undefined && groupId === undefined && Object.keys(cells).length === 0) {
        throw new McpUserError('Nothing to change: give a name, a group or values.');
      }
      const { set, remove } = buildItemPatch({
        uid,
        now: now(),
        name,
        groupId,
        position,
        cells,
      });
      const writes = [{ op: 'update', path: `boards/${boardId}/items/${itemId}`, set, remove }];
      if (groupId !== undefined) {
        // Subitems follow their parent into the group, like the web's move (rules: same group).
        for (const sub of await subitemDocs(boardId, itemId, { active: false })) {
          writes.push({
            op: 'update',
            path: `boards/${boardId}/items/${sub.id}`,
            set: { groupId, updatedAt: ts(now()), updatedBy: uid },
            remove: [],
          });
        }
      }
      await client.commit(writes);
      return {
        id: itemId,
        updated: [...Object.keys(set), ...remove].filter((k) => !k.startsWith('updated')),
      };
    },

    async restoreItem({ boardId, itemId }) {
      const loaded = await loadBoard(boardId, 'edit');
      assertId(itemId, 'itemId');
      const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
      if (!item) throw new McpUserError(`Item "${itemId}" was not found on this board.`);
      if (item.state === 'active') throw new McpUserError(`Item "${itemId}" is already active.`);
      if (!['archived', 'deleted'].includes(item.state)) {
        throw new McpUserError(`Item "${itemId}" is ${item.state} and cannot be restored.`);
      }
      const groups = sortedByPosition(loaded.board.groups);
      let groupId = item.groupId;
      if (item.parentItemId) {
        const parent = await client.getDoc(`boards/${boardId}/items/${item.parentItemId}`);
        if (!parent || parent.state !== 'active') {
          throw new McpUserError('Restore the parent item first; a subitem comes back under it.');
        }
        groupId = parent.groupId;
      } else if (!groups.some((g) => g.id === groupId)) {
        groupId = groups[0].id; // the group was deleted meanwhile
      }
      const restore = (id, extra = {}) => ({
        op: 'update',
        path: `boards/${boardId}/items/${id}`,
        set: { state: 'active', deletedAt: null, updatedAt: now(), updatedBy: uid, ...extra },
      });
      const writes = [restore(itemId, groupId !== item.groupId ? { groupId } : {})];
      if (!item.parentItemId) {
        // Subitems that went away with the parent (same state) come back with it.
        for (const sub of await subitemDocs(boardId, itemId, { active: false })) {
          if (sub.data.state !== item.state) continue;
          // A subitem trashed on its own, before the parent, stays in the trash.
          if (item.state === 'deleted' && sub.data.deletedAt && item.deletedAt) {
            if (millis(sub.data.deletedAt) < millis(item.deletedAt)) continue;
          }
          writes.push(restore(sub.id, { groupId }));
        }
      }
      await client.commit(writes);
      return {
        id: itemId,
        restoredFrom: item.state,
        group: groups.find((g) => g.id === groupId)?.title ?? groupId,
        subitemsAlso: writes.length - 1,
      };
    },

    async moveItem({ boardId, itemId, group, position, beforeItemId, afterItemId }) {
      const loaded = await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const placements = [position, beforeItemId, afterItemId].filter((p) => p !== undefined);
      if (placements.length > 1) {
        throw new McpUserError('Give one of position, beforeItemId or afterItemId, not several.');
      }
      if (position !== undefined && position !== 'first' && position !== 'last') {
        throw new McpUserError('position is "first" or "last".');
      }
      const isSub = Boolean(item.parentItemId);
      if (isSub && group !== undefined) {
        throw new McpUserError("A subitem stays in its parent's group; move the parent instead.");
      }
      const targetGroupId =
        group !== undefined && !isSub ? findGroup(loaded.board, group).id : item.groupId;
      const docs = await itemsOf(boardId, ['groupId', 'position', 'parentItemId', 'state']);
      const siblings = docs
        .filter(
          (d) =>
            d.id !== itemId &&
            d.data.state === 'active' &&
            (isSub
              ? d.data.parentItemId === item.parentItemId
              : !d.data.parentItemId && d.data.groupId === targetGroupId),
        )
        .sort((a, b) => (a.data.position < b.data.position ? -1 : 1));
      const anchorId = beforeItemId ?? afterItemId;
      let before = null;
      let after = null;
      if (anchorId !== undefined) {
        assertId(anchorId, beforeItemId !== undefined ? 'beforeItemId' : 'afterItemId');
        const at = siblings.findIndex((d) => d.id === anchorId);
        if (at < 0) {
          throw new McpUserError(
            `Item "${anchorId}" is not an active ${isSub ? 'sibling subitem' : 'item of the target group'}.`,
          );
        }
        const edge = beforeItemId !== undefined ? at : at + 1; // index of the first item after the gap
        before = siblings[edge - 1]?.data.position ?? null;
        after = siblings[edge]?.data.position ?? null;
      } else if (position === 'first') {
        after = siblings[0]?.data.position ?? null;
      } else {
        before = siblings.at(-1)?.data.position ?? null;
      }
      const newPosition = positionBetween(before, after);
      const groupChanged = targetGroupId !== item.groupId;
      const writes = [
        {
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {
            ...(groupChanged ? { groupId: targetGroupId } : {}),
            position: newPosition,
            updatedAt: ts(now()),
            updatedBy: uid,
          },
          remove: [],
        },
      ];
      if (groupChanged) {
        // Subitems follow their parent into the group (rules: same group).
        for (const sub of await subitemDocs(boardId, itemId, { active: false })) {
          writes.push({
            op: 'update',
            path: `boards/${boardId}/items/${sub.id}`,
            set: { groupId: targetGroupId, updatedAt: ts(now()), updatedBy: uid },
            remove: [],
          });
        }
      }
      await client.commit(writes);
      const title = loaded.board.groups.find((g) => g.id === targetGroupId)?.title ?? targetGroupId;
      return { id: itemId, group: title, position: newPosition, subitemsAlso: writes.length - 1 };
    },

    async getItemDescription({ boardId, itemId }) {
      await loadBoard(boardId, 'view');
      const item = await loadItem(boardId, itemId);
      const description = item.description ?? null;
      return {
        id: itemId,
        name: item.name,
        hasDescription: description !== null,
        markdown: description ? docToMarkdown(description.doc) : '',
        text: description?.text ?? '',
        richNodes: description ? richNodeTypes(description.doc) : [],
      };
    },

    async setItemDescription({ boardId, itemId, markdown, mode = 'replace', allowOverwriteRich }) {
      if (markdown.length > MAX_MARKDOWN_CHARS) {
        throw new McpUserError(`The description is over ${MAX_MARKDOWN_CHARS} characters.`);
      }
      await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const existing = item.description?.doc ?? null;
      const rich = existing ? richNodeTypes(existing) : [];
      const added = markdownToDoc(markdown);
      let doc = added;
      if (mode === 'append') {
        doc = appendDoc(existing, added);
      } else if (rich.length > 0 && !allowOverwriteRich) {
        throw new McpUserError(
          `The item's description contains ${rich.join(', ')}, which this tool cannot write back. ` +
            'Use mode "append" to keep it, or pass allowOverwriteRich: true to replace it anyway.',
        );
      }
      const description = toStoredDescription(doc);
      // The web writes the whole `description` value (null when empty); the rules check its shape.
      await client.commit([
        {
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: { description, updatedAt: ts(now()), updatedBy: uid },
          remove: [],
        },
      ]);
      return {
        id: itemId,
        mode,
        cleared: description === null,
        chars: description?.text.length ?? 0,
      };
    },

    async setItemState({ boardId, itemId, state }) {
      await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const targets = [{ id: itemId }];
      // Subitems follow their parent into the archive or the trash (the web does the same).
      if (!item.parentItemId) targets.push(...(await subitemDocs(boardId, itemId)));
      await client.commit(
        targets.map((t) => ({
          op: 'update',
          path: `boards/${boardId}/items/${t.id}`,
          set: {
            state,
            deletedAt: state === 'deleted' ? now() : null,
            updatedAt: now(),
            updatedBy: uid,
          },
        })),
      );
      return { id: itemId, state, subitemsAlso: targets.length - 1 };
    },

    // ---- updates (comments) and replies ----------------------------------------------------------
    async listUpdates({ boardId, itemId, limit = 20, includeReplies = true }) {
      await loadBoard(boardId, 'view');
      await loadItem(boardId, itemId);
      const base = `boards/${boardId}/items/${itemId}/updates`;
      const posts = (await client.listAllDocs(base))
        .sort((a, b) => +b.data.createdAt - +a.data.createdAt)
        .slice(0, limit);
      const updates = [];
      for (const post of posts) {
        const shaped = shapePost(post.id, post.data);
        shaped.repliesCount = post.data.repliesCount ?? 0;
        if (includeReplies && shaped.repliesCount > 0) {
          const replies = await client.listAllDocs(`${base}/${post.id}/replies`);
          shaped.replies = replies
            .sort((a, b) => +a.data.createdAt - +b.data.createdAt)
            .map((r) => shapePost(r.id, r.data));
        }
        updates.push(shaped);
      }
      return { itemId, updates, shown: updates.length };
    },

    async addUpdate({ boardId, itemId, text }) {
      const loaded = await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      const body = buildRichBody(text, await mentionResolver(loaded));
      const profile = await authorProfile();
      const id = newDocId();
      const doc = buildUpdateDoc({
        uid,
        itemId,
        id,
        ...body,
        authorName: profile.displayName,
        authorPhotoUrl: profile.photoURL,
        now: now(),
      });
      // The post and the item's counter (the row bubble) land together, like the web does.
      await client.commit([
        {
          op: 'set',
          path: `boards/${boardId}/items/${itemId}/updates/${id}`,
          data: doc,
          precondition: { exists: false },
        },
        {
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {},
          increment: { updatesCount: 1 },
        },
      ]);
      return { id, itemId, mentioned: body.mentions };
    },

    async addReply({ boardId, itemId, updateId, text }) {
      const loaded = await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      await loadUpdate(boardId, itemId, updateId);
      const body = buildRichBody(text, await mentionResolver(loaded));
      const profile = await authorProfile();
      const id = newDocId();
      const doc = buildReplyDoc({
        uid,
        updateId,
        id,
        ...body,
        authorName: profile.displayName,
        authorPhotoUrl: profile.photoURL,
        now: now(),
      });
      const parent = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
      await client.commit([
        { op: 'set', path: `${parent}/replies/${id}`, data: doc, precondition: { exists: false } },
        { op: 'update', path: parent, set: {}, increment: { repliesCount: 1 } },
      ]);
      return { id, updateId, mentioned: body.mentions };
    },

    async editUpdate({ boardId, itemId, updateId, replyId, text }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      const { target, path } = await loadUpdate(boardId, itemId, updateId, replyId);
      if (target.authorId !== uid) {
        throw new McpUserError('You can only edit your own updates and replies.');
      }
      if (target.attachments?.length) {
        throw new McpUserError('This post has attachments; edit it in Atrium.');
      }
      const body = buildRichBody(text); // no mention chips: the app never notifies on edit
      await client.commit([
        {
          op: 'update',
          path,
          set: { content: body.content, contentDoc: body.contentDoc, updatedAt: ts(now()) },
          remove: [],
        },
      ]);
      return { id: replyId ?? updateId, edited: true };
    },

    async deleteUpdate({ boardId, itemId, updateId, replyId }) {
      await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const { update, target, path } = await loadUpdate(boardId, itemId, updateId, replyId);
      if (target.authorId !== uid) {
        throw new McpUserError('You can only delete your own updates and replies.');
      }
      const writes = [{ op: 'delete', path }];
      // Counters only move down while positive (the rules refuse a decrement from 0).
      if (replyId !== undefined) {
        if ((update.repliesCount ?? 0) > 0) {
          writes.push({
            op: 'update',
            path: `boards/${boardId}/items/${itemId}/updates/${updateId}`,
            set: {},
            increment: { repliesCount: -1 },
          });
        }
      } else if ((item.updatesCount ?? 0) > 0) {
        writes.push({
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {},
          increment: { updatesCount: -1 },
        });
      }
      await client.commit(writes);
      return { deleted: replyId ?? updateId };
    },

    // ---- votes ----------------------------------------------------------------------------------
    async setVote({ boardId, itemId, column, voted }) {
      const loaded = await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const voteColumns = columnsForItem(loaded.board, item).filter((c) => c.type === 'vote');
      let target;
      if (column === undefined) {
        if (voteColumns.length !== 1) {
          const known = voteColumns.map((c) => `"${c.title}"`).join(', ') || 'none';
          throw new McpUserError(
            voteColumns.length === 0
              ? 'This item has no vote column.'
              : `Give column: this item has several vote columns (${known}).`,
          );
        }
        target = voteColumns[0];
      } else {
        target = findColumn({ columns: voteColumns }, column);
      }
      assertWritableColumn(loaded, target);
      const path = `boards/${boardId}/items/${itemId}`;
      for (let attempt = 0; ; attempt += 1) {
        const meta = await client.getDocMeta(path);
        if (!meta || meta.data.state !== 'active') {
          throw new McpUserError(`Item "${itemId}" was not found on this board.`);
        }
        const raw = meta.data.values?.[target.id]?.votersIds;
        const current = Array.isArray(raw) ? raw : [];
        const has = current.includes(uid);
        const result = (votes, changed) => ({
          itemId,
          column: target.title,
          votes,
          voted,
          changed,
        });
        if (has === voted) return result(current.length, false);
        const next = voted ? [...current, uid] : current.filter((u) => u !== uid);
        try {
          await client.commit([
            {
              op: 'update',
              path,
              set: {
                [`values.${target.id}`]: { votersIds: next },
                updatedAt: ts(now()),
                updatedBy: uid,
              },
              remove: [],
              precondition: { updateTime: meta.updateTime },
            },
          ]);
          return result(next.length, true);
        } catch (error) {
          const raced = error?.status === 409 || error?.status === 400;
          if (!raced || attempt >= 1) throw error;
        }
      }
    },

    // ---- board lifecycle ------------------------------------------------------------------------
    async renameBoard({ boardId, name, description }) {
      if (name === undefined && description === undefined) {
        throw new McpUserError('Give a name or a description to change.');
      }
      const patch = {};
      if (name !== undefined) {
        const trimmed = String(name).trim();
        if (trimmed.length < 1 || trimmed.length > 120) {
          throw new McpUserError('A board name has 1 to 120 characters.');
        }
        patch.name = trimmed;
      }
      if (description !== undefined) {
        if (String(description).length > 1000) {
          throw new McpUserError('A board description has at most 1000 characters.');
        }
        patch.description = String(description);
      }
      return mutateBoard(
        boardId,
        (board) => ({
          patch,
          result: {
            id: boardId,
            name: patch.name ?? board.name,
            description: patch.description ?? board.description ?? '',
            was: { name: board.name, description: board.description ?? '' },
          },
        }),
        { need: 'edit' },
      );
    },

    async setBoardState({ boardId, to }) {
      const from = {
        archived: ['active'],
        deleted: ['active', 'archived'],
        active: ['archived', 'deleted'],
      }[to];
      return mutateBoard(
        boardId,
        async (board) => {
          if (!from.includes(board.state)) {
            throw new McpUserError(
              board.state === to
                ? `Board "${boardId}" is already ${to}.`
                : `Board "${boardId}" is ${board.state}; only a board that is ${from.join(' or ')} can become ${to}.`,
            );
          }
          const patch = { state: to, deletedAt: to === 'deleted' ? now() : null };
          if (to === 'active' && board.folderId) {
            const folder = await client.getDoc(
              `workspaces/${board.workspaceId}/folders/${board.folderId}`,
            );
            if (!folder) patch.folderId = null;
          }
          return { patch, result: { id: boardId, name: board.name, state: to, was: board.state } };
        },
        {
          need: 'owner',
          states: ['active', 'archived', 'deleted'],
          ownerMessage: 'Archiving, trashing or restoring a board needs the board owner role.',
        },
      );
    },

    async setUpdateLike({ boardId, itemId, updateId, replyId, liked }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      assertId(updateId, 'updateId');
      if (replyId !== undefined) assertId(replyId, 'replyId');
      const base = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
      const path = replyId === undefined ? base : `${base}/replies/${replyId}`;
      for (let attempt = 0; ; attempt += 1) {
        const meta = await client.getDocMeta(path);
        if (!meta) {
          throw new McpUserError(
            replyId === undefined
              ? `Update "${updateId}" was not found on this item.`
              : `Reply "${replyId}" was not found on this update.`,
          );
        }
        const current = Array.isArray(meta.data.likes) ? meta.data.likes : [];
        const has = current.includes(uid);
        if (has === liked) {
          return { id: replyId ?? updateId, liked, likes: current.length, changed: false };
        }
        const next = liked ? [...current, uid] : current.filter((u) => u !== uid);
        try {
          await client.commit([
            {
              op: 'update',
              path,
              set: { likes: next },
              remove: [],
              precondition: { updateTime: meta.updateTime },
            },
          ]);
          return { id: replyId ?? updateId, liked, likes: next.length, changed: true };
        } catch (error) {
          const raced = error?.status === 409 || error?.status === 400;
          if (!raced || attempt >= 1) throw error;
        }
      }
    },

    // ---- subitems -------------------------------------------------------------------------------
    async listSubitems({ boardId, itemId }) {
      const { board } = await loadBoard(boardId, 'view');
      const parent = await loadItem(boardId, itemId);
      if (parent.parentItemId) throw new McpUserError('A subitem has no subitems of its own.');
      const columns = subitemColumnsOf(board);
      const titles = new Map(columns.map((c) => [c.id, c.title]));
      const subs = await subitemDocs(boardId, itemId);
      return {
        itemId,
        columns: sortedByPosition(columns).map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          ...labelSummary(c),
        })),
        subitems: subs.map((d) => ({
          id: d.id,
          seq: d.data.seq ?? null,
          name: d.data.name,
          values: Object.fromEntries(
            columns.flatMap((c) => {
              const cell = readableCell(c, d.data.values?.[c.id]);
              return cell === null ? [] : [[titles.get(c.id), cell]];
            }),
          ),
        })),
      };
    },

    async createSubitems({ boardId, itemId, subitems }) {
      if (subitems.length === 0 || subitems.length > MAX_ITEMS_PER_CALL) {
        throw new McpUserError(`Create between 1 and ${MAX_ITEMS_PER_CALL} subitems per call.`);
      }
      const loaded = await loadBoard(boardId, 'edit');
      const parent = await loadItem(boardId, itemId);
      if (parent.parentItemId) {
        throw new McpUserError('Subitems are one level deep: pick a top-level item as the parent.');
      }
      const columns = subitemColumnsOf(loaded.board);
      const positions = sortedPositions(await subitemDocs(boardId, itemId, { active: false }));
      const writes = [];
      const created = [];
      for (const input of subitems) {
        const values = await convertValues(loaded, input.values, columns);
        const position = positionAfter(positions);
        positions.push(position);
        const id = newDocId();
        const data = buildItemDoc({
          uid,
          name: input.name,
          groupId: parent.groupId,
          position,
          values,
          now: now(),
          parentItemId: itemId,
        });
        writes.push({
          op: 'set',
          path: `boards/${boardId}/items/${id}`,
          data,
          precondition: { exists: false },
        });
        created.push({ id, name: data.name });
      }
      await client.commit(writes);
      return { created };
    },

    // ---- more item operations --------------------------------------------------------------------
    async duplicateItem({ boardId, itemId }) {
      const loaded = await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const isSub = Boolean(item.parentItemId);
      const unwritable = (columns) =>
        new Set(
          columns
            .filter(
              (c) =>
                columnRegistry.isDerived(c.type) ||
                columnRegistry.isServerManaged(c.type) ||
                ((loaded.board.columnLocks ?? []).includes(c.id) && loaded.role !== 'owner'),
            )
            .map((c) => c.id),
        );
      const copyValues = (values = {}, columns) => {
        const skip = unwritable(columns);
        return Object.fromEntries(Object.entries(values).filter(([id]) => !skip.has(id)));
      };
      const docs = await itemsOf(boardId);
      const siblings = docs.filter((d) =>
        isSub
          ? d.data.parentItemId === item.parentItemId
          : !d.data.parentItemId && d.data.groupId === item.groupId,
      );
      const position = positionRightAfter(sortedPositions(siblings), item.position);
      const id = newDocId();
      const writes = [
        {
          op: 'set',
          path: `boards/${boardId}/items/${id}`,
          data: buildItemDoc({
            uid,
            name: `${item.name} (copy)`.slice(0, 500),
            groupId: item.groupId,
            position,
            values: copyValues(item.values, columnsForItem(loaded.board, item)),
            now: now(),
            parentItemId: item.parentItemId ?? null,
          }),
          precondition: { exists: false },
        },
      ];
      let subitems = 0;
      if (!isSub) {
        const children = docs
          .filter((d) => d.data.parentItemId === itemId && d.data.state === 'active')
          .sort((a, b) => (a.data.position < b.data.position ? -1 : 1));
        for (const child of children) {
          writes.push({
            op: 'set',
            path: `boards/${boardId}/items/${newDocId()}`,
            data: buildItemDoc({
              uid,
              name: child.data.name,
              groupId: item.groupId,
              position: child.data.position,
              values: copyValues(child.data.values, subitemColumnsOf(loaded.board)),
              now: now(),
              parentItemId: id,
            }),
            precondition: { exists: false },
          });
          subitems += 1;
        }
      }
      await client.commit(writes);
      return { id, name: writes[0].data.name, subitems };
    },

    async moveItemToBoard({
      boardId,
      itemId,
      targetBoardId,
      group,
      dryRun = false,
      allowDataLoss = false,
    }) {
      const source = await loadBoard(boardId, 'edit');
      assertId(targetBoardId, 'targetBoardId');
      if (targetBoardId === boardId) {
        throw new McpUserError('Pick a different board: the item is already on this one.');
      }
      const target = await loadBoard(targetBoardId, 'read');
      // A viewer on the target reads as "not found", like a board outside the memberships.
      if (!EDIT_ROLES.includes(target.role)) {
        throw new McpUserError(`Board "${targetBoardId}" was not found in your workspaces.`);
      }
      if (target.workspaceId !== source.workspaceId) {
        throw new McpUserError("Moving to another workspace isn't supported yet.");
      }
      assertId(itemId, 'itemId');
      const meta = await client.getDocMeta(`boards/${boardId}/items/${itemId}`);
      if (!meta) throw new McpUserError(`Item "${itemId}" was not found on this board.`);
      const item = meta.data;
      if (item.state !== 'active') throw new McpUserError(`Item "${itemId}" is ${item.state}.`);
      if (item.parentItemId) {
        throw new McpUserError('Move its parent instead: a subitem cannot be moved on its own.');
      }
      const targetGroup = group
        ? findGroup(target.board, group)
        : sortedByPosition(target.board.groups)[0];
      if (!targetGroup) throw new McpUserError('The target board has no groups.');

      const subs = await subitemDocs(boardId, itemId);
      if (subs.length > MAX_MOVED_SUBITEMS) {
        throw new McpUserError(
          `The item has ${subs.length} subitems; moving more than ${MAX_MOVED_SUBITEMS} at once is not supported.`,
        );
      }

      const ctx = await cellContext(target);
      const dropped = [];
      const copied = [];
      const mapValues = (values = {}, fromColumns, toColumns, label) => {
        const cells = {};
        const used = new Set();
        const drop = (column, reason) =>
          dropped.push({ column: label ? `${label}: ${column.title}` : column.title, reason });
        for (const column of fromColumns) {
          const value = values[column.id];
          if (value === undefined || value === null) continue;
          if (columnRegistry.isDerived(column.type)) continue; // nothing is stored
          if (isColumnValueEmpty(column.type, value)) continue;
          if (columnRegistry.isServerManaged(column.type)) {
            drop(column, 'cannot be copied yet');
            continue;
          }
          if (column.type === 'dependency') {
            drop(column, 'points at items of the source board');
            continue;
          }
          let match = toColumns.find((c) => c.id === column.id && c.type === column.type);
          if (!match) {
            const same = toColumns.filter(
              (c) => c.type === column.type && norm(c.title) === norm(column.title),
            );
            if (same.length === 1) match = same[0];
          }
          if (!match) {
            drop(column, 'no matching column');
            continue;
          }
          if (used.has(match.id)) {
            drop(column, 'the matching column is already filled by another column');
            continue;
          }
          if (match.migrating) {
            drop(column, 'the matching column is changing type');
            continue;
          }
          if ((target.board.columnLocks ?? []).includes(match.id) && target.role !== 'owner') {
            drop(column, 'the matching column is locked to board owners');
            continue;
          }
          try {
            const mapped = mapOneValue(column, match, value, ctx, (reason) => drop(column, reason));
            if (mapped === undefined) continue;
            cells[match.id] = mapped;
            used.add(match.id);
            copied.push({
              from: label ? `${label}: ${column.title}` : column.title,
              to: match.title,
            });
          } catch (error) {
            if (!(error instanceof McpUserError)) throw error;
            drop(column, error.message);
          }
        }
        return cells;
      };

      const itemCells = mapValues(
        item.values,
        columnsForItem(source.board, item),
        columnsForItem(target.board, { parentItemId: null }),
      );
      const subCells = subs.map((sub) =>
        mapValues(
          sub.data.values,
          columnsForItem(source.board, sub.data),
          subitemColumnsOf(target.board),
          `subitem "${sub.data.name}"`,
        ),
      );
      if (item.description) dropped.push({ column: 'description', reason: 'not copied' });

      const countUpdates = async (boardItemId, doc) =>
        doc.updatesCount ??
        (await client.listAllDocs(`boards/${boardId}/items/${boardItemId}/updates`)).length;
      let updatesLeft = await countUpdates(itemId, item);
      for (const sub of subs) updatesLeft += await countUpdates(sub.id, sub.data);
      let files = 0;
      for (const [, value] of Object.entries(item.values ?? {})) {
        if (Array.isArray(value?.files)) files += value.files.length;
      }

      const needsAllowDataLoss = dropped.length > 0 || updatesLeft > 0;
      const base = {
        targetBoardId,
        group: targetGroup.title,
        copied,
        dropped,
        subitems: subs.length,
        updatesLeftOnSource: updatesLeft,
        sourceState: 'deleted',
      };
      if (dryRun) {
        return { ...base, newItemId: null, dryRun: true, needsAllowDataLoss };
      }
      if (needsAllowDataLoss && !allowDataLoss) {
        const lines = dropped.map((d) => `${d.column} (${d.reason})`);
        throw new McpUserError(
          'Moving would leave things behind. ' +
            (lines.length ? `Not copied: ${lines.join('; ')}. ` : '') +
            `Files on the item: ${files}. Updates on the item: ${updatesLeft} (they stay with the trashed original). ` +
            'Call again with allowDataLoss: true to move anyway, or dryRun: true to preview.',
        );
      }

      const topLevel = (await itemsOf(targetBoardId, ['groupId', 'position', 'parentItemId']))
        .filter((d) => !d.data.parentItemId && d.data.groupId === targetGroup.id)
        .map((d) => d.data.position);
      const newId = newDocId();
      const writes = [
        {
          op: 'set',
          path: `boards/${targetBoardId}/items/${newId}`,
          data: buildItemDoc({
            uid,
            name: item.name,
            groupId: targetGroup.id,
            position: positionAfter(topLevel),
            values: itemCells,
            now: now(),
          }),
          precondition: { exists: false },
        },
      ];
      subs.forEach((sub, index) => {
        writes.push({
          op: 'set',
          path: `boards/${targetBoardId}/items/${newDocId()}`,
          data: buildItemDoc({
            uid,
            name: sub.data.name,
            groupId: targetGroup.id,
            position: sub.data.position,
            values: subCells[index],
            now: now(),
            parentItemId: newId,
          }),
          precondition: { exists: false },
        });
      });
      for (const [id, updateTime] of [
        [itemId, meta.updateTime],
        ...subs.map((s) => [s.id, s.updateTime]),
      ]) {
        writes.push({
          op: 'update',
          path: `boards/${boardId}/items/${id}`,
          set: { state: 'deleted', deletedAt: now(), updatedAt: now(), updatedBy: uid },
          precondition: { updateTime },
        });
      }
      await client.commit(writes);
      return { ...base, newItemId: newId, dryRun: false, needsAllowDataLoss };
    },

    async getActivity({ boardId, itemId, limit = 30 }) {
      await loadBoard(boardId, 'view');
      if (itemId !== undefined) assertId(itemId, 'itemId');
      const events = (await client.listAllDocs(`boards/${boardId}/activity`))
        .filter(
          (e) => itemId === undefined || e.data.itemId === itemId || e.data.parentItemId === itemId,
        )
        .sort((a, b) => +b.data.createdAt - +a.data.createdAt)
        .slice(0, limit);
      return {
        events: events.map(({ id, data: e }) => ({
          id,
          at: iso(e.createdAt),
          kind: e.kind,
          actor: e.actorName,
          itemId: e.itemId,
          item: e.itemName,
          column: e.columnTitle,
          group: e.groupTitle,
          from: e.data?.fromText,
          to: e.data?.toText,
          snippet: e.data?.snippet,
        })),
      };
    },

    async listMembers({ boardId, workspaceId } = {}) {
      if (boardId !== undefined) {
        const { board } = await loadBoard(boardId, 'view');
        return { workspaceId: board.workspaceId, members: await boardMembers(board) };
      }
      const ws = await resolveWorkspace(workspaceId);
      const members = [];
      for (const memberUid of ws.memberUids) {
        const profile = await profileOf(memberUid);
        members.push({
          uid: memberUid,
          name: profile.displayName || profile.email || memberUid,
          email: profile.email ?? null,
          workspaceRole: ws.roles[memberUid] ?? null,
          me: memberUid === uid,
        });
      }
      return { workspaceId: ws.id, members };
    },

    async findMember({ email, workspaceId }) {
      const wanted = String(email).trim().toLowerCase();
      if (!wanted.includes('@')) throw new McpUserError('Give a full email address.');
      const ws = await resolveWorkspace(workspaceId);
      // Only this workspace's members are ever looked at, so a person elsewhere in Atrium is
      // indistinguishable from an address that has no account.
      for (const memberUid of ws.memberUids) {
        const profile = await profileOf(memberUid);
        if (typeof profile.email === 'string' && profile.email.trim().toLowerCase() === wanted) {
          return {
            workspaceId: ws.id,
            found: true,
            member: {
              uid: memberUid,
              name: profile.displayName || profile.email || memberUid,
              email: profile.email,
              workspaceRole: ws.roles[memberUid] ?? null,
              me: memberUid === uid,
            },
          };
        }
      }
      return { workspaceId: ws.id, found: false };
    },

    /**
     * Checks the actor against the database; used at startup. The user must exist, and, with a
     * workspace filter, be a member of that workspace. Returns `{ uid, workspaces }`.
     */
    async verify() {
      const profile = await client.getDoc(`users/${uid}`);
      if (!profile) throw new McpUserError(`User "${uid}" does not exist in Atrium.`);
      if (workspaceFilter) await workspace(workspaceFilter);
      return { uid, workspaces: await listWorkspaces() };
    },
  };
}
