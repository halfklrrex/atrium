/**
 * Native Excel charts: the chart part (`c:chartSpace` with a bar, line, pie or doughnut chart) and
 * the drawing part that anchors charts to cells. The series point at cell ranges of the sheet and
 * carry a cache of the same values, so a viewer can draw the chart before it recalculates
 * anything. Element order follows the DrawingML chart schema (spec `P6-export-workbook.md`,
 * "Charts in OOXML"); the samples are validated against the ECMA-376 XSDs.
 */
import { PALETTE, WORKBOOK_FONT, rgb } from './palette';
import { XML_HEADER, xmlEscape } from './xml';

const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

/** Cells the chart covers: zero-based columns and rows, `to` exclusive (the cell it ends before). */
export interface ChartAnchor {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

export interface ChartSeriesSpec {
  name: string;
  /** `'Sheet'!$C$5` holding the series name, or omitted for a literal name. */
  nameRef?: string;
  /** `'Sheet'!$C$6:$C$9`. */
  valuesRef: string;
  /** `null` = no value (a gap). */
  values: readonly (number | null)[];
  /** Series colour. */
  color: string;
  /** One colour per point (bars and slices in their label colour); overrides `color` per point. */
  pointColors?: readonly string[];
}

export interface ChartSpec {
  /** Bar (columns or horizontal), line, pie, or doughnut. */
  kind: 'bar' | 'line' | 'pie' | 'doughnut';
  title: string;
  /** `'Sheet'!$B$6:$B$9`. */
  categoriesRef: string;
  categories: readonly string[];
  series: readonly ChartSeriesSpec[];
  /** Bar only: columns by default, or horizontal bars. */
  direction?: 'col' | 'bar';
  /** Bar only. */
  grouping?: 'clustered' | 'stacked';
  showValues?: boolean;
  showLegend?: boolean;
  anchor: ChartAnchor;
}

/** Series colours when nothing else gives one (Vibe label colours, in the app's order). */
export const SERIES_COLORS = [
  '#0073EA',
  '#00C875',
  '#FDAB3D',
  '#DF2F4A',
  '#A25DDC',
  '#579BFC',
  '#FF158A',
  '#9CD326',
  '#CAB641',
  '#784BD1',
  '#66CCFF',
  '#BB3354',
];

const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${rgb(hex)}"/></a:solidFill>`;

function runProps(tag: 'a:defRPr' | 'a:rPr', size: number, bold: boolean, color: string): string {
  const lang = tag === 'a:rPr' ? ' lang="en-US"' : '';
  return `<${tag}${lang} sz="${size}" b="${bold ? 1 : 0}">${solid(color)}<a:latin typeface="${WORKBOOK_FONT}"/></${tag}>`;
}

/** Text properties for axes, labels and the legend. */
const txPr = (size: number, color: string = PALETTE.textMuted) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${runProps('a:defRPr', size, false, color)}</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function titleXml(text: string): string {
  return (
    '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>' +
    `<a:pPr>${runProps('a:defRPr', 1200, true, PALETTE.text)}</a:pPr>` +
    `<a:r>${runProps('a:rPr', 1200, true, PALETTE.text)}<a:t>${xmlEscape(text)}</a:t></a:r>` +
    '</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>'
  );
}

function strRef(ref: string, values: readonly string[]): string {
  return (
    `<c:strRef><c:f>${xmlEscape(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(v)}</c:v></c:pt>`).join('') +
    '</c:strCache></c:strRef>'
  );
}

function numRef(ref: string, values: readonly (number | null)[]): string {
  return (
    `<c:numRef><c:f>${xmlEscape(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>` +
    values
      .map((v, i) =>
        v !== null && Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${String(v)}</c:v></c:pt>` : '',
      )
      .join('') +
    '</c:numCache></c:numRef>'
  );
}

const seriesName = (s: ChartSeriesSpec) =>
  s.nameRef
    ? `<c:tx>${strRef(s.nameRef, [s.name])}</c:tx>`
    : `<c:tx><c:v>${xmlEscape(s.name)}</c:v></c:tx>`;

/** Data labels; `pos` only where the chart type allows one. */
function dataLabels(show: boolean, pos: string | null, percent = false): string {
  if (!show) return '';
  return (
    '<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
    txPr(900, PALETTE.text) +
    (pos ? `<c:dLblPos val="${pos}"/>` : '') +
    `<c:showLegendKey val="0"/><c:showVal val="${percent ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/>` +
    `<c:showPercent val="${percent ? 1 : 0}"/><c:showBubbleSize val="0"/>` +
    (percent ? '<c:showLeaderLines val="1"/>' : '') +
    '</c:dLbls>'
  );
}

function points(colors: readonly string[] | undefined, withInvert: boolean): string {
  return (colors ?? [])
    .map(
      (color, idx) =>
        `<c:dPt><c:idx val="${idx}"/>${withInvert ? '<c:invertIfNegative val="0"/>' : ''}<c:bubble3D val="0"/><c:spPr>${solid(color)}</c:spPr></c:dPt>`,
    )
    .join('');
}

const catVal = (spec: ChartSpec, s: ChartSeriesSpec) =>
  `<c:cat>${strRef(spec.categoriesRef, spec.categories)}</c:cat><c:val>${numRef(s.valuesRef, s.values)}</c:val>`;

const AX_CAT = 50010;
const AX_VAL = 50020;
const line = (hex: string) => `<a:ln w="9525">${solid(hex)}</a:ln>`;

function axes(horizontal: boolean): string {
  const catAx =
    `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/>` +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr>${line(PALETTE.frame)}</c:spPr>${txPr(900)}` +
    `<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx =
    `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? 'b' : 'l'}"/>` +
    `<c:majorGridlines><c:spPr>${line(PALETTE.rule)}</c:spPr></c:majorGridlines>` +
    '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}` +
    `<c:crossAx val="${AX_CAT}"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  return catAx + valAx;
}

function plot(spec: ChartSpec): string {
  const show = spec.showValues !== false;
  const axIds = `<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/>`;
  switch (spec.kind) {
    case 'bar': {
      const dir = spec.direction ?? 'col';
      const stacked = spec.grouping === 'stacked';
      const series = spec.series
        .map(
          (s, i) =>
            `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${seriesName(s)}` +
            `<c:spPr>${solid(s.color)}</c:spPr><c:invertIfNegative val="0"/>` +
            points(s.pointColors, true) +
            dataLabels(show, stacked ? 'ctr' : 'outEnd') +
            catVal(spec, s) +
            '</c:ser>',
        )
        .join('');
      return (
        `<c:barChart><c:barDir val="${dir}"/><c:grouping val="${stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>` +
        series +
        `<c:gapWidth val="60"/>${stacked ? '<c:overlap val="100"/>' : ''}${axIds}</c:barChart>` +
        axes(dir === 'bar')
      );
    }
    case 'line': {
      const series = spec.series
        .map(
          (s, i) =>
            `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${seriesName(s)}` +
            `<c:spPr><a:ln w="28575" cap="rnd">${solid(s.color)}<a:round/></a:ln></c:spPr>` +
            `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solid(s.color)}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>` +
            dataLabels(show, 't') +
            catVal(spec, s) +
            '<c:smooth val="0"/></c:ser>',
        )
        .join('');
      return (
        `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axIds}</c:lineChart>` +
        axes(false)
      );
    }
    case 'pie':
    case 'doughnut': {
      const s = spec.series[0];
      if (!s) return '';
      const ser =
        `<c:ser><c:idx val="0"/><c:order val="0"/>${seriesName(s)}` +
        `<c:spPr><a:ln w="12700">${solid(PALETTE.white)}</a:ln></c:spPr>` +
        points(s.pointColors, false) +
        dataLabels(show, null, true) +
        catVal(spec, s) +
        '</c:ser>';
      return spec.kind === 'pie'
        ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`
        : `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
    }
  }
}

/** `xl/charts/chartN.xml`. */
export function chartXml(spec: ChartSpec): string {
  const round = spec.kind === 'pie' || spec.kind === 'doughnut';
  const legend =
    spec.showLegend === true
      ? `<c:legend><c:legendPos val="${round ? 'r' : 'b'}"/><c:overlay val="0"/>${txPr(900)}</c:legend>`
      : '';
  return (
    XML_HEADER +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    '<c:roundedCorners val="0"/>' +
    '<c:chart>' +
    titleXml(spec.title) +
    '<c:autoTitleDeleted val="0"/>' +
    '<c:plotArea><c:layout/>' +
    plot(spec) +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
    '</c:plotArea>' +
    legend +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    '</c:chart>' +
    `<c:spPr>${solid(PALETTE.white)}<a:ln w="9525">${solid(PALETTE.frame)}</a:ln></c:spPr>` +
    txPr(900) +
    '</c:chartSpace>'
  );
}

/**
 * `xl/drawings/drawingN.xml`: one graphic frame per chart, linked by `rId1`, `rId2`... in the
 * drawing's relationships (the package writes those).
 */
export function drawingXml(anchors: readonly ChartAnchor[]): string {
  const frames = anchors
    .map((a, i) => {
      const pos = (tag: string, col: number, row: number) =>
        `<xdr:${tag}><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
      return (
        '<xdr:twoCellAnchor editAs="oneCell">' +
        pos('from', a.fromCol, a.fromRow) +
        pos('to', a.toCol, a.toRow) +
        '<xdr:graphicFrame macro="">' +
        `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
      );
    })
    .join('');
  return XML_HEADER + `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${frames}</xdr:wsDr>`;
}
