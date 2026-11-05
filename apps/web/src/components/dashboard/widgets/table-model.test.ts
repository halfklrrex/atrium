import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem } from '../../../test/fixtures';
import { buildTableModel, type TableSettings } from './table-model';
import type { WidgetBoardData } from './widget-columns';
import { column, status, statusColumn, twoBoards } from './widget-test-data';

vi.mock('../../../lib/firebase', () => ({ db: {} }));

const settings = (patch: Partial<TableSettings> = {}): TableSettings => ({
  columnIds: [],
  filter: null,
  rowLimit: 10,
  ...patch,
});
const run = (patch: Partial<TableSettings> = {}, ids: string[] = [], boards = twoBoards()) =>
  buildTableModel({ boards, widgetBoardIds: ids, settings: settings(patch) });
const names = (m: ReturnType<typeof run>) => m.rows.map((r) => r.row.item.id);

describe('buildTableModel', () => {
  it('lists the items of both boards with default columns', () => {
    const model = run();
    expect(model.total).toBe(6);
    expect(model.headers).toEqual(['Status', 'People', 'Date']);
    expect(names(model).sort()).toEqual(['i1', 'i2', 'i3', 'j1', 'j2', 'j3']);
    expect(model.note).toBeNull();
  });

  it('limits to the widget boards', () => {
    expect(names(run({}, ['b2'])).sort()).toEqual(['j1', 'j2', 'j3']);
  });

  it('filters by status label text across boards', () => {
    const model = run({ filter: { columnId: 'status', values: ['done'] } });
    // "Done" on Sales, "done" on Orders
    expect(names(model).sort()).toEqual(['i1', 'j1']);
  });

  it('caps the rows and says how many are hidden', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeItem({ id: `r${i}`, position: `a${i}` }),
    );
    const board = makeBoard({ id: 'big', columns: [statusColumn('status')] });
    const model = run({}, [], [{ board, items }]);
    expect(model.rows).toHaveLength(10);
    expect(model.total).toBe(12);
    expect(model.note).toBe('Showing 10 of 12');
  });

  it('matches chosen columns across boards and computes formulas', () => {
    const model = run({ columnIds: ['amount', 'total'] });
    expect(model.headers).toEqual(['Amount', 'Total']);
    const i1 = model.rows.find((r) => r.row.item.id === 'i1')!;
    expect(i1.cells[0]?.value).toBe(10);
    expect(i1.cells[1]?.value).toBe(20);
    const j1 = model.rows.find((r) => r.row.item.id === 'j1')!;
    expect(j1.cells[0]?.value).toBe(20); // "amount" on Orders, matched by title
    expect(j1.cells[1]).toBeNull(); // Orders has no Total column
  });

  it('skips subitems and handles empty boards', () => {
    const board = makeBoard({ id: 'e', columns: [column('s', 'status', 'Status')] });
    const sub = makeItem({ id: 'sub', parentItemId: 'p', values: { s: status(0) } });
    const data: WidgetBoardData[] = [{ board, items: [sub] }];
    const model = run({}, [], data);
    expect(model.total).toBe(0);
    expect(model.rows).toEqual([]);
  });

  it('drops boards without the filter column', () => {
    const bare = makeBoard({ id: 'bare', columns: [] });
    const data = [...twoBoards(), { board: bare, items: [makeItem({ id: 'z' })] }];
    const model = run({ filter: { columnId: 'status', values: ['done'] } }, [], data);
    expect(names(model).sort()).toEqual(['i1', 'j1']);
  });
});
