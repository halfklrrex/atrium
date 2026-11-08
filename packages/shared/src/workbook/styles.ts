/**
 * Style registry for `xl/styles.xml`. A caller describes a cell style by its parts and gets the
 * `cellXfs` index to put in `<c s="...">`; equal requests share one index, and fonts, fills,
 * borders and number formats are de-duplicated. Index 0 is the workbook's default style (Figtree
 * 10, the text colour), as Excel expects.
 */
import { PALETTE, WORKBOOK_FONT, argb } from './palette';
import { XML_HEADER, xmlEscape } from './xml';

export interface FontSpec {
  /** Points; 10 by default. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** `#RRGGBB`; the text colour by default. */
  color?: string;
}

export type BorderStyle = 'thin' | 'medium' | 'hair' | 'dashed' | 'thick';

export interface BorderSide {
  style: BorderStyle;
  color: string;
}

export interface BorderSpec {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
}

export interface AlignSpec {
  h?: 'left' | 'center' | 'right';
  v?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  /** Indent levels; only with `h` left or right. */
  indent?: number;
}

export interface StyleSpec {
  font?: FontSpec;
  /** Solid fill colour `#RRGGBB`; none when omitted. */
  fill?: string;
  border?: BorderSpec;
  /** A number format code (`0%`, `mmm d, yyyy`); `General` when omitted. */
  numFmt?: string;
  align?: AlignSpec;
}

/** Conditional-format look (`dxf`): a fill and/or a font colour. */
export interface DxfSpec {
  fill?: string;
  fontColor?: string;
  bold?: boolean;
}

/** Number formats Excel knows by id; anything else gets an id from 164 up. */
const BUILT_IN_FORMATS: Record<string, number> = {
  General: 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
};

const DEFAULT_FONT_SIZE = 10;

function fontXml(font: FontSpec): string {
  const size = font.size ?? DEFAULT_FONT_SIZE;
  return (
    '<font>' +
    (font.bold ? '<b/>' : '') +
    (font.italic ? '<i/>' : '') +
    (font.underline ? '<u/>' : '') +
    `<sz val="${size}"/>` +
    `<color rgb="${argb(font.color ?? PALETTE.text)}"/>` +
    `<name val="${WORKBOOK_FONT}"/><family val="2"/><scheme val="none"/>` +
    '</font>'
  );
}

const fillXml = (hex: string): string =>
  `<fill><patternFill patternType="solid"><fgColor rgb="${argb(hex)}"/><bgColor indexed="64"/></patternFill></fill>`;

function sideXml(name: string, side: BorderSide | undefined): string {
  return side
    ? `<${name} style="${side.style}"><color rgb="${argb(side.color)}"/></${name}>`
    : `<${name}/>`;
}

const borderXml = (b: BorderSpec): string =>
  '<border>' +
  sideXml('left', b.left) +
  sideXml('right', b.right) +
  sideXml('top', b.top) +
  sideXml('bottom', b.bottom) +
  '<diagonal/></border>';

function alignXml(a: AlignSpec | undefined): string {
  if (!a) return '';
  const attrs: string[] = [];
  if (a.h) attrs.push(`horizontal="${a.h}"`);
  if (a.v) attrs.push(`vertical="${a.v}"`);
  if (a.wrap) attrs.push('wrapText="1"');
  if (a.indent && a.indent > 0 && (a.h === 'left' || a.h === 'right')) {
    attrs.push(`indent="${Math.round(a.indent)}"`);
  }
  return attrs.length > 0 ? `<alignment ${attrs.join(' ')}/>` : '';
}

/** Interns XML snippets: equal text gets the same index. */
class Pool {
  readonly items: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(initial: readonly string[] = []) {
    for (const x of initial) this.add(x);
  }
  add(xml: string): number {
    const found = this.index.get(xml);
    if (found !== undefined) return found;
    this.items.push(xml);
    this.index.set(xml, this.items.length - 1);
    return this.items.length - 1;
  }
}

export class StyleRegistry {
  private readonly fonts = new Pool([fontXml({})]);
  // Excel requires fill 0 = none and fill 1 = gray125, whatever the cells use.
  private readonly fills = new Pool([
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ]);
  private readonly borders = new Pool([borderXml({})]);
  private readonly xfs = new Pool([
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
  ]);
  private readonly dxfs = new Pool();
  private readonly numFmts = new Map<string, number>();
  private readonly cache = new Map<string, number>();

  /** The `cellXfs` index of a style. */
  style(spec: StyleSpec = {}): number {
    const key = JSON.stringify(spec);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const fontId = this.fonts.add(fontXml(spec.font ?? {}));
    const fillId = spec.fill ? this.fills.add(fillXml(spec.fill)) : 0;
    const borderId = spec.border ? this.borders.add(borderXml(spec.border)) : 0;
    const numFmtId = this.numFmtId(spec.numFmt ?? 'General');
    const align = alignXml(spec.align);
    const applies =
      (numFmtId !== 0 ? ' applyNumberFormat="1"' : '') +
      (fontId !== 0 ? ' applyFont="1"' : '') +
      (fillId !== 0 ? ' applyFill="1"' : '') +
      (borderId !== 0 ? ' applyBorder="1"' : '') +
      (align ? ' applyAlignment="1"' : '');
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies}` +
      (align ? `>${align}</xf>` : '/>');
    const id = this.xfs.add(xf);
    this.cache.set(key, id);
    return id;
  }

  /** The `dxfs` index of a conditional-format look. */
  dxf(spec: DxfSpec): number {
    const font =
      spec.fontColor || spec.bold
        ? '<font>' +
          (spec.bold ? '<b/>' : '') +
          (spec.fontColor ? `<color rgb="${argb(spec.fontColor)}"/>` : '') +
          '</font>'
        : '';
    // In a dxf a solid fill takes its colour from bgColor (unlike a cell fill).
    const fill = spec.fill
      ? `<fill><patternFill patternType="solid"><bgColor rgb="${argb(spec.fill)}"/></patternFill></fill>`
      : '';
    return this.dxfs.add(`<dxf>${font}${fill}</dxf>`);
  }

  /** Number of `cellXfs` (every `s` attribute must be below it). */
  get styleCount(): number {
    return this.xfs.items.length;
  }

  private numFmtId(code: string): number {
    const builtIn = BUILT_IN_FORMATS[code];
    if (builtIn !== undefined) return builtIn;
    const known = this.numFmts.get(code);
    if (known !== undefined) return known;
    const id = 164 + this.numFmts.size;
    this.numFmts.set(code, id);
    return id;
  }

  /** `xl/styles.xml`, children in schema order. */
  xml(): string {
    const list = (tag: string, items: readonly string[]) =>
      `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    const numFmts = [...this.numFmts].map(
      ([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`,
    );
    return (
      XML_HEADER +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (numFmts.length > 0 ? list('numFmts', numFmts) : '') +
      list('fonts', this.fonts.items) +
      list('fills', this.fills.items) +
      list('borders', this.borders.items) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', this.xfs.items) +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      list('dxfs', this.dxfs.items) +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>'
    );
  }
}
