/**
 * Arrow geometry for the Gantt, in SVG user units (one unit is one pixel of the grid). Pure: given
 * where two bars sit, it returns the elbow connector's path and its arrowhead.
 */
import { MIN_BAR_PX } from '../board-timeline/timeline-model';

/** The stub an arrow leaves the prerequisite's end by. */
export const ARROW_STUB = 12;
/** Length and half-width of the arrowhead. */
export const ARROW_HEAD_LENGTH = 8;
export const ARROW_HEAD_HALF_WIDTH = 4;

/** A bar's horizontal extent and the y of its vertical centre. */
export interface BarBox {
  left: number;
  right: number;
  midY: number;
}

export interface ArrowShape {
  /** The connector line (an open path). */
  line: string;
  /** The arrowhead (a closed triangle pointing right at the dependent's start). */
  head: string;
  /** Where the line starts, and the arrowhead tip. */
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** A bar's box from its displayed range and row. `rowHeight` is the height of one row. */
export function barBox(
  startIdx: number,
  endIdx: number,
  row: number,
  dayWidth: number,
  rowHeight: number,
): BarBox {
  const left = startIdx * dayWidth;
  const width = Math.max((endIdx - startIdx + 1) * dayWidth, MIN_BAR_PX);
  return { left, right: left + width, midY: (row + 0.5) * rowHeight };
}

const pt = (x: number, y: number): string => `${x} ${y}`;

/**
 * The connector from the end of `from` to the start of `to` (finish to start). When the dependent
 * starts far enough right, the line leaves the prerequisite, steps vertically and enters the
 * dependent. When it starts before the prerequisite ends (reversed order or overlapping), the line
 * leaves right, drops (or climbs) half a row to run back left between the rows, then enters from
 * the left.
 */
export function arrowShape(from: BarBox, to: BarBox, rowHeight: number): ArrowShape {
  const x1 = from.right;
  const y1 = from.midY;
  const x2 = to.left;
  const y2 = to.midY;
  const lineEnd = x2 - ARROW_HEAD_LENGTH;
  const head = `M ${pt(x2, y2)} L ${pt(lineEnd, y2 - ARROW_HEAD_HALF_WIDTH)} L ${pt(lineEnd, y2 + ARROW_HEAD_HALF_WIDTH)} Z`;

  let line: string;
  if (y1 === y2 && lineEnd >= x1) {
    line = `M ${pt(x1, y1)} H ${lineEnd}`;
  } else if (lineEnd >= x1 + ARROW_STUB) {
    // Room for one vertical step, halfway between the two ends but never inside the stub.
    const stepX = Math.max(x1 + ARROW_STUB, Math.min(lineEnd - ARROW_STUB, (x1 + lineEnd) / 2));
    line = `M ${pt(x1, y1)} H ${stepX} V ${y2} H ${lineEnd}`;
  } else {
    const outX = x1 + ARROW_STUB;
    const inX = Math.min(lineEnd - ARROW_STUB, outX - ARROW_STUB);
    // Run back left along the gap between the rows (below when the target is lower or level).
    const gapY = y2 >= y1 ? y1 + rowHeight / 2 : y1 - rowHeight / 2;
    line = `M ${pt(x1, y1)} H ${outX} V ${gapY} H ${inX} V ${y2} H ${lineEnd}`;
  }
  return { line, head, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
}
