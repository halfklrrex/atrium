import { describe, expect, it } from 'vitest';
import { makeBoard, makeItem } from '../../../test/fixtures';
import { UNASSIGNED_ID } from '../../board-workload/workload-model';
import { column } from './widget-test-data';
import { buildWorkloadWidgetModel, type WorkloadWidgetSettings } from './workload-widget-model';
import type { WidgetBoardData } from './widget-columns';

const settings = (over: Partial<WorkloadWidgetSettings> = {}): WorkloadWidgetSettings => ({
  peopleColumnId: null,
  dateColumnId: null,
  bucket: 'week',
  ...over,
});
const who = (...ids: string[]) => ({ personsAndTeams: ids.map((id) => ({ id, kind: 'person' })) });
const nameOf = (id: string) => ({ ann: 'Ann Example', bo: 'Bo Example' })[id as 'ann'];
const TODAY = '2026-11-04'; // a Wednesday

function boards(): WidgetBoardData[] {
  const b1 = makeBoard({
    id: 'b1',
    name: 'Sales',
    columns: [column('who', 'people', 'Owner'), column('when', 'timeline', 'Dates')],
  });
  const b2 = makeBoard({
    id: 'b2',
    name: 'Orders',
    columns: [column('p2', 'people', 'Owner'), column('d2', 'date', 'Due')],
  });
  return [
    {
      board: b1,
      items: [
        makeItem({
          id: 'i1',
          values: { who: who('ann'), when: { from: '2026-11-02', to: '2026-11-03' } },
        }),
        makeItem({ id: 'i2', values: { when: { from: '2026-11-04', to: '2026-11-04' } } }),
      ],
    },
    {
      board: b2,
      items: [
        makeItem({ id: 'j1', values: { p2: who('ann', 'bo'), d2: { date: '2026-11-05' } } }),
        makeItem({ id: 'j2', values: { p2: who('bo') } }),
      ],
    },
  ];
}

describe('buildWorkloadWidgetModel', () => {
  it('merges two boards into one axis, one row per person', () => {
    const result = buildWorkloadWidgetModel({
      boards: boards(),
      widgetBoardIds: [],
      settings: settings(),
      today: TODAY,
      nameOf,
    });
    expect(result.boardCount).toBe(2);
    const rows = result.model!.rows;
    expect(rows.map((r) => r.name)).toEqual(['Ann Example', 'Bo Example', 'Unassigned']);
    const ann = rows[0]!;
    expect(ann.itemCount).toBe(2);
    expect(rows[1]!.itemCount).toBe(1);
    expect(rows[2]!.id).toBe(UNASSIGNED_ID);
    expect(result.model!.noDates.map((i) => i.id)).toEqual(['b2:j2']);
    expect(result.summary).toContain('2 people');
  });

  it('honours the board subset and the month bucket', () => {
    const result = buildWorkloadWidgetModel({
      boards: boards(),
      widgetBoardIds: ['b2'],
      settings: settings({ bucket: 'month' }),
      today: TODAY,
      nameOf,
    });
    expect(result.boardCount).toBe(1);
    expect(result.model!.zoom).toBe('months');
    expect(result.model!.rows.map((r) => r.name)).toEqual(['Ann Example', 'Bo Example']);
  });

  it('matches a saved date column across boards by type and title', () => {
    const result = buildWorkloadWidgetModel({
      boards: boards(),
      widgetBoardIds: [],
      settings: settings({ dateColumnId: 'when' }),
      today: TODAY,
      nameOf,
    });
    // Board 2 has no timeline "Dates", so it falls back to its own date column.
    expect(result.model!.rows[0]!.itemCount).toBe(2);
  });

  it('skips boards without a date column and handles no data at all', () => {
    const none = makeBoard({ id: 'b3', name: 'Notes', columns: [column('t', 'text', 'Text')] });
    const result = buildWorkloadWidgetModel({
      boards: [{ board: none, items: [makeItem({ id: 'n1' })] }],
      widgetBoardIds: [],
      settings: settings(),
      today: TODAY,
    });
    expect(result.model).toBeNull();
    expect(result.skippedBoards).toEqual(['Notes']);

    const empty = buildWorkloadWidgetModel({
      boards: [{ board: boards()[0]!.board, items: [] }],
      widgetBoardIds: [],
      settings: settings(),
      today: TODAY,
    });
    expect(empty.model!.rows).toEqual([]);
    expect(empty.model!.noItemsDated).toBe(true);
  });

  it('ignores subitems', () => {
    const data = boards();
    data[0] = {
      ...data[0]!,
      items: [
        ...data[0]!.items,
        makeItem({
          id: 'sub',
          parentItemId: 'i1',
          values: { who: who('bo'), when: { from: '2026-11-02', to: '2026-11-02' } },
        }),
      ],
    };
    const result = buildWorkloadWidgetModel({
      boards: data,
      widgetBoardIds: ['b1'],
      settings: settings(),
      today: TODAY,
      nameOf,
    });
    expect(result.model!.rows.map((r) => r.name)).toEqual(['Ann Example', 'Unassigned']);
  });
});
