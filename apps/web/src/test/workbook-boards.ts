/**
 * Sample boards for the Excel workbook tests: a small board, a board with subitems, dates and
 * awkward text, and a large board. Fictional names only (public repository).
 */
import {
  defaultCalendarSettings,
  defaultChartSettings,
  defaultGanttSettings,
  defaultKanbanSettings,
  defaultTimelineViewSettings,
  defaultViewSettings,
  defaultWorkloadSettings,
  type ColumnDef,
  type GroupDef,
  type ViewSettings,
  type ViewType,
} from '@atrium/shared';
import type { BoardViewDoc, ItemDoc } from '../data';
import type { WorkbookDataInput } from '../components/boards/workbook-data';
import { makeItem, ts } from './fixtures';

const col = (
  id: string,
  type: string,
  title: string,
  position: string,
  settings: Record<string, unknown> = {},
): ColumnDef => ({ id, type, title, position, settings });

const STATUS = {
  labels: [
    { id: 'working', index: 0, label: 'Working on it', color: '#fdab3d' },
    { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
    { id: 'review', index: 3, label: 'In review', color: '#579bfc' },
  ],
};

const PRIORITY = {
  labels: [
    { id: 'critical', index: 0, label: 'Critical ⚠️', color: '#333333' },
    { id: 'high', index: 1, label: 'High', color: '#401694' },
    { id: 'medium', index: 2, label: 'Medium', color: '#5559df' },
    { id: 'low', index: 3, label: 'Low', color: '#579bfc' },
  ],
};

const COLUMNS: ColumnDef[] = [
  col('owner', 'people', 'Owner', 'a1'),
  col('status', 'status', 'Status', 'a2', STATUS),
  col('priority', 'status', 'Priority', 'a3', PRIORITY),
  col('due', 'date', 'Due date', 'a4'),
  col('budget', 'numbers', 'Budget', 'a5', { decimals: 2 }),
  col('ok', 'checkbox', 'Approved', 'a6'),
  col('notes', 'long_text', 'Notes', 'a7'),
];

const GROUPS: GroupDef[] = [
  { id: 'g1', title: 'This sprint', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Next sprint', color: '#a25ddc', position: 'a1' },
  { id: 'g3', title: 'Done', color: '#00c875', position: 'a2' },
];

const PEOPLE: Record<string, string> = {
  u1: 'Avery Quinn',
  u2: 'Blake Rivera',
  u3: 'Casey Morgan',
  u4: 'Devon Ellis',
};

const person = (...ids: string[]) => ({
  personsAndTeams: ids.map((id) => ({ id, kind: 'person' })),
});

const iso = (base: string, days: number): string => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The "now" all samples use: 8 Nov 2026, 14:32 local time. */
export const SAMPLE_NOW = new Date(2026, 10, 8, 14, 32);

function base(name: string, items: ItemDoc[], subitems: ItemDoc[] = []): WorkbookDataInput {
  return {
    board: { id: `b-${name}` },
    boardName: name,
    now: SAMPLE_NOW,
    items,
    subitems,
    columns: COLUMNS,
    hiddenColumnIds: [],
    groups: GROUPS,
    personNames: (id) => PEOPLE[id],
  };
}

export function smallBoard(): WorkbookDataInput {
  const items = [
    makeItem({
      id: 'i1',
      name: 'Plan the launch',
      position: 'a1',
      values: {
        owner: person('u1'),
        status: { index: 0 },
        priority: { index: 1 },
        due: { date: '2026-11-10' },
        budget: 1200,
        ok: { checked: 'true' },
      },
    }),
    makeItem({
      id: 'i2',
      name: 'Write the copy',
      position: 'a2',
      values: {
        owner: person('u2'),
        status: { index: 1 },
        priority: { index: 2 },
        due: { date: '2026-11-02' },
      },
    }),
    makeItem({
      id: 'i3',
      name: 'Fix the login bug',
      position: 'a3',
      groupId: 'g2',
      values: {
        owner: person('u1', 'u3'),
        status: { index: 2 },
        priority: { index: 0 },
        due: { date: '2026-11-01' },
        budget: '-35.5',
      },
    }),
    makeItem({ id: 'i4', name: 'Celebrate', position: 'a4', groupId: 'g3' }),
  ];
  return base('Marketing launch', items);
}

export function subitemBoard(): WorkbookDataInput {
  const items = [
    makeItem({
      id: 'p1',
      name: '=HYPERLINK("http://example.com")',
      position: 'a1',
      values: {
        owner: person('u4'),
        status: { index: 3 },
        due: { date: '2026-11-12' },
        notes: {
          text: 'First line\nSecond line with <tags> & "quotes"\nThird line, a bit longer than the others so it wraps in the cell',
        },
      },
    }),
    makeItem({
      id: 'p2',
      name: 'Café déjà vu 🎉 — ünïcode',
      position: 'a2',
      groupId: 'g2',
      values: { status: { index: 1 }, priority: { index: 3 }, ok: { checked: false } },
    }),
    makeItem({
      id: 'p3',
      name: 'Bad\u0001control\u0007chars and a very long name that keeps going and going well past fifty characters',
      position: 'a3',
      groupId: 'g3',
      values: { notes: { text: 'x'.repeat(40_000) } },
    }),
  ];
  const subitems = [
    makeItem({ id: 's1', name: 'Draft', parentItemId: 'p1', position: 'a1' }),
    makeItem({ id: 's2', name: '+1 for review', parentItemId: 'p1', position: 'a2' }),
    makeItem({ id: 's3', name: 'Ship', parentItemId: 'p2', position: 'a1' }),
  ];
  const input = base('Product roadmap: Q4 [draft]', items, subitems);
  return {
    ...input,
    subitemColumns: [col('status', 'status', 'Status', 'a1', STATUS)],
  };
}

export function largeBoard(count = 3000): WorkbookDataInput {
  const items: ItemDoc[] = [];
  const subitems: ItemDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `i${i}`;
    items.push(
      makeItem({
        id,
        name: `Task ${i + 1}`,
        position: `a${String(i).padStart(5, '0')}`,
        groupId: (GROUPS[i % 3] as GroupDef).id,
        values: {
          owner: person(`u${(i % 4) + 1}`),
          status: i % 5 === 4 ? null : { index: i % 4 },
          priority: { index: i % 4 },
          due: { date: iso('2026-10-01', i % 90) },
          budget: (i * 37) % 1000,
          ok: { checked: i % 2 === 0 },
        },
      }),
    );
    if (i % 15 === 0) {
      subitems.push(makeItem({ id: `s${i}`, name: `Step of ${i + 1}`, parentItemId: id }));
    }
  }
  return base('Operations backlog', items, subitems);
}

function makeView(
  id: string,
  type: ViewType,
  position: string,
  extra: Partial<ViewSettings>,
): BoardViewDoc {
  return {
    id,
    name: `${type[0]!.toUpperCase()}${type.slice(1)} view`,
    type,
    position,
    ownerId: null,
    settings: { ...defaultViewSettings(), ...extra },
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    updatedBy: 'u1',
  } as BoardViewDoc;
}

/** One view of every type the workbook ports (plus the table, which has no sheet). */
export function allViews(
  chartType: 'bar' | 'stacked_bar' | 'line' | 'pie' | 'donut' = 'bar',
): BoardViewDoc[] {
  return [
    makeView('main', 'table', 'a0', {}),
    makeView('v-kanban', 'kanban', 'a1', {
      kanban: { ...defaultKanbanSettings(), cardColumnIds: ['owner', 'due', 'priority'] },
    }),
    makeView('v-cal', 'calendar', 'a2', {
      calendar: { ...defaultCalendarSettings(), colorBy: 'status' },
    }),
    makeView('v-time', 'timeline', 'a3', {
      timeline: { ...defaultTimelineViewSettings(), columnId: 'span', colorBy: 'status' },
    }),
    makeView('v-gantt', 'gantt', 'a4', {
      gantt: { ...defaultGanttSettings(), columnId: 'span', dependencyColumnId: 'deps' },
    }),
    makeView('v-chart', 'chart', 'a5', { chart: { ...defaultChartSettings(), chartType } }),
    makeView('v-chart-2', 'chart', 'a6', {
      chart: { ...defaultChartSettings(), chartType: 'pie' },
    }),
    makeView('v-work', 'workload', 'a7', {
      workload: { ...defaultWorkloadSettings(), columnId: 'span' },
    }),
  ];
}

const VIEW_COLUMNS: ColumnDef[] = [
  ...COLUMNS,
  col('span', 'timeline', 'Timeline', 'a8'),
  col('deps', 'dependency', 'Depends on', 'a9', { strict: false }),
];

/** A board with every view type: dates, ranges and dependencies around the sample "now". */
export function viewsBoard(
  chartType?: 'bar' | 'stacked_bar' | 'line' | 'pie' | 'donut',
): WorkbookDataInput {
  const names = [
    'Brief',
    'Design',
    'Build',
    'Test',
    'Launch',
    'Review',
    'Retro',
    'Docs',
    'Support',
    'Plan Q1',
  ];
  const items = names.map((name, i) =>
    makeItem({
      id: `v${i}`,
      name,
      position: `a${i}`,
      groupId: (GROUPS[i % 3] as GroupDef).id,
      values: {
        owner: person(`u${(i % 4) + 1}`, ...(i % 3 === 0 ? ['u2'] : [])),
        status: i === 9 ? null : { index: i % 4 },
        priority: { index: i % 4 },
        due: { date: iso('2026-11-02', i * 2) },
        budget: 100 * (i + 1),
        span: { from: iso('2026-10-26', i * 4), to: iso('2026-10-26', i * 4 + 5 + (i % 3)) },
        ...(i > 0 ? { deps: { item_ids: [`v${i - 1}`] } } : {}),
      },
    }),
  );
  return {
    ...base('Website relaunch', items),
    columns: VIEW_COLUMNS,
    views: allViews(chartType),
    allItems: items,
  };
}

/** A large board with every view, wide enough to hit the sheet caps (500 bars, 24 months). */
export function largeViewsBoard(count = 1200): WorkbookDataInput {
  const items: ItemDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push(
      makeItem({
        id: `w${i}`,
        name: `Job ${i + 1}`,
        position: `a${String(i).padStart(5, '0')}`,
        groupId: (GROUPS[i % 3] as GroupDef).id,
        values: {
          owner: person(`u${(i % 4) + 1}`),
          status: { index: i % 4 },
          priority: { index: (i * 7) % 4 },
          due: { date: iso('2025-01-01', i) },
          span: { from: iso('2025-01-01', i), to: iso('2025-01-01', i + 3 + (i % 10)) },
          ...(i > 0 && i % 2 === 0 ? { deps: { item_ids: [`w${i - 1}`] } } : {}),
        },
      }),
    );
  }
  return {
    ...base('Field operations', items),
    columns: VIEW_COLUMNS,
    views: allViews('stacked_bar'),
    allItems: items,
  };
}
