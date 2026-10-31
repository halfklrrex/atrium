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
  buildCalendar,
  hiddenOnDay,
  itemSpan,
  laneCapacity,
  periodTitle,
  planMove,
  resolveCalendarColumn,
  shiftAnchor,
  textToneFor,
  valueForDay,
  type BuildCalendarInput,
} from './calendar-model';

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
  column('plan', 'timeline', 'Plan', 'a1'),
  column('due', 'date', 'Due', 'a2'),
]);
const due = columns.find((c) => c.def.id === 'due')!;
const plan = columns.find((c) => c.def.id === 'plan')!;

const groups: GroupDef[] = [
  { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
  { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
];

const settings = {
  mode: 'month' as const,
  showWeekends: true,
  firstDayOfWeek: 'monday' as const,
  colorBy: null,
};

const day = (date: string, time?: string) => ({ date, ...(time ? { time } : {}) });

function build(overrides: Partial<BuildCalendarInput> = {}) {
  return buildCalendar({
    items: [],
    column: due,
    columns,
    groups,
    search: '',
    settings,
    anchor: '2026-10-24',
    ...overrides,
  });
}

describe('resolveCalendarColumn', () => {
  it('prefers the saved column, then the first date column, then the first timeline column', () => {
    expect(resolveCalendarColumn(columns, 'plan')?.def.id).toBe('plan');
    expect(resolveCalendarColumn(columns, null)?.def.id).toBe('due');
    expect(resolveCalendarColumn(columns, 'gone')?.def.id).toBe('due');
    // A column that is not a date or timeline falls back too.
    expect(resolveCalendarColumn(columns, 'status')?.def.id).toBe('due');
    expect(
      resolveCalendarColumn(
        columns.filter((c) => c.def.id !== 'due'),
        null,
      )?.def.id,
    ).toBe('plan');
    expect(
      resolveCalendarColumn(
        columns.filter((c) => c.def.id === 'status'),
        null,
      ),
    ).toBeNull();
  });
});

describe('itemSpan', () => {
  it('reads dates, times and timelines, and ignores empty or invalid values', () => {
    const item = (values: Record<string, unknown>) => makeItem({ id: 'i', values });
    expect(itemSpan(item({ due: day('2026-10-20', '09:30:00') }), due)).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
      time: '09:30',
      isRange: false,
    });
    expect(itemSpan(item({ plan: { from: '2026-10-20', to: '2026-10-22' } }), plan)).toMatchObject({
      from: '2026-10-20',
      to: '2026-10-22',
      isRange: true,
    });
    expect(itemSpan(item({}), due)).toBeNull();
    expect(itemSpan(item({ due: { date: 'nope' } }), due)).toBeNull();
    expect(itemSpan(item({ plan: { from: '2026-10-22', to: '2026-10-20' } }), plan)).toBeNull();
  });
});

describe('buildCalendar placement', () => {
  it('builds the month weeks and places date items on their day', () => {
    const items = [
      makeItem({ id: 'a', name: 'Alpha', position: 'a0', values: { due: day('2026-10-20') } }),
      makeItem({ id: 'b', name: 'Beta', position: 'a1', values: { due: day('2026-10-20') } }),
      makeItem({ id: 'c', name: 'Nowhere', position: 'a2', values: {} }),
      makeItem({ id: 'd', name: 'Sub', parentItemId: 'a', values: { due: day('2026-10-20') } }),
    ];
    const model = build({ items });
    expect(model.title).toBe('October 2026');
    expect(model.weeks).toHaveLength(5);
    const week = model.weeks.find((w) => w.days.includes('2026-10-20'))!;
    expect(week.perDay['2026-10-20']!.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(week.segments.map((s) => [s.name, s.colStart, s.colSpan, s.lane])).toEqual([
      ['Alpha', 1, 1, 0],
      ['Beta', 1, 1, 1],
    ]);
    // Items without a value and subitems are not shown.
    expect(model.visibleIds).toEqual(['a', 'b']);
  });

  it('shows the time before the name and gives an accessible label', () => {
    const [seg] = build({
      items: [makeItem({ id: 'a', name: 'Call', values: { due: day('2026-10-20', '09:30:00') } })],
    }).weeks[3]!.segments;
    expect(seg!.text).toBe('09:30 Call');
    expect(seg!.label).toBe('Call, Tuesday, October 20, 2026');
  });

  it('splits a timeline at week rows and flags the continuation', () => {
    const model = build({
      column: plan,
      items: [
        makeItem({
          id: 'p',
          name: 'Launch',
          values: { plan: { from: '2026-10-22', to: '2026-10-28' } },
        }),
      ],
    });
    const pieces = model.weeks.flatMap((w) => w.segments);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({
      colStart: 3,
      colSpan: 4,
      continuesBefore: false,
      continuesAfter: true,
      label: 'Launch, Oct 22 to Oct 28',
    });
    expect(pieces[1]).toMatchObject({
      colStart: 0,
      colSpan: 3,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('stacks overlapping bars into lanes and reuses a lane once it is free', () => {
    const item = (id: string, from: string, to: string, position: string) =>
      makeItem({ id, name: id, position, values: { plan: { from, to } } });
    const model = build({
      column: plan,
      items: [
        item('long', '2026-10-19', '2026-10-23', 'a0'),
        item('mid', '2026-10-20', '2026-10-21', 'a1'),
        item('late', '2026-10-22', '2026-10-23', 'a2'),
      ],
    });
    const week = model.weeks[3]!;
    expect(week.segments.map((s) => [s.name, s.lane])).toEqual([
      ['long', 0],
      ['mid', 1],
      ['late', 1],
    ]);
    expect(week.laneCount).toBe(2);
  });

  it('hides weekend columns and clips spans to the days shown', () => {
    const model = build({
      column: plan,
      settings: { ...settings, showWeekends: false },
      items: [
        makeItem({
          id: 'p',
          name: 'Weekend job',
          values: { plan: { from: '2026-10-24', to: '2026-10-25' } },
        }),
        makeItem({
          id: 'q',
          name: 'Across',
          values: { plan: { from: '2026-10-23', to: '2026-10-26' } },
        }),
      ],
    });
    expect(model.weeks.every((w) => w.days.length === 5)).toBe(true);
    const names = model.weeks.flatMap((w) => w.segments.map((s) => s.name));
    expect(names).not.toContain('Weekend job');
    const across = model.weeks.flatMap((w) => w.segments).filter((s) => s.name === 'Across');
    // Friday on one row, Monday on the next.
    expect(across.map((s) => [s.colStart, s.colSpan])).toEqual([
      [4, 1],
      [0, 1],
    ]);
  });

  it('shows only the week in week mode', () => {
    const model = build({
      settings: { ...settings, mode: 'week' },
      items: [
        makeItem({ id: 'a', name: 'In', values: { due: day('2026-10-21') } }),
        makeItem({ id: 'b', name: 'Out', values: { due: day('2026-10-28') } }),
      ],
    });
    expect(model.weeks).toHaveLength(1);
    expect(model.title).toBe('Oct 19 – 25, 2026');
    expect(model.visibleIds).toEqual(['a']);
  });

  it('applies search, filters and sort', () => {
    const items = [
      makeItem({ id: 'a', name: 'Write', position: 'a0', values: { due: day('2026-10-20') } }),
      makeItem({ id: 'b', name: 'Build', position: 'a1', values: { due: day('2026-10-20') } }),
    ];
    expect(build({ items, search: 'bui' }).visibleIds).toEqual(['b']);
    const filtered = {
      ...createDefaultFilterState(),
      filterGroup: {
        conjunction: 'and' as const,
        conditions: [{ columnId: 'name', operator: 'contains' as const, value: 'Wri' }],
      },
    };
    expect(build({ items, filterState: filtered }).visibleIds).toEqual(['a']);
    const sorted = {
      ...createDefaultFilterState(),
      sortConditions: [{ columnId: 'name', direction: 'asc' as const }],
    };
    const week = build({ items, filterState: sorted }).weeks[3]!;
    expect(week.perDay['2026-10-20']!.map((s) => s.name)).toEqual(['Build', 'Write']);
  });

  it('shows an optimistic patch at once', () => {
    const items = [makeItem({ id: 'a', name: 'Move', values: { due: day('2026-10-20') } })];
    const model = build({ items, patches: { a: day('2026-10-22') } });
    expect(model.weeks[3]!.perDay['2026-10-22']!.map((s) => s.name)).toEqual(['Move']);
    expect(model.weeks[3]!.perDay['2026-10-20']).toEqual([]);
  });
});

describe('colours and legend', () => {
  const items = [
    makeItem({
      id: 'a',
      name: 'Alpha item',
      groupId: 'g1',
      values: { due: day('2026-10-20'), status: { index: 1 } },
    }),
    makeItem({ id: 'b', name: 'Beta item', groupId: 'g2', values: { due: day('2026-10-21') } }),
  ];

  it('colours by group by default, with a group legend in board order', () => {
    const model = build({ items });
    const segs = model.weeks[3]!.segments;
    expect(segs.find((s) => s.name === 'Alpha item')!.color).toBe('#579bfc');
    expect(segs.find((s) => s.name === 'Beta item')!.color).toBe('#00c875');
    expect(model.legend.map((l) => l.name)).toEqual(['Alpha', 'Beta']);
  });

  it('colours by a status column, falls back for items without a label, and lists the labels', () => {
    const model = build({ items, settings: { ...settings, colorBy: 'status' } });
    const segs = model.weeks[3]!.segments;
    expect(segs.find((s) => s.name === 'Alpha item')!.color).toBe('#00c875');
    expect(segs.find((s) => s.name === 'Beta item')!.color).toBeNull();
    expect(model.legend.map((l) => l.name)).toEqual(['To do', 'Done']);
  });

  it('ignores a colour column that is gone or is not a status column', () => {
    const model = build({ items, settings: { ...settings, colorBy: 'plan' } });
    expect(model.weeks[3]!.segments[0]!.color).toBe('#579bfc');
    expect(model.legend.map((l) => l.name)).toEqual(['Alpha', 'Beta']);
  });

  it('picks readable text for a fill', () => {
    expect(textToneFor('#ffcb00')).toBe('dark'); // yellow
    expect(textToneFor('#401694')).toBe('light'); // deep purple
    expect(textToneFor('#000')).toBe('light');
    expect(textToneFor('#fff')).toBe('dark');
    expect(textToneFor(null)).toBe('dark');
    expect(textToneFor('not-a-colour')).toBe('dark');
  });
});

describe('overflow', () => {
  it('computes how many bars fit and which items "+N more" holds', () => {
    const metrics = { header: 28, row: 24, more: 20 };
    expect(laneCapacity(0, metrics)).toBe(3);
    expect(laneCapacity(60, metrics)).toBe(1);
    expect(laneCapacity(148, metrics)).toBe(4);
    const items = ['a', 'b', 'c', 'd'].map((id, i) =>
      makeItem({ id, name: id, position: `a${i}`, values: { due: day('2026-10-20') } }),
    );
    const week = build({ items }).weeks[3]!;
    expect(hiddenOnDay(week, '2026-10-20', 2).map((s) => s.name)).toEqual(['c', 'd']);
    expect(hiddenOnDay(week, '2026-10-20', 4)).toEqual([]);
    expect(hiddenOnDay(week, '2026-10-21', 1)).toEqual([]);
  });
});

describe('navigation', () => {
  it('shifts and titles the period', () => {
    expect(shiftAnchor('2026-10-24', 'month', 1)).toBe('2026-11-24');
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(shiftAnchor('2026-10-24', 'week', -1)).toBe('2026-10-17');
    expect(periodTitle('2026-10-24', 'month', 'monday')).toBe('October 2026');
    expect(periodTitle('2026-10-24', 'week', 'sunday')).toBe('Oct 18 – 24, 2026');
  });
});

describe('planMove', () => {
  it('moves a date to the dropped day and keeps its time', () => {
    const item = makeItem({ id: 'a', values: { due: day('2026-10-20', '09:30:00') } });
    expect(planMove(item, due, '2026-10-20', '2026-10-23')).toEqual({
      value: { date: '2026-10-23', time: '09:30:00' },
      from: '2026-10-23',
      to: '2026-10-23',
    });
  });

  it('moves both ends of a timeline by the same days, from the grabbed day', () => {
    const item = makeItem({
      id: 'p',
      values: { plan: { from: '2026-10-20', to: '2026-10-23' } },
    });
    // Grabbed on its third day (22nd) and dropped on the 25th: +3 days.
    expect(planMove(item, plan, '2026-10-22', '2026-10-25')?.value).toEqual({
      from: '2026-10-23',
      to: '2026-10-26',
    });
    // Across a month end, keeping the length.
    expect(planMove(item, plan, '2026-10-20', '2026-11-01')?.value).toEqual({
      from: '2026-11-01',
      to: '2026-11-04',
    });
  });

  it('refuses a move that goes nowhere or has no value', () => {
    const item = makeItem({ id: 'a', values: { due: day('2026-10-20') } });
    expect(planMove(item, due, '2026-10-20', '2026-10-20')).toBeNull();
    expect(planMove(makeItem({ id: 'b', values: {} }), due, '2026-10-20', '2026-10-21')).toBeNull();
  });

  it('builds the value of an item added on a day', () => {
    expect(valueForDay(due, '2026-10-20')).toEqual({ date: '2026-10-20' });
    expect(valueForDay(plan, '2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-10-20' });
  });
});
