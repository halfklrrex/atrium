// Service methods: column type change, buttons and time tracking (batch 3 PR 3). Hosted-only: the
// work runs in `serverOps`, which calls the library code behind the `changeColumnType`,
// `revertColumnType`, `clickButton`, `startTimeTracking` and `stopTimeTracking` callables with the
// actor's uid, so the permission, lock, vote-cap, snapshot and repeat-guard checks are the callables'
// own. This module resolves names to ids, shows the loss report the web shows before a conversion,
// guards data loss with `dryRun` and `allowDataLoss`, and shapes the answers.
import {
  columnRegistry,
  columnTypeChangeSupport,
  findColumnDependents,
  viewSettingsSchema,
} from '@atrium/shared';
import { McpUserError, assertId } from '../errors.mjs';
import { findColumn } from '../refs.mjs';

export const CALLABLES_NEED_HOSTED_MESSAGE =
  "This needs the hosted Atrium connector (it runs Atrium's server code); the local server cannot do it.";

/** Most values one conversion converts here: the hosted function has about a minute; larger columns are converted in Atrium. */
export const MAX_CONVERTED_VALUES = 3000;
/** How many lost values one answer lists. */
const MAX_LISTED_LOSSES = 25;

const DEPENDENT_KIND = {
  formula: 'Formula column',
  progress: 'Progress column',
  mirror: 'Mirror column',
  dependency: 'Dependency column',
  view: 'View',
};

export function callablesService(h, serverOps) {
  const { client, uid, now, loadBoard, loadItem, assertWritableColumn, itemsOf, iso } = h;

  const requireServerOps = () => {
    if (!serverOps) throw new McpUserError(CALLABLES_NEED_HOSTED_MESSAGE);
    return serverOps;
  };

  const typeLabel = (type) => columnRegistry.find(type)?.label ?? type;

  /** The column of `type` to use: the one named, or the only one on the board. */
  function pickTypedColumn(board, ref, type, noun) {
    if (ref !== undefined && ref !== null) {
      const column = findColumn(board, ref);
      if (column.type !== type) {
        throw new McpUserError(`Column "${column.title}" is not a ${noun} column.`);
      }
      return column;
    }
    const all = board.columns.filter((c) => c.type === type);
    if (all.length === 1) return all[0];
    if (all.length === 0) {
      throw new McpUserError(`This board has no ${noun} column. Add one with atrium_add_column.`);
    }
    throw new McpUserError(
      `Name the ${noun} column with "column": ${all.map((c) => `"${c.title}"`).join(', ')}.`,
    );
  }

  /** The views the actor sees, as the web's type-change dialog reads them (for the "Used by" list). */
  async function visibleViewSettings(boardId) {
    const rows = await client.listAllDocs(`boards/${boardId}/views`);
    const out = [];
    for (const row of rows) {
      const ownerId = row.data.ownerId ?? null;
      if (ownerId !== null && ownerId !== uid) continue;
      const parsed = viewSettingsSchema.safeParse(row.data.settings);
      if (parsed.success)
        out.push({ name: String(row.data.name ?? row.id), settings: parsed.data });
    }
    return out;
  }

  const usedBy = (dependents) =>
    dependents.map((d) => ({ kind: DEPENDENT_KIND[d.kind] ?? d.kind, title: d.title }));

  return {
    async changeColumnType({
      boardId,
      column: ref,
      toType,
      settings,
      dryRun = false,
      allowDataLoss = false,
    }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const column = findColumn(loaded.board, ref);
      if (column.migrating) {
        throw new McpUserError(
          `Column "${column.title}" is changing type; try again in a few minutes.`,
        );
      }
      const target = String(toType ?? '').trim();
      if (!columnRegistry.has(target)) {
        throw new McpUserError(`Unknown column type "${toType}".`);
      }
      const toSettings = settings ?? columnRegistry.defaultSettings(target);
      const request = { uid, boardId, columnId: column.id, toType: target, toSettings };

      // The preview and the real run share the callable's checks and conversion; the preview never writes.
      const preview = await ops.previewColumnTypeChange(request);
      const total = preview.converted + preview.cleared;
      if (total > MAX_CONVERTED_VALUES && !dryRun) {
        throw new McpUserError(
          `"${column.title}" has ${total} values; the connector converts at most ${MAX_CONVERTED_VALUES} at a time. Change the type in Atrium instead.`,
        );
      }
      const names = new Map(
        (await itemsOf(boardId, ['name'])).map((d) => [d.id, d.data.name ?? null]),
      );
      const fromLabel = typeLabel(column.type);
      const toLabel = typeLabel(target);
      const support = columnTypeChangeSupport(column.type, target);
      const dependents = findColumnDependents(
        loaded.board.columns,
        column.id,
        await visibleViewSettings(boardId),
      );
      const report = {
        boardId,
        column: column.title,
        from: fromLabel,
        to: toLabel,
        converted: preview.converted,
        cleared: preview.cleared,
        ...(support.warning ? { warning: support.warning } : {}),
        ...(preview.lost.length > 0
          ? {
              lost: preview.lost.slice(0, MAX_LISTED_LOSSES).map((l) => ({
                itemId: l.itemId,
                item: names.get(l.itemId) ?? null,
                value: l.before,
              })),
            }
          : {}),
        ...(preview.samples.length > 0 ? { samples: preview.samples } : {}),
        ...(dependents.length > 0
          ? {
              usedBy: usedBy(dependents),
              usedByNote: 'These may stop working after the change.',
            }
          : {}),
      };

      if (dryRun) {
        return {
          dryRun: true,
          ...report,
          note: 'Preview only; nothing was written. Call again without dryRun to apply it (allowDataLoss: true if values would be cleared).',
        };
      }
      if (preview.cleared > 0 && !allowDataLoss) {
        const shown = preview.lost
          .slice(0, 5)
          .map((l) => `${names.get(l.itemId) ?? l.itemId}: "${l.before}"`)
          .join('; ');
        throw new McpUserError(
          `Refused: ${preview.cleared} value${preview.cleared === 1 ? '' : 's'} in "${column.title}" can't be carried over from ${fromLabel} to ${toLabel} and would be cleared` +
            (shown ? ` (for example ${shown})` : '') +
            '. Run again with dryRun to see them all, or allowDataLoss: true to convert anyway. The change can be undone with atrium_revert_column_type for 30 days.',
        );
      }

      const done = await ops.changeColumnType(request);
      return {
        changed: true,
        ...report,
        converted: done.converted,
        cleared: done.cleared,
        snapshotId: done.snapshotId,
        undo: 'Call atrium_revert_column_type for this column within 30 days to put the old type and values back.',
      };
    },

    async revertColumnType({ boardId, column: ref }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const column = findColumn(loaded.board, ref);
      const snapshotId = column.migrating?.snapshotId ?? column.lastTypeChange?.snapshotId;
      if (!snapshotId) {
        throw new McpUserError(
          `"${column.title}" has no type change to undo (an undo is kept for 30 days after a change).`,
        );
      }
      if (
        !column.migrating &&
        column.lastTypeChange &&
        column.lastTypeChange.expiresAt <= now().getTime()
      ) {
        throw new McpUserError('This type change can no longer be undone.');
      }
      const from = column.lastTypeChange?.fromType;
      const done = await ops.revertColumnType({ uid, boardId, snapshotId });
      return {
        reverted: true,
        boardId,
        column: column.title,
        ...(from ? { backTo: typeLabel(from) } : {}),
        restored: done.restored,
        removed: done.removed,
        note: 'Values edited since the change were replaced by the old ones; values the converted column gained for items that had none were removed.',
      };
    },

    async clickButton({ boardId, itemId, column: ref }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const column = pickTypedColumn(loaded.board, ref, 'button', 'Button');
      assertWritableColumn(loaded, column);
      const item = await loadItem(boardId, itemId);
      const done = await ops.clickButton({ uid, boardId, itemId, columnId: column.id });
      const label =
        typeof column.settings?.label === 'string' ? column.settings.label : column.title;
      return {
        clicked: true,
        button: label,
        column: column.title,
        itemId,
        item: item.name ?? null,
        applied: done.applied.map((a) => a.type),
        ...(done.notified !== undefined ? { notified: done.notified } : {}),
        at: iso(new Date(done.timestamp)),
        note:
          done.applied.length === 0
            ? 'The button has no actions; the click was logged in the activity.'
            : 'The actions ran as they do in Atrium: the item changed as set, and anyone to notify was notified.',
      };
    },

    async startTimeTracking({ boardId, itemId, column: ref }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const column = pickTypedColumn(loaded.board, ref, 'time_tracking', 'Time tracking');
      assertWritableColumn(loaded, column);
      const item = await loadItem(boardId, itemId);
      const done = await ops.startTimeTracking({ uid, boardId, itemId, columnId: column.id });
      return {
        started: true,
        column: column.title,
        itemId,
        item: item.name ?? null,
        sessionId: done.sessionId,
        startedAt: iso(new Date(done.startedAt)),
        note: 'The timer runs until atrium_stop_time_tracking; starting again returns the running session.',
      };
    },

    async stopTimeTracking({ boardId, itemId, column: ref }) {
      const ops = requireServerOps();
      const loaded = await loadBoard(boardId, 'edit');
      const column = pickTypedColumn(loaded.board, ref, 'time_tracking', 'Time tracking');
      assertWritableColumn(loaded, column);
      assertId(itemId, 'itemId');
      const item = await client.getDoc(`boards/${boardId}/items/${itemId}`);
      if (!item || item.state === 'deleted') {
        throw new McpUserError(`Item "${itemId}" was not found on this board.`);
      }
      const done = await ops.stopTimeTracking({ uid, boardId, itemId, columnId: column.id });
      return {
        stopped: true,
        column: column.title,
        itemId,
        item: item.name ?? null,
        totalSeconds: done.duration,
        stoppedAt: iso(new Date(done.stoppedAt)),
      };
    },
  };
}
