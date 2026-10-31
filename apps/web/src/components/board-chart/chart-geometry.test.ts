import { describe, expect, it } from 'vitest';
import {
  arcPath,
  bandScale,
  charsThatFit,
  linePath,
  linearScale,
  niceTicks,
  pieArcs,
  stackOffsets,
  truncateLabel,
} from './chart-geometry';

describe('niceTicks', () => {
  it.each([
    [0, 5],
    [0, 7],
    [0, 12],
    [0, 99],
    [0, 1234],
    [0, 0.3],
    [3, 3],
    [0, 0],
    [-40, 120],
    [0, 1_000_000],
  ])('gives 4 to 6 steps that cover %s..%s and include zero', (lo, hi) => {
    const { ticks, min, max } = niceTicks(lo, hi);
    expect(ticks.length - 1).toBeGreaterThanOrEqual(4);
    expect(ticks.length - 1).toBeLessThanOrEqual(6);
    expect(min).toBeLessThanOrEqual(Math.min(lo, 0));
    expect(max).toBeGreaterThanOrEqual(Math.max(hi, 0));
    expect(ticks).toContain(0);
    const step = ticks[1]! - ticks[0]!;
    ticks.forEach((t, i) => expect(t).toBeCloseTo(ticks[0]! + i * step, 6));
  });

  it('uses round steps', () => {
    expect(niceTicks(0, 10).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 100).ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe('scales', () => {
  it('splits a size into bands with padding', () => {
    const band = bandScale(4, 400, 0.5);
    expect(band.step).toBe(100);
    expect(band.bandwidth).toBe(50);
    expect(band.start(0)).toBe(25);
    expect(band.center(1)).toBe(150);
    expect(bandScale(0, 100).step).toBe(100);
  });

  it('maps linearly and survives a flat domain', () => {
    const y = linearScale(0, 10, 100, 0);
    expect(y(0)).toBe(100);
    expect(y(10)).toBe(0);
    expect(y(5)).toBe(50);
    expect(linearScale(3, 3, 9, 0)(3)).toBe(9);
  });
});

describe('stackOffsets', () => {
  it('piles positives up and negatives down, and skips nulls and zeros', () => {
    expect(stackOffsets([2, null, 3, 0, -1, -2])).toEqual([
      { series: 0, from: 0, to: 2 },
      { series: 2, from: 2, to: 5 },
      { series: 4, from: 0, to: -1 },
      { series: 5, from: -1, to: -3 },
    ]);
  });
});

describe('linePath', () => {
  it('breaks the line at a missing value', () => {
    expect(
      linePath([
        { x: 0, y: 1 },
        { x: 10, y: 2 },
        { x: 20, y: null },
        { x: 30, y: 3 },
      ]),
    ).toBe('M0 1L10 2M30 3');
    expect(linePath([])).toBe('');
  });
});

describe('pieArcs', () => {
  it('gives each positive value a share of the circle, clockwise from the top', () => {
    const arcs = pieArcs([1, 0, 3], 50, 50, 40, 0);
    expect(arcs.map((a) => a.index)).toEqual([0, 2]);
    expect(arcs[0]!.share).toBeCloseTo(0.25);
    expect(arcs[0]!.start).toBe(0);
    expect(arcs[1]!.end).toBeCloseTo(Math.PI * 2);
    expect(arcs[0]!.path.startsWith('M50 10')).toBe(true);
    expect(pieArcs([0, -1], 0, 0, 10, 0)).toEqual([]);
  });

  it('draws a single slice as a full circle, with a hole for a donut', () => {
    const [pie] = pieArcs([5], 50, 50, 40, 0);
    expect(pie!.share).toBe(1);
    expect(pie!.path.match(/A/g)).toHaveLength(2);
    const [donut] = pieArcs([5], 50, 50, 40, 20);
    expect(donut!.path.match(/M/g)).toHaveLength(2);
    expect(donut!.path.match(/A/g)).toHaveLength(4);
  });

  it('puts a donut label on the middle of the ring', () => {
    const [arc] = pieArcs([1, 1], 50, 50, 40, 20);
    expect(arc!.labelX).toBeCloseTo(80);
    expect(arc!.labelY).toBeCloseTo(50);
    expect(arcPath(50, 50, 40, 20, 0, 1)).toMatch(/^M.*Z$/);
  });
});

describe('labels', () => {
  it('truncates with an ellipsis', () => {
    expect(truncateLabel('Working on it', 20)).toBe('Working on it');
    expect(truncateLabel('Working on it', 8)).toBe('Working…');
    expect(truncateLabel('Working on it', 1)).toBe('…');
    expect(truncateLabel('Working on it', 0)).toBe('');
  });

  it('counts the characters that fit', () => {
    expect(charsThatFit(100, 7)).toBe(14);
    expect(charsThatFit(100, 0)).toBe(0);
  });
});
