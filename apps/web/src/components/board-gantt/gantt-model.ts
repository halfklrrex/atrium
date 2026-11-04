/**
 * Pure model of the Gantt view's dependency layer. The bars, axis and lanes come from the Timeline
 * model (`buildTimeline`); this adds the arrows: which item waits for which, where each end sits in
 * the grid, and which arrows are violated (the prerequisite finishes after the dependent starts).
 * No React and no Firebase, so it is unit tested.
 */
import { columnRegistry } from '@atrium/shared';
import type { ColumnView } from '../board-table/table-model';
import type { LaneWindow, TimelineLane, TimelineModel } from '../board-timeline/timeline-model';

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
