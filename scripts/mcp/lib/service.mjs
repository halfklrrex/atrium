// The connector's tool logic, free of any MCP wiring. Every function takes plain arguments and returns
// plain JSON, so it can be tested against an in-memory Firestore. See docs/mcp-connector.md.
//
// Safety rules enforced here (the Admin-style REST client bypasses security rules, so we do it):
//   - only boards of `config.workspaceId`, only `state = active`, only where the configured user has
//     a role (structure changes need `owner`, item changes `editor` or `owner`);
//   - never writes derivedColumnIds / serverManagedColumnIds / requiredColumnIds / seq / boardSeq / activity / notifications;
//   - no hard deletes; only the documents of one board are ever touched.
import {
  boardRoleFromWorkspaceRole,
  columnRegistry,
  columnsForItem,
  columnsForSubitems,
  hasLegacySubitemColumns,
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
  ts,
  newDocId,
  positionAfter,
  validSettings,
} from './builders.mjs';
import { McpUserError, assertId } from './errors.mjs';
import { findColumn, findGroup, sortedByPosition } from './refs.mjs';
import { readableCell, toValidCell } from './values.mjs';
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

const EDIT_ROLES = ['owner', 'editor'];

function labelSummary(column) {
  const s = column.settings ?? {};
  if (column.type === 'status')
    return { labels: s.labels.map((l) => ({ label: l.label, color: l.color })) };
  if (column.type === 'dropdown') return { options: s.labels.map((l) => l.label) };
  if (column.type === 'tags') return { tags: (s.tags ?? []).map((t) => t.name) };
  if (column.type === 'rating') return { limit: s.limit, symbol: s.symbol };
  return {};
}

export function createService({ client, config, now = () => new Date() }) {
  let workspaceCache;
  let profileCache;

  /** The workspace doc, checked once: the configured user must be a non-viewer member. */
  async function workspace() {
    workspaceCache ??= (async () => {
      const ws = await client.getDoc(`workspaces/${config.workspaceId}`);
      if (!ws) throw new McpUserError('The configured workspace does not exist.');
      const role = ws.roles?.[config.uid];
      if (!(ws.memberIds ?? []).includes(config.uid) || !role) {
        throw new McpUserError('The configured user is not a member of the configured workspace.');
      }
      if (role === 'viewer') {
        throw new McpUserError('The configured user is only a viewer of the workspace.');
      }
      return { role, roles: ws.roles ?? {}, memberUids: ws.memberIds ?? [] };
    })();
    try {
      return await workspaceCache;
    } catch (error) {
      workspaceCache = undefined;
      throw error;
    }
  }

  async function roleOn(board) {
    const direct = board.access?.[config.uid];
    if (direct) return direct;
    // Main boards are open to workspace members through their workspace role.
    if (board.kind === 'main') return boardRoleFromWorkspaceRole((await workspace()).role);
    return null;
  }

  /** Loads a board and applies the safety checks. `need` is 'read', 'edit' or 'owner'. */
  async function loadBoard(boardId, need = 'edit') {
    assertId(boardId, 'boardId');
    await workspace();
    const meta = await client.getDocMeta(`boards/${boardId}`);
    // Same message for "missing" and "someone else's": do not reveal other workspaces.
    const notFound = new McpUserError(
      `Board "${boardId}" was not found in the configured workspace.`,
    );
    if (!meta || meta.data.workspaceId !== config.workspaceId) throw notFound;
    if (meta.data.state !== 'active') {
      throw new McpUserError(`Board "${boardId}" is ${meta.data.state}, not active.`);
    }
    const role = await roleOn(meta.data);
    if (!role) throw notFound;
    if (need === 'owner' && role !== 'owner') {
      throw new McpUserError("Changing a board's structure needs the board owner role.");
    }
    if (need === 'edit' && !EDIT_ROLES.includes(role)) {
      throw new McpUserError('The configured user can only view this board.');
    }
    return { id: boardId, board: meta.data, updateTime: meta.updateTime, role };
  }

  /** Read-modify-write of the board doc with an `updateTime` precondition; retried once. */
  async function mutateBoard(boardId, change) {
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await loadBoard(boardId, 'owner');
      const { patch, result } = await change(loaded.board);
      try {
        await client.commit([
          {
            op: 'patch',
            path: `boards/${boardId}`,
            data: { ...patch, updatedAt: now(), updatedBy: config.uid },
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

  async function cellContext() {
    return { uid: config.uid, memberUids: (await workspace()).memberUids };
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
    const ctx = await cellContext();
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

  const itemsOf = (boardId, fields) => client.listAllDocs(`boards/${boardId}/items`, { fields });

  async function loadItem(boardId, itemId) {
    assertId(itemId, 'itemId');
    const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
    if (!item) throw new McpUserError(`Item "${itemId}" was not found on this board.`);
    if (item.state !== 'active') throw new McpUserError(`Item "${itemId}" is ${item.state}.`);
    return item;
  }

  /** Workspace members who can read the board: `{ uid, name, email, role }` (role on the board). */
  async function boardMembers(board) {
    const { roles, memberUids } = await workspace();
    const out = [];
    for (const uid of memberUids) {
      const role =
        board.access?.[uid] ??
        (board.kind === 'main' && roles[uid] ? boardRoleFromWorkspaceRole(roles[uid]) : null);
      if (!role) continue;
      const profile = (await client.getDoc(`users/${uid}`)) ?? {};
      out.push({
        uid,
        name: profile.displayName || profile.email || uid,
        email: profile.email ?? null,
        role,
      });
    }
    return out;
  }

  const iso = (value) => (value instanceof Date ? value.toISOString() : null);

  async function authorProfile() {
    profileCache ??= (await client.getDoc(`users/${config.uid}`)) ?? {};
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
    return memberResolver(await boardMembers(loaded.board), config.uid);
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
    mine: post.authorId === config.uid,
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
    // ---- read ------------------------------------------------------------------------------
    async listBoards() {
      const { role: wsRole } = await workspace();
      const boards = await client.runQuery('boards', { workspaceId: config.workspaceId });
      const visible = boards.filter((b) => {
        if (b.data.state !== 'active') return false;
        if (b.data.access?.[config.uid]) return true;
        return b.data.kind === 'main' && boardRoleFromWorkspaceRole(wsRole) !== null;
      });
      return sortedByPosition(visible.map((b) => ({ ...b.data, id: b.id }))).map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        state: b.state,
      }));
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
    async createBoard({ name, description }) {
      await workspace();
      const existing = await client.runQuery('boards', { workspaceId: config.workspaceId });
      const roots = existing.filter((b) => b.data.folderId === null);
      const doc = buildBoardDoc({
        config,
        name,
        description,
        position: positionAfter(roots.map((b) => b.data.position)),
        now: now(),
      });
      const id = newDocId();
      await client.commit([
        { op: 'set', path: `boards/${id}`, data: doc, precondition: { exists: false } },
      ]);
      return {
        id,
        name: doc.name,
        columns: doc.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
        groups: doc.groups.map((g) => ({ id: g.id, title: g.title })),
      };
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

    async addColumn({ boardId, title, type, settings }) {
      return mutateBoard(boardId, (board) => {
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
          config,
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
      const cells = await convertValues(loaded, values, columnsForItem(loaded.board, item));
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
        config,
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
            set: { groupId, updatedAt: ts(now()), updatedBy: config.uid },
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
          set: { description, updatedAt: ts(now()), updatedBy: config.uid },
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
            updatedBy: config.uid,
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
        config,
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
        config,
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
      if (target.authorId !== config.uid) {
        throw new McpUserError('Only the configured user can edit their own updates and replies.');
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
      if (target.authorId !== config.uid) {
        throw new McpUserError(
          'Only the configured user can delete their own updates and replies.',
        );
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
          config,
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
            config,
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
              config,
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

    async listMembers({ boardId }) {
      if (boardId !== undefined) {
        const { board } = await loadBoard(boardId, 'view');
        return { members: await boardMembers(board) };
      }
      const { roles, memberUids } = await workspace();
      const members = [];
      for (const uid of memberUids) {
        const profile = (await client.getDoc(`users/${uid}`)) ?? {};
        members.push({
          uid,
          name: profile.displayName || profile.email || uid,
          email: profile.email ?? null,
          workspaceRole: roles[uid] ?? null,
          me: uid === config.uid,
        });
      }
      return { members };
    },

    /** Checks the configuration against the database; used at startup. */
    verify: workspace,
  };
}
