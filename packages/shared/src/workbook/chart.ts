/**
 * Native Excel charts: the chart part (`c:chartSpace`) and the drawing part that anchors charts to
 * cells. The series point at cell ranges of the sheet and carry a cache of the same values, so a
 * viewer can draw the chart before it recalculates anything. Element order follows the DrawingML
 * chart schema (see `docs/specs/P6-export-workbook.md`, "Charts in OOXML").
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
  values: readonly number[];
  /** Series colour. */
  color: string;
  /** One colour per point (bars in their label colour); overrides `color` per point. */
  pointColors?: readonly string[];
}

export interface BarChartSpec {
  kind: 'bar';
  title: string;
  /** `'Sheet'!$B$6:$B$9`. */
  categoriesRef: string;
  categories: readonly string[];
  series: readonly ChartSeriesSpec[];
  /** Columns by default, or horizontal bars. */
  direction?: 'col' | 'bar';
  grouping?: 'clustered' | 'stacked';
  showValues?: boolean;
  showLegend?: boolean;
  anchor: ChartAnchor;
}

export type ChartSpec = BarChartSpec;

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

function numRef(ref: string, values: readonly number[]): string {
  return (
    `<c:numRef><c:f>${xmlEscape(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>` +
    values
      .map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${String(v)}</c:v></c:pt>` : ''))
      .join('') +
    '</c:numCache></c:numRef>'
  );
}

function barSeries(spec: BarChartSpec, s: ChartSeriesSpec, i: number): string {
  const tx = s.nameRef
    ? `<c:tx>${strRef(s.nameRef, [s.name])}</c:tx>`
    : `<c:tx><c:v>${xmlEscape(s.name)}</c:v></c:tx>`;
  const points = (s.pointColors ?? [])
    .map(
      (color, idx) =>
        `<c:dPt><c:idx val="${idx}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${solid(color)}</c:spPr></c:dPt>`,
    )
    .join('');
  const stacked = spec.grouping === 'stacked';
  const labels =
    spec.showValues === false
      ? ''
      : '<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
        txPr(900, PALETTE.text) +
        (stacked ? '<c:dLblPos val="ctr"/>' : '<c:dLblPos val="outEnd"/>') +
        '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/>' +
        '<c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}` +
    `<c:spPr>${solid(s.color)}</c:spPr><c:invertIfNegative val="0"/>` +
    points +
    labels +
    `<c:cat>${strRef(spec.categoriesRef, spec.categories)}</c:cat>` +
    `<c:val>${numRef(s.valuesRef, s.values)}</c:val>` +
    '</c:ser>'
  );
}

const AX_CAT = 50010;
const AX_VAL = 50020;

function barChartXml(spec: BarChartSpec): string {
  const dir = spec.direction ?? 'col';
  const stacked = spec.grouping === 'stacked';
  const line = (hex: string) => `<a:ln w="9525">${solid(hex)}</a:ln>`;
  const catAx =
    `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="${dir === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${dir === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/>` +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr>${line(PALETTE.frame)}</c:spPr>${txPr(900)}` +
    `<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx =
    `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${dir === 'bar' ? 'b' : 'l'}"/>` +
    `<c:majorGridlines><c:spPr>${line(PALETTE.rule)}</c:spPr></c:majorGridlines>` +
    '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}` +
    `<c:crossAx val="${AX_CAT}"/><c:crosses val="${dir === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  const legend =
    spec.showLegend === true
      ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(900)}</c:legend>`
      : '';
  return (
    XML_HEADER +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    '<c:roundedCorners val="0"/>' +
    '<c:chart>' +
    titleXml(spec.title) +
    '<c:autoTitleDeleted val="0"/>' +
    '<c:plotArea><c:layout/>' +
    `<c:barChart><c:barDir val="${dir}"/><c:grouping val="${stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>` +
    spec.series.map((s, i) => barSeries(spec, s, i)).join('') +
    `<c:gapWidth val="60"/>${stacked ? '<c:overlap val="100"/>' : ''}` +
    `<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>` +
    catAx +
    valAx +
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

/** `xl/charts/chartN.xml`. */
export function chartXml(spec: ChartSpec): string {
  return barChartXml(spec);
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
