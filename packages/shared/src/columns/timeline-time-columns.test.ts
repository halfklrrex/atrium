import { describe, expect, it } from 'vitest';
import {
  columnRegistry,
  computeTimelineProgress,
  formatHour,
  formatWeek,
  formatWorldClockTime,
  getDefaultCity,
  getIsoWeek,
  getTimezoneOffsetMinutes,
  getTimelineDurationDays,
  getWeekDateRange,
  hourColumn,
  hourSettingsSchema,
  hourValueSchema,
  isValidTimezone,
  parseHour,
  timelineColumn,
  timelineSettingsSchema,
  timelineValueSchema,
  validateWeekValue,
  weekColumn,
  weekSettingsSchema,
  weekValueSchema,
  worldClockColumn,
  worldClockSettingsSchema,
  worldClockValueSchema,
} from './index';

describe('P2 Timeline, Week, Hour & World Clock Columns', () => {
  describe('timelineColumn', () => {
    it('validates timeline value schema and enforces strictness (no extra keys)', () => {
      const valid = timelineValueSchema.safeParse({
        from: '2026-10-20',
        to: '2026-10-25',
      });
      expect(valid.success).toBe(true);

      const sameDay = timelineValueSchema.safeParse({
        from: '2026-10-20',
        to: '2026-10-20',
      });
      expect(sameDay.success).toBe(true);

      // Rejects unverified visualization_type or extra keys
      expect(
        timelineValueSchema.safeParse({
          from: '2026-10-20',
          to: '2026-10-20',
          visualization_type: 'bars',
        }).success,
      ).toBe(false);
      expect(
        timelineValueSchema.safeParse({
          from: '2026-10-20',
          to: '2026-10-20',
          extra: true,
        }).success,
      ).toBe(false);

      // Rejects from > to
      const invalidOrder = timelineValueSchema.safeParse({
        from: '2026-10-25',
        to: '2026-10-20',
      });
      expect(invalidOrder.success).toBe(false);

      // Rejects malformed dates
      const invalidDate = timelineValueSchema.safeParse({
        from: '2026-02-31',
        to: '2026-03-05',
      });
      expect(invalidDate.success).toBe(false);
    });

    it('validates timeline settings schema and defaults', () => {
      const defaults = timelineColumn.defaultSettings();
      expect(defaults).toEqual({ showProgress: false });
      expect(timelineSettingsSchema.safeParse(defaults).success).toBe(true);
      expect(timelineSettingsSchema.safeParse({ showProgress: true, extra: 1 }).success).toBe(
        false,
      );
    });

    it('calculates duration in inclusive days', () => {
      expect(
        getTimelineDurationDays({
          from: '2026-10-20',
          to: '2026-10-20',
        }),
      ).toBe(1);

      expect(
        getTimelineDurationDays({
          from: '2026-10-20',
          to: '2026-10-24',
        }),
      ).toBe(5);
    });

    it('computes timeline progress percentage relative to a date', () => {
      const span = { from: '2026-10-20', to: '2026-10-30' };

      // Before start date -> 0%
      expect(computeTimelineProgress(span, '2026-10-15')).toBe(0);
      expect(computeTimelineProgress(span, '2026-10-20')).toBe(0);

      // Mid-span -> ~50%
      expect(computeTimelineProgress(span, '2026-10-25')).toBe(50);

      // After end date -> 100%
      expect(computeTimelineProgress(span, '2026-10-30')).toBe(100);
      expect(computeTimelineProgress(span, '2026-11-05')).toBe(100);
    });

    it('toText, compare, and aggregate', () => {
      const t1 = { from: '2026-10-20', to: '2026-10-24' };
      const t2 = { from: '2026-10-25', to: '2026-10-30' };
      const settings = timelineColumn.defaultSettings();

      expect(timelineColumn.toText(t1, settings)).toBe('2026-10-20 - 2026-10-24');
      expect(timelineColumn.compare(t1, t2, settings)).toBeLessThan(0);
      expect(timelineColumn.compare(t2, t1, settings)).toBeGreaterThan(0);

      const agg = timelineColumn.aggregate?.([t1, null, t2, undefined], settings);
      expect(agg).toEqual({
        kind: 'range',
        earliest: '2026-10-20',
        latest: '2026-10-30',
      });

      expect(timelineColumn.aggregate?.([null, undefined], settings)).toBeNull();
    });

    it('round-trips through registry parseValue and toText', () => {
      const fixture = { from: '2026-10-20', to: '2026-10-25' };
      const parsed = columnRegistry.parseValue('timeline', fixture);
      expect(parsed).toEqual({ success: true, data: fixture });
      if (parsed.success) {
        expect(columnRegistry.toText('timeline', parsed.data, {})).toBe('2026-10-20 - 2026-10-25');
      }
    });
  });

  describe('weekColumn', () => {
    it('validates monday week shape { week: { startDate, endDate } } and rejects flat/extra keys', () => {
      const valid = weekValueSchema.safeParse({
        week: {
          startDate: '2026-10-19',
          endDate: '2026-10-25',
        },
      });
      expect(valid.success).toBe(true);

      // Rejects flat shape
      expect(
        weekValueSchema.safeParse({
          startDate: '2026-10-19',
          endDate: '2026-10-25',
        }).success,
      ).toBe(false);

      // Rejects stored weekNumber or year
      expect(
        weekValueSchema.safeParse({
          week: {
            startDate: '2026-10-19',
            endDate: '2026-10-25',
            weekNumber: 43,
          },
        }).success,
      ).toBe(false);

      // Rejects start > end
      expect(
        weekValueSchema.safeParse({
          week: {
            startDate: '2026-10-26',
            endDate: '2026-10-20',
          },
        }).success,
      ).toBe(false);
    });

    it('validates week settings schema and defaults', () => {
      const defaults = weekColumn.defaultSettings();
      expect(defaults).toEqual({ firstDayOfWeek: 'monday' });
      expect(weekSettingsSchema.safeParse(defaults).success).toBe(true);
      expect(weekSettingsSchema.safeParse({ firstDayOfWeek: 'sunday' }).success).toBe(true);
      expect(weekSettingsSchema.safeParse({ firstDayOfWeek: 'friday' }).success).toBe(false);
    });

    it('validateWeekValue verifies 7-day span and start day alignment', () => {
      const mondayWeek = {
        week: {
          startDate: '2026-10-19', // Monday
          endDate: '2026-10-25', // Sunday (6 days later)
        },
      };
      expect(validateWeekValue(mondayWeek, { firstDayOfWeek: 'monday' })).toBe(true);
      // Fails on Sunday setting
      expect(validateWeekValue(mondayWeek, { firstDayOfWeek: 'sunday' })).toBe(false);

      const sundayWeek = {
        week: {
          startDate: '2026-10-18', // Sunday
          endDate: '2026-10-24', // Saturday
        },
      };
      expect(validateWeekValue(sundayWeek, { firstDayOfWeek: 'sunday' })).toBe(true);
      expect(validateWeekValue(sundayWeek, { firstDayOfWeek: 'monday' })).toBe(false);

      // Invalid span (5 days instead of 6)
      const wrongSpan = {
        week: {
          startDate: '2026-10-19',
          endDate: '2026-10-24',
        },
      };
      expect(validateWeekValue(wrongSpan, { firstDayOfWeek: 'monday' })).toBe(false);
    });

    it('calculates ISO week and week date ranges', () => {
      // 2026-10-24 is a Saturday in ISO week 43 of 2026
      const iso = getIsoWeek('2026-10-24');
      expect(iso.weekNumber).toBe(43);
      expect(iso.year).toBe(2026);

      const mondayRange = getWeekDateRange('2026-10-24', 'monday');
      expect(mondayRange).toEqual({
        startDate: '2026-10-19',
        endDate: '2026-10-25',
      });
    });

    it('formats week, compares, and aggregates', () => {
      const w1 = { week: { startDate: '2026-10-12', endDate: '2026-10-18' } };
      const w2 = { week: { startDate: '2026-10-19', endDate: '2026-10-25' } };
      const sundayWeek = { week: { startDate: '2026-10-18', endDate: '2026-10-24' } };
      const settings = weekColumn.defaultSettings();

      expect(formatWeek(w2)).toBe('W43 (2026-10-19 - 2026-10-25)');
      expect(weekColumn.toText(w2, settings)).toBe('W43 (2026-10-19 - 2026-10-25)');
      // Sunday-first week label uses the ISO week of its Thursday to reflect the majority of days
      expect(formatWeek(sundayWeek)).toBe('W43 (2026-10-18 - 2026-10-24)');
      expect(weekColumn.compare(w1, w2, settings)).toBeLessThan(0);

      const agg = weekColumn.aggregate?.([w1, w2], settings);
      expect(agg).toEqual({
        kind: 'range',
        earliest: '2026-10-12',
        latest: '2026-10-25',
      });
    });

    it('round-trips through registry parseValue and toText', () => {
      const fixture = { week: { startDate: '2026-10-19', endDate: '2026-10-25' } };
      const parsed = columnRegistry.parseValue('week', fixture);
      expect(parsed).toEqual({ success: true, data: fixture });
      if (parsed.success) {
        expect(columnRegistry.toText('week', parsed.data, {})).toBe(
          'W43 (2026-10-19 - 2026-10-25)',
        );
      }
    });
  });

  describe('hourColumn', () => {
    it('validates hour value schema and rejects extra keys', () => {
      expect(hourValueSchema.safeParse({ hour: 0, minute: 0 }).success).toBe(true);
      expect(hourValueSchema.safeParse({ hour: 23, minute: 59 }).success).toBe(true);
      expect(hourValueSchema.safeParse({ hour: 24, minute: 0 }).success).toBe(false);
      expect(hourValueSchema.safeParse({ hour: 12, minute: 60 }).success).toBe(false);
      expect(hourValueSchema.safeParse({ hour: -1, minute: 30 }).success).toBe(false);
      expect(hourValueSchema.safeParse({ hour: 12, minute: 30, extra: 1 }).success).toBe(false);
    });

    it('formats hour in 24h and 12h styles', () => {
      expect(formatHour({ hour: 0, minute: 0 }, true)).toBe('00:00');
      expect(formatHour({ hour: 0, minute: 0 }, false)).toBe('12:00 AM');
      expect(formatHour({ hour: 12, minute: 30 }, false)).toBe('12:30 PM');
      expect(formatHour({ hour: 14, minute: 5 }, true)).toBe('14:05');
      expect(formatHour({ hour: 14, minute: 5 }, false)).toBe('02:05 PM');
    });

    it('parses user entered hour strings', () => {
      expect(parseHour('14:05')).toEqual({ hour: 14, minute: 5 });
      expect(parseHour('2:30 PM')).toEqual({ hour: 14, minute: 30 });
      expect(parseHour('2:30pm')).toEqual({ hour: 14, minute: 30 });
      expect(parseHour('12:15 AM')).toEqual({ hour: 0, minute: 15 });
      expect(parseHour('12:15 PM')).toEqual({ hour: 12, minute: 15 });
      expect(parseHour('invalid')).toBeNull();
    });

    it('compares chronologically and registers in columnRegistry', () => {
      const h1 = { hour: 9, minute: 30 };
      const h2 = { hour: 14, minute: 0 };
      const settings = hourColumn.defaultSettings();
      expect(hourSettingsSchema.safeParse(settings).success).toBe(true);

      expect(hourColumn.compare(h1, h2, settings)).toBeLessThan(0);
      expect(hourColumn.compare(h2, h1, settings)).toBeGreaterThan(0);
      expect(hourColumn.toText(h1, settings)).toBe('09:30');
      expect(hourColumn.toText(h1, { format24Hour: false })).toBe('09:30 AM');

      const parsed = columnRegistry.parseValue('hour', h1);
      expect(parsed).toEqual({ success: true, data: h1 });
    });
  });

  describe('worldClockColumn', () => {
    it('validates canonical case-exact timezone and rejects aliases/case mismatches', () => {
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);

      // Modern canonical IANA names (positive tests)
      expect(isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidTimezone('Europe/Kyiv')).toBe(true);
      expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
      expect(isValidTimezone('Asia/Kathmandu')).toBe(true);

      // Negative: legacy aliases
      expect(isValidTimezone('Asia/Calcutta')).toBe(false);
      expect(isValidTimezone('Europe/Kiev')).toBe(false);
      expect(isValidTimezone('Asia/Katmandu')).toBe(false);
      expect(isValidTimezone('America/Buenos_Aires')).toBe(false);

      // Negative: case mismatch
      expect(isValidTimezone('europe/london')).toBe(false);
      expect(isValidTimezone('asia/kolkata')).toBe(false);
      // Negative: legacy alias or non-canonical
      expect(isValidTimezone('US/Eastern')).toBe(false);
      // Negative: completely invalid
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);

      expect(worldClockValueSchema.safeParse({ timezone: 'Europe/London' }).success).toBe(true);
      expect(worldClockValueSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
      expect(worldClockValueSchema.safeParse({ timezone: 'Europe/Kyiv' }).success).toBe(true);
      expect(
        worldClockValueSchema.safeParse({ timezone: 'America/Argentina/Buenos_Aires' }).success,
      ).toBe(true);
      expect(worldClockValueSchema.safeParse({ timezone: 'Asia/Kathmandu' }).success).toBe(true);

      expect(worldClockValueSchema.safeParse({ timezone: 'Asia/Calcutta' }).success).toBe(false);
      expect(worldClockValueSchema.safeParse({ timezone: 'Europe/Kiev' }).success).toBe(false);
      expect(worldClockValueSchema.safeParse({ timezone: 'europe/london' }).success).toBe(false);
      expect(worldClockValueSchema.safeParse({ timezone: 'US/Eastern' }).success).toBe(false);

      // Strictness: rejects extra keys (like city)
      expect(
        worldClockValueSchema.safeParse({
          timezone: 'Europe/London',
          city: 'London',
        }).success,
      ).toBe(false);
    });

    it('extracts default city and formats world clock time', () => {
      expect(getDefaultCity('America/New_York')).toBe('New York');
      expect(getDefaultCity('Europe/London')).toBe('London');
      expect(getDefaultCity('UTC')).toBe('UTC');

      const testDate = new Date('2026-10-24T12:30:00Z');
      const formattedUtc = formatWorldClockTime('UTC', testDate, true);
      expect(formattedUtc).toBe('12:30');

      const formatted12h = formatWorldClockTime('UTC', testDate, false);
      expect(formatted12h.toUpperCase()).toContain('12:30');
    });

    it('computes timezone offsets and compares world clocks', () => {
      const testDate = new Date('2026-10-24T12:00:00Z');
      const utcOffset = getTimezoneOffsetMinutes('UTC', testDate);
      expect(utcOffset).toBe(0);

      const tokyoOffset = getTimezoneOffsetMinutes('Asia/Tokyo', testDate);
      expect(tokyoOffset).toBe(540); // +9 hours = +540 minutes

      const ny = { timezone: 'America/New_York' };
      const tokyo = { timezone: 'Asia/Tokyo' };
      const settings = worldClockColumn.defaultSettings();
      expect(worldClockSettingsSchema.safeParse(settings).success).toBe(true);

      expect(worldClockColumn.compare(ny, tokyo, settings)).toBeLessThan(0);
      expect(worldClockColumn.compare(tokyo, ny, settings)).toBeGreaterThan(0);

      expect(worldClockColumn.toText(tokyo, settings)).toBe('Asia/Tokyo (Tokyo)');
      expect(worldClockColumn.toText(tokyo, { format24Hour: true, showCity: false })).toBe(
        'Asia/Tokyo',
      );

      const parsed = columnRegistry.parseValue('world_clock', { timezone: 'Asia/Tokyo' });
      expect(parsed).toEqual({ success: true, data: { timezone: 'Asia/Tokyo' } });
    });
  });

  describe('Registry Integration', () => {
    it('registers all 4 time columns in columnRegistry', () => {
      expect(columnRegistry.has('timeline')).toBe(true);
      expect(columnRegistry.has('week')).toBe(true);
      expect(columnRegistry.has('hour')).toBe(true);
      expect(columnRegistry.has('world_clock')).toBe(true);

      const tl = columnRegistry.get('timeline');
      expect(tl.label).toBe('Timeline');

      const wk = columnRegistry.get('week');
      expect(wk.label).toBe('Week');

      const hr = columnRegistry.get('hour');
      expect(hr.label).toBe('Hour');

      const wc = columnRegistry.get('world_clock');
      expect(wc.label).toBe('World Clock');
    });
  });
});
