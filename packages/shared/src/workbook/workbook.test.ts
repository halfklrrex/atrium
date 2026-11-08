import { describe, expect, it } from 'vitest';
import {
  CHECK_MARK,
  buildBoardWorkbookParts,
  excelSerialDate,
  guardFormula,
  type BoardWorkbookData,
} from './board-workbook';
import { chartXml, drawingXml } from './chart';
import { PALETTE, argb, rgb, textOn } from './palette';
import { SheetWriter, safeSheetName } from './sheet';
import { StyleRegistry } from './styles';
import {
  MAX_CELL_TEXT,
  absRange,
  clampCellText,
  quoteSheet,
  rangeRef,
  stripIllegalXmlChars,
  xlsxColumnName,
  xmlEscape,
} from './xml';

describe('xml helpers', () => {
  it('escapes text and removes characters XML cannot hold', () => {
    expect(xmlEscape('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;');
    expect(stripIllegalXmlChars('a\u0000b\ud800c￾')).toBe('abc');
    expect(stripIllegalXmlChars('tab\tnew\nline 🎉')).toBe('tab\tnew\nline 🎉');
  });

  it('cuts a cell to Excel’s limit without splitting a surrogate pair', () => {
    expect(clampCellText('x'.repeat(40_000))).toHaveLength(MAX_CELL_TEXT);
    const pair = `${'x'.repeat(MAX_CELL_TEXT - 1)}🎉`;
    expect(clampCellText(pair)).toHaveLength(MAX_CELL_TEXT - 1);
  });

  it('names columns and ranges', () => {
    expect([0, 25, 26, 701, 702, 16_383].map(xlsxColumnName)).toEqual([
      'A',
      'Z',
      'AA',
      'ZZ',
      'AAA',
      'XFD',
    ]);
    expect(rangeRef(0, 1, 2, 3)).toBe('A1:C3');
    expect(rangeRef(1, 2, 1, 2)).toBe('B2');
    expect(absRange(1, 5, 1, 9)).toBe('$B$5:$B$9');
    expect(quoteSheet("Bob's")).toBe("'Bob''s'");
  });

  it('reads dates as Excel serials', () => {
    expect(excelSerialDate('1900-03-01')?.serial).toBe(61);
    expect(excelSerialDate('2026-01-05')).toEqual({ serial: 46027, hasTime: false });
    expect(excelSerialDate('2026-01-05 12:00:00')).toEqual({ serial: 46027.5, hasTime: true });
    expect(excelSerialDate('2026-02-30')).toBeNull();
    expect(excelSerialDate('2026-01-05 25:00:00')).toBeNull();
    expect(excelSerialDate('nope')).toBeNull();
  });

  it('guards formula-like text', () => {
    expect(['=1', '+1', '-a', '@x', '\tx', '\rx', 'ok'].map(guardFormula)).toEqual([
      "'=1",
      "'+1",
      "'-a",
      "'@x",
      "'\tx",
      "'\rx",
      'ok',
    ]);
  });
});

describe('palette', () => {
  it('converts colours', () => {
    expect(argb('#0073ea')).toBe('FF0073EA');
    expect(rgb('#0073ea')).toBe('0073EA');
    expect(argb('not a colour')).toBe('FF000000');
  });

  it('uses white text on label colours and dark text on very light ones', () => {
    expect(textOn('#00c875')).toBe(PALETTE.white);
    expect(textOn('#fdab3d')).toBe(PALETTE.white);
    expect(textOn('#ffffff')).toBe(PALETTE.text);
    expect(textOn('#f6f7fb')).toBe(PALETTE.text);
  });
});

describe('StyleRegistry', () => {
  it('keeps index 0 as the default and shares equal styles', () => {
    const st = new StyleRegistry();
    expect(st.style()).toBe(0);
    const a = st.style({ font: { bold: true }, fill: '#0073ea' });
    const b = st.style({ font: { bold: true }, fill: '#0073ea' });
    const c = st.style({ font: { bold: true }, fill: '#00c875' });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(st.styleCount).toBe(3);
  });

  it('writes the style sheet in schema order with Figtree and the required fills', () => {
    const st = new StyleRegistry();
    st.style({ numFmt: 'd mmm yyyy' });
    st.style({ numFmt: '0%' });
    st.style({ numFmt: 'd mmm yyyy', font: { italic: true } });
    st.dxf({ fill: '#fdab3d', bold: true });
    const xml = st.xml();
    const order = [
      '<numFmts',
      '<fonts',
      '<fills',
      '<borders',
      '<cellStyleXfs',
      '<cellXfs',
      '<cellStyles',
      '<dxfs',
    ];
    const positions = order.map((tag) => xml.indexOf(tag));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(xml).toContain('<numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/>');
    expect(xml).toContain('numFmtId="9"');
    expect(xml).toContain('<name val="Figtree"/><family val="2"/><scheme val="none"/>');
    expect(xml).toContain(
      '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>',
    );
    expect(xml).toContain(
      '<dxfs count="1"><dxf><font><b/></font><fill><patternFill patternType="solid"><bgColor rgb="FFFDAB3D"/>',
    );
  });

  it('only writes an indent with a left or right alignment', () => {
    const st = new StyleRegistry();
    st.style({ align: { h: 'center', indent: 2 } });
    st.style({ align: { h: 'left', indent: 2 } });
    const xml = st.xml();
    expect(xml).toContain('<alignment horizontal="center"/>');
    expect(xml).toContain('<alignment horizontal="left" indent="2"/>');
  });
});

describe('SheetWriter', () => {
  it('writes cells in row and column order whatever order they were set in', () => {
    const sheet = new SheetWriter('Data');
    sheet.number(2, 3, 7);
    sheet.text(0, 3, 'b');
    sheet.text(0, 1, 'a');
    sheet.bool(1, 1, true);
    const xml = sheet.xml({ selected: true });
    expect(xml).toContain(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="b"><v>1</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>b</t></is></c><c r="C3"><v>7</v></c></row></sheetData>',
    );
    expect(xml).toContain('<dimension ref="A1:C3"/>');
    expect(xml).toContain('tabSelected="1"');
  });

  it('refuses overlapping merges and rows that were already flushed', () => {
    const sheet = new SheetWriter('Data');
    sheet.merge({ c1: 0, r1: 1, c2: 2, r2: 1 });
    expect(() => sheet.merge({ c1: 2, r1: 1, c2: 3, r2: 2 })).toThrow(/overlaps/);
    sheet.merge({ c1: 3, r1: 1, c2: 4, r2: 1 });
    sheet.text(0, 2, 'x');
    sheet.flushBefore(3);
    expect(() => sheet.text(0, 2, 'late')).toThrow(/already written/);
  });

  it('writes the worksheet children in schema order', () => {
    const sheet = new SheetWriter('Items', {
      tabColor: '#0073ea',
      showGridLines: false,
      freeze: { cols: 2, rows: 4 },
      fitToWidth: true,
      landscape: true,
    });
    sheet.setWidth(1, 30);
    sheet.text(1, 4, 'Item');
    sheet.number(2, 5, 3);
    sheet.merge({ c1: 0, r1: 1, c2: 3, r2: 1 });
    sheet.setAutoFilter({ c1: 1, r1: 4, c2: 3, r2: 5 });
    sheet.dataBar({ c1: 2, r1: 5, c2: 2, r2: 5 }, '#579bfc');
    sheet.link(1, 4, "'Summary'!A1", 'Summary');
    sheet.addChart({
      kind: 'bar',
      title: 't',
      categoriesRef: "'Items'!$B$5",
      categories: ['a'],
      series: [{ name: 'n', valuesRef: "'Items'!$C$5", values: [3], color: '#0073ea' }],
      anchor: { fromCol: 0, fromRow: 0, toCol: 2, toRow: 2 },
    });
    const xml = sheet.xml({ selected: false, drawingRelId: 'rId1' });
    const order = [
      '<sheetPr>',
      '<dimension',
      '<sheetViews>',
      '<sheetFormatPr',
      '<cols>',
      '<sheetData>',
      '<autoFilter',
      '<mergeCells',
      '<conditionalFormatting',
      '<hyperlinks>',
      '<printOptions',
      '<pageMargins',
      '<pageSetup',
      '<drawing',
      // The worksheet's own extLst (the data bar rule has one inside it too).
      '<extLst><ext uri="{78C0D931',
    ];
    const positions = order.map((tag) => xml.indexOf(tag));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(xml).toContain(
      '<pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/>',
    );
    expect(xml).toContain('showGridLines="0"');
    // The 2007 data bar and its 2010 extension share one id.
    const ids = xml.match(/\{A7C1D2E3-[0-9A-F-]+\}/g) ?? [];
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(sheet.definedNames(1)).toEqual([
      `<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Items'!$B$4:$D$5</definedName>`,
    ]);
  });

  it('cleans sheet names', () => {
    expect(safeSheetName('Q4: plan [draft]?')).toBe('Q4- plan -draft--');
    expect(safeSheetName("'x'")).toBe('x');
    expect(safeSheetName('')).toBe('Sheet');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
  });
});

describe('charts', () => {
  const spec = {
    kind: 'bar' as const,
    title: 'Items by status',
    categoriesRef: "'Summary'!$B$14:$B$15",
    categories: ['Done', 'Stuck <x>'],
    series: [
      {
        name: 'Items',
        valuesRef: "'Summary'!$C$14:$C$15",
        values: [3, 1],
        color: '#0073ea',
        pointColors: ['#00c875', '#df2f4a'],
      },
    ],
    anchor: { fromCol: 5, fromRow: 12, toCol: 8, toRow: 26 },
  };

  it('writes a bar chart with per-point colours and caches', () => {
    const xml = chartXml(spec);
    expect(xml).toContain('<c:barDir val="col"/><c:grouping val="clustered"/>');
    expect(xml).toContain(
      '<c:dPt><c:idx val="1"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="DF2F4A"/>',
    );
    expect(xml).toContain('<c:f>&apos;Summary&apos;!$B$14:$B$15</c:f>'.replace(/&apos;/g, "'"));
    expect(xml).toContain('<c:pt idx="1"><c:v>Stuck &lt;x&gt;</c:v></c:pt>');
    expect(xml).toContain('<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/>');
    expect(xml).toContain('<a:latin typeface="Figtree"/>');
  });

  it('anchors charts in a drawing with unique frame ids', () => {
    const xml = drawingXml([spec.anchor, { fromCol: 0, fromRow: 30, toCol: 3, toRow: 40 }]);
    expect(xml).toContain(
      '<xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row>',
    );
    expect(xml).toContain('<xdr:cNvPr id="2" name="Chart 1"/>');
    expect(xml).toContain('<xdr:cNvPr id="3" name="Chart 2"/>');
    expect(xml).toContain('r:id="rId2"');
  });
});

function sampleData(overrides: Partial<BoardWorkbookData> = {}): BoardWorkbookData {
  return {
    boardName: 'Launch & <plan>',
    exportedLabel: '8 Nov 2026, 14:32',
    createdAt: '2026-11-08T13:32:00Z',
    selection: null,
    stripe: ['#fdab3d', '#00c875'],
    figures: {
      items: 3,
      groups: 2,
      done: 1,
      inProgress: 1,
      overdue: 1,
      dueSoon: 0,
      noDate: 1,
      people: 2,
    },
    status: {
      title: 'Status',
      rows: [
        { label: 'Done', color: '#00c875', count: 1 },
        { label: 'Not set', color: null, count: 2 },
      ],
    },
    priority: null,
    groups: {
      title: 'Groups',
      rows: [
        { label: 'Now', color: '#579bfc', count: 2, done: 1 },
        { label: 'Later', color: '#a25ddc', count: 1, done: 0 },
      ],
    },
    people: {
      title: 'Workload by Owner',
      rows: [{ label: 'Avery Quinn', color: null, count: 2, done: 1 }],
      more: 0,
    },
    items: {
      header: ['Item', 'Group', 'Status', 'Due', 'Cost', 'OK', 'Note'],
      hasSubitems: false,
      rows: [
        {
          cells: [
            '=SUM(A1)',
            'Now',
            { text: 'Done', color: '#00c875' },
            { text: '2026-01-05', date: true },
            { text: '-4.5', numeric: true },
            { text: 'v', checkbox: true },
            'line 1\nline 2',
          ],
          groupColor: '#579bfc',
          subitem: false,
        },
        {
          cells: [
            'B',
            'Later',
            { text: '', color: null },
            '',
            '',
            { text: '', checkbox: true },
            '',
          ],
          groupColor: '#a25ddc',
          subitem: false,
        },
      ],
    },
    ...overrides,
  };
}

describe('buildBoardWorkbookParts', () => {
  const parts = buildBoardWorkbookParts(sampleData());
  const summary = parts['xl/worksheets/sheet1.xml'] as string;
  const items = parts['xl/worksheets/sheet2.xml'] as string;

  it('has the Summary first, then Items, with a chart on the Summary', () => {
    expect(parts['xl/workbook.xml']).toContain(
      '<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Items" sheetId="2" r:id="rId2"/></sheets>',
    );
    expect(Object.keys(parts)).toEqual(
      expect.arrayContaining([
        'xl/charts/chart1.xml',
        'xl/drawings/drawing1.xml',
        'xl/drawings/_rels/drawing1.xml.rels',
        'xl/worksheets/_rels/sheet1.xml.rels',
        'docProps/core.xml',
      ]),
    );
    expect(parts['[Content_Types].xml']).toContain('/xl/charts/chart1.xml');
    expect(parts['docProps/core.xml']).toContain('<dc:title>Launch &amp; &lt;plan&gt;</dc:title>');
  });

  it('lays out the Summary banner, cards, tables and links', () => {
    expect(summary).toContain('<mergeCell ref="A1:I1"/>');
    expect(summary).toContain('<t>Launch &amp; &lt;plan&gt;</t>');
    expect(summary).toContain('Board summary · 3 items · Exported 8 Nov 2026, 14:32');
    for (const label of ['ITEMS', 'DONE', 'OVERDUE', 'DUE IN 7 DAYS', 'PEOPLE', 'GROUPS']) {
      expect(summary).toContain(`<t>${label}</t>`);
    }
    expect(summary).toContain('<t>STATUS</t>');
    expect(summary).toContain('<t>WORKLOAD BY OWNER</t>');
    expect(summary).toContain('<t>IN THIS WORKBOOK</t>');
    expect(summary).toContain(`location="'Items'!A1"`);
    expect(summary).toContain('type="dataBar"');
    expect(summary).toContain('<drawing r:id="rId1"/>');
  });

  it('styles Items: frozen header, autofilter, guard, dates, numbers and check marks', () => {
    expect(items).toContain('activePane="bottomRight" state="frozen"');
    expect(items).toContain('<autoFilter ref="B4:H6"/>');
    expect(items).toContain(`<t>'=SUM(A1)</t>`);
    expect(items).toContain('<v>46027</v>');
    expect(items).toContain('<v>-4.5</v>');
    expect(items).toContain(`<t>${CHECK_MARK}</t>`);
    expect(items).toContain('<t xml:space="preserve">line 1\nline 2</t>');
    expect(items).toContain(`location="'Summary'!A1"`);
    expect(parts['xl/workbook.xml']).toContain(
      `<definedName name="_xlnm.Print_Titles" localSheetId="1">'Items'!$4:$4</definedName>`,
    );
  });

  it('says when the workbook holds a selection', () => {
    const selection = buildBoardWorkbookParts(sampleData({ selection: { count: 3, total: 40 } }));
    expect(selection['xl/worksheets/sheet1.xml']).toContain(
      'Selection of 3 items (of 40 on the board)',
    );
    expect(selection['xl/worksheets/sheet1.xml']).toContain(
      'Figures describe the selected items only.',
    );
  });

  it('writes an empty board without failing', () => {
    const empty = buildBoardWorkbookParts(
      sampleData({
        status: null,
        people: null,
        groups: { title: 'Groups', rows: [] },
        figures: {
          items: 0,
          groups: 0,
          done: null,
          inProgress: null,
          overdue: null,
          dueSoon: null,
          noDate: null,
          people: null,
        },
        items: { header: ['Item', 'Group'], hasSubitems: false, rows: [] },
      }),
    );
    expect(empty['xl/worksheets/sheet2.xml']).toContain('No items to export');
    expect(empty['xl/charts/chart1.xml']).toBeUndefined();
  });
});
