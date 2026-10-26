import { describe, expect, it } from 'vitest';
import {
  formatDay,
  formatNumber,
  formatRange,
  isBeforeToday,
  parseIsoDate,
  parseNumberInput,
  toIsoDate,
} from './format';

const now = new Date(2026, 9, 24, 9, 0, 0); // 24 Oct 2026, local

describe('dates', () => {
  it('round-trips ISO dates as local dates', () => {
    expect(toIsoDate(parseIsoDate('2026-01-05'))).toBe('2026-01-05');
    expect(parseIsoDate('2026-01-05').getDate()).toBe(5);
  });

  it('omits the year only for the current year', () => {
    expect(formatDay('2026-10-23', now, 'en-US')).toBe('Oct 23');
    expect(formatDay('2025-10-23', now, 'en-US')).toBe('Oct 23, 2025');
  });

  it('formats a range, collapsing a single day', () => {
    expect(formatRange('2026-10-03', '2026-11-12', now, 'en-US')).toBe('Oct 3 - Nov 12');
    expect(formatRange('2026-10-03', '2026-10-03', now, 'en-US')).toBe('Oct 3');
  });

  it('knows what is before today', () => {
    expect(isBeforeToday('2026-10-23', now)).toBe(true);
    expect(isBeforeToday('2026-10-24', now)).toBe(false);
    expect(isBeforeToday('2026-12-01', now)).toBe(false);
  });
});

describe('numbers', () => {
  const plain = { unit: null, decimals: null };

  it('adds thousands separators and the unit', () => {
    expect(formatNumber(1200, plain, 'en-US')).toBe('1,200');
    expect(formatNumber('1200.5', plain, 'en-US')).toBe('1,200.5');
    expect(
      formatNumber(1200, { unit: { symbol: '$', direction: 'left' }, decimals: null }, 'en-US'),
    ).toBe('$1,200');
    expect(
      formatNumber(12, { unit: { symbol: 'kg', direction: 'right' }, decimals: null }, 'en-US'),
    ).toBe('12 kg');
  });

  it('honours fixed decimals', () => {
    expect(formatNumber(3, { unit: null, decimals: 2 }, 'en-US')).toBe('3.00');
  });

  it('parses typed input', () => {
    expect(parseNumberInput('1,200')).toBe('1200');
    expect(parseNumberInput(' -4.50 ')).toBe('-4.5');
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('abc')).toBeUndefined();
    expect(parseNumberInput('1e5')).toBeUndefined();
  });
});
