// Mirror values in reads. A mirror column stores nothing: the web reads the linked items and calls
// `computeMirror` (apps/web/src/columns/mirror.tsx). This does the same once per call, for the items
// a read is about to show, and hands the data to `readableCell` through the read context.
import { boardRelationValueSchema, columnRegistry, mirrorSettingsSchema } from '@atrium/shared';

/** A call reads at most this many linked boards, and this many linked items. */
export const MAX_MIRROR_BOARDS = 10;
export const MAX_MIRROR_ITEMS = 500;

export function createMirrorReader({ client, roleOn }) {
  /**
   * Loads what the Mirror columns of `columns` need for `docs` (item docs) into `context.mirror`:
   * `{ connected, targetColumns }`. Boards the actor cannot read are never read, so they contribute
   * nothing (as in the web). Limits add a line to `context.notes`.
   */
  return async function prepareMirrors(context, docs, columns) {
    const mirrors = columns.flatMap((column) => {
      if (column.type !== 'mirror') return [];
      const parsed = mirrorSettingsSchema.safeParse(column.settings ?? {});
      return parsed.success && parsed.data.relationColumnId ? [parsed.data] : [];
    });
    if (mirrors.length === 0) return;

    // Every linked item the shown items point at, by board.
    const wanted = new Map();
    for (const settings of mirrors) {
      for (const doc of docs) {
        const relation = boardRelationValueSchema.safeParse(
          doc.data.values?.[settings.relationColumnId],
        );
        if (!relation.success) continue;
        for (const link of relation.data.linkedItems) {
          if (!wanted.has(link.boardId)) wanted.set(link.boardId, new Set());
          wanted.get(link.boardId).add(link.itemId);
        }
      }
    }
    const notes = (context.notes ??= []);
    const boardIds = [...wanted.keys()];
    if (boardIds.length > MAX_MIRROR_BOARDS) {
      notes.push(
        `Mirror columns read ${MAX_MIRROR_BOARDS} of ${boardIds.length} linked boards; values from the other ${boardIds.length - MAX_MIRROR_BOARDS} are left out.`,
      );
    }

    const connected = {};
    const targetColumns = {};
    let budget = MAX_MIRROR_ITEMS;
    let skippedItems = 0;
    for (const boardId of boardIds.slice(0, MAX_MIRROR_BOARDS)) {
      const meta = await client.getDocMeta(`boards/${boardId}`);
      // Same rule as the web: a board you cannot read (or that is gone) shows nothing.
      if (!meta || meta.data.state === 'deleted' || !(await roleOn(meta.data))) continue;
      for (const settings of mirrors) {
        const targetId = settings.targetColumnIds[boardId];
        const def = targetId ? meta.data.columns?.find((c) => c.id === targetId) : undefined;
        if (!def || !columnRegistry.has(def.type)) continue;
        const parsed = columnRegistry.parseSettings(def.type, def.settings);
        targetColumns[def.id] = {
          id: def.id,
          type: def.type,
          settings: parsed.success ? parsed.data : columnRegistry.defaultSettings(def.type),
        };
      }
      const itemIds = [...wanted.get(boardId)];
      const take = itemIds.slice(0, Math.max(0, budget));
      skippedItems += itemIds.length - take.length;
      budget -= take.length;
      for (let at = 0; at < take.length; at += 25) {
        const items = await Promise.all(
          take
            .slice(at, at + 25)
            .map((itemId) => client.getDoc(`boards/${boardId}/items/${itemId}`)),
        );
        items.forEach((item, i) => {
          if (!item) return;
          const itemId = take[at + i];
          connected[`${boardId}:${itemId}`] = {
            id: itemId,
            boardId,
            state:
              item.state === 'active' ? 'active' : item.state === 'archived' ? 'archived' : 'trash',
            values: item.values ?? {},
          };
        });
      }
    }
    if (skippedItems > 0) {
      notes.push(
        `Mirror columns read ${MAX_MIRROR_ITEMS} linked items per call; ${skippedItems} more are left out.`,
      );
    }
    context.mirror = { connected, targetColumns };
  };
}
