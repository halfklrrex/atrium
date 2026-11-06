import { describe, expect, it } from 'vitest';
import { CSV_BOM, buildCsv, csvEscapeField, csvFileName } from './csv';

describe('csvEscapeField', () => {
  it('leaves plain text, empty text and unicode alone', () => {
    expect(csvEscapeField('hello')).toBe('hello');
    expect(csvEscapeField('')).toBe('');
    expect(csvEscapeField('Café Zoë 日本')).toBe('Café Zoë 日本');
  });

  it('quotes commas, quotes and line breaks, doubling quotes', () => {
    expect(csvEscapeField('a,b')).toBe('"a,b"');
    expect(csvEscapeField('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscapeField('a\nb')).toBe('"a\nb"');
    expect(csvEscapeField('a\r\nb')).toBe('"a\r\nb"');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('prefixes a field starting with %j', (prefix) => {
    const out = csvEscapeField(`${prefix}1+1`);
    expect(out.replace(/^"|"$/g, '').startsWith("'")).toBe(true);
  });

  it('guards formulas that also need quoting', () => {
    expect(csvEscapeField('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`);
  });

  it('does not touch a "=" that is not first', () => {
    expect(csvEscapeField('a=b')).toBe('a=b');
  });

  it('exports negative numbers from numeric cells as plain numbers', () => {
    expect(csvEscapeField('-5', { numeric: true })).toBe('-5');
    expect(csvEscapeField('-12.50', { numeric: true })).toBe('-12.50');
    expect(csvEscapeField('-5')).toBe("'-5");
  });

  it('still guards numeric cells whose text is not a plain number', () => {
    expect(csvEscapeField('-5+cmd', { numeric: true })).toBe("'-5+cmd");
    expect(csvEscapeField('=1', { numeric: true })).toBe("'=1");
  });
});

describe('buildCsv', () => {
  it('builds a 3 column, 3 row golden string', () => {
    const csv = buildCsv([
      ['Item', 'Status', 'Notes'],
      ['Write, edit', 'Done', 'say "ok"'],
      ['Plan', '', { text: '-3', numeric: true }],
    ]);
    expect(csv).toBe('Item,Status,Notes\r\n"Write, edit",Done,"say ""ok"""\r\nPlan,,-3');
  });

  it('is empty for no rows and the BOM is the UTF-8 mark', () => {
    expect(buildCsv([])).toBe('');
    expect(CSV_BOM).toBe('﻿');
  });
});

describe('csvFileName', () => {
  it('adds the extension', () => {
    expect(csvFileName('Roadmap')).toBe('Roadmap.csv');
  });

  it('replaces characters not allowed in file names', () => {
    expect(csvFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.csv');
    expect(csvFileName('tab\there')).toBe('tab-here.csv');
  });

  it('trims to 80 characters and falls back for an empty name', () => {
    expect(csvFileName('x'.repeat(200))).toBe(`${'x'.repeat(80)}.csv`);
    expect(csvFileName('   ')).toBe('board.csv');
  });
});
