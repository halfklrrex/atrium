/**
 * Chart widget model (P6): the Chart view's chart, drawn from the items of several boards at once.
 * Pure: no React and no Firebase.
 *
 * Every board has its own column ids, status label ids and group ids, so the boards cannot be fed
 * to the Chart view's one-pass builder as they are. This module normalises them first and then
 * runs `buildChartModel` ONCE over the combined items, which merges the buckets by key and keeps
 * the Chart view's ordering, capping ("Other"), colours, notes and accessible table unchanged:
 *
 * - Axis columns (X, stack) are matched on each board by id, then by type and title
 *   (`resolveColumn`, as in Numbers and Battery). A board without the column puts its items in
 *   the "Empty" bucket.
 * - Status labels merge by label text (case-insensitive); the first board's colour and order win.
 * - Dropdown labels merge by label text the same way.
 * - People merge by user id (the stored value is already global).
 * - Dates and timelines merge by date bucket (day, week or month), which is global.
 * - Groups merge by group title (case-insensitive).
 * - The Y measure reads the matched Numbers, Progress or number Formula column of each board;
 *   derived columns are computed with that board's columns before merging.
 *
 * Normalisation works by giving the builder synthetic columns (`__x`, `__s`, `__y`) and copies of
 * the items whose values are rewritten to the merged label ids.
 */
import {
  CHART_GROUP_AXIS,
  columnRegistry,
  type ChartSettings,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import type { ItemDoc } from '../../../data';
import { buildColumnViews } from '../../board-table/table-model';
import {
  buildChartModel,
  CHART_STACK_TYPES,
  CHART_X_TYPES,
  type ChartModel,
} from '../../board-chart/chart-model';
import {
  isNumericColumn,
  readNumber,
  readStatusLabel,
  resolveColumn,
  widgetBoards,
  type WidgetBoardData,
} from './widget-columns';

export type { ChartModel };

const X_ID = '__x';
const S_ID = '__s';
const Y_ID = '__y';

export interface MultiBoardChartInput {
  boards: readonly WidgetBoardData[];
  widgetBoardIds: readonly string[];
  settings: ChartSettings;
  userName: (uid: string) => string | undefined;
}

const lower = (text: string): string => text.trim().toLowerCase();
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sameColumn = (a: ColumnDef, b: ColumnDef): boolean =>
  a.type === b.type && lower(a.title) === lower(b.title);

/** A merged axis: the synthetic column (or null for groups) and how to read an item into it. */
interface Axis {
  column: ColumnDef | null;
  read: (board: WidgetBoardData['board'], item: ItemDoc) => unknown;
}

function findColumn(boards: readonly WidgetBoardData[], id: string | null): ColumnDef | null {
  if (!id) return null;
  for (const { board } of boards) {
    const found = board.columns.find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}

function firstStatusColumn(
  boards: readonly WidgetBoardData[],
  not: ColumnDef | 'group' | null,
): ColumnDef | null {
  for (const { board } of boards) {
    const found = board.columns.find(
      (c) => c.type === 'status' && !(not && not !== 'group' && sameColumn(c, not)),
    );
    if (found) return found;
  }
  return null;
}

/** The column an axis means, or `'group'`; mirrors `resolveXDim` / `resolveStackDim` across boards. */
function pickAxis(
  boards: readonly WidgetBoardData[],
  savedId: string | null,
  allowed: readonly string[],
  other: ColumnDef | 'group' | null,
): ColumnDef | 'group' | null {
  if (savedId === CHART_GROUP_AXIS) return other === 'group' ? null : 'group';
  const saved = findColumn(boards, savedId);
  if (
    saved &&
    allowed.includes(saved.type) &&
    !(other && other !== 'group' && sameColumn(saved, other))
  ) {
    return saved;
  }
  const status = firstStatusColumn(boards, other);
  if (status) return status;
  return other === 'group' ? null : 'group';
}

/** Merged groups: by title, in the order the boards list them. */
function mergeGroups(boards: readonly WidgetBoardData[]): GroupDef[] {
  const groups: GroupDef[] = [];
  const idByTitle = new Map<string, string>();
  for (const { board } of boards) {
    const sorted = [...board.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
    for (const g of sorted) {
      const key = lower(g.title);
      if (idByTitle.has(key)) continue;
      const id = `g${groups.length}`;
      idByTitle.set(key, id);
      groups.push({
        id,
        title: g.title,
        color: g.color,
        position: `a${String(groups.length).padStart(4, '0')}`,
      });
    }
  }
  return groups;
}

/** Group id of an item on the merged group axis (the item keeps no group if its board lost it). */
function mergedGroupId(
  board: WidgetBoardData['board'],
  item: ItemDoc,
  groups: readonly GroupDef[],
): string {
  const own = board.groups.find((g) => g.id === item.groupId);
  if (!own) return '';
  return groups.find((g) => lower(g.title) === lower(own.title))?.id ?? '';
}

function columnAxis(boards: readonly WidgetBoardData[], ref: ColumnDef, synthId: string): Axis {
  const allBoards = boards.map((b) => b.board);
  const base = { id: synthId, type: ref.type, title: ref.title, position: 'a0' };
  const resolved = (board: WidgetBoardData['board']) => resolveColumn(allBoards, board, ref.id);

  if (ref.type === 'status') {
    const texts: { text: string; color: string }[] = [];
    for (const { board } of boards) {
      const def = resolved(board);
      const labels = (
        def?.settings as { labels?: { label: string; color: string; index: number }[] }
      )?.labels;
      for (const l of [...(labels ?? [])].sort((a, b) => a.index - b.index)) {
        if (l.label.trim() === '' || texts.some((t) => lower(t.text) === lower(l.label))) continue;
        texts.push({ text: l.label, color: l.color });
      }
    }
    const labels = texts.map((t, index) => ({
      id: `l${index}`,
      index,
      label: t.text,
      color: t.color,
    }));
    return {
      column: { ...base, settings: { labels } } as ColumnDef,
      read: (board, item) => {
        const def = resolved(board);
        const label = def ? readStatusLabel(item, def) : null;
        const found = label ? labels.find((l) => lower(l.label) === lower(label.label)) : null;
        return found ? { index: found.index } : undefined;
      },
    };
  }

  if (ref.type === 'dropdown') {
    const texts: string[] = [];
    for (const { board } of boards) {
      const def = resolved(board);
      const labels = (def?.settings as { labels?: { id: number; label: string }[] })?.labels;
      for (const l of labels ?? []) {
        if (l.label.trim() !== '' && !texts.some((t) => lower(t) === lower(l.label))) {
          texts.push(l.label);
        }
      }
    }
    const labels = texts.map((label, id) => ({ id, label }));
    return {
      column: { ...base, settings: { labels } } as ColumnDef,
      read: (board, item) => {
        const def = resolved(board);
        const raw = def ? item.values[def.id] : undefined;
        if (!def || !isRec(raw) || !Array.isArray(raw.ids)) return undefined;
        const own = (def.settings as { labels?: { id: number; label: string }[] })?.labels ?? [];
        const ids = new Set<number>();
        for (const n of raw.ids) {
          const text = own.find((l) => l.id === n)?.label;
          const merged =
            text === undefined ? undefined : labels.find((l) => lower(l.label) === lower(text));
          if (merged) ids.add(merged.id);
        }
        return { ids: [...ids] };
      },
    };
  }

  // People, date and timeline values are global already: copy them across.
  const settings = columnRegistry.has(ref.type)
    ? columnRegistry.defaultSettings(ref.type)
    : ref.settings;
  return {
    column: { ...base, settings } as ColumnDef,
    read: (board, item) => {
      const def = resolved(board);
      return def ? item.values[def.id] : undefined;
    },
  };
}

/** The Numbers-like column the Y measure reads, from the first board that has it. */
function pickY(boards: readonly WidgetBoardData[], settings: ChartSettings): ColumnDef | null {
  if (settings.yMode === 'count') return null;
  const saved = findColumn(boards, settings.yColumnId);
  if (saved && isNumericColumn(saved)) return saved;
  for (const { board } of boards) {
    const found = board.columns.find(isNumericColumn);
    if (found) return found;
  }
  return null;
}

/** Builds the chart model for a Chart widget; see the header comment for the merge rules. */
export function buildMultiBoardChartModel(input: MultiBoardChartInput): ChartModel {
  const boards = widgetBoards(input.boards, input.widgetBoardIds);
  const { settings } = input;
  const allBoards = boards.map((b) => b.board);
  const stacked = settings.chartType === 'stacked_bar';

  const xPick = pickAxis(boards, settings.xColumnId, CHART_X_TYPES, null) ?? 'group';
  const sPick = stacked ? pickAxis(boards, settings.stackColumnId, CHART_STACK_TYPES, xPick) : null;

  const groups = mergeGroups(boards);
  const xAxis: Axis | null = xPick === 'group' ? null : columnAxis(boards, xPick, X_ID);
  const sAxis: Axis | null = sPick && sPick !== 'group' ? columnAxis(boards, sPick, S_ID) : null;

  const yRef = pickY(boards, settings);
  const yDef: ColumnDef | null = yRef
    ? ({
        id: Y_ID,
        type: 'numbers',
        title: yRef.title,
        position: 'a0',
        settings:
          yRef.type === 'numbers' ? yRef.settings : columnRegistry.defaultSettings('numbers'),
      } as ColumnDef)
    : null;

  const defs = [xAxis?.column, sAxis?.column, yDef].filter((d): d is ColumnDef => !!d);

  const items: ItemDoc[] = [];
  for (const { board, items: boardItems } of boards) {
    const yColumn = yRef ? resolveColumn(allBoards, board, yRef.id) : null;
    for (const item of boardItems) {
      const values: Record<string, unknown> = {};
      if (xAxis) values[X_ID] = xAxis.read(board, item);
      if (sAxis) values[S_ID] = sAxis.read(board, item);
      if (yColumn) values[Y_ID] = readNumber(board, item, yColumn) ?? undefined;
      items.push({
        ...item,
        id: `${board.id}/${item.id}`,
        groupId: mergedGroupId(board, item, groups),
        values,
      });
    }
  }

  return buildChartModel({
    items,
    columns: buildColumnViews(defs),
    groups,
    settings: {
      ...settings,
      xColumnId: xPick === 'group' ? CHART_GROUP_AXIS : X_ID,
      stackColumnId: !stacked || !sPick ? null : sPick === 'group' ? CHART_GROUP_AXIS : S_ID,
      yColumnId: yDef ? Y_ID : null,
    },
    search: '',
    userName: input.userName,
  });
}
