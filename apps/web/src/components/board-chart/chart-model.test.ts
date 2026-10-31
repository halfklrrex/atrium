import {
  CHART_EMPTY_BUCKET,
  CHART_GROUP_AXIS,
  CHART_LIMITS,
  CHART_OTHER_BUCKET,
  columnRegistry,
  createDefaultFilterState,
  defaultChartSettings,
  type ChartSettings,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import type { ItemDoc } from '../../data';
import { buildColumnViews } from '../board-table/table-model';
import { buildChartModel, resolveStackDim, resolveXDim, resolveY } from './chart-model';

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

const statusSettings = {
  labels: [
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
    { id: 'done', index: 1, label: 'Done', color: '#00c875' },
    { id: 'todo', index: 0, label: 'To do', color: '#579bfc' },
  ],
};
const priorityStatus = {
  labels: [
    { id: 'hi', index: 0, label: 'High', color: '#e2445c' },
    { id: 'lo', index: 1, label: 'Low', color: '#0086c0' },
  ],
};
const dropdownSettings = {
  labels: [
    { id: 1, label: 'Design' },
    { id: 2, label: 'Build' },
  ],
  limitSelect: false,
};

const columns = buildColumnViews([
  column('status', 'status', 'Status', 'a0', statusSettings),
  column('prio', 'status', 'Priority', 'a1', priorityStatus),
  column('owner', 'people', 'Owner', 'a2'),
  column('tags', 'dropdown', 'Tags', 'a3', dropdownSettings),
  column('due', 'date', 'Due', 'a4'),
  column('plan', 'timeline', 'Plan', 'a5'),
  column('budget', 'numbers', 'Budget', 'a6', {
    unit: { symbol: '€', direction: 'left' },
    decimals: 0,
  }),
  column('notes', 'text', 'Notes', 'a7'),
]);

const groups: GroupDef[] = [
  { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
  { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
];

const names: Record<string, string> = { u1: 'Avery Quinn', u2: 'Blake Rowan', u3: 'Casey Lane' };
const userName = (uid: string) => names[uid];

const stat = (index: number) => ({ index });
let n = 0;
const item = (values: Record<string, unknown>, extra: Partial<ItemDoc> = {}): ItemDoc =>
  makeItem({ id: `i${n++}`, position: `p${String(n).padStart(4, '0')}`, values, ...extra });

const items: ItemDoc[] = [
  item({
    status: stat(1),
    budget: 100,
    owner: { personsAndTeams: [{ id: 'u1', kind: 'person' }] },
  }),
  item({
    status: stat(1),
    budget: 300,
    owner: { personsAndTeams: [{ id: 'u2', kind: 'person' }] },
  }),
  item({
    status: stat(0),
    budget: 50,
    owner: {
      personsAndTeams: [
        { id: 'u1', kind: 'person' },
        { id: 'u2', kind: 'person' },
      ],
    },
  }),
  item({ status: stat(2) }, { groupId: 'g2' }),
  item({}, { groupId: 'g2' }),
];

function build(overrides: Partial<ChartSettings> = {}, list: ItemDoc[] = items, search = '') {
  return buildChartModel({
    items: list,
    columns,
    groups,
    settings: { ...defaultChartSettings(), ...overrides },
    filterState: createDefaultFilterState(),
    search,
    userName,
  });
}

const labels = (m: ReturnType<typeof build>) => m.buckets.map((b) => b.label);
const counts = (m: ReturnType<typeof build>) => m.buckets.map((b) => b.value);

describe('axis resolution', () => {
  it('defaults X to the first status column, else groups, and drops a stale id', () => {
    expect(resolveXDim(columns, null).id).toBe('status');
    expect(resolveXDim(columns, 'gone').id).toBe('status');
    expect(resolveXDim(columns, 'notes').id).toBe('status');
    expect(resolveXDim(columns, CHART_GROUP_AXIS).kind).toBe('group');
    expect(resolveXDim(buildColumnViews([]), null).kind).toBe('group');
    expect(resolveXDim(columns, 'due').kind).toBe('date');
  });

  it('picks a stack that differs from X', () => {
    const x = resolveXDim(columns, 'status');
    expect(resolveStackDim(columns, null, x)?.id).toBe('prio');
    expect(resolveStackDim(columns, 'status', x)?.id).toBe('prio');
    expect(resolveStackDim(columns, 'owner', x)?.id).toBe('owner');
    expect(resolveStackDim(columns, CHART_GROUP_AXIS, x)?.kind).toBe('group');
    const groupX = resolveXDim(columns, CHART_GROUP_AXIS);
    expect(resolveStackDim(columns, null, groupX)?.id).toBe('status');
    expect(resolveStackDim(buildColumnViews([]), null, groupX)).toBeNull();
  });

  it('falls back to a count without a usable Numbers column', () => {
    const y = (patch: Partial<ChartSettings>) =>
      resolveY(columns, { ...defaultChartSettings(), ...patch });
    expect(y({}).fellBack).toBe(false);
    expect(y({ yMode: 'sum' }).column?.def.id).toBe('budget');
    expect(y({ yMode: 'sum', yColumnId: 'notes' })).toMatchObject({
      mode: 'count',
      fellBack: true,
    });
    expect(y({ yMode: 'max', yColumnId: 'gone' }).fellBack).toBe(true);
    expect(
      resolveY(buildColumnViews([]), { ...defaultChartSettings(), yMode: 'sum' }).fellBack,
    ).toBe(true);
  });
});

describe('X kinds', () => {
  it('buckets by status in label-index order, with the label colour', () => {
    const m = build();
    expect(labels(m)).toEqual(['To do', 'Done', 'Stuck', 'Empty']);
    expect(counts(m)).toEqual([1, 2, 1, 1]);
    expect(m.buckets[0]!.color).toBe('#579bfc');
    expect(m.buckets[3]!.color).toBe('var(--atrium-chart-empty)');
    expect(m.coloredBuckets).toBe(true);
    expect(m.title).toBe('Items by Status');
  });

  it('buckets by group in board order with the group colour', () => {
    const m = build({ xColumnId: CHART_GROUP_AXIS });
    expect(labels(m)).toEqual(['Alpha', 'Beta']);
    expect(counts(m)).toEqual([3, 2]);
    expect(m.buckets[0]!.color).toBe('#579bfc');
  });

  it('counts an item once in each of its people, ordered by name, with cycled series colours', () => {
    const m = build({ xColumnId: 'owner' });
    expect(labels(m)).toEqual(['Avery Quinn', 'Blake Rowan', 'Empty']);
    expect(counts(m)).toEqual([2, 2, 2]);
    expect(m.multiValue).toBe(true);
    expect(m.buckets[0]!.color).toBe('var(--atrium-chart-series-1)');
    expect(m.buckets[1]!.color).toBe('var(--atrium-chart-series-2)');
    expect(m.coloredBuckets).toBe(false);
    expect(m.table.caption).toMatch(/counts in each/);
  });

  it('buckets a dropdown by label in settings order, ignoring unknown ids', () => {
    const list = [
      item({ tags: { ids: [2] } }),
      item({ tags: { ids: [1, 2] } }),
      item({ tags: { ids: [99] } }),
    ];
    const m = build({ xColumnId: 'tags' }, list);
    expect(labels(m)).toEqual(['Design', 'Build', 'Empty']);
    expect(counts(m)).toEqual([1, 2, 1]);
  });

  it('buckets dates by day with gaps filled by zero', () => {
    const list = [
      item({ due: { date: '2026-03-02' } }),
      item({ due: { date: '2026-03-02' } }),
      item({ due: { date: '2026-03-05' } }),
      item({}),
    ];
    const m = build({ xColumnId: 'due', dateBucket: 'day' }, list);
    expect(labels(m)).toEqual(['2 Mar 2026', '3 Mar 2026', '4 Mar 2026', '5 Mar 2026', 'Empty']);
    expect(counts(m)).toEqual([2, 0, 0, 1, 1]);
  });

  it('buckets dates by ISO week starting Monday', () => {
    const list = [
      item({ due: { date: '2026-03-01' } }), // Sunday -> week of 23 Feb
      item({ due: { date: '2026-03-02' } }), // Monday
      item({ due: { date: '2026-03-08' } }), // Sunday, same week as 2 Mar
      item({ due: { date: '2026-03-16' } }),
    ];
    const m = build({ xColumnId: 'due', dateBucket: 'week' }, list);
    expect(labels(m)).toEqual([
      'Week of 23 Feb 2026',
      'Week of 2 Mar 2026',
      'Week of 9 Mar 2026',
      'Week of 16 Mar 2026',
    ]);
    expect(counts(m)).toEqual([1, 2, 0, 1]);
  });

  it('buckets dates by month, across a year end', () => {
    const list = [
      item({ due: { date: '2026-11-30' } }),
      item({ due: { date: '2027-01-02' } }),
      item({ due: { date: '2027-01-30' } }),
    ];
    const m = build({ xColumnId: 'due', dateBucket: 'month' }, list);
    expect(labels(m)).toEqual(['Nov 2026', 'Dec 2026', 'Jan 2027']);
    expect(counts(m)).toEqual([1, 0, 2]);
  });

  it('uses the start of a timeline value', () => {
    const list = [
      item({ plan: { from: '2026-03-30', to: '2026-04-20' } }),
      item({ plan: { from: '2026-04-02', to: '2026-04-03' } }),
    ];
    const m = build({ xColumnId: 'plan', dateBucket: 'month' }, list);
    expect(labels(m)).toEqual(['Mar 2026', 'Apr 2026']);
    expect(counts(m)).toEqual([1, 1]);
  });
});

describe('empty bucket', () => {
  it('is dropped when showEmpty is off', () => {
    const m = build({ showEmpty: false });
    expect(labels(m)).toEqual(['To do', 'Done', 'Stuck']);
    expect(m.buckets.some((b) => b.key === CHART_EMPTY_BUCKET)).toBe(false);
  });
});

describe('Y modes', () => {
  const statusOf = (m: ReturnType<typeof build>, label: string) =>
    m.buckets.find((b) => b.label === label)!;

  it('sums, treating a bucket without numbers as 0', () => {
    const m = build({ yMode: 'sum', yColumnId: 'budget' });
    expect(statusOf(m, 'Done').value).toBe(400);
    expect(statusOf(m, 'Done').text).toBe('€400');
    expect(statusOf(m, 'Stuck').value).toBe(0);
    expect(m.title).toBe('Sum of Budget by Status');
  });

  it('averages, min and max skip empty numbers and leave a bucket without numbers empty', () => {
    const avg = build({ yMode: 'average', yColumnId: 'budget' });
    expect(statusOf(avg, 'Done').value).toBe(200);
    expect(statusOf(avg, 'Stuck').value).toBeNull();
    expect(statusOf(avg, 'Stuck').text).toBe('–');
    expect(statusOf(build({ yMode: 'min' }), 'Done').value).toBe(100);
    expect(statusOf(build({ yMode: 'max' }), 'Done').value).toBe(300);
    expect(statusOf(build({ yMode: 'max' }), 'Empty').value).toBeNull();
  });

  it('reports the fallback to a count', () => {
    const m = build({ yMode: 'sum', yColumnId: 'notes' });
    expect(m.yFallback).toMatch(/counts items/);
    expect(m.title).toBe('Items by Status');
    expect(build().yFallback).toBeNull();
  });

  it('reads numbers stored as strings and ignores junk', () => {
    const list = [
      item({ status: stat(1), budget: '20' }),
      item({ status: stat(1), budget: 'abc' }),
    ];
    expect(build({ yMode: 'sum' }, list).buckets[0]!.value).toBe(20);
  });
});

describe('stacked bar', () => {
  it('stacks by the default status column, bottom up', () => {
    const list = [
      item({ status: stat(1), prio: { index: 0 } }),
      item({ status: stat(1), prio: { index: 0 } }),
      item({ status: stat(1), prio: { index: 1 } }),
      item({ status: stat(0) }),
    ];
    const m = build({ chartType: 'stacked_bar' }, list);
    expect(m.series.map((s) => s.label)).toEqual(['High', 'Low', 'Empty']);
    const done = m.buckets.find((b) => b.label === 'Done')!;
    expect(done.value).toBe(3);
    expect(done.segments.map((s) => [s.label, s.from, s.to])).toEqual([
      ['High', 0, 2],
      ['Low', 2, 3],
    ]);
    expect(m.legend.map((l) => l.name)).toEqual(['High', 'Low', 'Empty']);
    expect(m.title).toBe('Items by Status and Priority');
    expect(m.table.head).toEqual(['Status', 'High', 'Low', 'Empty', 'Total']);
  });

  it('merges stacks beyond the cap into Other', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      item({ status: stat(1), owner: { personsAndTeams: [{ id: `p${i}`, kind: 'person' }] } }),
    );
    const m = build({ chartType: 'stacked_bar', stackColumnId: 'owner' }, many);
    expect(m.series).toHaveLength(CHART_LIMITS.series);
    expect(m.series.at(-1)!.key).toBe(CHART_OTHER_BUCKET);
    expect(m.buckets[0]!.value).toBe(15);
  });

  it('counts every item once in a single series when nothing else can split the bars', () => {
    const m = buildChartModel({
      items,
      columns: buildColumnViews([]),
      groups,
      settings: { ...defaultChartSettings(), chartType: 'stacked_bar' },
      search: '',
      userName,
    });
    expect(m.series).toHaveLength(0);
    expect(m.buckets.map((b) => b.label)).toEqual(['Alpha', 'Beta']);
  });
});

describe('sorting', () => {
  it('sorts by value either way but keeps Empty last', () => {
    expect(labels(build({ sortBy: 'value_desc' }))).toEqual(['Done', 'To do', 'Stuck', 'Empty']);
    expect(labels(build({ sortBy: 'value_asc' }))).toEqual(['To do', 'Stuck', 'Done', 'Empty']);
  });

  it('keeps dates in time order whatever the sort', () => {
    const list = [
      item({ due: { date: '2026-03-02' } }),
      item({ due: { date: '2026-04-02' } }),
      item({ due: { date: '2026-04-09' } }),
    ];
    const m = build({ xColumnId: 'due', sortBy: 'value_desc', dateBucket: 'month' }, list);
    expect(labels(m)).toEqual(['Mar 2026', 'Apr 2026']);
  });
});

describe('caps', () => {
  const manyPeople = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      item({
        owner: { personsAndTeams: [{ id: `p${String(i).padStart(3, '0')}`, kind: 'person' }] },
      }),
    );

  it('merges the smallest buckets into Other past the bar cap', () => {
    const list = manyPeople(60);
    // Give p000 the biggest bucket.
    list.push(item({ owner: { personsAndTeams: [{ id: 'p000', kind: 'person' }] } }));
    const m = build({ xColumnId: 'owner', showEmpty: false }, list);
    expect(m.buckets).toHaveLength(CHART_LIMITS.xBuckets);
    const other = m.buckets.at(-1)!;
    expect(other.key).toBe(CHART_OTHER_BUCKET);
    expect(other.label).toBe('Other');
    expect(m.buckets.some((b) => b.label === 'Unknown person' && b.count === 2)).toBe(true);
    expect(m.buckets.reduce((s, b) => s + b.count, 0)).toBe(61);
    expect(m.notes.join(' ')).toMatch(/grouped as Other/);
  });

  it('caps pie slices at 12, Empty included', () => {
    const list = [...manyPeople(20), item({})];
    const m = build({ chartType: 'pie', xColumnId: 'owner' }, list);
    expect(m.buckets).toHaveLength(CHART_LIMITS.slices);
    expect(m.buckets.at(-1)!.key).toBe(CHART_EMPTY_BUCKET);
    expect(m.buckets.at(-2)!.key).toBe(CHART_OTHER_BUCKET);
    expect(m.legend).toHaveLength(CHART_LIMITS.slices);
  });

  it('widens days to weeks, then months, to fit the date axis', () => {
    const days = [item({ due: { date: '2026-01-01' } }), item({ due: { date: '2026-04-30' } })];
    const weeks = build({ xColumnId: 'due', dateBucket: 'day' }, days);
    expect(weeks.buckets.length).toBeLessThanOrEqual(CHART_LIMITS.xBuckets);
    expect(weeks.buckets[0]!.label).toMatch(/^Week of/);
    expect(weeks.notes[0]).toMatch(/weeks/);

    const wide = [item({ due: { date: '2025-01-01' } }), item({ due: { date: '2026-06-30' } })];
    const months = build({ xColumnId: 'due', dateBucket: 'day' }, wide);
    expect(months.buckets[0]!.label).toBe('Jan 2025');
    expect(months.notes[0]).toMatch(/months/);
  });

  it('keeps the latest 50 months of a very long span', () => {
    const list = [item({ due: { date: '2010-01-01' } }), item({ due: { date: '2026-06-30' } })];
    const m = build({ xColumnId: 'due', dateBucket: 'month' }, list);
    expect(m.buckets).toHaveLength(CHART_LIMITS.xBuckets);
    expect(m.buckets.at(-1)!.label).toBe('Jun 2026');
    expect(m.notes.join(' ')).toMatch(/latest 50/);
  });
});

describe('filters and search', () => {
  it('charts only the items that pass search and skips subitems', () => {
    const list = [
      item({ status: stat(1) }, { name: 'Roof repair' }),
      item({ status: stat(1) }, { name: 'Garden' }),
      item({ status: stat(1) }, { name: 'Roof sub', parentItemId: 'i0' }),
    ];
    const m = build({}, list, 'roof');
    expect(m.itemCount).toBe(1);
    expect(counts(m)).toEqual([1]);
  });

  it('is empty for a board without items', () => {
    const m = build({}, []);
    expect(m.itemCount).toBe(0);
    expect(m.buckets).toEqual([]);
    expect(m.ariaLabel).toMatch(/no data/);
  });
});

describe('colours and legend', () => {
  it('has a legend for bars that carry colours, but not for plain bars or lines', () => {
    expect(build().legend.map((l) => l.name)).toEqual(['To do', 'Done', 'Stuck', 'Empty']);
    expect(build({ xColumnId: 'owner' }).legend).toEqual([]);
    expect(build({ chartType: 'line' }).legend).toEqual([]);
  });

  it('gives pies a legend of the slices and shares', () => {
    const m = build({ chartType: 'donut' });
    expect(m.legend).toHaveLength(4);
    expect(m.total).toBe(5);
    expect(m.buckets[1]!.share).toBeCloseTo(0.4);
    expect(m.buckets[1]!.tooltip).toBe('Done · 2 items · 40%');
  });

  it('cycles the 12 series colours', () => {
    const list = Array.from({ length: 14 }, (_, i) =>
      item({
        owner: { personsAndTeams: [{ id: `q${String(i).padStart(2, '0')}`, kind: 'person' }] },
      }),
    );
    const m = build({ xColumnId: 'owner', showEmpty: false }, list);
    expect(m.buckets[12]!.color).toBe('var(--atrium-chart-series-1)');
  });
});

describe('text for screen readers', () => {
  it('summarises the first 10 buckets and says how many more', () => {
    const m = build();
    expect(m.ariaLabel).toBe('Bar chart, items by Status: To do 1, Done 2, Stuck 1, Empty 1');
    const list = Array.from({ length: 13 }, (_, i) =>
      item({
        owner: { personsAndTeams: [{ id: `r${String(i).padStart(2, '0')}`, kind: 'person' }] },
      }),
    );
    const big = build({ xColumnId: 'owner', showEmpty: false }, list);
    expect(big.ariaLabel).toMatch(/and 3 more$/);
    expect(big.ariaLabel.split(',').length).toBeLessThanOrEqual(13);
  });

  it('lists every bucket in the hidden table', () => {
    const m = build({ yMode: 'sum' });
    expect(m.table.head).toEqual(['Status', 'Sum of Budget']);
    expect(m.table.rows[1]).toEqual(['Done', '€400']);
    expect(m.table.rows).toHaveLength(m.buckets.length);
  });

  it('names the owner in a sum tooltip', () => {
    const m = build({ xColumnId: 'owner', yMode: 'sum' });
    expect(m.buckets[0]!.tooltip).toBe('Owner: Avery Quinn · €150');
  });
});

describe('performance', () => {
  it('builds a model for 10,000 items well under a second (50 ms target)', () => {
    const big: ItemDoc[] = Array.from({ length: 10_000 }, (_, i) =>
      makeItem({
        id: `b${i}`,
        position: `p${i}`,
        values: {
          status: { index: i % 3 },
          budget: i,
          owner: { personsAndTeams: [{ id: `u${i % 20}`, kind: 'person' }] },
        },
      }),
    );
    build({ yMode: 'sum' }, big);
    const start = performance.now();
    const m = build({ yMode: 'sum', chartType: 'stacked_bar', stackColumnId: 'owner' }, big);
    const elapsed = performance.now() - start;
    expect(m.buckets.length).toBe(3);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('axis labels', () => {
  it('shortens day and week labels for the axis and adds the year only across years', () => {
    const weeks = build({ xColumnId: 'due', dateBucket: 'week' }, [
      item({ due: { date: '2026-03-02' } }),
      item({ due: { date: '2026-03-10' } }),
    ]);
    expect(weeks.buckets.map((b) => b.axisLabel)).toEqual(['2 Mar', '9 Mar']);
    expect(weeks.buckets[0]!.label).toBe('Week of 2 Mar 2026');
    const across = build({ xColumnId: 'due', dateBucket: 'day' }, [
      item({ due: { date: '2026-12-30' } }),
      item({ due: { date: '2027-01-02' } }),
    ]);
    expect(across.buckets[0]!.axisLabel).toBe('30 Dec 26');
    expect(build().buckets[0]!.axisLabel).toBe('To do');
  });
});
