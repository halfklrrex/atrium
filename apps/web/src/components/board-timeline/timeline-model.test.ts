import {
  columnRegistry,
  createDefaultFilterState,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { buildColumnViews } from '../board-table/table-model';
import {
  MAX_AXIS_DAYS,
  WINDOW_THRESHOLD_ROWS,
  buildAxis,
  buildTimeline,
  labelWidthPx,
  packRows,
  planBarChange,
  planDrag,
  resolveDrag,
  resolveTimelineColumn,
  summaryRange,
  windowLanes,
  type BuildTimelineInput,
  type TimelineBar,
  type TimelineLane,
} from './timeline-model';

const column = (
  id: string,
  type: string,
  title: string,
  position: string,
  settings?: unknown,
): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: (settings ?? columnRegistry.defaultSettings(type)) as Record<string, unknown>,
});

const status = {
  labels: [
    { id: 'todo', index: 0, label: 'To do', color: '#579bfc' },
    { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
  ],
};

const columns = buildColumnViews([
  column('status', 'status', 'Status', 'a0', status),
  column('due', 'date', 'Due', 'a1'),
  column('plan', 'timeline', 'Plan', 'a2'),
]);
const due = columns.find((c) => c.def.id === 'due')!;
const plan = columns.find((c) => c.def.id === 'plan')!;

const groups: GroupDef[] = [
  { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
  { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
  { id: 'g3', title: 'Empty', color: '#ff642e', position: 'a2' },
];

const settings = {
  zoom: 'days' as const,
  colorBy: null,
  collapsedGroupIds: [] as string[],
  showGroupSummary: true,
  showWeekends: true,
};

// Saturday 24 October 2026.
const TODAY = '2026-10-24';

function build(overrides: Partial<BuildTimelineInput> = {}) {
  return buildTimeline({
    items: [],
    column: plan,
    columns,
    groups,
    search: '',
    settings,
    today: TODAY,
    ...overrides,
  });
}

const span = (id: string, name: string, groupId: string, from: string, to: string, pos = 'a0') =>
  makeItem({ id, name, groupId, position: pos, values: { plan: { from, to } } });

describe('resolveTimelineColumn', () => {
  it('uses the saved column when it is a date or timeline column', () => {
    expect(resolveTimelineColumn(columns, 'due')?.def.id).toBe('due');
    expect(resolveTimelineColumn(columns, 'plan')?.def.id).toBe('plan');
  });

  it('falls back to the first timeline column, then the first date column', () => {
    expect(resolveTimelineColumn(columns, null)?.def.id).toBe('plan');
    expect(resolveTimelineColumn(columns, 'status')?.def.id).toBe('plan');
    expect(resolveTimelineColumn(columns, 'gone')?.def.id).toBe('plan');
    const dateOnly = columns.filter((c) => c.def.type !== 'timeline');
    expect(resolveTimelineColumn(dateOnly, 'gone')?.def.id).toBe('due');
  });

  it('is null when the board has no usable column', () => {
    expect(
      resolveTimelineColumn(
        columns.filter((c) => c.def.type === 'status'),
        null,
      ),
    ).toBeNull();
  });
});

describe('buildAxis', () => {
  it('lists every day with a month row over a day row, and marks today', () => {
    const axis = buildAxis('2026-10-29', '2026-11-02', 'days', true, '2026-10-31');
    expect(axis.days).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(axis.top.map((c) => [c.label, c.span])).toEqual([
      ['October 2026', 3],
      ['November 2026', 2],
    ]);
    expect(axis.cells.map((c) => c.label)).toEqual(['Th 29', 'Fr 30', 'Sa 31', 'Su 1', 'Mo 2']);
    expect(axis.cells.filter((c) => c.today).map((c) => c.label)).toEqual(['Sa 31']);
  });

  it('drops the weekend days at the days zoom when asked', () => {
    const axis = buildAxis('2026-10-22', '2026-10-27', 'days', false, TODAY);
    expect(axis.days).toEqual(['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27']);
    // A day on the weekend sits at the next displayed day.
    expect(axis.lowerBound('2026-10-24')).toBe(2);
    expect(axis.lowerBound('2026-10-28')).toBe(4);
  });

  it('shows whole weeks (Monday to Sunday) labelled "W43 19 - 25"', () => {
    const axis = buildAxis('2026-10-22', '2026-10-28', 'weeks', true, TODAY);
    expect(axis.days[0]).toBe('2026-10-19');
    expect(axis.days).toHaveLength(14);
    expect(axis.cells.map((c) => c.label)).toEqual(['W43 19 - 25', 'W44 26 - Nov 1']);
    expect(axis.cells[0]!.today).toBe(true);
    expect(axis.cells[1]!.today).toBe(false);
  });

  it('shows whole months with the year above', () => {
    const axis = buildAxis('2026-10-22', '2027-01-05', 'months', true, TODAY);
    expect(axis.days[0]).toBe('2026-10-01');
    expect(axis.days[axis.days.length - 1]).toBe('2027-01-31');
    expect(axis.cells.map((c) => c.label)).toEqual(['Oct', 'Nov', 'Dec', 'Jan']);
    expect(axis.top.map((c) => [c.label, c.span])).toEqual([
      ['2026', 92],
      ['2027', 31],
    ]);
  });

  it('carries on by calendar days past either end of the axis', () => {
    const axis = buildAxis('2026-10-20', '2026-10-22', 'days', true, TODAY);
    expect(axis.dayAt(1)).toBe('2026-10-21');
    expect(axis.dayAt(-2)).toBe('2026-10-18');
    expect(axis.dayAt(5)).toBe('2026-10-25');
  });
});

describe('summaryRange', () => {
  it('writes a day, a range in one month, across months and across years', () => {
    expect(summaryRange('2026-10-03', '2026-10-03')).toBe('Oct 3');
    expect(summaryRange('2026-10-03', '2026-10-17')).toBe('Oct 3 - 17');
    expect(summaryRange('2026-10-28', '2026-11-04')).toBe('Oct 28 - Nov 4');
    expect(summaryRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 - Jan 3, 2027');
  });
});

describe('packRows', () => {
  const bar = (key: string, startIdx: number, endIdx: number, name = 'Task'): TimelineBar =>
    ({
      key,
      name,
      startIdx,
      endIdx,
      row: 0,
      order: Number(key.replace(/\D/g, '')) || 0,
      labelOutside: false,
    }) as TimelineBar;

  it('puts bars that do not touch on one row', () => {
    const bars = [bar('a1', 0, 9), bar('a2', 12, 20)];
    expect(packRows(bars, 40)).toBe(1);
    expect(bars.map((b) => b.row)).toEqual([0, 0]);
  });

  it('opens a second row for overlapping bars', () => {
    const bars = [bar('a1', 0, 9), bar('a2', 5, 12), bar('a3', 20, 25)];
    expect(packRows(bars, 40)).toBe(2);
    expect(bars.map((b) => b.row)).toEqual([0, 1, 0]);
  });

  it('counts a name drawn after a narrow bar as part of the bar', () => {
    // A one-day bar at 4px a day is a small square; its 24-character name runs well past the next bar.
    const long = 'Prepare the quarterly report';
    const bars = [bar('a1', 0, 0, long), bar('a2', 10, 20, 'Next')];
    expect(bars[0]!.name.length * 7).toBeGreaterThan(10 * 4);
    expect(packRows(bars, 4)).toBe(2);
    expect(bars[0]!.labelOutside).toBe(true);
    expect(bars[1]!.row).toBe(1);
    // With room (40px a day) the same name fits inside a wider bar and nothing is outside.
    const wide = [bar('a1', 0, 5, 'Short'), bar('a2', 10, 20, 'Next')];
    expect(packRows(wide, 40)).toBe(1);
    expect(wide[0]!.labelOutside).toBe(false);
  });

  it('estimates a name by its length', () => {
    expect(labelWidthPx('abcd')).toBe(28);
  });
});

describe('buildTimeline', () => {
  const items = [
    span('i1', 'Design', 'g1', '2026-10-05', '2026-10-12', 'a0'),
    span('i2', 'Build', 'g1', '2026-10-10', '2026-10-20', 'a1'),
    span('i3', 'Ship', 'g2', '2026-10-25', '2026-10-30', 'a2'),
    makeItem({ id: 'i4', name: 'Undated', groupId: 'g2', position: 'a3', values: {} }),
    makeItem({
      id: 'sub',
      name: 'A subitem',
      groupId: 'g1',
      parentItemId: 'i1',
      values: { plan: { from: '2026-10-06', to: '2026-10-07' } },
    }),
  ];

  it('makes one lane per group in board order, only for groups with a dated item', () => {
    const model = build({ items });
    expect(model.lanes.map((l) => l.group.id)).toEqual(['g1', 'g2']);
    expect(model.lanes[0]!.bars.map((b) => b.name)).toEqual(['Design', 'Build']);
    expect(model.noDates).toBe(false);
  });

  it('packs overlapping items into separate rows below the summary row', () => {
    const lane = build({ items }).lanes[0]!;
    expect(lane.rowCount).toBe(2);
    expect(lane.summaryRows).toBe(1);
    expect(lane.heightRows).toBe(3);
    expect(lane.bars.map((b) => b.row)).toEqual([0, 1]);
  });

  it('summarises a lane from its earliest to its latest date', () => {
    const lanes = build({ items }).lanes;
    expect(lanes[0]!.summary).toMatchObject({
      from: '2026-10-05',
      to: '2026-10-20',
      rangeText: 'Oct 5 - 20',
      daysText: '16 days',
    });
    expect(lanes[1]!.summary).toMatchObject({ rangeText: 'Oct 25 - 30', daysText: '6 days' });
  });

  it('has no summary row when it is turned off, but a collapsed lane keeps it', () => {
    const lanes = build({
      items,
      settings: { ...settings, showGroupSummary: false, collapsedGroupIds: ['g2'] },
    }).lanes;
    expect(lanes[0]!.summary).toBeNull();
    expect(lanes[0]!.heightRows).toBe(2);
    expect(lanes[1]!.collapsed).toBe(true);
    expect(lanes[1]!.summary).not.toBeNull();
    expect(lanes[1]!.heightRows).toBe(1);
    expect(lanes[1]!.rowCount).toBe(0);
  });

  it('places bars on the axis and skips subitems and items without a value', () => {
    const model = build({ items });
    const design = model.lanes[0]!.bars[0]!;
    expect(model.axis.days[design.startIdx]).toBe('2026-10-05');
    expect(model.axis.days[design.endIdx]).toBe('2026-10-12');
    expect(design.label).toBe('Design, Oct 5 to Oct 12');
    expect(model.lanes.flatMap((l) => l.bars.map((b) => b.name))).not.toContain('A subitem');
    expect(model.visibleIdsByLane).toEqual([
      { groupId: 'g1', ids: ['i1', 'i2'] },
      { groupId: 'g2', ids: ['i3'] },
    ]);
  });

  it('draws a date item as one day', () => {
    const model = build({
      column: due,
      items: [
        makeItem({ id: 'd', name: 'Pay', groupId: 'g1', values: { due: { date: '2026-10-20' } } }),
      ],
    });
    const bar = model.lanes[0]!.bars[0]!;
    expect(bar.endIdx - bar.startIdx).toBe(0);
    expect(bar.label).toBe('Pay, Tuesday, October 20, 2026');
    expect(bar.isRange).toBe(false);
  });

  it('keeps today and the items in the axis, and marks where today is', () => {
    const model = build({ items });
    expect(model.axis.days[model.todayIdx]).toBe(TODAY);
    expect(model.axis.days[0]! <= '2026-10-05').toBe(true);
    expect(model.axis.days[model.axis.days.length - 1]! >= '2026-10-30').toBe(true);
  });

  it('shows an axis around today and no lanes when nothing has a date', () => {
    const model = build({ items: [items[3]!] });
    expect(model.lanes).toEqual([]);
    expect(model.noDates).toBe(true);
    expect(model.axis.days).toContain(TODAY);
  });

  it('clips an item far from today to the axis limits', () => {
    const model = build({ items: [span('far', 'Far', 'g1', '2000-01-01', '2100-01-01')] });
    expect(model.axis.days.length).toBeLessThanOrEqual(2 * MAX_AXIS_DAYS + 1);
    const bar = model.lanes[0]!.bars[0]!;
    expect(bar.continuesBefore).toBe(true);
    expect(bar.continuesAfter).toBe(true);
    // An item entirely outside the axis is not drawn.
    const none = build({ items: [span('x', 'X', 'g1', '2000-01-01', '2000-02-01')] });
    expect(none.lanes).toEqual([]);
  });

  it('drops an item that lies wholly on a hidden weekend', () => {
    const model = build({
      items: [span('w', 'Weekend', 'g1', '2026-10-24', '2026-10-25')],
      settings: { ...settings, showWeekends: false },
    });
    expect(model.lanes).toEqual([]);
  });

  it('applies the search and the filters', () => {
    const searched = build({ items, search: 'ship' });
    expect(searched.lanes.map((l) => l.group.id)).toEqual(['g2']);
    const filterState = { ...createDefaultFilterState(), personIds: ['nobody'] };
    // A person filter nobody matches leaves nothing.
    expect(build({ items, filterState }).lanes).toEqual([]);
  });

  it('colours by group, or by status label with the group colour as no fallback', () => {
    const coloured = build({
      items: [
        makeItem({
          id: 's1',
          name: 'A',
          groupId: 'g1',
          values: { plan: { from: '2026-10-05', to: '2026-10-06' }, status: { index: 0 } },
        }),
        span('s2', 'B', 'g1', '2026-10-05', '2026-10-06'),
      ],
      settings: { ...settings, colorBy: 'status' },
    });
    const bars = coloured.lanes[0]!.bars;
    expect(bars.find((b) => b.name === 'A')!.color).toBe('#579bfc');
    expect(bars.find((b) => b.name === 'B')!.color).toBeNull();
    expect(coloured.legend.map((l) => l.name)).toEqual(['To do', 'Done']);
    const byGroup = build({ items });
    expect(byGroup.lanes[0]!.bars[0]!.color).toBe('#579bfc');
    expect(byGroup.legend.map((l) => l.name)).toEqual(['Alpha', 'Beta', 'Empty']);
    // Dark text on a light fill, light text on a dark one.
    expect(byGroup.lanes[1]!.bars[0]!.tone).toBe('dark');
  });

  it('uses an optimistic patch in place of the stored value', () => {
    const model = build({ items, patches: { i1: { from: '2026-10-06', to: '2026-10-08' } } });
    const bar = model.lanes[0]!.bars.find((b) => b.key === 'i1')!;
    expect(bar.from).toBe('2026-10-06');
    expect(bar.to).toBe('2026-10-08');
  });

  it('packs differently per zoom, since the day width changes', () => {
    const crowded = [
      span('a', 'A long task name here', 'g1', '2026-10-05', '2026-10-05', 'a0'),
      span('b', 'Another one', 'g1', '2026-10-12', '2026-10-12', 'a1'),
    ];
    expect(build({ items: crowded }).lanes[0]!.rowCount).toBe(1);
    expect(
      build({ items: crowded, settings: { ...settings, zoom: 'months' } }).lanes[0]!.rowCount,
    ).toBe(2);
  });
});

describe('windowLanes', () => {
  const lane = (id: string, rows: number): TimelineLane =>
    ({
      group: { id, title: id, color: '#000000', position: id },
      collapsed: false,
      bars: [],
      rowCount: rows,
      summaryRows: 1,
      heightRows: rows + 1,
      summary: null,
    }) as TimelineLane;

  it('renders everything while there are few rows', () => {
    const windows = windowLanes([lane('a', 5), lane('b', 5)], 0, 10);
    expect(windows.every((w) => w.render)).toBe(true);
    expect(windows[1]!.topRow).toBe(6);
  });

  it('renders only the lanes and rows near the viewport once there are many', () => {
    const lanes = Array.from({ length: 30 }, (_, i) => lane(`g${i}`, 19)); // 600 rows
    expect(lanes.reduce((n, l) => n + l.heightRows, 0)).toBeGreaterThan(WINDOW_THRESHOLD_ROWS);
    const windows = windowLanes(lanes, 300, 340, 10);
    const rendered = windows.filter((w) => w.render).map((w) => w.lane.group.id);
    expect(rendered).toEqual(['g14', 'g15', 'g16', 'g17']);
    // Every lane keeps its place (a spacer of the same height) in the list.
    expect(windows).toHaveLength(30);
    // Within a rendered lane only the rows near the viewport are asked for.
    const first = windows.find((w) => w.lane.group.id === 'g14')!;
    expect(first.rowFrom).toBeGreaterThan(0);
    expect(first.rowTo).toBe(19);
  });
});

describe('planBarChange', () => {
  const timelineItem = span('t', 'T', 'g1', '2026-10-05', '2026-10-10');
  const dateItem = makeItem({
    id: 'd',
    groupId: 'g1',
    values: { due: { date: '2026-10-05', time: '09:30:00' } },
  });

  it('moves both ends of a timeline by whole days, keeping its length', () => {
    expect(planBarChange(timelineItem, plan, { kind: 'move', days: 3 })).toMatchObject({
      value: { from: '2026-10-08', to: '2026-10-13' },
    });
    expect(planBarChange(timelineItem, plan, { kind: 'move', days: -6 })?.value).toEqual({
      from: '2026-09-29',
      to: '2026-10-04',
    });
  });

  it('moves a date and keeps its time', () => {
    expect(planBarChange(dateItem, due, { kind: 'move', days: 2 })?.value).toEqual({
      date: '2026-10-07',
      time: '09:30:00',
    });
  });

  it('changes one end of a timeline, never past the other (at least one day)', () => {
    expect(planBarChange(timelineItem, plan, { kind: 'start', day: '2026-10-02' })?.value).toEqual({
      from: '2026-10-02',
      to: '2026-10-10',
    });
    expect(planBarChange(timelineItem, plan, { kind: 'end', day: '2026-10-20' })?.value).toEqual({
      from: '2026-10-05',
      to: '2026-10-20',
    });
    expect(planBarChange(timelineItem, plan, { kind: 'start', day: '2026-10-30' })?.value).toEqual({
      from: '2026-10-10',
      to: '2026-10-10',
    });
    expect(planBarChange(timelineItem, plan, { kind: 'end', day: '2026-09-01' })?.value).toEqual({
      from: '2026-10-05',
      to: '2026-10-05',
    });
  });

  it('refuses a resize of a date, a zero move and an item without a value', () => {
    expect(planBarChange(dateItem, due, { kind: 'end', day: '2026-10-09' })).toBeNull();
    expect(planBarChange(timelineItem, plan, { kind: 'move', days: 0 })).toBeNull();
    expect(planBarChange(timelineItem, plan, { kind: 'end', day: '2026-10-10' })).toBeNull();
    expect(
      planBarChange(makeItem({ id: 'n', values: {} }), plan, { kind: 'move', days: 1 }),
    ).toBeNull();
  });
});

describe('dragging a bar', () => {
  const items = [span('t', 'T', 'g1', '2026-10-20', '2026-10-23')];
  const model = build({ items });
  const bar = model.lanes[0]!.bars[0]!;

  it('keeps a resize from crossing the other end', () => {
    expect(resolveDrag(bar, 'start', 10)).toMatchObject({ k: 3, startIdx: bar.endIdx });
    expect(resolveDrag(bar, 'end', -10)).toMatchObject({ k: -3, endIdx: bar.startIdx });
    expect(resolveDrag(bar, 'move', 4)).toMatchObject({ startIdx: bar.startIdx + 4 });
  });

  it('plans a move by the days dragged, and a resize of one edge', () => {
    expect(planDrag(bar, plan, model.axis, 'move', 2)?.value).toEqual({
      from: '2026-10-22',
      to: '2026-10-25',
    });
    expect(planDrag(bar, plan, model.axis, 'end', 5)?.value).toEqual({
      from: '2026-10-20',
      to: '2026-10-28',
    });
    expect(planDrag(bar, plan, model.axis, 'start', -2)?.value).toEqual({
      from: '2026-10-18',
      to: '2026-10-23',
    });
    expect(planDrag(bar, plan, model.axis, 'move', 0)).toBeNull();
  });

  it('steps over hidden weekends: one axis day is the next weekday', () => {
    const noWeekends = build({
      items: [span('t', 'T', 'g1', '2026-10-23', '2026-10-23')],
      settings: { ...settings, showWeekends: false },
    });
    const friday = noWeekends.lanes[0]!.bars[0]!;
    // Friday dragged one displayed day lands on Monday: a 3 day shift.
    expect(planDrag(friday, plan, noWeekends.axis, 'move', 1)?.value).toEqual({
      from: '2026-10-26',
      to: '2026-10-26',
    });
  });
});
