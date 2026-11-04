/**
 * Pure model of the Gantt view's dependency layer. The bars, axis and lanes come from the Timeline
 * model (`buildTimeline`); this adds the arrows: which item waits for which, where each end sits in
 * the grid, and which arrows are violated (the prerequisite finishes after the dependent starts).
 * No React and no Firebase, so it is unit tested.
 */
import { columnRegistry, hasCycle, topologicalSort } from '@atrium/shared';
import { addDays, inclusiveSpan } from '../../lib/date-grid';
import { itemSpan } from '../board-date-views/date-view-model';
import type { ColumnView } from '../board-table/table-model';
import {
  TIMELINE_COLUMN_TYPES,
  type LaneWindow,
  type TimelineLane,
  type TimelineModel,
} from '../board-timeline/timeline-model';

/** The saved Dependency column if it still exists, else the first Dependency column, else null. */
export function resolveDependencyColumn(
  columns: readonly ColumnView[],
  columnId: string | null,
): ColumnView | null {
  const usable = columns.filter((c) => c.def.type === 'dependency');
  return usable.find((c) => c.def.id === columnId) ?? usable[0] ?? null;
}

/** Where an item's bar (or its collapsed lane's summary bar) sits on the grid. */
export interface GanttNode {
  id: string;
  name: string;
  /** The item's real first and last day. */
  from: string;
  to: string;
  /** First and last displayed axis index of the drawn bar. */
  startIdx: number;
  endIdx: number;
  /** Row within the whole body (lane offset, summary row and packed row included). */
  row: number;
  /** The lane is collapsed, so the node is the lane's summary bar. */
  collapsed: boolean;
  groupId: string;
  /** The item's index in the view's order (breaks ties on the critical path). */
  order: number;
}

export interface GanttEdge {
  /** `<dependent>:<prerequisite>`. */
  key: string;
  /** The prerequisite (the arrow starts at the end of its bar). */
  from: GanttNode;
  /** The dependent (the arrow ends at the start of its bar). */
  to: GanttNode;
  /** The prerequisite ends after the dependent starts. */
  violated: boolean;
  /** Tooltip of a violated arrow. */
  message: string | null;
}

/** Every drawn item as a node, with the row offsets of its lane. */
export function buildNodes(lanes: readonly TimelineLane[]): Map<string, GanttNode> {
  const nodes = new Map<string, GanttNode>();
  let top = 0;
  for (const lane of lanes) {
    for (const bar of lane.bars) {
      const summary = lane.collapsed ? lane.summary : null;
      nodes.set(bar.key, {
        id: bar.key,
        name: bar.name,
        from: bar.from,
        to: bar.to,
        startIdx: summary ? summary.startIdx : bar.startIdx,
        endIdx: summary ? summary.endIdx : bar.endIdx,
        row: summary ? top : top + lane.summaryRows + bar.row,
        collapsed: lane.collapsed,
        groupId: lane.group.id,
        order: bar.order,
      });
    }
    top += lane.heightRows;
  }
  return nodes;
}

/** The prerequisite ids an item lists in the Dependency column (none for a bad value). */
export function prerequisitesOf(
  values: Readonly<Record<string, unknown>>,
  columnId: string,
): readonly string[] {
  const raw = values[columnId];
  if (raw === null || raw === undefined) return [];
  const parsed = columnRegistry.parseValue('dependency', raw);
  if (!parsed.success) return [];
  return (parsed.data as { item_ids: string[] }).item_ids;
}

/**
 * The arrows of a Gantt: one per (dependent, prerequisite) pair where both items are drawn. Pairs
 * with a missing end (filtered out, no date, deleted) are left out, and so is a pair inside one
 * collapsed lane (both ends would be the same summary bar).
 */
export function buildEdges(model: TimelineModel, dependencyColumnId: string | null): GanttEdge[] {
  if (!dependencyColumnId) return [];
  const nodes = buildNodes(model.lanes);
  const edges: GanttEdge[] = [];
  for (const lane of model.lanes) {
    for (const bar of lane.bars) {
      const to = nodes.get(bar.key);
      if (!to) continue;
      for (const prerequisiteId of prerequisitesOf(bar.item.values, dependencyColumnId)) {
        const from = nodes.get(prerequisiteId);
        if (!from || from.id === to.id) continue;
        if (from.collapsed && to.collapsed && from.groupId === to.groupId) continue;
        const violated = from.to > to.from;
        edges.push({
          key: `${to.id}:${from.id}`,
          from,
          to,
          violated,
          message: violated ? `Starts before ${from.name} finishes` : null,
        });
      }
    }
  }
  return edges;
}

/** Ids of the items on screen: in a rendered lane and, when expanded, within the row window. */
export function renderedNodeIds(windows: readonly LaneWindow[]): Set<string> {
  const ids = new Set<string>();
  for (const win of windows) {
    if (!win.render) continue;
    for (const bar of win.lane.bars) {
      if (win.lane.collapsed || (bar.row >= win.rowFrom && bar.row < win.rowTo)) ids.add(bar.key);
    }
  }
  return ids;
}

/** The arrows with both ends rendered (an arrow to a row outside the window is clipped). */
export function visibleEdges(
  edges: readonly GanttEdge[],
  windows: readonly LaneWindow[],
): GanttEdge[] {
  const rendered = renderedNodeIds(windows);
  return edges.filter((e) => rendered.has(e.from.id) && rendered.has(e.to.id));
}

/**
 * The baseline column: the saved one when it is a Timeline or Date column other than the one the
 * bars use, else none (a baseline is opt-in, so there is no fallback).
 */
export function resolveBaselineColumn(
  columns: readonly ColumnView[],
  baselineColumnId: string | null,
  barColumnId: string | null,
): ColumnView | null {
  if (!baselineColumnId || baselineColumnId === barColumnId) return null;
  return (
    columns.find(
      (c) =>
        c.def.id === baselineColumnId &&
        (TIMELINE_COLUMN_TYPES as readonly string[]).includes(c.def.type),
    ) ?? null
  );
}

/** An item's planned dates as a thin bar under its main bar. */
export interface GanttBaseline {
  id: string;
  from: string;
  to: string;
  /** First and last displayed axis index. */
  startIdx: number;
  endIdx: number;
  /** Row of the item's main bar. */
  row: number;
}

/**
 * The baseline bars: one per drawn item of an expanded lane that has a valid, displayed value in
 * the baseline column. A collapsed lane shows its summary only, so it has none.
 */
export function buildBaselines(model: TimelineModel, column: ColumnView): GanttBaseline[] {
  const baselines: GanttBaseline[] = [];
  const dayCount = model.axis.days.length;
  let top = 0;
  for (const lane of model.lanes) {
    if (!lane.collapsed) {
      for (const bar of lane.bars) {
        const span = itemSpan(bar.item, column);
        if (!span) continue;
        const startIdx = model.axis.lowerBound(span.from);
        const endIdx = model.axis.lowerBound(addDays(span.to, 1)) - 1;
        if (startIdx >= dayCount || endIdx < startIdx) continue;
        baselines.push({
          id: bar.key,
          from: span.from,
          to: span.to,
          startIdx,
          endIdx,
          row: top + lane.summaryRows + bar.row,
        });
      }
    }
    top += lane.heightRows;
  }
  return baselines;
}

/** Baselines whose main bar is on screen (in a rendered lane and the row window). */
export function visibleBaselines(
  baselines: readonly GanttBaseline[],
  windows: readonly LaneWindow[],
): GanttBaseline[] {
  const rendered = renderedNodeIds(windows);
  return baselines.filter((b) => rendered.has(b.id));
}

export interface CriticalPath {
  /** Items on the path, in order from the first prerequisite. */
  ids: string[];
  /** Keys of the arrows between consecutive items on the path. */
  edgeKeys: Set<string>;
  /** The dependencies form a cycle, so no path is computed. */
  cyclic: boolean;
}

const NO_PATH: CriticalPath = { ids: [], edgeKeys: new Set(), cyclic: false };

/**
 * The critical path: the chain of dependent items with the greatest total duration (the days each
 * bar covers). `topologicalSort` orders the items prerequisites first, then each item's best
 * chain is its own duration plus its longest prerequisite chain. Ties go to the item that comes
 * first in the view's order, so the result is stable. With a cycle nothing is highlighted.
 */
export function criticalPath(edges: readonly GanttEdge[]): CriticalPath {
  if (edges.length === 0) return NO_PATH;
  const nodes = new Map<string, GanttNode>();
  const prerequisites = new Map<string, GanttNode[]>();
  for (const edge of edges) {
    nodes.set(edge.from.id, edge.from);
    nodes.set(edge.to.id, edge.to);
    const list = prerequisites.get(edge.to.id) ?? [];
    list.push(edge.from);
    prerequisites.set(edge.to.id, list);
  }
  const graph = new Map<string, string[]>();
  for (const id of nodes.keys()) {
    graph.set(
      id,
      (prerequisites.get(id) ?? []).map((n) => n.id),
    );
  }
  const sorted = topologicalSort(graph);
  if (!sorted) return { ids: [], edgeKeys: new Set(), cyclic: true };

  const earlier = (a: GanttNode, b: GanttNode) => a.order - b.order || a.id.localeCompare(b.id);
  const best = new Map<string, number>();
  const via = new Map<string, GanttNode | null>();
  for (const id of sorted) {
    const node = nodes.get(id)!;
    let pick: GanttNode | null = null;
    for (const p of prerequisites.get(id) ?? []) {
      const pBest = best.get(p.id) ?? 0;
      const kBest = pick ? (best.get(pick.id) ?? 0) : -1;
      if (pBest > kBest || (pBest === kBest && pick && earlier(p, pick) < 0)) pick = p;
    }
    best.set(id, inclusiveSpan(node.from, node.to) + (pick ? (best.get(pick.id) ?? 0) : 0));
    via.set(id, pick);
  }
  let end: GanttNode | null = null;
  for (const id of sorted) {
    const node = nodes.get(id)!;
    const total = best.get(id) ?? 0;
    const endTotal = end ? (best.get(end.id) ?? 0) : -1;
    if (total > endTotal || (total === endTotal && end && earlier(node, end) < 0)) end = node;
  }
  const ids: string[] = [];
  const edgeKeys = new Set<string>();
  for (let node: GanttNode | null | undefined = end; node; node = via.get(node.id)) {
    ids.unshift(node.id);
    const prev = via.get(node.id);
    if (prev) edgeKeys.add(`${node.id}:${prev.id}`);
  }
  return { ids, edgeKeys, cyclic: false };
}

/** The items' prerequisites in `columnId` form a loop (so no critical path can be worked out). */
export function hasDependencyLoop(
  items: readonly { id: string; values: Readonly<Record<string, unknown>> }[],
  columnId: string,
): boolean {
  return hasCycle(
    new Map(items.map((item) => [item.id, prerequisitesOf(item.values, columnId)] as const)),
  );
}
