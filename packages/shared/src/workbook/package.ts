/**
 * Assembles sheets into the parts of an `.xlsx` package: content types, relationships, document
 * properties, the workbook, the styles, the sheets and their drawings and charts. Returns a map of
 * part path to XML text; the web app zips it.
 */
import { chartXml, drawingXml } from './chart';
import type { SheetWriter } from './sheet';
import { NS_MAIN, NS_REL } from './sheet';
import type { StyleRegistry } from './styles';
import { XML_HEADER, xmlEscape } from './xml';

const CT = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

const REL = {
  document: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  sheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  drawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
};

const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function rels(list: readonly { id: string; type: string; target: string }[]): string {
  return (
    XML_HEADER +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    list
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEscape(r.target)}"/>`)
      .join('') +
    '</Relationships>'
  );
}

export interface PackageInput {
  sheets: readonly SheetWriter[];
  styles: StyleRegistry;
  /** Document title (the board name). */
  title: string;
  /** Creation time, ISO 8601 (`2026-11-08T10:15:00Z`). */
  createdAt: string;
}

/** The workbook's parts in zip order. Throws on duplicate sheet names. */
export function buildPackage(input: PackageInput): Record<string, string> {
  const { sheets, styles } = input;
  const names = new Set<string>();
  for (const s of sheets) {
    const key = s.name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate sheet name ${s.name}`);
    names.add(key);
  }

  const overrides: { part: string; type: string }[] = [
    { part: '/xl/workbook.xml', type: CT.workbook },
    { part: '/xl/styles.xml', type: CT.styles },
    { part: '/docProps/core.xml', type: CT.core },
    { part: '/docProps/app.xml', type: CT.app },
  ];
  const sheetParts: Record<string, string> = {};
  let drawingCount = 0;
  let chartCount = 0;

  sheets.forEach((sheet, i) => {
    const n = i + 1;
    overrides.push({ part: `/xl/worksheets/sheet${n}.xml`, type: CT.sheet });
    let drawingRelId: string | undefined;
    if (sheet.charts.length > 0) {
      drawingCount += 1;
      const d = drawingCount;
      drawingRelId = 'rId1';
      sheetParts[`xl/worksheets/_rels/sheet${n}.xml.rels`] = rels([
        { id: 'rId1', type: REL.drawing, target: `../drawings/drawing${d}.xml` },
      ]);
      const chartRels: { id: string; type: string; target: string }[] = [];
      sheet.charts.forEach((chart, k) => {
        chartCount += 1;
        sheetParts[`xl/charts/chart${chartCount}.xml`] = chartXml(chart);
        overrides.push({ part: `/xl/charts/chart${chartCount}.xml`, type: CT.chart });
        chartRels.push({
          id: `rId${k + 1}`,
          type: REL.chart,
          target: `../charts/chart${chartCount}.xml`,
        });
      });
      sheetParts[`xl/drawings/drawing${d}.xml`] = drawingXml(sheet.charts.map((c) => c.anchor));
      sheetParts[`xl/drawings/_rels/drawing${d}.xml.rels`] = rels(chartRels);
      overrides.push({ part: `/xl/drawings/drawing${d}.xml`, type: CT.drawing });
    }
    sheetParts[`xl/worksheets/sheet${n}.xml`] = sheet.xml({ selected: i === 0, drawingRelId });
  });

  const contentTypes =
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    `<Default Extension="rels" ContentType="${CT.rels}"/>` +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`).join('') +
    '</Types>';

  const definedNames = sheets.flatMap((s, i) => s.definedNames(i));
  const workbook =
    XML_HEADER +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<workbookPr date1904="0"/>' +
    '<bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews>' +
    '<sheets>' +
    sheets
      .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets>' +
    (definedNames.length > 0 ? `<definedNames>${definedNames.join('')}</definedNames>` : '') +
    '</workbook>';

  const workbookRels = rels([
    ...sheets.map((_, i) => ({
      id: `rId${i + 1}`,
      type: REL.sheet,
      target: `worksheets/sheet${i + 1}.xml`,
    })),
    { id: `rId${sheets.length + 1}`, type: REL.styles, target: 'styles.xml' },
  ]);

  const core =
    XML_HEADER +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEscape(input.title)}</dc:title><dc:creator>Atrium</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(input.createdAt)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEscape(input.createdAt)}</dcterms:modified>` +
    '</cp:coreProperties>';

  const app =
    XML_HEADER +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Atrium</Application></Properties>';

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels([
      { id: 'rId1', type: REL.document, target: 'xl/workbook.xml' },
      { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
      { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
    ]),
    'docProps/core.xml': core,
    'docProps/app.xml': app,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': styles.xml(),
    ...sheetParts,
  };
}
