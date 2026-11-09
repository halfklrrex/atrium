import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_STATUS_LABELS } from '../boards';
import { DEFAULT_PRIORITY_LABELS, DEFAULT_STATUS_LABELS, statusSettingsSchema } from './status';

describe('default status and priority labels', () => {
  it('a new Status column and a new board start with the same labels', () => {
    expect(DEFAULT_BOARD_STATUS_LABELS).toEqual(DEFAULT_STATUS_LABELS);
    expect(DEFAULT_STATUS_LABELS.map((l) => l.index)).toEqual([0, 1, 2, 5]);
  });

  it('Priority is Critical red, High orange, Medium blue, Low light blue, Critical first', () => {
    expect(DEFAULT_PRIORITY_LABELS.map((l) => [l.index, l.label, l.color])).toEqual([
      [0, 'Critical', '#df2f4a'],
      [1, 'High', '#fdab3d'],
      [2, 'Medium', '#579bfc'],
      [3, 'Low', '#66ccff'],
    ]);
    expect(statusSettingsSchema.safeParse({ labels: DEFAULT_PRIORITY_LABELS }).success).toBe(true);
  });
});
