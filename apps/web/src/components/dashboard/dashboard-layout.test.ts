import { DASHBOARD_LIMITS } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  applyGridItems,
  clampLayout,
  collides,
  findFreeSlot,
  layoutHeight,
  moveItem,
  moveItemBy,
  newWidgetLayout,
  normalizeLayout,
  normalizeWidgets,
  resizeItem,
  resizeItemBy,
  toGridItems,
  type GridItem,
} from './dashboard-layout';

const item = (id: string, x: number, y: number, w: number, h: number): GridItem => ({
  id,
  x,
  y,
  w,
  h,
});
const byId = (items: readonly GridItem[], id: string) => items.find((i) => i.id === id)!;
const noOverlaps = (items: readonly GridItem[]) =>
  items.every((a, i) => items.every((b, j) => i === j || !collides(a, b)));

describe('clampLayout', () => {
  it('keeps a valid layout as is', () => {
    expect(clampLayout({ x: 2, y: 3, w: 4, h: 5 })).toEqual({ x: 2, y: 3, w: 4, h: 5 });
  });

  it('clamps size to the limits', () => {
    expect(clampLayout({ x: 0, y: 0, w: 1, h: 1 })).toMatchObject({ w: 2, h: 2 });
    expect(clampLayout({ x: 0, y: 0, w: 40, h: 40 })).toMatchObject({ w: 12, h: 12 });
  });

  it('pulls a widget back inside the right edge', () => {
    expect(clampLayout({ x: 11, y: 0, w: 4, h: 2 })).toMatchObject({ x: 8, w: 4 });
    expect(clampLayout({ x: 99, y: 0, w: 2, h: 2 }).x).toBe(10);
  });

  it('clamps negative and fractional values and NaN', () => {
    expect(clampLayout({ x: -3, y: -1, w: 3.4, h: 2.6 })).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(clampLayout({ x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN })).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
  });

  it('caps y', () => {
    expect(clampLayout({ x: 0, y: 5000, w: 2, h: 2 }).y).toBe(DASHBOARD_LIMITS.maxY);
  });
});

describe('collides', () => {
  it('detects overlap and treats touching edges as free', () => {
    expect(collides({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 3, w: 4, h: 4 })).toBe(true);
    expect(collides({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false);
    expect(collides({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 4, w: 4, h: 4 })).toBe(false);
  });
});

describe('normalizeLayout', () => {
  it('is a no-op for a tidy layout and keeps the input order', () => {
    const items = [item('b', 4, 0, 4, 3), item('a', 0, 0, 4, 3), item('c', 0, 3, 8, 2)];
    expect(normalizeLayout(items)).toEqual(items);
  });

  it('does not mutate its input', () => {
    const items = [item('a', 0, 0, 4, 3), item('b', 0, 0, 4, 3)];
    const copy = structuredClone(items);
    normalizeLayout(items, 'a');
    expect(items).toEqual(copy);
  });

  it('compacts gaps upwards', () => {
    const out = normalizeLayout([item('a', 0, 5, 4, 3), item('b', 4, 9, 4, 3)]);
    expect(byId(out, 'a').y).toBe(0);
    expect(byId(out, 'b').y).toBe(0);
  });

  it('only falls until it touches the widget above', () => {
    const out = normalizeLayout([item('a', 0, 0, 4, 3), item('b', 0, 8, 4, 2)]);
    expect(byId(out, 'b').y).toBe(3);
  });

  it('resolves overlaps by pushing others below the pinned widget', () => {
    const items = [item('a', 0, 0, 6, 4), item('b', 0, 0, 6, 4)];
    const out = normalizeLayout(items, 'b');
    expect(byId(out, 'b')).toMatchObject({ x: 0, y: 0 });
    expect(byId(out, 'a').y).toBe(4);
    expect(noOverlaps(out)).toBe(true);
  });

  it('resolves overlaps without a pinned widget by reading order', () => {
    const out = normalizeLayout([item('a', 0, 0, 6, 4), item('b', 3, 2, 6, 4)]);
    expect(byId(out, 'a')).toMatchObject({ y: 0 });
    expect(byId(out, 'b').y).toBe(4);
    expect(noOverlaps(out)).toBe(true);
  });

  it('cascades a push through a stack', () => {
    const out = normalizeLayout(
      [item('a', 0, 0, 4, 5), item('b', 0, 3, 4, 3), item('c', 0, 6, 4, 3)],
      'a',
    );
    expect(byId(out, 'b').y).toBe(5);
    expect(byId(out, 'c').y).toBe(8);
  });

  it('clamps out-of-range items', () => {
    const out = normalizeLayout([item('a', 20, -4, 99, 1)]);
    expect(out[0]).toEqual({ id: 'a', x: 0, y: 0, w: 12, h: 2 });
  });

  it('always ends overlap-free, in the grid, for a pile of identical widgets', () => {
    const items = Array.from({ length: 24 }, (_, i) => item(`w${i}`, 0, 0, 5, 4));
    const out = normalizeLayout(items, 'w7');
    expect(noOverlaps(out)).toBe(true);
    expect(out.every((i) => i.x >= 0 && i.x + i.w <= 12 && i.y >= 0)).toBe(true);
    expect(byId(out, 'w7')).toMatchObject({ x: 0, y: 0 });
  });

  it('is idempotent', () => {
    const items = [item('a', 3, 7, 6, 4), item('b', 0, 0, 12, 3), item('c', 5, 1, 4, 4)];
    const once = normalizeLayout(items);
    expect(normalizeLayout(once)).toEqual(once);
  });

  it('handles an empty list and an unknown pinned id', () => {
    expect(normalizeLayout([])).toEqual([]);
    expect(normalizeLayout([item('a', 0, 3, 4, 2)], 'zzz')[0]!.y).toBe(0);
  });
});

describe('moveItem and resizeItem', () => {
  const base = () => [item('a', 0, 0, 6, 3), item('b', 6, 0, 6, 3), item('c', 0, 3, 12, 3)];

  it('moves a widget and pushes the one it lands on', () => {
    const out = moveItem(base(), 'a', { x: 6, y: 0 });
    expect(byId(out, 'a')).toMatchObject({ x: 6, y: 0 });
    expect(byId(out, 'b').y).toBe(3);
    expect(noOverlaps(out)).toBe(true);
  });

  it('clamps a move past the right edge', () => {
    const out = moveItem(base(), 'b', { x: 10, y: 0 });
    expect(byId(out, 'b').x).toBe(6);
  });

  it('resizes and pushes neighbours down', () => {
    const out = resizeItem(base(), 'a', { w: 12, h: 4 });
    expect(byId(out, 'a')).toMatchObject({ w: 12, h: 4 });
    expect(byId(out, 'b').y).toBe(4);
    expect(byId(out, 'c').y).toBe(7);
    expect(noOverlaps(out)).toBe(true);
  });

  it('clamps a resize to the limits', () => {
    const out = resizeItem(base(), 'a', { w: 1, h: 99 });
    expect(byId(out, 'a')).toMatchObject({ w: 2, h: 12 });
  });

  it('moves and resizes by arrow-key steps', () => {
    const moved = moveItemBy(base(), 'a', { dx: 1, dy: 0 });
    expect(byId(moved, 'a').x).toBe(1);
    expect(noOverlaps(moved)).toBe(true);
    const left = moveItemBy(base(), 'a', { dx: -1, dy: 0 });
    expect(byId(left, 'a').x).toBe(0);
    const resized = resizeItemBy(base(), 'a', { dw: -1, dh: 1 });
    expect(byId(resized, 'a')).toMatchObject({ w: 5, h: 4 });
    expect(resizeItemBy(base(), 'nope', { dw: 1, dh: 1 })).toEqual(normalizeLayout(base()));
    expect(moveItemBy(base(), 'nope', { dx: 1, dy: 1 })).toEqual(normalizeLayout(base()));
  });
});

describe('findFreeSlot and newWidgetLayout', () => {
  it('uses the origin on an empty grid', () => {
    expect(findFreeSlot([], { w: 4, h: 3 })).toEqual({ x: 0, y: 0 });
  });

  it('finds a gap beside existing widgets', () => {
    expect(findFreeSlot([item('a', 0, 0, 6, 3)], { w: 6, h: 3 })).toEqual({ x: 6, y: 0 });
  });

  it('goes below when the row is full', () => {
    expect(findFreeSlot([item('a', 0, 0, 12, 3)], { w: 6, h: 3 })).toEqual({ x: 0, y: 3 });
  });

  it('fills a hole before the bottom', () => {
    const items = [item('a', 0, 0, 4, 6), item('b', 8, 0, 4, 6), item('c', 0, 6, 12, 2)];
    expect(findFreeSlot(items, { w: 4, h: 3 })).toEqual({ x: 4, y: 0 });
  });

  it('builds a layout from the type defaults', () => {
    expect(newWidgetLayout([], 'numbers')).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(newWidgetLayout([item('a', 0, 0, 3, 3)], 'numbers')).toEqual({
      x: 3,
      y: 0,
      w: 3,
      h: 3,
    });
    expect(newWidgetLayout([item('a', 0, 0, 12, 4)], 'table')).toEqual({
      x: 0,
      y: 4,
      w: 12,
      h: 6,
    });
  });

  it('measures the layout height', () => {
    expect(layoutHeight([])).toBe(0);
    expect(layoutHeight([item('a', 0, 2, 4, 3), item('b', 4, 0, 4, 9)])).toBe(9);
  });
});

describe('widget helpers', () => {
  const widgets = [
    { id: 'a', layout: { x: 0, y: 4, w: 4, h: 3 }, title: 'A' },
    { id: 'b', layout: { x: 0, y: 0, w: 4, h: 3 }, title: 'B' },
  ];

  it('round-trips through grid items', () => {
    expect(applyGridItems(widgets, toGridItems(widgets))).toEqual(widgets);
  });

  it('keeps widgets that have no matching item', () => {
    expect(applyGridItems(widgets, [item('a', 4, 0, 4, 3)])[1]).toBe(widgets[1]);
  });

  it('normalises layouts stored on widgets without touching other fields', () => {
    const out = normalizeWidgets(widgets);
    expect(out.map((w) => w.title)).toEqual(['A', 'B']);
    expect(out[0]!.layout.y).toBe(3);
    expect(out[1]!.layout.y).toBe(0);
  });
});
