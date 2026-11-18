// Service methods: items. Receives the shared helpers of `createService` (see ../service.mjs).
import { columnRegistry, columnsForItem, isColumnValueEmpty } from '@atrium/shared';
import {
  buildItemDoc,
  buildItemPatch,
  positionRightAfter,
  positionBetween,
  ts,
  newDocId,
  positionAfter,
} from '../builders.mjs';
import { McpUserError, assertId } from '../errors.mjs';
import { findColumn, findGroup, sortedByPosition } from '../refs.mjs';
import { toValidCell } from '../values.mjs';
import {
  MAX_MARKDOWN_CHARS,
  appendDoc,
  docToMarkdown,
  markdownToDoc,
  richNodeTypes,
  toStoredDescription,
} from '../description.mjs';
import { MAX_ITEMS_PER_CALL, MAX_MOVED_SUBITEMS, EDIT_ROLES } from './constants.mjs';
import { memberResolver, resolveMentions } from '../updates.mjs';
import { labelSummary } from './shared.mjs';

/** Milliseconds of a stored timestamp (Date, Firestore timestamp or ISO string). */
const millis = (value) =>
  value instanceof Date
    ? value.getTime()
    : typeof value?.toMillis === 'function'
      ? value.toMillis()
      : new Date(value).getTime();

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

export function itemsService(h) {
  const {
    client,
    uid,
    now,
    loadBoard,
    cellContext,
    assertWritableColumn,
    convertValues,
    assertRequiredKept,
    itemsOf,
    loadItem,
    iso,
    sortedPositions,
    subitemDocs,
    subitemColumnsOf,
    readContext,
    readValues,
    readCell,
    prepareMirrors,
    boardMembers,
    roleOn,
    listWorkspaces,
  } = h;

  /**
   * The board an item (or subitem) lives on, for callers that only know the item id (the public API's
   * `GET /items/{id}`). `boardId` is an optional hint that skips the search. Only boards the actor can
   * read are looked at, so an item elsewhere reads exactly like a missing one.
   */
  async function locateItem({ itemId, boardId }) {
    assertId(itemId, 'itemId');
    const notFound = new McpUserError(`Item "${itemId}" was not found in your workspaces.`);
    const isActive = (doc) => doc && doc.state === 'active';
    if (boardId !== undefined) {
      await loadBoard(boardId, 'read');
      if (!isActive(await client.getDoc(`boards/${boardId}/items/${itemId}`))) throw notFound;
      return { boardId };
    }
    const boardIds = [];
    for (const ws of await listWorkspaces()) {
      for (const row of await client.runQuery('boards', { workspaceId: ws.id })) {
        if (row.data.state === 'active' && (await roleOn(row.data))) boardIds.push(row.id);
      }
    }
    for (let i = 0; i < boardIds.length; i += 10) {
      const chunk = boardIds.slice(i, i + 10);
      const docs = await Promise.all(
        chunk.map((b) => client.getDoc(`boards/${b}/items/${itemId}`)),
      );
      const at = docs.findIndex(isActive);
      if (at >= 0) return { boardId: chunk[at] };
    }
    throw notFound;
  }

  return {
    locateItem,
    /** One item or subitem with its cells keyed by column id and by title, subitems nested. */
    async getItem({ itemId, boardId }) {
      const located = await locateItem({ itemId, boardId });
      const { board, workspaceId } = await loadBoard(located.boardId, 'read');
      const item = await loadItem(located.boardId, itemId);
      const isSub = Boolean(item.parentItemId);
      const columns = columnsForItem(board, item);
      const titles = new Map();
      const taken = new Set();
      for (const c of sortedByPosition(columns)) {
        const dup = taken.has(c.title.toLowerCase());
        taken.add(c.title.toLowerCase());
        titles.set(c.id, dup ? `${c.title} (${c.id})` : c.title);
      }
      const context = await readContext(located.boardId, workspaceId, board.columns);
      const subs = isSub ? [] : await subitemDocs(located.boardId, itemId);
      const doc = { id: itemId, data: item };
      await prepareMirrors(context, [doc, ...subs], board.columns);
      const groupTitle = board.groups.find((g) => g.id === item.groupId)?.title ?? item.groupId;
      const shape = (d, cols) => ({
        id: d.id,
        seq: d.data.seq ?? null,
        name: d.data.name,
        parentItemId: d.data.parentItemId ?? null,
        createdAt: iso(d.data.createdAt),
        updatedAt: iso(d.data.updatedAt),
        values: readValues(context, d, cols, (c) => c.id),
        valuesByTitle: readValues(context, d, cols, (c) => titles.get(c.id) ?? c.title),
      });
      return {
        ...shape(doc, columns),
        boardId: located.boardId,
        workspaceId,
        group: { id: item.groupId, title: groupTitle },
        ...(subs.length > 0
          ? { subitems: subs.map((s) => shape(s, subitemColumnsOf(board))) }
          : {}),
      };
    },
    async findItems({ boardId, name, group, where = [], limit = 25, offset = 0 }) {
      const { board } = await loadBoard(boardId, 'read');
      const groupId = group !== undefined ? findGroup(board, group).id : null;
      const filters = where.map((w) => {
        const column = findColumn(board, w.column);
        // Calculated columns match their computed text; mirrors (linked boards) and managed ones can't be filtered yet.
        if (columnRegistry.isServerManaged(column.type) || column.type === 'mirror') {
          throw new McpUserError(
            `Column "${column.title}" is a managed or mirror column, cannot filter on it.`,
          );
        }
        return { column, equals: w.equals };
      });
      const needle = name === undefined ? '' : name.trim().toLowerCase();
      const norm = (v) => String(v).trim().toLowerCase();
      const context = await readContext(boardId, board.workspaceId, board.columns);
      const cellMatches = (column, doc, wanted) => {
        const cell = readCell(context, doc, board.columns, column);
        if (cell === null) return wanted === null;
        if (wanted === null) return false;
        // People cells match a uid or a name (a person's or a team's).
        const options = Array.isArray(cell)
          ? cell.flatMap((entry) =>
              entry !== null && typeof entry === 'object' ? [entry.id, entry.name] : [entry],
            )
          : typeof cell === 'string'
            ? [cell, ...cell.split(',')]
            : [cell];
        return options.some((o) => o !== null && norm(o) === norm(wanted));
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
            filters.every((f) => cellMatches(f.column, d, f.equals)),
        )
        .sort(
          (a, b) =>
            (groupOrder.get(a.data.groupId) ?? Infinity) -
              (groupOrder.get(b.data.groupId) ?? Infinity) ||
            (a.data.groupId < b.data.groupId ? -1 : a.data.groupId > b.data.groupId ? 1 : 0) ||
            (a.data.position < b.data.position ? -1 : a.data.position > b.data.position ? 1 : 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      const pageDocs = found.slice(offset, offset + limit);
      await prepareMirrors(context, pageDocs, board.columns);
      const page = pageDocs.map((d) => ({
        id: d.id,
        seq: d.data.seq ?? null,
        name: d.data.name,
        group: groupTitle.get(d.data.groupId) ?? d.data.groupId,
        values: readValues(context, d, board.columns, (c) => c.title),
      }));
      return {
        ...(context.notes?.length ? { notes: context.notes } : {}),
        total: found.length,
        offset,
        shown: page.length,
        items: page,
        ...(offset + page.length < found.length ? { nextOffset: offset + page.length } : {}),
      };
    },
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
      const cells = await convertValues(loaded, values, columns, { item: { ...item, id: itemId } });
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
      const loaded = await loadBoard(boardId, 'edit');
      const item = await loadItem(boardId, itemId);
      const existing = item.description?.doc ?? null;
      const rich = existing ? richNodeTypes(existing) : [];
      let added = markdownToDoc(markdown);
      // @[Name] becomes a mention chip (members who can see the board); the existing description
      // trigger notifies the people newly mentioned.
      if (markdown.includes('@[')) {
        added = resolveMentions(added, memberResolver(await boardMembers(loaded.board), uid)).doc;
      }
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
    async listSubitems({ boardId, itemId }) {
      const { board } = await loadBoard(boardId, 'view');
      const parent = await loadItem(boardId, itemId);
      if (parent.parentItemId) throw new McpUserError('A subitem has no subitems of its own.');
      const columns = subitemColumnsOf(board);
      const titles = new Map(columns.map((c) => [c.id, c.title]));
      const subs = await subitemDocs(boardId, itemId);
      const context = await readContext(boardId, board.workspaceId, columns);
      await prepareMirrors(context, subs, columns);
      return {
        ...(context.notes?.length ? { notes: context.notes } : {}),
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
          values: readValues(context, d, columns, (c) => titles.get(c.id)),
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
        const values = await convertValues(loaded, input.values, columns, {
          parentItemId: itemId,
        });
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
  };
}
