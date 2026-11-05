import { describe, expect, it } from 'vitest';
import { cellSteps, deltaToCells } from './grid-metrics';

// 12 columns of 70 plus 11 gaps of 10 = 950.
const metrics = { width: 950, gap: 10, rowHeight: 50 };

describe('grid metrics', () => {
  it('measures the distance between cell starts', () => {
    expect(cellSteps(metrics)).toEqual({ x: 80, y: 60 });
  });

  it('rounds a pointer delta to the nearest whole cell', () => {
    expect(deltaToCells({ x: 100, y: 20 }, metrics)).toEqual({ dx: 1, dy: 0 });
    expect(deltaToCells({ x: 125, y: 31 }, metrics)).toEqual({ dx: 2, dy: 1 });
    expect(deltaToCells({ x: -85, y: -61 }, metrics)).toEqual({ dx: -1, dy: -1 });
  });

  it('never returns negative zero', () => {
    const { dx, dy } = deltaToCells({ x: -10, y: -10 }, metrics);
    expect(Object.is(dx, 0)).toBe(true);
    expect(Object.is(dy, 0)).toBe(true);
  });

  it('does nothing for a degenerate grid', () => {
    expect(deltaToCells({ x: 100, y: 100 }, { width: 0, gap: 0, rowHeight: 0 })).toEqual({
      dx: 0,
      dy: 0,
    });
  });
});
