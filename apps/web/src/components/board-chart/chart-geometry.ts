/**
 * Pure geometry for the Chart view: nice axis ticks, band scales, stacked offsets, pie arcs, line
 * paths and label truncation. No React and no DOM, so every function is unit-tested directly.
 */

export interface NiceTicks {
  ticks: number[];
  min: number;
  max: number;
}

const STEP_MANTISSAS = [1, 2, 2.5, 5] as const;

/** Ticks from at most `minValue` to at least `maxValue`, 4 to 6 steps, always including zero. */
export function niceTicks(minValue: number, maxValue: number, target = 5): NiceTicks {
  const lo = Math.min(minValue, 0);
  let hi = Math.max(maxValue, 0);
  if (hi === lo) hi = lo + 1;
  const range = hi - lo;
  const startPower = Math.floor(Math.log10(range / 8));
  let best: { step: number; n: number } | null = null;
  for (let power = startPower; power <= startPower + 2; power += 1) {
    for (const mantissa of STEP_MANTISSAS) {
      const step = mantissa * 10 ** power;
      const n = Math.round(Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9));
      if (n < 4 || n > 6) continue;
      if (!best || Math.abs(n - target) < Math.abs(best.n - target)) best = { step, n };
    }
  }
  const step = best?.step ?? 10 ** Math.ceil(Math.log10(range / target));
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const ticks: number[] = [];
  for (let i = first; i <= last; i += 1) ticks.push(Number((i * step).toFixed(decimals)));
  return { ticks, min: ticks[0] ?? 0, max: ticks[ticks.length - 1] ?? 1 };
}

export interface BandScale {
  /** Distance from one band start to the next. */
  step: number;
  bandwidth: number;
  /** Left edge of band `index`. */
  start: (index: number) => number;
  /** Centre of band `index`. */
  center: (index: number) => number;
}

/** `count` equal bands across `size`, each with `padding` (0..1) of its step left empty around it. */
export function bandScale(count: number, size: number, padding = 0.3): BandScale {
  const safe = Math.max(1, count);
  const step = size / safe;
  const bandwidth = step * (1 - padding);
  const inset = (step - bandwidth) / 2;
  return {
    step,
    bandwidth,
    start: (index) => index * step + inset,
    center: (index) => index * step + step / 2,
  };
}

export interface LinearScale {
  (value: number): number;
}

/** Maps `[d0, d1]` onto `[r0, r1]`. A flat domain maps to `r0`. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  const span = d1 - d0;
  return (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

export interface StackSegment {
  /** Index of the series in the input. */
  series: number;
  from: number;
  to: number;
}

/**
 * Stack `values` (one number per series, `null` = nothing) on one bar. Positive values pile up from
 * zero, negative values pile down from zero.
 */
export function stackOffsets(values: readonly (number | null)[]): StackSegment[] {
  let up = 0;
  let down = 0;
  const out: StackSegment[] = [];
  values.forEach((value, series) => {
    if (value === null || value === 0) return;
    if (value > 0) {
      out.push({ series, from: up, to: up + value });
      up += value;
    } else {
      out.push({ series, from: down, to: down + value });
      down += value;
    }
  });
  return out;
}

export interface Point {
  x: number;
  y: number | null;
}

/** A polyline path; a `null` y breaks the line (a gap), so a missing value never reads as zero. */
export function linePath(points: readonly Point[]): string {
  let path = '';
  let pen = false;
  for (const point of points) {
    if (point.y === null) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`;
    pen = true;
  }
  return path;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export interface Arc {
  index: number;
  value: number;
  /** Radians, clockwise from twelve o'clock. */
  start: number;
  end: number;
  /** Fraction of the whole, 0..1. */
  share: number;
  path: string;
  /** Where a label sits (middle of the ring). */
  labelX: number;
  labelY: number;
}

const polar = (cx: number, cy: number, r: number, angle: number): [number, number] => [
  cx + r * Math.sin(angle),
  cy - r * Math.cos(angle),
];

/**
 * The SVG path of one ring slice (`inner` 0 = a pie wedge). A full circle is drawn as two arcs per
 * edge; fill it with `fill-rule: evenodd` so a donut keeps its hole.
 */
export function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const pt = (r: number, angle: number): string => {
    const [x, y] = polar(cx, cy, r, angle);
    return `${round(x)} ${round(y)}`;
  };
  if (end - start >= Math.PI * 2 - 1e-6) {
    let path = `M${pt(outer, start)}A${outer} ${outer} 0 1 1 ${pt(outer, start + Math.PI)}A${outer} ${outer} 0 1 1 ${pt(outer, start)}`;
    if (inner > 0) {
      path += `M${pt(inner, start)}A${inner} ${inner} 0 1 0 ${pt(inner, start + Math.PI)}A${inner} ${inner} 0 1 0 ${pt(inner, start)}`;
    }
    return `${path}Z`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  let path = `M${pt(outer, start)}A${outer} ${outer} 0 ${large} 1 ${pt(outer, end)}`;
  path +=
    inner > 0
      ? `L${pt(inner, end)}A${inner} ${inner} 0 ${large} 0 ${pt(inner, start)}`
      : `L${round(cx)} ${round(cy)}`;
  return `${path}Z`;
}

/** Slices for the positive `values`, in order, starting at twelve o'clock. Zero and negative values get no slice. */
export function pieArcs(
  values: readonly number[],
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): Arc[] {
  const total = values.reduce((sum, v) => (v > 0 ? sum + v : sum), 0);
  if (total <= 0) return [];
  let angle = 0;
  const arcs: Arc[] = [];
  values.forEach((value, index) => {
    if (!(value > 0)) return;
    const share = value / total;
    const start = angle;
    const end = angle + share * Math.PI * 2;
    angle = end;
    const mid = (start + end) / 2;
    const [labelX, labelY] = polar(cx, cy, inner > 0 ? (outer + inner) / 2 : outer * 0.62, mid);
    arcs.push({
      index,
      value,
      start,
      end,
      share,
      path: arcPath(cx, cy, outer, inner, start, end),
      labelX: round(labelX),
      labelY: round(labelY),
    });
  });
  return arcs;
}

/** `label` cut to at most `maxChars` characters, ending in an ellipsis when it was cut. */
export function truncateLabel(label: string, maxChars: number): string {
  if (maxChars < 1) return '';
  if (label.length <= maxChars) return label;
  if (maxChars === 1) return '…';
  return `${label.slice(0, maxChars - 1).trimEnd()}…`;
}

/** How many characters of a label fit in `width` when a character is about `charWidth` wide. */
export function charsThatFit(width: number, charWidth: number): number {
  return charWidth > 0 ? Math.max(0, Math.floor(width / charWidth)) : 0;
}
