import { describe, expect, it } from 'vitest';
import { largeViewsBoard, viewsBoard } from '../../test/workbook-boards';
import { buildViewSheets } from './view-sheet-data';

function sheets(input = viewsBoard()) {
  return buildViewSheets({
    boardId: input.board.id,
    views: input.views ?? [],
    items: input.allItems ?? input.items,
    columns: input.columns,
    groups: input.groups,
    personNames: input.personNames,
    today: '2026-11-08',
  });
}

describe('buildViewSheets', () => {
  it('makes one sheet per view type, in the fixed order, skipping the table', () => {
    expect(sheets().map((s) => s.type)).toEqual([
      'kanban',
      'calendar',
      'timeline',
      'gantt',
      'chart',
      'workload',
    ]);
  });

  it('builds Kanban lanes from the view model with card lines', () => {
    const k = sheets().find((s) => s.type === 'kanban');
    if (k?.type !== 'kanban') throw new Error('no kanban');
    expect(k.cardColumns).toEqual(['Owner', 'Due date', 'Priority']);
    expect(k.lanes.map((l) => [l.title, l.total])).toEqual([
      ['Working on it', 3],
      ['Done', 2],
      ['Stuck', 2],
      ['In review', 2],
      ['Empty', 1],
    ]);
    expect(k.lanes[0]?.cards[0]).toEqual({
      name: 'Brief',
      groupColor: '#579bfc',
      lines: ['Owner: Avery Quinn, Blake Rivera', 'Due date: 2026-11-02', 'Priority: Critical ⚠️'],
    });
  });

  it('lists Calendar entries on each day in the status colour', () => {
    const c = sheets().find((s) => s.type === 'calendar');
    if (c?.type !== 'calendar') throw new Error('no calendar');
    expect(c.months).toEqual(['2026-11']);
    expect(c.entries['2026-11-02']).toEqual([{ name: 'Brief', color: '#fdab3d' }]);
  });

  it('marks Gantt prerequisites and the critical path', () => {
    const g = sheets().find((s) => s.type === 'gantt');
    if (g?.type !== 'gantt') throw new Error('no gantt');
    const items = g.rows.flatMap((r) => (r.kind === 'item' ? [r] : []));
    expect(items).toHaveLength(10);
    expect(items.find((r) => r.name === 'Design')).toMatchObject({
      dependsOn: 'Brief',
      critical: true,
    });
  });

  it('charts by status with the label colours', () => {
    const ch = sheets().find((s) => s.type === 'chart');
    if (ch?.type !== 'chart') throw new Error('no chart');
    expect(ch.chartType).toBe('bar');
    expect(ch.buckets.slice(0, 2)).toEqual([
      { label: 'Working on it', color: '#fdab3d', value: 3 },
      { label: 'Done', color: '#00c875', value: 2 },
    ]);
  });

  it('builds Workload rows per person', () => {
    const w = sheets().find((s) => s.type === 'workload');
    if (w?.type !== 'workload') throw new Error('no workload');
    expect(w.rows.map((r) => r.name)).toContain('Avery Quinn');
    expect(w.periods.some((p) => p.today)).toBe(true);
    expect(w.rows.every((r) => r.values.length === w.periods.length)).toBe(true);
  });

  it('caps the large board and says so', () => {
    const all = sheets(largeViewsBoard());
    const t = all.find((s) => s.type === 'timeline');
    const c = all.find((s) => s.type === 'calendar');
    const w = all.find((s) => s.type === 'workload');
    if (t?.type !== 'timeline' || c?.type !== 'calendar' || w?.type !== 'workload') {
      throw new Error('missing sheets');
    }
    expect(t.rows.filter((r) => r.kind === 'item')).toHaveLength(500);
    expect(t.note).toContain('Showing the first 500 of 1200 items.');
    expect(c.months).toHaveLength(24);
    expect(w.periods.length).toBeLessThanOrEqual(104);
  }, 60_000);
});
