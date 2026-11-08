/**
 * Strict structure test of the designed Excel workbook: the file is zipped and unzipped with
 * `fflate`, every part is parsed as XML, and the rules Excel enforces are checked (part and
 * relationship graph, element order, style indexes, cell references, merged ranges, links,
 * conditional formats, defined names and chart references). A failure here is what makes Excel
 * say "We found a problem with some content".
 *
 * Set `ATRIUM_WORKBOOK_SAMPLES=<folder>` to also write the sample workbooks there (for opening
 * them in Excel or Numbers by hand).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { largeBoard, smallBoard, subitemBoard } from '../../test/workbook-boards';
import { boardXlsxBytes } from './board-export';
import { buildBoardWorkbookData, type WorkbookDataInput } from './workbook-data';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

/** `CT_Worksheet` child order (ECMA-376 part 1, 18.3.1.99). */
const WORKSHEET_ORDER = [
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'drawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
];
const STYLESHEET_ORDER = [
  'numFmts',
  'fonts',
  'fills',
  'borders',
  'cellStyleXfs',
  'cellXfs',
  'cellStyles',
  'dxfs',
  'tableStyles',
  'colors',
  'extLst',
];
const WORKBOOK_ORDER = [
  'fileVersion',
  'fileSharing',
  'workbookPr',
  'workbookProtection',
  'bookViews',
  'sheets',
  'functionGroups',
  'externalReferences',
  'definedNames',
  'calcPr',
];
const CHART_SPACE_ORDER = [
  'date1904',
  'lang',
  'roundedCorners',
  'AlternateContent',
  'style',
  'clrMapOvr',
  'pivotSource',
  'protection',
  'chart',
  'spPr',
  'txPr',
  'externalData',
  'printSettings',
  'userShapes',
];
const CHART_ORDER = [
  'title',
  'autoTitleDeleted',
  'pivotFmts',
  'view3D',
  'floor',
  'sideWall',
  'backWall',
  'plotArea',
  'legend',
  'plotVisOnly',
  'dispBlanksAs',
];
const BAR_CHART_ORDER = [
  'barDir',
  'grouping',
  'varyColors',
  'ser',
  'dLbls',
  'gapWidth',
  'overlap',
  'serLines',
  'axId',
];
const BAR_SER_ORDER = [
  'idx',
  'order',
  'tx',
  'spPr',
  'invertIfNegative',
  'pictureOptions',
  'dPt',
  'dLbls',
  'trendline',
  'errBars',
  'cat',
  'val',
  'shape',
  'extLst',
];
const DLBLS_ORDER = [
  'dLbl',
  'delete',
  'numFmt',
  'spPr',
  'txPr',
  'dLblPos',
  'showLegendKey',
  'showVal',
  'showCatName',
  'showSerName',
  'showPercent',
  'showBubbleSize',
  'separator',
  'showLeaderLines',
  'leaderLines',
];
const CAT_AX_ORDER = [
  'axId',
  'scaling',
  'delete',
  'axPos',
  'majorGridlines',
  'minorGridlines',
  'title',
  'numFmt',
  'majorTickMark',
  'minorTickMark',
  'tickLblPos',
  'spPr',
  'txPr',
  'crossAx',
  'crosses',
  'crossesAt',
  'auto',
  'lblAlgn',
  'lblOffset',
  'noMultiLvlLbl',
];
const VAL_AX_ORDER = [
  'axId',
  'scaling',
  'delete',
  'axPos',
  'majorGridlines',
  'minorGridlines',
  'title',
  'numFmt',
  'majorTickMark',
  'minorTickMark',
  'tickLblPos',
  'spPr',
  'txPr',
  'crossAx',
  'crosses',
  'crossesAt',
  'crossBetween',
  'majorUnit',
  'minorUnit',
];
const XF_ORDER = ['alignment', 'protection', 'extLst'];
const BORDER_ORDER = ['start', 'left', 'end', 'right', 'top', 'bottom', 'diagonal'];

const children = (el: Element): Element[] => Array.from(el.children);
const childNamed = (el: Element, name: string) => children(el).filter((c) => c.localName === name);

function expectOrder(el: Element, order: readonly string[], where: string): void {
  let last = -1;
  for (const child of children(el)) {
    const i = order.indexOf(child.localName);
    expect(i, `${where}: unexpected <${child.localName}>`).toBeGreaterThanOrEqual(0);
    expect(i, `${where}: <${child.localName}> is out of order`).toBeGreaterThanOrEqual(last);
    last = i;
  }
}

function parse(name: string, text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  expect(error, `${name} is not well-formed: ${error?.textContent ?? ''}`).toBeUndefined();
  return doc;
}

interface Cell {
  col: number;
  row: number;
}

function parseRef(ref: string): Cell {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell reference ${ref}`);
  let col = 0;
  for (const ch of m[1] as string) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (col < 1 || col > 16_384 || row < 1 || row > 1_048_576) throw new Error(`Out of range ${ref}`);
  return { col: col - 1, row };
}

function parseRange(ref: string): { a: Cell; b: Cell } {
  const [x, y] = ref.split(':');
  const a = parseRef(x as string);
  const b = parseRef((y ?? x) as string);
  if (b.col < a.col || b.row < a.row) throw new Error(`Inverted range ${ref}`);
  return { a, b };
}

/** `'Sheet name'!$A$1:$B$2` or `Sheet!A1` into the sheet name and the range. */
function parseSheetRef(ref: string): { sheet: string; range: string } {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(ref);
  if (!m) throw new Error(`Bad sheet reference ${ref}`);
  return { sheet: (m[1] ?? m[2] ?? '').replace(/''/g, "'"), range: m[3] as string };
}

function resolveTarget(source: string, target: string): string {
  const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  // `_rels/x.rels` describes the part one level up.
  const base = dir.endsWith('_rels') ? dir.slice(0, -'_rels'.length).replace(/\/$/, '') : dir;
  const parts = (target.startsWith('/') ? target.slice(1) : `${base ? `${base}/` : ''}${target}`)
    .split('/')
    .reduce<string[]>((acc, p) => {
      if (p === '..') acc.pop();
      else if (p !== '.' && p !== '') acc.push(p);
      return acc;
    }, []);
  return parts.join('/');
}

/** Checks every rule and returns the parsed parts for further assertions. */
async function checkWorkbook(input: WorkbookDataInput, sampleName: string) {
  const data = buildBoardWorkbookData(input);
  const bytes = await boardXlsxBytes(data);
  const samples = process.env.ATRIUM_WORKBOOK_SAMPLES;
  if (samples) {
    mkdirSync(samples, { recursive: true });
    writeFileSync(join(samples, `${sampleName}.xlsx`), bytes);
  }
  const zip = unzipSync(bytes);
  const texts = Object.fromEntries(
    Object.entries(zip).map(([name, content]) => [name, strFromU8(content)]),
  );
  const docs = Object.fromEntries(Object.entries(texts).map(([n, t]) => [n, parse(n, t)]));
  const doc = (name: string): Document => {
    const d = docs[name];
    expect(d, `missing part ${name}`).toBeDefined();
    return d as Document;
  };

  // Content types: every part has one, every override exists.
  const types = doc('[Content_Types].xml').documentElement;
  const overrides = new Map(
    childNamed(types, 'Override').map((o) => [
      (o.getAttribute('PartName') ?? '').slice(1),
      o.getAttribute('ContentType'),
    ]),
  );
  const defaults = new Set(childNamed(types, 'Default').map((d) => d.getAttribute('Extension')));
  for (const part of overrides.keys())
    expect(zip[part], `override for missing ${part}`).toBeDefined();
  for (const part of Object.keys(zip)) {
    const ext = part.slice(part.lastIndexOf('.') + 1);
    expect(overrides.has(part) || defaults.has(ext), `no content type for ${part}`).toBe(true);
  }
  for (const [part, type] of overrides) {
    if (part.startsWith('xl/worksheets/sheet')) expect(type).toContain('worksheet+xml');
    if (part.startsWith('xl/charts/')) expect(type).toContain('drawingml.chart+xml');
    if (part.startsWith('xl/drawings/drawing')) expect(type).toContain('drawing+xml');
  }

  // Relationships: unique ids, every target exists.
  const relsOf = new Map<string, Map<string, string>>();
  for (const name of Object.keys(zip).filter((n) => n.endsWith('.rels'))) {
    const ids = new Map<string, string>();
    for (const rel of childNamed(doc(name).documentElement, 'Relationship')) {
      const id = rel.getAttribute('Id') ?? '';
      expect(ids.has(id), `duplicate ${id} in ${name}`).toBe(false);
      const target = resolveTarget(name, rel.getAttribute('Target') ?? '');
      expect(zip[target], `${name} ${id} points to missing ${target}`).toBeDefined();
      ids.set(id, target);
    }
    const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
    relsOf.set(owner, ids);
  }

  // Workbook: order, sheets, defined names.
  const workbook = doc('xl/workbook.xml').documentElement;
  expectOrder(workbook, WORKBOOK_ORDER, 'workbook');
  const sheetEls = childNamed(childNamed(workbook, 'sheets')[0]!, 'sheet');
  const sheetNames = sheetEls.map((s) => s.getAttribute('name') ?? '');
  expect(new Set(sheetNames.map((n) => n.toLowerCase())).size).toBe(sheetNames.length);
  for (const name of sheetNames) {
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  }
  const wbRels = relsOf.get('xl/workbook.xml')!;
  const sheetParts = sheetEls.map((s) => {
    const rid = s.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id',
    );
    const part = wbRels.get(rid ?? '');
    expect(part, `sheet ${s.getAttribute('name')} has no part`).toBeDefined();
    return part as string;
  });
  const defined = childNamed(workbook, 'definedNames')[0];
  for (const dn of defined ? childNamed(defined, 'definedName') : []) {
    const local = Number(dn.getAttribute('localSheetId'));
    expect(local).toBeLessThan(sheetNames.length);
    const ref = dn.textContent ?? '';
    const { sheet, range } = parseSheetRef(ref);
    expect(sheetNames).toContain(sheet);
    if (!/^\$\d+:\$\d+$/.test(range)) parseRange(range);
  }

  // Styles: order, counts, ids in range.
  const styles = doc('xl/styles.xml').documentElement;
  expectOrder(styles, STYLESHEET_ORDER, 'styles');
  const countOf = (tag: string) => {
    const el = childNamed(styles, tag)[0];
    if (!el) return 0;
    const n = children(el).length;
    expect(Number(el.getAttribute('count')), `${tag} count`).toBe(n);
    return n;
  };
  const fonts = countOf('fonts');
  const fills = countOf('fills');
  const borders = countOf('borders');
  const xfCount = countOf('cellXfs');
  const dxfCount = countOf('dxfs');
  countOf('numFmts');
  countOf('cellStyleXfs');
  const numFmtIds = new Set(
    childNamed(childNamed(styles, 'numFmts')[0] ?? styles, 'numFmt').map((n) =>
      Number(n.getAttribute('numFmtId')),
    ),
  );
  for (const xf of childNamed(childNamed(styles, 'cellXfs')[0]!, 'xf')) {
    expect(Number(xf.getAttribute('fontId'))).toBeLessThan(fonts);
    expect(Number(xf.getAttribute('fillId'))).toBeLessThan(fills);
    expect(Number(xf.getAttribute('borderId'))).toBeLessThan(borders);
    const fmt = Number(xf.getAttribute('numFmtId'));
    if (fmt >= 164) expect(numFmtIds.has(fmt), `numFmt ${fmt}`).toBe(true);
    expectOrder(xf, XF_ORDER, 'xf');
  }
  for (const b of childNamed(childNamed(styles, 'borders')[0]!, 'border')) {
    expectOrder(b, BORDER_ORDER, 'border');
  }
  const firstFills = childNamed(childNamed(styles, 'fills')[0]!, 'fill');
  expect(firstFills[0]!.innerHTML).toContain('patternType="none"');
  expect(firstFills[1]!.innerHTML).toContain('patternType="gray125"');
  for (const font of childNamed(childNamed(styles, 'fonts')[0]!, 'font')) {
    expect(childNamed(font, 'name')[0]!.getAttribute('val')).toBe('Figtree');
    expect(childNamed(font, 'family')[0]!.getAttribute('val')).toBe('2');
  }

  // Worksheets.
  const sheets = sheetParts.map((part, index) => {
    const ws = doc(part).documentElement;
    const name = sheetNames[index] as string;
    expect(ws.namespaceURI).toBe(NS_MAIN);
    expectOrder(ws, WORKSHEET_ORDER, part);

    // Rows and cells increase; references match; styles exist; text fits Excel's limit.
    const sheetData = childNamed(ws, 'sheetData')[0]!;
    let lastRow = 0;
    let maxCol = 0;
    let maxRow = 1;
    for (const row of childNamed(sheetData, 'row')) {
      const r = Number(row.getAttribute('r'));
      expect(r, `${part}: row ${r} after ${lastRow}`).toBeGreaterThan(lastRow);
      lastRow = r;
      let lastCol = -1;
      for (const c of childNamed(row, 'c')) {
        const ref = parseRef(c.getAttribute('r') ?? '');
        expect(ref.row, `${part}: cell ${c.getAttribute('r')} in row ${r}`).toBe(r);
        expect(ref.col, `${part}: cell ${c.getAttribute('r')} order`).toBeGreaterThan(lastCol);
        lastCol = ref.col;
        maxCol = Math.max(maxCol, ref.col);
        maxRow = Math.max(maxRow, r);
        const s = Number(c.getAttribute('s') ?? '0');
        expect(s, `${part}: style of ${c.getAttribute('r')}`).toBeLessThan(xfCount);
        const t = c.getAttribute('t');
        if (t === 'inlineStr') {
          const text = c.getElementsByTagName('t')[0]?.textContent ?? '';
          expect(text.length).toBeLessThanOrEqual(32_767);
          expect(childNamed(c, 'v')).toHaveLength(0);
        } else if (t === 'b') {
          expect(['0', '1']).toContain(childNamed(c, 'v')[0]?.textContent);
        } else if (t === null) {
          const v = childNamed(c, 'v')[0];
          if (v) expect(Number.isFinite(Number(v.textContent))).toBe(true);
        } else {
          throw new Error(`${part}: unexpected cell type ${t}`);
        }
      }
    }
    const dim = parseRange(childNamed(ws, 'dimension')[0]!.getAttribute('ref') ?? '');
    expect(dim.b.col).toBeGreaterThanOrEqual(maxCol);
    expect(dim.b.row).toBeGreaterThanOrEqual(maxRow);

    // Merged ranges: valid, more than one cell, never overlapping.
    const mergeEl = childNamed(ws, 'mergeCells')[0];
    const merges = mergeEl
      ? childNamed(mergeEl, 'mergeCell').map((m) => parseRange(m.getAttribute('ref') ?? ''))
      : [];
    if (mergeEl) expect(Number(mergeEl.getAttribute('count'))).toBe(merges.length);
    merges.forEach((m, i) => {
      expect(m.a.col !== m.b.col || m.a.row !== m.b.row).toBe(true);
      for (const o of merges.slice(i + 1)) {
        const overlap =
          m.a.col <= o.b.col && o.a.col <= m.b.col && m.a.row <= o.b.row && o.a.row <= m.b.row;
        expect(overlap, `${part}: overlapping merges`).toBe(false);
      }
    });

    // Columns: valid, increasing, sensible widths.
    const cols = childNamed(ws, 'cols')[0];
    let lastMax = 0;
    for (const c of cols ? childNamed(cols, 'col') : []) {
      const min = Number(c.getAttribute('min'));
      const max = Number(c.getAttribute('max'));
      expect(min).toBeGreaterThan(lastMax);
      expect(max).toBeGreaterThanOrEqual(min);
      lastMax = max;
      const width = Number(c.getAttribute('width'));
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(255);
    }

    // Conditional formats: ranges valid, unique priorities, dxfs exist, 2010 ids match.
    const priorities = new Set<number>();
    const barIds = new Set<string>();
    for (const cf of childNamed(ws, 'conditionalFormatting')) {
      for (const part2 of (cf.getAttribute('sqref') ?? '').split(' ')) parseRange(part2);
      for (const rule of childNamed(cf, 'cfRule')) {
        const p = Number(rule.getAttribute('priority'));
        expect(priorities.has(p), `${part}: priority ${p} twice`).toBe(false);
        priorities.add(p);
        const dxf = rule.getAttribute('dxfId');
        if (dxf !== null) expect(Number(dxf)).toBeLessThan(dxfCount);
        if (rule.getAttribute('type') === 'dataBar') {
          const id = rule.getElementsByTagName('x14:id')[0]?.textContent ?? '';
          expect(id).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
          barIds.add(id);
        }
      }
    }
    const extIds = Array.from(ws.getElementsByTagName('x14:cfRule')).map((r) =>
      r.getAttribute('id'),
    );
    expect(new Set(extIds)).toEqual(barIds);

    // Pane, links, autofilter.
    const pane = ws.getElementsByTagName('pane')[0];
    if (pane) parseRef(pane.getAttribute('topLeftCell') ?? '');
    for (const link of ws.getElementsByTagName('hyperlink')) {
      parseRef(link.getAttribute('ref') ?? '');
      const { sheet, range } = parseSheetRef(link.getAttribute('location') ?? '');
      expect(sheetNames).toContain(sheet);
      parseRange(range);
      expect(link.getAttribute('r:id')).toBeNull();
    }
    const af = childNamed(ws, 'autoFilter')[0];
    if (af) parseRange(af.getAttribute('ref') ?? '');

    // Drawing: the relationship exists and is a drawing.
    const drawing = childNamed(ws, 'drawing')[0];
    if (drawing) {
      const rid = drawing.getAttribute('r:id') ?? '';
      const target = relsOf.get(part)?.get(rid);
      expect(target, `${part}: drawing ${rid}`).toMatch(/^xl\/drawings\/drawing\d+\.xml$/);
    }
    return { name, part, ws };
  });

  // Charts: order, axes, references to existing sheets with caches of the same length.
  for (const part of Object.keys(zip).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n))) {
    const space = doc(part).documentElement;
    expect(space.namespaceURI).toBe(NS_C);
    expectOrder(space, CHART_SPACE_ORDER, part);
    const chart = childNamed(space, 'chart')[0]!;
    expectOrder(chart, CHART_ORDER, `${part} chart`);
    const plot = childNamed(chart, 'plotArea')[0]!;
    const axIds = new Set<string>();
    for (const ax of [...childNamed(plot, 'catAx'), ...childNamed(plot, 'valAx')]) {
      expectOrder(
        ax,
        ax.localName === 'catAx' ? CAT_AX_ORDER : VAL_AX_ORDER,
        `${part} ${ax.localName}`,
      );
      axIds.add(childNamed(ax, 'axId')[0]!.getAttribute('val') ?? '');
    }
    for (const bar of childNamed(plot, 'barChart')) {
      expectOrder(bar, BAR_CHART_ORDER, `${part} barChart`);
      for (const id of childNamed(bar, 'axId')) expect(axIds).toContain(id.getAttribute('val'));
      for (const ser of childNamed(bar, 'ser')) {
        expectOrder(ser, BAR_SER_ORDER, `${part} ser`);
        for (const lbl of childNamed(ser, 'dLbls')) expectOrder(lbl, DLBLS_ORDER, `${part} dLbls`);
        for (const tag of ['cat', 'val']) {
          const holder = childNamed(ser, tag)[0]!;
          const refEl = holder.getElementsByTagName('c:f')[0]!;
          const { sheet, range } = parseSheetRef(refEl.textContent ?? '');
          expect(sheetNames).toContain(sheet);
          const { a, b } = parseRange(range);
          const length = (b.row - a.row + 1) * (b.col - a.col + 1);
          const ptCount = holder.getElementsByTagName('c:ptCount')[0]!.getAttribute('val');
          expect(Number(ptCount)).toBe(length);
        }
      }
    }
  }
  // Each drawing anchors inside the sheet grid and links to a chart.
  for (const part of Object.keys(zip).filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n))) {
    const anchors = doc(part).getElementsByTagName('xdr:twoCellAnchor');
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const from = a.getElementsByTagName('xdr:from')[0]!;
      const to = a.getElementsByTagName('xdr:to')[0]!;
      const n = (el: Element, tag: string) => Number(el.getElementsByTagName(tag)[0]!.textContent);
      expect(n(to, 'xdr:col')).toBeGreaterThan(n(from, 'xdr:col'));
      expect(n(to, 'xdr:row')).toBeGreaterThan(n(from, 'xdr:row'));
      const rid = a.getElementsByTagName('c:chart')[0]!.getAttribute('r:id') ?? '';
      expect(relsOf.get(part)?.get(rid)).toMatch(/^xl\/charts\/chart\d+\.xml$/);
    }
  }
  return { data, texts, sheets, sheetNames };
}

describe('the Excel workbook structure', () => {
  it('is valid for a small board', async () => {
    const { sheetNames, texts, data } = await checkWorkbook(smallBoard(), 'small-board');
    expect(sheetNames).toEqual(['Summary', 'Items']);
    expect(data.figures).toMatchObject({ items: 4, done: 1, overdue: 1, dueSoon: 1, people: 3 });
    expect(texts['xl/charts/chart1.xml']).toContain('Items by status');
  });

  it('is valid for a board with subitems, long and awkward text', async () => {
    const { texts } = await checkWorkbook(subitemBoard(), 'subitems-and-dates');
    const items = texts['xl/worksheets/sheet2.xml'] as string;
    expect(items).toContain(`'=HYPERLINK(&quot;`); // the formula guard
    expect(items).toContain('<t>Bad');
    expect(items).not.toContain('\u0001');
  });

  it('is valid for a large board', async () => {
    const { data } = await checkWorkbook(largeBoard(3000), 'large-board');
    expect(data.items.rows.length).toBe(3000 + 200);
  }, 60_000);
});
