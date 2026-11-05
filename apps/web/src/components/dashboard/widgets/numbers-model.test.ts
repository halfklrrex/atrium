import { describe, expect, it, vi } from 'vitest';
import { buildNumbersModel, formatNumber, type NumbersSettings } from './numbers-model';
import { twoBoards } from './widget-test-data';

vi.mock('../../../lib/firebase', () => ({ db: {} }));

const settings = (patch: Partial<NumbersSettings> = {}): NumbersSettings => ({
  mode: 'count',
  columnId: null,
  filter: null,
  ...patch,
});

const run = (
  patch: Partial<NumbersSettings>,
  widgetBoardIds: string[] = [],
  boards = twoBoards(),
) => buildNumbersModel({ boards, widgetBoardIds, settings: settings(patch) });

describe('buildNumbersModel', () => {
  it('counts items across both boards', () => {
    const model = run({});
    expect(model.value).toBe(6);
    expect(model.caption).toBe('6 items');
  });

  it('limits the count to the widget boards', () => {
    expect(run({}, ['b2']).value).toBe(3);
  });

  it('sums a Numbers column, matching the second board column by title', () => {
    const model = run({ mode: 'sum', columnId: 'amount' });
    // 10 + 5.5 on Sales, 20 + 4 on Orders ("amount" has the same title, different case)
    expect(model.value).toBe(39.5);
    expect(model.numberCount).toBe(4);
    expect(model.caption).toBe('Sum of Amount');
  });

  it('averages, finds min and max over the items that have a number', () => {
    expect(run({ mode: 'average', columnId: 'amount' }).value).toBe(39.5 / 4);
    expect(run({ mode: 'min', columnId: 'amount' }).value).toBe(4);
    expect(run({ mode: 'max', columnId: 'amount' }).value).toBe(20);
  });

  it('reads formula columns through the registry', () => {
    // Total = Amount * 2 exists on Sales only: (10 + 5.5 + 0) * 2 (the empty amount counts as 0)
    const model = run({ mode: 'sum', columnId: 'total' });
    expect(model.value).toBe(31);
    expect(model.numberCount).toBe(3);
  });

  it('gives no value for an average of nothing, and 0 for a sum of nothing', () => {
    const boards = twoBoards().map((b) => ({ ...b, items: [] }));
    expect(run({ mode: 'average', columnId: 'amount' }, [], boards).value).toBeNull();
    expect(run({ mode: 'sum', columnId: 'amount' }, [], boards).value).toBe(0);
    expect(run({ mode: 'count' }, [], boards).value).toBe(0);
  });

  it('falls back to a count when the column is gone', () => {
    const model = run({ mode: 'sum', columnId: 'deleted-column' });
    expect(model.fellBack).toBe(true);
    expect(model.value).toBe(6);
  });

  it('filters by status labels, merging labels by text across boards', () => {
    // "done" is label id "done" on Sales and "finished" (text "done") on Orders.
    const model = run({ filter: { columnId: 'status', values: ['done'] } });
    expect(model.value).toBe(2);
    const sum = run({
      mode: 'sum',
      columnId: 'amount',
      filter: { columnId: 'status', values: ['done'] },
    });
    expect(sum.value).toBe(10 + 20); // Sales i1 (done) and Orders j1 (index 0 = done)
  });

  it('treats a filter with no labels chosen as no filter', () => {
    expect(run({ filter: { columnId: 'status', values: [] } }).value).toBe(6);
  });

  it('formats numbers with grouping and at most two decimals', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.89');
    expect(formatNumber(0)).toBe('0');
  });
});
