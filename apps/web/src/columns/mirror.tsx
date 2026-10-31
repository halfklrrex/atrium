import {
  boardRelationValueSchema,
  columnRegistry,
  computeMirror,
  findStatusLabel,
  type ColumnDef,
  type ConnectedItem,
  type DropdownSettings,
  type DropdownValue,
  type LinkedItemRef,
  type MirrorSettings,
  type MirrorValue,
  type NumbersSettings,
  type StatusSettings,
  type StatusValue,
  type TargetColumnDef,
} from '@atrium/shared';
import { Mirror } from '@vibe/icons';
import { useContext, useEffect, useMemo, useState } from 'react';
import { TableEnvContext } from '../components/board-table/table-env';
import {
  fetchBoardColumns,
  fetchLinkedItemNames,
  getCachedLinkedItem,
  useLinkedItemCacheVersion,
} from './board-relation';
import styles from './cells.module.css';
import { formatNumber } from './format';
import { defineColumnUi, type CellContext, type CellProps } from './types';

/** A linked item read earlier than this is read again when a Mirror cell mounts. */
const STALE_MS = 60_000;
/** How many mirrored values a cell shows before "+N". */
const VISIBLE_VALUES = 3;
const LOADING_TEXT = '...';

const NUMERIC_AGGREGATIONS = new Set(['sum', 'average', 'min', 'max']);

/** The item a cell belongs to, as the table holds it (values only; derived cells get no stored value). */
function useCellItem(ctx: CellContext) {
  const env = useContext(TableEnvContext);
  const getItems = ctx.getItems ?? env?.getItems;
  if (!getItems || !ctx.itemId) return undefined;
  return getItems().find((item) => item.id === ctx.itemId);
}

export interface MirrorState {
  /** `true` until every linked item and every linked board's columns have been read. */
  loading: boolean;
  /** Linked items that exist, are readable and are not deleted. */
  linkedCount: number;
  result: MirrorValue | null;
  /** Target column definitions by column id (settings already parsed). */
  targetColumns: Record<string, TargetColumnDef>;
  /** Items that went into the result, with the target column of their board. */
  entries: { value: unknown; column: TargetColumnDef }[];
}

const EMPTY_STATE: MirrorState = {
  loading: false,
  linkedCount: 0,
  result: null,
  targetColumns: {},
  entries: [],
};

/**
 * Computes a Mirror cell: reads the linked items in full (one batched read per board, through the
 * session cache shared with the Connect boards cell) and the target boards' columns, then calls
 * `computeMirror`.
 *
 * Live updates are deliberately limited: linked items are read once per session and read again
 * (when older than a minute) the next time a Mirror cell mounts, for example after navigating back
 * to the board. There are no per-item listeners, because a board full of Mirror cells would open one
 * listener per linked item. See docs/architecture.md section 6.2.
 */
export function useMirrorValue(
  item: { values?: Record<string, unknown> } | undefined,
  settings: MirrorSettings,
): MirrorState {
  const cacheVersion = useLinkedItemCacheVersion();
  const [columnsByBoard, setColumnsByBoard] = useState<Record<string, ColumnDef[] | null>>({});

  const relationValue = item?.values?.[settings.relationColumnId];
  // Keyed by content, so a fresh but equal relation value does not restart the reads.
  const refsKey = useMemo(() => {
    if (!settings.relationColumnId) return '[]';
    const parsed = boardRelationValueSchema.safeParse(relationValue);
    return JSON.stringify(parsed.success ? parsed.data.linkedItems : []);
  }, [settings.relationColumnId, relationValue]);
  const refs = useMemo(() => JSON.parse(refsKey) as LinkedItemRef[], [refsKey]);

  useEffect(() => {
    const byBoard = new Map<string, string[]>();
    for (const ref of refs) {
      const list = byBoard.get(ref.boardId) ?? [];
      list.push(ref.itemId);
      byBoard.set(ref.boardId, list);
    }
    let cancelled = false;
    for (const [boardId, itemIds] of byBoard) {
      void fetchLinkedItemNames(boardId, itemIds, STALE_MS);
      void fetchBoardColumns(boardId).then((columns) => {
        if (cancelled) return;
        setColumnsByBoard((prev) =>
          prev[boardId] === columns ? prev : { ...prev, [boardId]: columns },
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [refs]);

  return useMemo(() => {
    void cacheVersion; // recompute when the shared cache fills
    if (!item || refs.length === 0) return EMPTY_STATE;

    const boardIds = [...new Set(refs.map((ref) => ref.boardId))];
    const loading =
      refs.some((ref) => getCachedLinkedItem(ref.boardId, ref.itemId) === undefined) ||
      boardIds.some((boardId) => columnsByBoard[boardId] === undefined);
    if (loading) return { ...EMPTY_STATE, loading: true };

    const connected: Record<string, ConnectedItem> = {};
    for (const ref of refs) {
      const cached = getCachedLinkedItem(ref.boardId, ref.itemId);
      if (!cached) continue;
      connected[`${ref.boardId}:${ref.itemId}`] = {
        id: ref.itemId,
        boardId: ref.boardId,
        state: cached.state === 'archived' ? 'archived' : 'active',
        values: cached.values,
      };
    }
    const linkedCount = Object.values(connected).filter((c) => c.state === 'active').length;

    const targetColumns: Record<string, TargetColumnDef> = {};
    const targetByBoard = new Map<string, TargetColumnDef>();
    for (const boardId of boardIds) {
      const targetId = settings.targetColumnIds[boardId];
      const def = targetId ? columnsByBoard[boardId]?.find((c) => c.id === targetId) : undefined;
      if (!def || !columnRegistry.has(def.type)) continue;
      const parsed = columnRegistry.parseSettings(def.type, def.settings);
      const target: TargetColumnDef = {
        id: def.id,
        type: def.type,
        settings: parsed.success ? parsed.data : columnRegistry.defaultSettings(def.type),
      };
      targetColumns[def.id] = target;
      targetByBoard.set(boardId, target);
    }

    const result = computeMirror(item, settings, connected, targetColumns, columnRegistry);

    const entries: MirrorState['entries'] = [];
    for (const ref of refs) {
      const linked = connected[`${ref.boardId}:${ref.itemId}`];
      const column = targetByBoard.get(ref.boardId);
      if (!linked || linked.state !== 'active' || !column) continue;
      const value = linked.values?.[column.id];
      if (value === undefined || value === null || value === '') continue;
      entries.push({ value, column });
    }

    return { loading: false, linkedCount, result, targetColumns, entries };
  }, [item, refs, settings, columnsByBoard, cacheVersion]);
}

interface Chip {
  key: string;
  text: string;
  /** Status colour; a dropdown label has none and uses the plain pill. */
  color?: string;
}

/** Status and dropdown values as chips; `null` for any other target type. */
function chipsOf(entries: MirrorState['entries']): Chip[] | null {
  const chips: Chip[] = [];
  for (const [index, { value, column }] of entries.entries()) {
    if (column.type === 'status') {
      const parsed = columnRegistry.parseValue('status', value);
      if (!parsed.success || !parsed.data) return null;
      const label = findStatusLabel(parsed.data as StatusValue, column.settings as StatusSettings);
      if (!label || label.label.trim() === '') continue;
      chips.push({ key: `${index}`, text: label.label, color: label.color });
    } else if (column.type === 'dropdown') {
      const parsed = columnRegistry.parseValue('dropdown', value);
      if (!parsed.success || !parsed.data) return null;
      const settings = column.settings as DropdownSettings;
      for (const id of (parsed.data as DropdownValue).ids) {
        const label = settings.labels.find((l) => l.id === id);
        if (label) chips.push({ key: `${index}:${id}`, text: label.label });
      }
    } else {
      return null;
    }
  }
  return chips;
}

function MirrorCell({ settings, ctx }: CellProps<MirrorValue, MirrorSettings>) {
  const item = useCellItem(ctx);
  const state = useMirrorValue(item, settings);

  if (state.loading) {
    return (
      <div className={styles.root}>
        <span className={styles.more}>{LOADING_TEXT}</span>
      </div>
    );
  }
  if (!state.result || state.linkedCount === 0) return <div className={styles.root} />;

  if (settings.aggregation === 'none') {
    const chips = chipsOf(state.entries);
    if (chips) {
      if (chips.length === 0) return <div className={styles.root} />;
      const shown = chips.slice(0, VISIBLE_VALUES);
      const extra = chips.length - shown.length;
      return (
        <div className={styles.root}>
          <span className={styles.pills}>
            {shown.map((chip) => (
              <span
                key={chip.key}
                className={chip.color ? styles.mirrorChip : styles.pill}
                style={chip.color ? { backgroundColor: chip.color } : undefined}
              >
                {chip.text}
              </span>
            ))}
            {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
          </span>
        </div>
      );
    }
    const texts = state.entries.map(({ value, column }) =>
      columnRegistry.toText(column.type, value, column.settings),
    );
    const visible = texts.filter((t) => t !== '');
    if (visible.length === 0) return <div className={styles.root} />;
    const shown = visible.slice(0, VISIBLE_VALUES).join(', ');
    const extra = visible.length - VISIBLE_VALUES;
    const text = extra > 0 ? `${shown} +${extra}` : shown;
    return (
      <div className={styles.root}>
        <span className={styles.text} title={visible.join(', ')}>
          {text}
        </span>
      </div>
    );
  }

  let text = state.result.displayValue;
  if (NUMERIC_AGGREGATIONS.has(settings.aggregation)) {
    const numbers = Object.values(state.targetColumns).find((c) => c.type === 'numbers');
    const n = Number(text);
    if (numbers && text !== '' && Number.isFinite(n)) {
      text = formatNumber(n, numbers.settings as NumbersSettings);
    }
  }
  if (text === '') return <div className={styles.root} />;
  return (
    <div className={styles.root}>
      <span className={styles.text} title={text}>
        {text}
      </span>
    </div>
  );
}

/** Read-only: the value is computed from the linked items and stored nowhere. */
export const mirrorUi = defineColumnUi<MirrorValue, MirrorSettings>({
  type: 'mirror',
  icon: Mirror,
  tone: 'purple',
  editor: 'none',
  Cell: MirrorCell,
});
