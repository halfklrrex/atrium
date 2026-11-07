import { describe, expect, it } from 'vitest';
import type { CsvCell } from './csv';
import { csvFileName, xlsxFileName } from './csv';
import { buildXlsxParts, excelSerialDate, stripIllegalXmlChars, xmlEscape } from './xlsx';

const rows: CsvCell[][] = [
  ['Item', 'Price', 'Due', 'Note', 'Done'],
  [
    'Write R&D <plan>',
    { text: '-12.50', numeric: true },
    { text: '2026-01-05', date: true },
    '=HYPERLINK("x")',
    { text: 'v', checkbox: true },
  ],
  [
    'x'.repeat(100),
    { text: '$5.00', numeric: true },
    { text: '2026-01-05 12:00:00', date: true },
    '-not a number',
    { text: '', checkbox: true },
  ],
  ['bad\u0001char', '', '', '+1 @a', ''],
];

describe('buildXlsxParts', () => {
  const parts = buildXlsxParts(rows);
  const sheet = parts['xl/worksheets/sheet1.xml'] as string;

  it('has every required part', () => {
    expect(Object.keys(parts)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(parts['[Content_Types].xml']).toContain('/xl/worksheets/sheet1.xml');
    expect(parts['xl/workbook.xml']).toContain('name="Items"');
    expect(parts['xl/styles.xml']).toContain('<b/>');
    expect(parts['xl/styles.xml']).toContain('numFmtId="14"');
    for (const xml of Object.values(parts)) expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('writes a bold header and freezes it', () => {
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Item</t></is></c>');
    expect(sheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
  });

  it('writes numbers, dates and checkboxes by kind', () => {
    expect(sheet).toContain('<c r="B2"><v>-12.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>46027</v></c>');
    expect(sheet).toContain('<c r="C3" s="3"><v>46027.5</v></c>');
    expect(sheet).toContain('<c r="E2" t="inlineStr"><is><t>TRUE</t></is></c>');
    expect(sheet).toContain('<c r="E3" t="inlineStr"><is><t>FALSE</t></is></c>');
    // a numeric cell with a unit stays text
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t>$5.00</t></is></c>');
  });

  it('guards formulas and never writes <f>', () => {
    expect(sheet).toContain(`<t>'=HYPERLINK(&quot;x&quot;)</t>`);
    expect(sheet).toContain("<t>'-not a number</t>");
    expect(sheet).toContain("<t>'+1 @a</t>");
    expect(sheet).not.toContain('<f>');
  });

  it('escapes XML and drops illegal characters', () => {
    expect(sheet).toContain('<t>Write R&amp;D &lt;plan&gt;</t>');
    expect(sheet).toContain('<t>badchar</t>');
    expect(sheet).not.toContain('\u0001');
  });

  it('sizes columns from the longest cell, max 60', () => {
    expect(sheet).toContain('<col min="1" max="1" width="60" customWidth="1"/>');
    expect(sheet).toContain('<col min="2" max="2" width="8" customWidth="1"/>');
  });

  it('leaves blank cells out', () => {
    expect(sheet).not.toContain('r="B4"');
  });
});

describe('helpers', () => {
  it('computes Excel serial dates', () => {
    expect(excelSerialDate('1900-03-01')?.serial).toBe(61);
    expect(excelSerialDate('2026-02-30')).toBeNull();
    expect(excelSerialDate('nope')).toBeNull();
  });
  it('escapes and strips', () => {
    expect(xmlEscape('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;');
    expect(stripIllegalXmlChars('a\u0000b\ud800c')).toBe('abc');
  });
  it('names files like the CSV', () => {
    expect(xlsxFileName('Plans: 2026')).toBe('Plans- 2026.xlsx');
    expect(csvFileName('')).toBe('board.csv');
  });
});
