// The connector's tool logic, free of any MCP wiring. Every function takes plain arguments and returns
// plain JSON, so it can be tested against an in-memory Firestore. See docs/mcp-connector.md.
//
// Safety rules enforced here (the Admin-style REST client bypasses security rules, so we do it):
//   - only boards of `config.workspaceId`, only `state = active`, only where the configured user has
//     a role (structure changes need `owner`, item changes `editor` or `owner`);
//   - never writes derivedColumnIds / serverManagedColumnIds / requiredColumnIds / seq / boardSeq / activity / notifications;
//   - no hard deletes; only the documents of one board are ever touched.
import { boardRoleFromWorkspaceRole, columnRegistry } from '@atrium/shared';
import {
  addLabelsToSettings,
  buildBoardDoc,
  buildColumn,
  buildGroup,
  buildItemDoc,
  buildItemPatch,
  buildUpdateDoc,
  newDocId,
  positionAfter,
  validSettings,
} from './builders.mjs';
import { McpUserError, assertId } from './errors.mjs';
import { findColumn, findGroup, sortedByPosition } from './refs.mjs';
import { readableCell, toValidCell } from './values.mjs';

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
      return { role, memberUids: ws.memberIds ?? [] };
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
  async function convertValues(loaded, values = {}) {
    const ctx = await cellContext();
    const out = {};
    for (const [ref, input] of Object.entries(values)) {
      const column = findColumn(loaded.board, ref);
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
      for (const column of [...board.columns, ...board.subitemColumns]) {
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
          .map((s) => shape(s, board.subitemColumns));
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
      const cells = await convertValues(loaded, values);
      let groupId;
      let position;
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
      await client.commit([
        { op: 'update', path: `boards/${boardId}/items/${itemId}`, set, remove },
      ]);
      return {
        id: itemId,
        updated: [...Object.keys(set), ...remove].filter((k) => !k.startsWith('updated')),
      };
    },

    async setItemState({ boardId, itemId, state }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      await client.commit([
        {
          op: 'update',
          path: `boards/${boardId}/items/${itemId}`,
          set: {
            state,
            deletedAt: state === 'deleted' ? now() : null,
            updatedAt: now(),
            updatedBy: config.uid,
          },
        },
      ]);
      return { id: itemId, state };
    },

    async addUpdate({ boardId, itemId, text }) {
      await loadBoard(boardId, 'edit');
      await loadItem(boardId, itemId);
      profileCache ??= (await client.getDoc(`users/${config.uid}`)) ?? {};
      const id = newDocId();
      const doc = buildUpdateDoc({
        config,
        itemId,
        id,
        content: text,
        authorName: profileCache.displayName,
        authorPhotoUrl: profileCache.photoURL,
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
      return { id, itemId };
    },

    /** Checks the configuration against the database; used at startup. */
    verify: workspace,
  };
}
