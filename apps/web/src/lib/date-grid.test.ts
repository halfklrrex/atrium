import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addWeeks,
  dayIndex,
  daysInMonth,
  diffDays,
  fullDateLabel,
  inclusiveSpan,
  isWeekend,
  monthGrid,
  monthTitle,
  rangeTitle,
  shortDateLabel,
  todayIso,
  weekDays,
  weekStart,
} from './date-grid';

describe('day arithmetic', () => {
  it('adds days and weeks across month, year and leap boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addWeeks('2026-10-19', 2)).toBe('2026-11-02');
  });

  it('adds months, clamping the day', () => {
    expect(addMonths('2026-10-15', 1)).toBe('2026-11-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('knows the days of a month, leap years included', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
  });

  it('measures spans, inclusive and exclusive, and axis indexes', () => {
    expect(diffDays('2026-10-01', '2026-10-24')).toBe(23);
    expect(diffDays('2026-10-24', '2026-10-01')).toBe(-23);
    // Daylight saving never leaks in: it is all UTC.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(inclusiveSpan('2026-10-24', '2026-10-24')).toBe(1);
    expect(inclusiveSpan('2026-10-24', '2026-10-26')).toBe(3);
    expect(inclusiveSpan('2026-10-26', '2026-10-24')).toBe(0);
    expect(dayIndex('2026-10-26', '2026-10-24')).toBe(2);
    expect(dayIndex('2026-10-22', '2026-10-24')).toBe(-2);
  });

  it('formats today from local time', () => {
    expect(todayIso(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('weeks', () => {
  it('finds the week start for both week starts', () => {
    // 2026-10-24 is a Saturday.
    expect(weekStart('2026-10-24', 'monday')).toBe('2026-10-19');
    expect(weekStart('2026-10-24', 'sunday')).toBe('2026-10-18');
    expect(weekStart('2026-10-25', 'monday')).toBe('2026-10-19');
    expect(weekStart('2026-10-25', 'sunday')).toBe('2026-10-25');
    expect(weekStart('2026-10-19', 'monday')).toBe('2026-10-19');
  });

  it('lists the days of a week, with or without the weekend', () => {
    expect(weekDays('2026-10-24', 'monday')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(weekDays('2026-10-24', 'sunday', false)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(isWeekend('2026-10-24')).toBe(true);
    expect(isWeekend('2026-10-23')).toBe(false);
  });
});

describe('month grids', () => {
  // In 2026 the first of the month falls on every weekday in these months:
  // Jun 1 Mon, Sep 1 Tue, Apr 1 Wed, Jan 1 Thu, May 1 Fri, Aug 1 Sat, Feb 1 Sun.
  const months: Array<[string, number]> = [
    ['2026-06-10', 1],
    ['2026-09-10', 2],
    ['2026-04-10', 3],
    ['2026-01-10', 4],
    ['2026-05-10', 5],
    ['2026-08-10', 6],
    ['2026-02-10', 0],
  ];

  it.each(months)('covers every day of the month once (%s)', (day) => {
    for (const first of ['monday', 'sunday'] as const) {
      const grid = monthGrid(day, first);
      const days = grid.flat();
      expect(days.length % 7).toBe(0);
      expect(grid.length).toBeGreaterThanOrEqual(4);
      expect(grid.length).toBeLessThanOrEqual(6);
      const month = day.slice(0, 7);
      const inMonth = days.filter((d) => d.startsWith(month));
      expect(inMonth).toHaveLength(daysInMonth(+day.slice(0, 4), +day.slice(5, 7)));
      // Consecutive days, starting on the chosen weekday.
      for (let i = 1; i < days.length; i += 1) expect(diffDays(days[i - 1]!, days[i]!)).toBe(1);
      expect(weekStart(days[0]!, first)).toBe(days[0]);
    }
  });

  it('has the right number of rows and first day', () => {
    expect(monthGrid('2026-10-24', 'monday')).toHaveLength(5);
    expect(monthGrid('2026-10-24', 'monday')[0]![0]).toBe('2026-09-28');
    expect(monthGrid('2026-10-24', 'sunday')[0]![0]).toBe('2026-09-27');
    // August 2026 starts on a Saturday: 6 weeks either way.
    expect(monthGrid('2026-08-10', 'sunday')).toHaveLength(6);
    expect(monthGrid('2026-08-10', 'monday')).toHaveLength(6);
    // February 2027 starts on a Monday and has 28 days: exactly 4 weeks.
    expect(monthGrid('2027-02-10', 'monday')).toHaveLength(4);
  });

  it('handles a leap February', () => {
    const grid = monthGrid('2024-02-10', 'monday');
    expect(grid.flat()).toContain('2024-02-29');
    expect(grid.flat().filter((d) => d.startsWith('2024-02'))).toHaveLength(29);
  });

  it('drops the weekend columns', () => {
    const grid = monthGrid('2026-10-24', 'monday', false);
    expect(grid.every((week) => week.length === 5)).toBe(true);
    expect(grid.flat().some(isWeekend)).toBe(false);
  });
});

describe('titles', () => {
  it('formats the toolbar titles', () => {
    expect(monthTitle('2026-10-24')).toBe('October 2026');
    expect(rangeTitle('2026-10-19', '2026-10-25')).toBe('Oct 19 – 25, 2026');
    expect(rangeTitle('2026-10-26', '2026-11-01')).toBe('Oct 26 – Nov 1, 2026');
    expect(rangeTitle('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(fullDateLabel('2026-10-26')).toBe('Monday, October 26, 2026');
    expect(shortDateLabel('2026-10-03')).toBe('Oct 3');
  });
});
