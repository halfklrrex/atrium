import { describe, expect, it } from 'vitest';
import { MIN_BAR_PX } from '../board-timeline/timeline-model';
import { ARROW_HEAD_LENGTH, ARROW_STUB, arrowShape, barBox } from './gantt-geometry';

const ROW = 32;
const DAY = 16;

describe('barBox', () => {
  it('places a bar by its axis range and row centre', () => {
    expect(barBox(2, 4, 3, DAY, ROW)).toEqual({ left: 32, right: 80, midY: 3.5 * ROW });
  });

  it('never narrower than the minimum bar width', () => {
    const box = barBox(1, 1, 0, 4, ROW);
    expect(box.right - box.left).toBe(MIN_BAR_PX);
  });
});

describe('arrowShape', () => {
  it('is a straight line for items on the same row, end to start', () => {
    const shape = arrowShape(barBox(0, 2, 1, DAY, ROW), barBox(6, 8, 1, DAY, ROW), ROW);
    expect(shape.start).toEqual({ x: 48, y: 1.5 * ROW });
    expect(shape.end).toEqual({ x: 96, y: 1.5 * ROW });
    expect(shape.line).toBe(`M 48 ${1.5 * ROW} H ${96 - ARROW_HEAD_LENGTH}`);
    expect(shape.head.startsWith(`M 96 ${1.5 * ROW}`)).toBe(true);
  });

  it('steps between rows with one elbow when the dependent starts later', () => {
    const shape = arrowShape(barBox(0, 2, 1, DAY, ROW), barBox(8, 9, 3, DAY, ROW), ROW);
    expect(shape.start).toEqual({ x: 48, y: 1.5 * ROW });
    expect(shape.end).toEqual({ x: 128, y: 3.5 * ROW });
    const stepX = (48 + (128 - ARROW_HEAD_LENGTH)) / 2;
    expect(shape.line).toBe(
      `M 48 ${1.5 * ROW} H ${stepX} V ${3.5 * ROW} H ${128 - ARROW_HEAD_LENGTH}`,
    );
  });

  it('runs back left between the rows when the dependent starts before the prerequisite ends', () => {
    const shape = arrowShape(barBox(4, 8, 1, DAY, ROW), barBox(2, 3, 3, DAY, ROW), ROW);
    const outX = 144 + ARROW_STUB;
    expect(shape.line.startsWith(`M 144 ${1.5 * ROW} H ${outX} V ${2 * ROW} H `)).toBe(true);
    expect(shape.line.endsWith(`V ${3.5 * ROW} H ${32 - ARROW_HEAD_LENGTH}`)).toBe(true);
  });

  it('climbs when the dependent is on an earlier row', () => {
    const shape = arrowShape(barBox(4, 8, 3, DAY, ROW), barBox(2, 3, 1, DAY, ROW), ROW);
    expect(shape.line).toContain(`V ${3 * ROW} H`);
  });
});
