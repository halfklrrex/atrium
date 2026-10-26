import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATUS_COLOR,
  EMPTY_STATUS_KEY,
  checkboxColumn,
  columnRegistry,
  dateColumn,
  numbersColumn,
  statusColumn,
  statusDistribution,
  type StatusSettings,
} from './index';

const status: StatusSettings = {
  labels: [
    { id: 'working', index: 0, label: 'Working on it', color: '#fdab3d' },
    { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
    { id: 'default', index: 5, label: '', color: '#c4c4c4' },
  ],
};

describe('status footer battery', () => {
  it('counts each label in label order and puts empty cells last', () => {
    const result = statusDistribution(
      [{ index: 1 }, { index: 1 }, { index: 0 }, null, undefined, { index: 5 }],
      status,
    );
    expect(result.total).toBe(6);
    expect(result.segments).toEqual([
      { key: 'working', label: 'Working on it', color: '#fdab3d', count: 1 },
      { key: 'done', label: 'Done', color: '#00c875', count: 2 },
      { key: EMPTY_STATUS_KEY, label: '', color: EMPTY_STATUS_COLOR, count: 3 },
    ]);
  });

  it('skips labels nobody uses and has no segments for no cells', () => {
    expect(statusDistribution([{ index: 2 }], status).segments.map((s) => s.key)).toEqual([
      'stuck',
    ]);
    expect(statusDistribution([], status)).toEqual({ total: 0, segments: [] });
  });

  it('treats a value pointing at a deleted label as empty', () => {
    const result = statusDistribution([{ index: 9 }], status);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.key).toBe(EMPTY_STATUS_KEY);
  });

  it('is available through the registry and ignores invalid cell values', () => {
    const result = columnRegistry.aggregate('status', [{ index: 1 }, { nonsense: true }], status);
    expect(result).toMatchObject({ kind: 'distribution', total: 2 });
  });
});

describe('numbers footer', () => {
  const settings = { unit: null, decimals: null };

  it('sums numbers and numeric strings, skipping empty cells', () => {
    expect(numbersColumn.aggregate!([1200, '30.5', null, undefined], settings)).toEqual({
      kind: 'sum',
      sum: 1230.5,
      count: 2,
    });
  });

  it('is zero for an empty group', () => {
    expect(numbersColumn.aggregate!([], settings)).toEqual({ kind: 'sum', sum: 0, count: 0 });
  });
});

describe('date footer', () => {
  const settings = { hideWeekdays: false };

  it('gives the earliest to latest range', () => {
    expect(
      dateColumn.aggregate!(
        [
          { date: '2026-11-12' },
          null,
          { date: '2026-10-03', time: '10:00:00' },
          { date: '2026-10-20' },
        ],
        settings,
      ),
    ).toEqual({ kind: 'range', earliest: '2026-10-03', latest: '2026-11-12' });
  });

  it('is null when no cell has a date', () => {
    expect(dateColumn.aggregate!([null, undefined], settings)).toBeNull();
  });
});

describe('checkbox footer', () => {
  it('counts ticked cells out of all cells', () => {
    expect(
      checkboxColumn.aggregate!(
        [{ checked: 'true' }, { checked: 'false' }, null, { checked: true }, null],
        {},
      ),
    ).toEqual({ kind: 'ratio', filled: 2, total: 5 });
  });
});

describe('types without a footer summary', () => {
  it.each(['text', 'long_text', 'link', 'people', 'dropdown'])('%s has no aggregate', (type) => {
    expect(columnRegistry.aggregate(type, [], columnRegistry.defaultSettings(type))).toBeNull();
  });

  it('keeps status in the registry list', () => {
    expect(statusColumn.aggregate).toBeTypeOf('function');
  });
});
