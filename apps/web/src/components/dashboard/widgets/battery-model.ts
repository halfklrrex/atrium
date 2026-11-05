/**
 * Battery widget model (P6): progress by status across the widget's boards, as monday's Battery.
 * One segment per status label with the number of items, and the share of items that count as
 * done. Pure: no React and no Firebase.
 *
 * Cross-board rules: the status column is `settings.statusColumnId` (matched on each board by id,
 * then by type and title) or, when null, the first status column of each board. Segments merge by
 * label text (case-insensitive), the same rule as the Chart widget; the first colour seen wins.
 * An item counts as done when its label id is in `doneLabelIds` or, when that list is empty, when
 * the label is flagged `isDone`. Items with no status form the "Not set" segment (never done).
 */
import type { DashboardWidget, StatusSettings } from '@atrium/shared';
import {
  readStatusLabel,
  resolveColumn,
  widgetBoards,
  type WidgetBoardData,
} from './widget-columns';

export type BatterySettings = Extract<DashboardWidget, { type: 'battery' }>['settings'];

export const BATTERY_EMPTY_KEY = '__empty';

export interface BatterySegment {
  key: string;
  label: string;
  /** Label colour from the board, or `null` for "Not set" (the component uses a token). */
  color: string | null;
  count: number;
  done: boolean;
  /** Share of all items, 0 to 100. */
  percent: number;
}

export interface BatteryModel {
  total: number;
  doneCount: number;
  /** Whole percent of items that are done (0 when there are no items). */
  percent: number;
  /** Largest first by the label order of the boards, "Not set" last. */
  segments: BatterySegment[];
  /** Boards read that have no status column. */
  boardsWithoutStatus: number;
  summary: string;
}

export function buildBatteryModel(input: {
  boards: readonly WidgetBoardData[];
  widgetBoardIds: readonly string[];
  settings: BatterySettings;
}): BatteryModel {
  const boards = widgetBoards(input.boards, input.widgetBoardIds);
  const columns = boards.map((b) => b.board);
  const doneIds = new Set(input.settings.doneLabelIds);
  const useFlag = doneIds.size === 0;

  const order: string[] = [];
  const segments = new Map<string, Omit<BatterySegment, 'percent'>>();
  let empty = 0;
  let total = 0;
  let doneCount = 0;
  let withoutStatus = 0;

  for (const { board, items } of boards) {
    const def =
      input.settings.statusColumnId !== null
        ? resolveColumn(columns, board, input.settings.statusColumnId)
        : (board.columns.find((c) => c.type === 'status') ?? null);
    if (!def || def.type !== 'status') {
      withoutStatus += 1;
      continue;
    }
    // Register the board's labels first so the legend follows the board's label order.
    const labels = [...((def.settings as unknown as StatusSettings).labels ?? [])]
      .filter((l) => l.label.trim() !== '')
      .sort((a, b) => a.index - b.index);
    for (const l of labels) {
      const key = l.label.trim().toLowerCase();
      if (!segments.has(key)) {
        order.push(key);
        segments.set(key, { key, label: l.label.trim(), color: l.color, count: 0, done: false });
      }
    }
    for (const item of items) {
      total += 1;
      const label = readStatusLabel(item, def);
      if (!label) {
        empty += 1;
        continue;
      }
      const key = label.label.trim().toLowerCase();
      const segment = segments.get(key)!;
      segment.count += 1;
      const isDone = useFlag ? label.isDone === true : doneIds.has(label.id);
      if (isDone) {
        segment.done = true;
        doneCount += 1;
      }
    }
  }

  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const out: BatterySegment[] = order
    .map((k) => segments.get(k)!)
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, percent: pct(s.count) }));
  if (empty > 0) {
    out.push({
      key: BATTERY_EMPTY_KEY,
      label: 'Not set',
      color: null,
      count: empty,
      done: false,
      percent: pct(empty),
    });
  }
  const percent = total === 0 ? 0 : Math.round(pct(doneCount));
  return {
    total,
    doneCount,
    percent,
    segments: out,
    boardsWithoutStatus: withoutStatus,
    summary:
      total === 0
        ? 'No items'
        : `${percent}% done: ${doneCount} of ${total} items. ${out
            .map((s) => `${s.label} ${s.count}`)
            .join(', ')}`,
  };
}
