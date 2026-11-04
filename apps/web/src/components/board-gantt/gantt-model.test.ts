import { columnRegistry, type ColumnDef, type GroupDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { buildColumnViews } from '../board-table/table-model';
import { buildTimeline, windowLanes } from '../board-timeline/timeline-model';
import {
  buildEdges,
  buildNodes,
  prerequisitesOf,
  renderedNodeIds,
  resolveDependencyColumn,
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
