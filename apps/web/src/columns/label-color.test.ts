import { describe, expect, it } from 'vitest';
import {
  customLabelColors,
  getReadableTextColor,
  hexToHsv,
  hsvToHex,
  normalizeHex,
} from './label-color';

describe('normalizeHex', () => {
  it('accepts 6 and 3 digit hex with or without #', () => {
    expect(normalizeHex('#1A2B3C')).toBe('#1a2b3c');
    expect(normalizeHex('1a2b3c')).toBe('#1a2b3c');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('  F00 ')).toBe('#ff0000');
  });
  it('rejects anything else', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'ggg', '#12345g', 'red']) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe('hsv conversion', () => {
  it('converts primaries and extremes', () => {
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: 0, v: 100 })).toBe('#ffffff');
    expect(hsvToHex({ h: 200, s: 50, v: 0 })).toBe('#000000');
    expect(hsvToHex({ h: 360, s: 100, v: 100 })).toBe('#ff0000');
  });
  it('round-trips hex through hsv', () => {
    for (const hex of ['#579bfc', '#df2f4a', '#9cd326', '#7f5347', '#123456', '#ffffff']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});

describe('getReadableTextColor', () => {
  it('uses dark text on light colors and white on dark ones', () => {
    expect(getReadableTextColor('#ffff00')).toBe('var(--fixed-dark-color)');
    expect(getReadableTextColor('#ffffff')).toBe('var(--fixed-dark-color)');
    expect(getReadableTextColor('#000000')).toBe('var(--atrium-table-on-fill)');
    expect(getReadableTextColor('#5559df')).toBe('var(--atrium-table-on-fill)');
    expect(getReadableTextColor('nonsense')).toBe('var(--atrium-table-on-fill)');
  });
});

describe('customLabelColors', () => {
  it('collects non-palette colors across columns, deduplicated and case-insensitive', () => {
    const colors = customLabelColors([
      { labels: [{ color: '#00c875' }, { color: '#123456' }, { color: '#ABCDEF' }] },
      { labels: [{ color: '#abcdef' }, { color: '#123456' }, { color: '#c4c4c4' }] },
      { labels: [{ id: 1, label: 'dropdown has no color' }] },
      null,
      { labels: 'bad' },
    ]);
    expect(colors).toEqual(['#123456', '#abcdef']);
  });
});
