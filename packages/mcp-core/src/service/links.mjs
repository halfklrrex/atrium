// Cell input for Connect boards and Dependency columns: item ids or exact item names become the stored
// shape, after the same checks the web's pickers make (boards the actor can read, items that exist and
// are active, the same parent for dependencies, no circular dependency).
import {
  boardRelationSettingsSchema,
  canAddDependency,
  dependencySettingsSchema,
} from '@atrium/shared';
import { McpUserError } from '../errors.mjs';
import { findColumn } from '../refs.mjs';

const norm = (text) => String(text).trim().toLowerCase();

/** One resolution run: the board and item reads are cached for its duration only. */
function linkSession({ client, roleOn, itemsOf }) {
  const boardCache = new Map();
  /** A linked board the actor can read, or an error that does not reveal other boards. */
  async function readableBoard(boardId) {
    if (!boardCache.has(boardId)) {
      boardCache.set(
        boardId,
        (async () => {
          const meta = await client.getDocMeta(`boards/${boardId}`);
          if (!meta || meta.data.state !== 'active' || !(await roleOn(meta.data))) return null;
          return { id: boardId, name: meta.data.name, board: meta.data };
        })(),
      );
    }
    const found = await boardCache.get(boardId);
    if (!found) {
      throw new McpUserError(
        `Board "${boardId}" was not found among the boards you can read.`,
        'not_found',
      );
    }
    return found;
  }

  const itemCache = new Map();
  const rootItems = async (boardId) => {
    if (!itemCache.has(boardId)) itemCache.set(boardId, itemsOf(boardId));
    return (await itemCache.get(boardId)).filter((d) => d.data.state === 'active');
  };

  /** One item of a board by id, else by exact name (case-insensitive) among the root items. */
  async function itemIn(boardId, text, { parentItemId = null } = {}) {
    const docs = await rootItems(boardId);
    const byId = docs.find((d) => d.id === text);
    if (byId) return byId.id;
    const named = docs.filter(
      (d) => (d.data.parentItemId ?? null) === parentItemId && norm(d.data.name) === norm(text),
    );
    if (named.length === 1) return named[0].id;
    if (named.length > 1) {
      throw new McpUserError(
        `More than one item is called "${text}" (ids: ${named.map((d) => d.id).join(', ')}). Use the id.`,
      );
    }
    return null;
  }

  async function relation(column, input) {
    const settings = boardRelationSettingsSchema.parse(column.settings ?? {});
    const entries =
      input && typeof input === 'object' && !Array.isArray(input) && 'linkedItems' in input
        ? input.linkedItems
        : Array.isArray(input)
          ? input
          : [input];
    const linked = [];
    for (const entry of entries) {
      if (entry !== null && typeof entry === 'object') {
        const boardId = entry.boardId ?? entry.board;
        const itemId = entry.itemId ?? entry.item;
        if (typeof boardId !== 'string' || typeof itemId !== 'string') {
          throw new McpUserError(
            'Give a linked item as an item id, an item name or { board, item }.',
          );
        }
        await readableBoard(boardId);
        if (settings.boardIds.length > 0 && !settings.boardIds.includes(boardId)) {
          throw new McpUserError(
            `Column "${column.title}" is not connected to board "${boardId}".`,
          );
        }
        const found = await itemIn(boardId, itemId);
        if (!found)
          throw new McpUserError(
            `Item "${itemId}" was not found on board "${boardId}".`,
            'not_found',
          );
        linked.push({ boardId, itemId: found });
        continue;
      }
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new McpUserError('Give a linked item as an item id or an item name.');
      }
      if (settings.boardIds.length === 0) {
        throw new McpUserError(
          `Column "${column.title}" is not connected to any board yet; connect boards first.`,
        );
      }
      const hits = [];
      for (const boardId of settings.boardIds) {
        await readableBoard(boardId);
        const found = await itemIn(boardId, entry.trim());
        if (found) hits.push({ boardId, itemId: found });
      }
      if (hits.length === 0) {
        throw new McpUserError(
          `No item "${entry}" on the connected boards of column "${column.title}". Give an item id or an exact name.`,
        );
      }
      if (hits.length > 1) {
        throw new McpUserError(
          `"${entry}" matches items on more than one connected board; give { board, item } with ids.`,
        );
      }
      linked.push(hits[0]);
    }
    const unique = [...new Map(linked.map((l) => [`${l.boardId}:${l.itemId}`, l])).values()];
    if (!settings.allowMultipleItems && unique.length > 1) {
      throw new McpUserError(`Column "${column.title}" links one item.`);
    }
    return { linkedItems: unique };
  }

  async function dependency(boardId, column, input, itemContext) {
    dependencySettingsSchema.parse(column.settings ?? {});
    const entries =
      input && typeof input === 'object' && !Array.isArray(input) && 'item_ids' in input
        ? input.item_ids
        : Array.isArray(input)
          ? input
          : [input];
    const parentItemId = itemContext.item?.parentItemId ?? itemContext.parentItemId ?? null;
    const ids = [];
    const docs = await rootItems(boardId);
    for (const entry of entries) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new McpUserError('Give a dependency as an item id or an item name.');
      }
      const found = docs.find((d) => d.id === entry);
      const id = found ? found.id : await itemIn(boardId, entry.trim(), { parentItemId });
      if (!id) throw new McpUserError(`Item "${entry}" was not found on this board.`, 'not_found');
      const doc = docs.find((d) => d.id === id);
      if ((doc.data.parentItemId ?? null) !== parentItemId) {
        throw new McpUserError(
          `Item "${entry}" is not at the same level: a dependency links items to items, or subitems of one parent.`,
        );
      }
      ids.push(id);
    }
    const unique = [...new Set(ids)];
    const itemId = itemContext.item?.id;
    if (itemId) {
      const graph = new Map();
      for (const d of docs) {
        const raw = d.data.values?.[column.id];
        graph.set(d.id, Array.isArray(raw?.item_ids) ? raw.item_ids : []);
      }
      const current = (graph.get(itemId) ?? []).filter((id) => unique.includes(id));
      graph.set(itemId, current);
      for (const target of unique) {
        if (current.includes(target)) continue;
        const check = canAddDependency(graph, itemId, target);
        if (!check.allowed) throw new McpUserError(check.reason ?? 'That would be circular.');
        current.push(target);
        graph.set(itemId, current);
      }
    }
    return { item_ids: unique };
  }

  /**
   * `Map<columnId, storedValue>` for the Connect boards and Dependency inputs in `values`
   * (title or id -> input). `itemContext`: `{ item }` when updating, `{ parentItemId }` for new subitems.
   */
  return async function resolveLinkCells(loaded, columns, values, itemContext = {}) {
    const out = new Map();
    for (const [key, input] of Object.entries(values ?? {})) {
      if (input === null || input === undefined) continue;
      let column;
      try {
        column = findColumn({ columns }, key);
      } catch {
        continue; // the caller reports the unknown column
      }
      if (column.type === 'board_relation') out.set(column.id, await relation(column, input));
      else if (column.type === 'dependency') {
        out.set(column.id, await dependency(loaded.id, column, input, itemContext));
      }
    }
    return out;
  };
}

export const createLinkResolver = (deps) => (loaded, columns, values, itemContext) =>
  linkSession(deps)(loaded, columns, values, itemContext);
