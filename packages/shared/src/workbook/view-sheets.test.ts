import { describe, expect, it } from 'vitest';
import { buildBoardWorkbookParts, type BoardWorkbookData } from './board-workbook';
import { chartXml } from './chart';
import type { ViewSheetData } from './view-sheets';

const base = (
  views: ViewSheetData[],
  selection: BoardWorkbookData['selection'] = null,
): BoardWorkbookData => ({
  boardName: 'Launch',
  exportedLabel: '8 Nov 2026, 14:32',
  createdAt: '2026-11-08T13:32:00Z',
  selection,
  stripe: ['#00c875'],
  figures: {
    items: 1,
    groups: 1,
    done: 0,
    inProgress: 0,
    overdue: 0,
    dueSoon: 0,
    noDate: 0,
    people: 1,
  },
  status: null,
  priority: null,
  groups: { title: 'Groups', rows: [{ label: 'Now', color: '#579bfc', count: 1, done: 0 }] },
  people: {
    title: 'Workload by Owner',
    rows: [{ label: 'Avery Quinn', color: null, count: 1, done: 0 }],
  },
  views,
  items: { header: ['Item', 'Group'], hasSubitems: false, rows: [] },
});

const kanban: ViewSheetData = {
  type: 'kanban',
  name: 'Lanes',
  columnTitle: 'Status',
  cardColumns: ['Owner'],
  lanes: [
    {
      title: 'Done',
      color: '#00c875',
      total: 3,
      cards: [{ name: 'Ship', groupColor: '#579bfc', lines: ['Owner: Avery Quinn'] }],
    },
    { title: 'Empty', color: null, total: 0, cards: [] },
  ],
};
const calendar: ViewSheetData = {
  type: 'calendar',
  name: 'Dates',
  columnTitle: 'Due',
  firstDayOfWeek: 'monday',
  today: '2026-11-08',
  months: ['2026-11'],
  entries: {
    '2026-11-03': [{ name: 'Ship', color: '#00c875' }],
    '2026-11-04': Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, color: null })),
  },
  note: null,
};
const gantt: ViewSheetData = {
  type: 'gantt',
  name: 'Plan',
  columnTitle: 'Timeline',
  today: '2026-11-08',
  rows: [
    { kind: 'group', title: 'Now', color: '#579bfc' },
    {
      kind: 'item',
      name: 'Build',
      from: '2026-11-02',
      to: '2026-11-05',
      color: '#00c875',
      groupColor: '#579bfc',
      dependsOn: 'Brief',
      critical: true,
    },
  ],
  note: 'Showing the first 500 of 900 items.',
};
const chart: ViewSheetData = {
  type: 'chart',
  name: 'Mix',
  chartType: 'donut',
  title: 'Items by status',
  xTitle: 'Status',
  yLabel: 'Items',
  buckets: [
    { label: 'Done', color: '#00c875', value: 2 },
    { label: 'Empty', color: null, value: 1 },
  ],
  series: [],
  stacked: [],
  notes: ['A note'],
  showLegend: true,
  showValues: true,
};
const workload: ViewSheetData = {
  type: 'workload',
  name: 'Load',
  peopleTitle: 'Owner',
  measureLabel: 'Items',
  periods: [
    { label: 'W45', today: true },
    { label: 'W46', today: false },
  ],
  rows: [{ name: 'Avery Quinn', values: [2, 0], levels: ['over', 'empty'], total: 2 }],
  note: null,
};

describe('view sheets', () => {
  const parts = buildBoardWorkbookParts(base([workload, chart, gantt, calendar, kanban]));
  const sheet = (n: number) => parts[`xl/worksheets/sheet${n}.xml`] as string;

  it('orders the sheets Kanban, Calendar, Gantt, Chart, Workload after Summary and Items', () => {
    expect(parts['xl/workbook.xml']).toMatch(
      /name="Summary".*name="Items".*name="Kanban".*name="Calendar".*name="Gantt".*name="Chart".*name="Workload"/,
    );
    for (const name of ['Kanban', 'Calendar', 'Gantt', 'Chart', 'Workload']) {
      expect(sheet(1)).toContain(`location="'${name}'!A1"`);
    }
  });

  it('draws Kanban lanes in their colours and cards with a group edge', () => {
    const k = sheet(3);
    expect(k).toContain('<t>Done  ·  3</t>');
    expect(k).toContain('<t>Ship</t>');
    expect(k).toContain('<t>Owner: Avery Quinn</t>');
    expect(k).toContain('<t>and 2 more</t>');
    expect(parts['xl/styles.xml']).toContain('<left style="thick"><color rgb="FF579BFC"/></left>');
  });

  it('draws Calendar months with pills and "+N more"', () => {
    const c = sheet(4);
    expect(c).toContain('<t>NOVEMBER 2026</t>');
    expect(c).toContain('<t>Mon</t>');
    expect(c).toContain('<t>Ship</t>');
    expect(c).toContain('<t>+4 more</t>');
  });

  it('draws Gantt bars, dependencies, the critical path and the cap note', () => {
    const g = sheet(5);
    expect(g).toContain('<t>Depends on</t>');
    expect(g).toContain('<t>Brief</t>');
    expect(g).toContain('<t>Yes</t>');
    expect(g).toContain('Showing the first 500 of 900 items.');
    expect(g).toContain('<pane xSplit="7" ySplit="6"');
  });

  it('puts the chart data next to a native doughnut chart', () => {
    expect(sheet(6)).toContain('<t>A note</t>');
    const charts = Object.keys(parts).filter((p) => p.startsWith('xl/charts/'));
    expect(charts.some((p) => (parts[p] as string).includes('<c:doughnutChart>'))).toBe(true);
  });

  it('colours Workload cells by level and charts the totals', () => {
    expect(parts['xl/styles.xml']).toContain('FFFFB3BF');
    expect(sheet(7)).toContain('<t>TOTAL BY OWNER</t>');
    expect(sheet(7)).toContain('<drawing r:id="rId1"/>');
  });

  it('leaves the view sheets out of a selection export', () => {
    const selection = buildBoardWorkbookParts(base([kanban], { count: 1, total: 5 }));
    expect(selection['xl/worksheets/sheet3.xml']).toBeUndefined();
  });

  it('keeps one sheet per view type', () => {
    const twice = buildBoardWorkbookParts(base([kanban, { ...kanban, name: 'Second' }]));
    expect(twice['xl/worksheets/sheet4.xml']).toBeUndefined();
  });
});

describe('chart kinds', () => {
  const common = {
    title: 't',
    categoriesRef: "'Chart'!$B$7:$B$8",
    categories: ['a', 'b'],
    anchor: { fromCol: 0, fromRow: 0, toCol: 4, toRow: 10 },
    series: [{ name: 's', valuesRef: "'Chart'!$C$7:$C$8", values: [1, null], color: '#0073ea' }],
  };

  it('writes a line chart with markers and leaves gaps for missing values', () => {
    const xml = chartXml({ ...common, kind: 'line' });
    expect(xml).toContain('<c:lineChart><c:grouping val="standard"/>');
    expect(xml).toContain('<c:marker><c:symbol val="circle"/>');
    expect(xml).toContain('<c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache>');
  });

  it('writes pie and doughnut charts without axes or a label position', () => {
    for (const kind of ['pie', 'doughnut'] as const) {
      const xml = chartXml({ ...common, kind, showLegend: true });
      expect(xml).not.toContain('<c:catAx>');
      expect(xml).not.toContain('dLblPos');
      expect(xml).toContain('<c:showPercent val="1"/>');
      expect(xml).toContain('<c:legendPos val="r"/>');
    }
    expect(chartXml({ ...common, kind: 'doughnut' })).toContain('<c:holeSize val="55"/>');
  });

  it('writes a stacked bar with overlap', () => {
    const xml = chartXml({ ...common, kind: 'bar', grouping: 'stacked' });
    expect(xml).toContain('<c:grouping val="stacked"/>');
    expect(xml).toContain('<c:overlap val="100"/>');
    expect(xml).toContain('<c:dLblPos val="ctr"/>');
  });
});
