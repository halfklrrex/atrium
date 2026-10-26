# P2 Spec: Timeline, Week, Hour & World Clock Columns

**Epic:** Timeline, week, hour & world clock columns  
**Roadmap Item:** `3306293394` (Phase P2: Full Column Library)  
**Agent:** Ava (Antigravity) · **Lead:** Ophelia (Claude Opus 5.5)  
**Branch:** `ag/columns-timeline-time`

---

## 1. Overview & Business Context

In monday.com, date-range scheduling, weekly planning, precise time-of-day recording, and distributed international collaboration rely on a quartet of specialized temporal columns:

1. **`timeline`**: Date ranges (`from` to `to`) with visual bar rendering, duration calculations in days, and elapsed progress tracking ($0 \le P \le 100$). Note: The P11 importer strips monday's internal `changed_at` attribute.
2. **`week`**: Calendar week selections stored in monday's canonical shape (`{"week": {"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}}`) with configurable first-day-of-week (Monday vs Sunday). `weekNumber` and `year` are derived at render-time via ISO 8601 algorithms.
3. **`hour`**: Time-of-day entries stored as `{ hour: 0..23, minute: 0..59 }` with 24-hour (`14:30`) and 12-hour AM/PM (`02:30 PM`) display modes and robust input parsing.
4. **`world_clock`**: International timezone trackers stored as `{ timezone: string }` validating canonical, case-exact IANA timezone identifiers via ECMAScript `Intl.DateTimeFormat`.

---

## 2. Data Models & Schemas

### 2.1 Timeline Column (`timeline`)

- **Type Slug:** `'timeline'`
- **Settings Schema:**
  ```ts
  export const timelineSettingsSchema = z
    .object({
      showProgress: z.boolean().default(false),
    })
    .strict();
  ```
- **Value Schema:** Strictly `{ from, to }` (strict object, unverified visualization types removed).
  ```ts
  export const timelineValueSchema = z
    .object({
      from: isoDateSchema, // YYYY-MM-DD
      to: isoDateSchema, // YYYY-MM-DD
    })
    .strict()
    .refine((val) => val.from <= val.to, {
      message: 'The "from" date must be before or equal to the "to" date',
      path: ['to'],
    });
  ```
- **Helpers:**
  - `getTimelineDurationDays(value: TimelineValue): number`: Returns inclusive span in days.
  - `computeTimelineProgress(value: TimelineValue, nowIsoDate?: string): number`: Computes percentage completion ($0 \dots 100$).
- **Summaries & Aggregation:**
  - `summaries`: `['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest']`
  - `aggregate`: Computes `{ kind: 'range', earliest: min(from), latest: max(to) }`.

### 2.2 Week Column (`week`)

- **Type Slug:** `'week'`
- **Settings Schema:**
  ```ts
  export const weekSettingsSchema = z
    .object({
      firstDayOfWeek: z.enum(['monday', 'sunday']).default('monday'),
    })
    .strict();
  ```
- **Value Schema:** Canonical monday shape `{ week: { startDate, endDate } }` (both objects strict).
  ```ts
  export const weekRangeSchema = z
    .object({
      startDate: isoDateSchema,
      endDate: isoDateSchema,
    })
    .strict();

  export const weekValueSchema = z
    .object({
      week: weekRangeSchema,
    })
    .strict()
    .refine((val) => val.week.startDate <= val.week.endDate, {
      message: 'startDate must be before or equal to endDate',
      path: ['week', 'endDate'],
    });
  ```
- **Validators & Helpers:**
  - `validateWeekValue(value, settings)`: Validates that `endDate` is exactly 6 days after `startDate` and the start day matches `settings.firstDayOfWeek`.
  - `getIsoWeek(dateStr: string): { weekNumber: number; year: number }`: Standard ISO 8601 week calculation.
  - `getWeekDateRange(dateStr: string, firstDayOfWeek)`: Computes start/end date bounds for the 7-day week.
  - `formatWeek(value: WeekValue): string`: Formats as `"W43 (2026-10-19 - 2026-10-25)"`.

### 2.3 Hour Column (`hour`)

- **Type Slug:** `'hour'`
- **Settings Schema:**
  ```ts
  export const hourSettingsSchema = z
    .object({
      format24Hour: z.boolean().default(true),
    })
    .strict();
  ```
- **Value Schema:**
  ```ts
  export const hourValueSchema = z
    .object({
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .strict();
  ```
- **Helpers:**
  - `formatHour(value: HourValue, format24Hour: boolean): string`: Formats as `"14:30"` or `"02:30 PM"`.
  - `parseHour(input: string): HourValue | null`: Parses both 24h and 12h AM/PM strings.
- **Sorting:** Compares `(a.hour * 60 + a.minute) - (b.hour * 60 + b.minute)`.

### 2.4 World Clock Column (`world_clock`)

- **Type Slug:** `'world_clock'`
- **Settings Schema:**
  ```ts
  export const worldClockSettingsSchema = z
    .object({
      format24Hour: z.boolean().default(true),
      showCity: z.boolean().default(true),
    })
    .strict();
  ```
- **Value Schema:** Canonical shape `{ timezone: string }` (dropped non-standard city key).
  ```ts
  export const worldClockValueSchema = z
    .object({
      timezone: z.string().min(1).refine(isValidTimezone, {
        message: 'Expected a valid canonical IANA timezone (e.g. "Europe/London", "UTC")',
      }),
    })
    .strict();
  ```
- **Canonical Validation:**
  - `isValidTimezone(tz)`: Validates `Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone === tz`, rejecting non-canonical aliases and case mismatches.
- **Helpers:**
  - `getDefaultCity(timezone: string): string`: Extracts clean city names (`"America/New_York"` -> `"New York"`).
  - `formatWorldClockTime(timezone: string, date: Date, format24Hour: boolean): string`: Formats time in timezone.
  - `getTimezoneOffsetMinutes(timezone: string, date: Date): number`: Returns UTC offset minutes.
- **Sorting:** Compares timezone UTC offsets, ordering world clocks geographically from West to East.

---

## 3. Testing Plan

- Value validation unit tests verifying strict schema enforcement (rejection of extra keys), date boundaries, and canonical timezone validation.
- `validateWeekValue` checks for Monday-aligned and Sunday-aligned 7-day spans.
- Round-trip tests through `columnRegistry.parseValue` and `columnRegistry.toText`.
