import { columnRegistry, type ColumnDef, type GroupDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { buildColumnViews } from '../board-table/table-model';
import { buildTimeline, windowLanes } from '../board-timeline/timeline-model';
import {
  buildEdges,
  buildBaselines,
  buildNodes,
  criticalPath,
  prerequisitesOf,
  resolveBaselineColumn,
  renderedNodeIds,
  resolveDependencyColumn,
  visibleBaselines,
  visibleEdges,
} from './gantt-model';

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const columns = buildColumnViews([
  column('plan', 'timeline', 'Plan', 'a0'),
  column('deps', 'dependency', 'Depends on', 'a1'),
  column('deps2', 'dependency', 'Blocked by', 'a2'),
  column('base', 'timeline', 'Baseline', 'a3'),
  column('due', 'date', 'Due', 'a4'),
]);
const plan = columns.find((c) => c.def.id === 'plan')!;

const groups: GroupDef[] = [
  { id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Beta', color: '#00c875', position: 'a1' },
];

const settings = {
  zoom: 'days' as const,
  colorBy: null,
  collapsedGroupIds: [] as string[],
  showGroupSummary: true,
  showWeekends: true,
};

const TODAY = '2026-10-24';

const item = (
  id: string,
  groupId: string,
  from: string,
  to: string,
  after: string[] = [],
  position = 'a0',
) =>
  makeItem({
    id,
    name: id.toUpperCase(),
    groupId,
    position,
    values: { plan: { from, to }, ...(after.length ? { deps: { item_ids: after } } : {}) },
  });

const model = (items: ReturnType<typeof item>[], collapsed: string[] = []) =>
  buildTimeline({
    items,
    column: plan,
    columns,
    groups,
    search: '',
    settings: { ...settings, collapsedGroupIds: collapsed },
    today: TODAY,
  });

describe('resolveDependencyColumn', () => {
  it('uses the saved column, else the first Dependency column, else none', () => {
    expect(resolveDependencyColumn(columns, 'deps2')?.def.id).toBe('deps2');
    expect(resolveDependencyColumn(columns, null)?.def.id).toBe('deps');
    expect(resolveDependencyColumn(columns, 'gone')?.def.id).toBe('deps');
    expect(resolveDependencyColumn(columns.slice(0, 1), null)).toBeNull();
  });
});

describe('prerequisitesOf', () => {
  it('reads item_ids and ignores missing or malformed values', () => {
    expect(prerequisitesOf({ deps: { item_ids: ['a', 'b'] } }, 'deps')).toEqual(['a', 'b']);
    expect(prerequisitesOf({}, 'deps')).toEqual([]);
    expect(prerequisitesOf({ deps: 'x' }, 'deps')).toEqual([]);
  });
});

describe('buildEdges', () => {
  it('draws an edge from each prerequisite to its dependent', () => {
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-10'),
      item('b', 'g1', '2026-10-12', '2026-10-15', ['a'], 'a1'),
    ]);
    const edges = buildEdges(m, 'deps');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ key: 'b:a', violated: false, message: null });
    expect(edges[0]!.from.id).toBe('a');
    expect(edges[0]!.to.id).toBe('b');
  });

  it('has no edges without a Dependency column', () => {
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-10'),
      item('b', 'g1', '2026-10-12', '2026-10-15', ['a'], 'a1'),
    ]);
    expect(buildEdges(m, null)).toEqual([]);
  });

  it('flags a prerequisite that ends after its dependent starts', () => {
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-14'),
      item('b', 'g1', '2026-10-12', '2026-10-15', ['a'], 'a1'),
    ]);
    const [edge] = buildEdges(m, 'deps');
    expect(edge).toMatchObject({ violated: true, message: 'Starts before A finishes' });
  });

  it('does not flag a prerequisite ending the day the dependent starts', () => {
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-12'),
      item('b', 'g1', '2026-10-12', '2026-10-15', ['a'], 'a1'),
    ]);
    expect(buildEdges(m, 'deps')[0]!.violated).toBe(false);
  });

  it('skips pairs with an undated or missing end', () => {
    const undated = makeItem({ id: 'u', name: 'U', groupId: 'g1', position: 'a2', values: {} });
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-10'),
      item('b', 'g1', '2026-10-12', '2026-10-15', ['a', 'u', 'missing'], 'a1'),
      undated,
    ]);
    expect(buildEdges(m, 'deps').map((e) => e.key)).toEqual(['b:a']);
  });

  it('draws an edge between lanes at the right rows', () => {
    const m = model([
      item('a', 'g1', '2026-10-05', '2026-10-10'),
      item('b', 'g2', '2026-10-12', '2026-10-15', ['a']),
    ]);
    const [edge] = buildEdges(m, 'deps');
    // Alpha: summary row 0, bar row 1. Beta starts at row 2: summary row 2, bar row 3.
    expect(edge!.from.row).toBe(1);
    expect(edge!.to.row).toBe(3);
  });

  it('attaches arrows of a collapsed lane to its summary bar', () => {
    const m = model(
      [
        item('a', 'g1', '2026-10-05', '2026-10-10'),
        item('c', 'g1', '2026-10-06', '2026-10-20', [], 'a1'),
        item('b', 'g2', '2026-10-12', '2026-10-15', ['a']),
      ],
      ['g1'],
    );
    const [edge] = buildEdges(m, 'deps');
    expect(edge!.from).toMatchObject({ collapsed: true, row: 0 });
    expect(edge!.from.endIdx).toBeGreaterThan(edge!.from.startIdx);
  });

  it('leaves out an edge inside one collapsed lane', () => {
    const m = model(
      [
        item('a', 'g1', '2026-10-05', '2026-10-10'),
        item('b', 'g1', '2026-10-12', '2026-10-15', ['a'], 'a1'),
      ],
      ['g1'],
    );
    expect(buildEdges(m, 'deps')).toEqual([]);
  });
});

describe('buildNodes', () => {
  it('numbers rows across lanes, summary rows included', () => {
    const nodes = buildNodes(
      model([
        item('a', 'g1', '2026-10-05', '2026-10-10'),
        item('b', 'g2', '2026-10-05', '2026-10-10'),
      ]).lanes,
    );
    expect(nodes.get('a')!.row).toBe(1);
    expect(nodes.get('b')!.row).toBe(3);
  });
});

describe('visibleEdges', () => {
  it('drops an edge whose end is outside the rendered row window', () => {
    // Enough rows in the first lane to make the body windowed.
    const many = Array.from({ length: 260 }, (_, i) =>
      item(`x${i}`, 'g1', '2026-10-05', '2026-10-10', [], `a${String(i).padStart(3, '0')}`),
    );
    const m = model([
      ...many,
      item('a', 'g2', '2026-10-05', '2026-10-10', [], 'a0'),
      item('b', 'g2', '2026-10-12', '2026-10-15', ['a', 'x0'], 'a1'),
    ]);
    const windows = windowLanes(m.lanes, 0, 10);
    const edges = buildEdges(m, 'deps');
    expect(edges.map((e) => e.key).sort()).toEqual(['b:a', 'b:x0']);
    expect(renderedNodeIds(windows).has('b')).toBe(false);
    expect(visibleEdges(edges, windows)).toEqual([]);
    const all = windowLanes(m.lanes, 0, 10_000);
    expect(visibleEdges(edges, all)).toHaveLength(2);
  });
});

const withBase = (
  id: string,
  groupId: string,
  from: string,
  to: string,
  base: { from: string; to: string } | null,
  position = 'a0',
) =>
  makeItem({
    id,
    name: id.toUpperCase(),
    groupId,
    position,
    values: { plan: { from, to }, ...(base ? { base } : {}) },
  });

describe('resolveBaselineColumn', () => {
  it('accepts a Timeline or Date column other than the bar column, never falls back', () => {
    expect(resolveBaselineColumn(columns, 'base', 'plan')?.def.id).toBe('base');
    expect(resolveBaselineColumn(columns, 'due', 'plan')?.def.id).toBe('due');
    expect(resolveBaselineColumn(columns, 'plan', 'plan')).toBeNull();
    expect(resolveBaselineColumn(columns, 'deps', 'plan')).toBeNull();
    expect(resolveBaselineColumn(columns, null, 'plan')).toBeNull();
    expect(resolveBaselineColumn(columns, 'gone', 'plan')).toBeNull();
  });
});

describe('buildBaselines', () => {
  const base = columns.find((c) => c.def.id === 'base')!;

  it('pairs each item with the baseline dates in the same row as its bar', () => {
    const m = model([
      withBase('a', 'g1', '2026-10-05', '2026-10-10', { from: '2026-10-03', to: '2026-10-08' }),
      withBase('b', 'g2', '2026-10-12', '2026-10-15', { from: '2026-10-12', to: '2026-10-12' }),
    ]);
    const baselines = buildBaselines(m, base);
    expect(baselines.map((b) => [b.id, b.from, b.to, b.row])).toEqual([
      ['a', '2026-10-03', '2026-10-08', 1],
      ['b', '2026-10-12', '2026-10-12', 3],
    ]);
    expect(baselines[0]!.startIdx).toBe(m.axis.lowerBound('2026-10-03'));
    expect(baselines[0]!.endIdx).toBe(m.axis.lowerBound('2026-10-09') - 1);
  });

  it('skips items without a baseline value and collapsed lanes', () => {
    const items = [
      withBase('a', 'g1', '2026-10-05', '2026-10-10', { from: '2026-10-03', to: '2026-10-08' }),
      withBase('b', 'g1', '2026-10-12', '2026-10-15', null, 'a1'),
      withBase('c', 'g2', '2026-10-12', '2026-10-15', { from: '2026-10-12', to: '2026-10-14' }),
    ];
    expect(buildBaselines(model(items), base).map((b) => b.id)).toEqual(['a', 'c']);
    expect(buildBaselines(model(items, ['g1']), base).map((b) => b.id)).toEqual(['c']);
  });

  it('draws a Date column baseline as one day, and hides baselines outside the row window', () => {
    const due = columns.find((c) => c.def.id === 'due')!;
    const dated = makeItem({
      id: 'a',
      name: 'A',
      groupId: 'g1',
      position: 'a0',
      values: { plan: { from: '2026-10-05', to: '2026-10-10' }, due: { date: '2026-10-09' } },
    });
    const m = model([dated]);
    const [b] = buildBaselines(m, due);
    expect(b).toMatchObject({ from: '2026-10-09', to: '2026-10-09' });
    expect(b!.endIdx).toBe(b!.startIdx);
    expect(visibleBaselines([b!], windowLanes(m.lanes, 0, 10))).toHaveLength(1);
    expect(visibleBaselines([b!], [])).toEqual([]);
  });
});

describe('criticalPath', () => {
  const path = (items: ReturnType<typeof item>[]) => criticalPath(buildEdges(model(items), 'deps'));

  it('has no path without arrows', () => {
    expect(path([item('a', 'g1', '2026-10-05', '2026-10-10')])).toMatchObject({
      ids: [],
      cyclic: false,
    });
  });

  it('follows a chain from its first prerequisite to its last dependent', () => {
    const result = path([
      item('a', 'g1', '2026-10-05', '2026-10-06'),
      item('b', 'g1', '2026-10-07', '2026-10-09', ['a'], 'a1'),
      item('c', 'g1', '2026-10-10', '2026-10-12', ['b'], 'a2'),
    ]);
    expect(result.ids).toEqual(['a', 'b', 'c']);
    expect([...result.edgeKeys].sort()).toEqual(['b:a', 'c:b']);
  });

  it('takes the longer branch of a diamond', () => {
    // a -> b (2 days) -> d and a -> c (6 days) -> d
    const result = path([
      item('a', 'g1', '2026-10-05', '2026-10-06'),
      item('b', 'g1', '2026-10-07', '2026-10-08', ['a'], 'a1'),
      item('c', 'g1', '2026-10-07', '2026-10-12', ['a'], 'a2'),
      item('d', 'g1', '2026-10-13', '2026-10-14', ['b', 'c'], 'a3'),
    ]);
    expect(result.ids).toEqual(['a', 'c', 'd']);
    expect(result.edgeKeys.has('d:b')).toBe(false);
  });

  it('breaks a tie in a diamond by the order of the items in the view', () => {
    const items = [
      item('a', 'g1', '2026-10-05', '2026-10-06'),
      item('b', 'g1', '2026-10-07', '2026-10-09', ['a'], 'a1'),
      item('c', 'g1', '2026-10-07', '2026-10-09', ['a'], 'a2'),
      item('d', 'g1', '2026-10-10', '2026-10-11', ['c', 'b'], 'a3'),
    ];
    expect(path(items).ids).toEqual(['a', 'b', 'd']);
    // Swap the order of b and c: the other branch wins.
    const swapped = [
      items[0]!,
      { ...items[1]!, position: 'a2' },
      { ...items[2]!, position: 'a1' },
      items[3]!,
    ];
    expect(path(swapped).ids).toEqual(['a', 'c', 'd']);
  });

  it('picks the longest of several chains, counting each bar in days', () => {
    const result = path([
      item('a', 'g1', '2026-10-05', '2026-10-06'),
      item('b', 'g1', '2026-10-07', '2026-10-08', ['a'], 'a1'),
      item('x', 'g2', '2026-10-05', '2026-10-25'),
      item('y', 'g2', '2026-10-26', '2026-10-27', ['x'], 'a1'),
    ]);
    expect(result.ids).toEqual(['x', 'y']);
  });

  it('skips the highlight on a cycle', () => {
    const result = path([
      item('a', 'g1', '2026-10-05', '2026-10-06', ['b']),
      item('b', 'g1', '2026-10-07', '2026-10-08', ['a'], 'a1'),
    ]);
    expect(result).toMatchObject({ ids: [], cyclic: true });
    expect(result.edgeKeys.size).toBe(0);
  });
});
