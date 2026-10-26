# Handoff: P2 Timeline, Week, Hour & World Clock Columns

**Date:** 2026-10-24  
**Agent:** Ava (Antigravity) · **Lead:** Ophelia (Claude Opus 5.5)  
**Branch:** `ag/columns-timeline-time`  
**Roadmap Item:** `Timeline, week, hour & world clock columns` (ID: `3306293394`, Phase P2)

## What Was Done

1. **Implemented 4 Time & Scheduling Column Types in `@atrium/shared`:**
   - **`timeline`** (`packages/shared/src/columns/timeline.ts`):
     - Value schema `{ from: string, to: string }` (.strict) with `from <= to` refinement. Removed unverified `visualization_type`.
     - Settings schema `{ showProgress: boolean }`.
     - Calculations: `getTimelineDurationDays(value)` (inclusive day span), `computeTimelineProgress(value, nowIsoDate)` (elapsed percentage $0 \dots 100$).
     - Aggregation: `{ kind: 'range', earliest, latest }`.
   - **`week`** (`packages/shared/src/columns/week.ts`):
     - Value schema matching monday: `{ week: { startDate, endDate } }` (both objects .strict()) with `startDate <= endDate`.
     - Dropped stored `weekNumber` and `year` (now computed at render-time).
     - Settings schema `{ firstDayOfWeek: 'monday' | 'sunday' }`.
     - Standalone validator `validateWeekValue(value, settings)` ensuring start day alignment and exact 6-day span.
     - Helpers: Standard ISO 8601 `getIsoWeek(dateStr)` and `getWeekDateRange(dateStr, firstDayOfWeek)`.
     - Formatting: `formatWeek(value)` -> `"W43 (2026-10-19 - 2026-10-25)"`.
   - **`hour`** (`packages/shared/src/columns/hour.ts`):
     - Value schema `{ hour: 0..23, minute: 0..59 }` (.strict).
     - Settings schema `{ format24Hour: boolean }`.
     - Helpers: `formatHour(value, format24Hour)` (24h `"14:30"` vs 12h `"02:30 PM"`), robust `parseHour(input)` handling 24h and 12h AM/PM inputs.
     - Chronological comparator over total minutes from midnight.
   - **`world_clock`** (`packages/shared/src/columns/world-clock.ts`):
     - Value schema `{ timezone: string }` (.strict). Dropped `city` per monday specification.
     - Canonical, case-exact IANA timezone validation via `Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().timeZone === timezone`, rejecting non-canonical aliases and case mismatches.
     - Settings schema `{ format24Hour: boolean, showCity: boolean }`.
     - Helpers: `formatWorldClockTime(timezone, date, format24Hour)`, `getTimezoneOffsetMinutes(timezone, date)`, `getDefaultCity(timezone)`.
     - Sorting by geographic UTC offset from West to East.

2. **Column Registry Integration:**
   - Registered all four types in `createColumnRegistry()` in `packages/shared/src/columns/index.ts`.
   - Updated `packages/shared/src/columns/registry.test.ts`.

3. **Testing & Specification:**
   - Comprehensive Vitest suite in `packages/shared/src/columns/timeline-time-columns.test.ts` testing strictness (rejecting extra keys), canonical timezone validation, and registry round-trips.
   - Spec written at `docs/specs/P2-timeline-time-columns.md`.

## What's Next

- Review and merge by Lead Agent Ophelia (Claude Opus 5.5).
- Web UI renderers and popover editors (`apps/web/src/columns/`) for the board table view.
