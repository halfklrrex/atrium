import { z } from 'zod';
import type { FilterCondition, FilterGroup, FilterOperator, SortCondition } from '../filters/types';
import { auditFields, positionSchema, uidSchema, type WriteDoc } from './common';

/** Caps that keep a saved view small (a Firestore document is limited to 1 MiB). */
export const VIEW_LIMITS = {
  conditions: 50,
  sorts: 10,
  hiddenColumns: 200,
  persons: 200,
  nameMax: 60,
} as const;

/** The id of the always-present "Main table" view. */
export const MAIN_VIEW_ID = 'main';
export const MAIN_VIEW_NAME = 'Main table';
export const MAIN_VIEW_POSITION = 'a0';

export const filterOperatorSchema: z.ZodType<FilterOperator> = z.enum([
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
  'greater_than',
  'less_than',
]);

export const filterConditionSchema: z.ZodType<FilterCondition> = z.object({
  columnId: z.string().min(1).max(128),
  operator: filterOperatorSchema,
  value: z.unknown().optional(),
});

export const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
  conjunction: z.enum(['and', 'or']),
  conditions: z.array(filterConditionSchema).max(VIEW_LIMITS.conditions),
});

export const sortConditionSchema: z.ZodType<SortCondition> = z.object({
  columnId: z.string().min(1).max(128),
  direction: z.enum(['asc', 'desc']),
});

export const viewTypeSchema = z.enum(['table', 'kanban', 'calendar', 'timeline']);
export type ViewType = z.infer<typeof viewTypeSchema>;

export const viewFilterSettingsSchema = z.object({
  personIds: z.array(uidSchema).max(VIEW_LIMITS.persons),
  filterGroup: filterGroupSchema,
  sortConditions: z.array(sortConditionSchema).max(VIEW_LIMITS.sorts),
  groupByColumnId: z.string().min(1).max(128).nullable(),
});

/** Caps for a Kanban view's settings. */
export const KANBAN_LIMITS = { cardColumns: 20, collapsedLanes: 60 } as const;

/** How many columns a Kanban card shows until the user picks others. */
export const KANBAN_DEFAULT_CARD_COLUMNS = 3;

/** Key of the lane for items without a status label (every other lane is keyed by its label id). */
export const KANBAN_EMPTY_LANE = '__empty';

/** Settings of a Kanban view (`views/{id}.settings.kanban`). */
export const kanbanSettingsSchema = z.object({
  /** The status column whose labels make the lanes; null = the board's first status column. */
  columnId: z.string().min(1).max(128).nullable(),
  /** Columns shown on the cards, in order; null = the first three non-status, non-derived columns. */
  cardColumnIds: z.array(z.string().min(1).max(128)).max(KANBAN_LIMITS.cardColumns).nullable(),
  /** Lane keys the user collapsed (label ids, or `__empty`). */
  collapsedLaneIds: z.array(z.string().min(1).max(128)).max(KANBAN_LIMITS.collapsedLanes),
  showEmptyLanes: z.boolean(),
});
export type KanbanSettings = z.infer<typeof kanbanSettingsSchema>;

export function defaultKanbanSettings(): KanbanSettings {
  return { columnId: null, cardColumnIds: null, collapsedLaneIds: [], showEmptyLanes: true };
}

/** Caps for a Timeline view's settings. */
export const TIMELINE_LIMITS = { collapsedGroups: 60 } as const;

const columnIdSchema = z.string().min(1).max(128);

/** Settings of a Calendar view (`views/{id}.settings.calendar`). */
export const calendarSettingsSchema = z.object({
  /** The date or timeline column that places items; null = first date column, else first timeline column. */
  columnId: columnIdSchema.nullable(),
  mode: z.enum(['month', 'week']),
  /** A status column whose label colours the items; null = the group colour. */
  colorBy: columnIdSchema.nullable(),
  showWeekends: z.boolean(),
  firstDayOfWeek: z.enum(['monday', 'sunday']),
});
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

export function defaultCalendarSettings(): CalendarSettings {
  return {
    columnId: null,
    mode: 'month',
    colorBy: null,
    showWeekends: true,
    firstDayOfWeek: 'monday',
  };
}

/** Settings of a Timeline view (`views/{id}.settings.timeline`). */
export const timelineViewSettingsSchema = z.object({
  /** The timeline or date column that places items; null = first timeline column, else first date column. */
  columnId: columnIdSchema.nullable(),
  zoom: z.enum(['days', 'weeks', 'months']),
  colorBy: columnIdSchema.nullable(),
  /** Group ids whose lane the user collapsed. */
  collapsedGroupIds: z.array(columnIdSchema).max(TIMELINE_LIMITS.collapsedGroups),
  showGroupSummary: z.boolean(),
  showToday: z.boolean(),
  showWeekends: z.boolean(),
  showLegend: z.boolean(),
});
export type TimelineViewSettings = z.infer<typeof timelineViewSettingsSchema>;

export function defaultTimelineViewSettings(): TimelineViewSettings {
  return {
    columnId: null,
    zoom: 'weeks',
    colorBy: null,
    collapsedGroupIds: [],
    showGroupSummary: true,
    showToday: true,
    showWeekends: true,
    showLegend: true,
  };
}

export const viewSettingsSchema = z.object({
  filter: viewFilterSettingsSchema,
  hiddenColumnIds: z.array(z.string().min(1).max(128)).max(VIEW_LIMITS.hiddenColumns),
  /** Only Kanban views have these. */
  kanban: kanbanSettingsSchema.optional(),
  /** Only Calendar views have these. */
  calendar: calendarSettingsSchema.optional(),
  /** Only Timeline views have these. */
  timeline: timelineViewSettingsSchema.optional(),
});
export type ViewSettings = z.infer<typeof viewSettingsSchema>;
export type ViewFilterSettings = z.infer<typeof viewFilterSettingsSchema>;

/** `boards/{boardId}/views/{viewId}`; `ownerId` null = shared view, a uid = that user's personal view. */
export const boardViewSchema = z.object({
  name: z.string().min(1).max(VIEW_LIMITS.nameMax),
  type: viewTypeSchema,
  position: positionSchema,
  ownerId: uidSchema.nullable(),
  settings: viewSettingsSchema,
  ...auditFields,
  updatedBy: uidSchema,
});
export type BoardView = z.infer<typeof boardViewSchema>;
export type BoardViewWrite = WriteDoc<BoardView>;

/** Settings of a view nobody has saved yet (and of a missing `main`). */
export function defaultViewSettings(): ViewSettings {
  return {
    filter: {
      personIds: [],
      filterGroup: { conjunction: 'and', conditions: [] },
      sortConditions: [],
      groupByColumnId: null,
    },
    hiddenColumnIds: [],
  };
}

/** A name for a new view that is not taken yet: "Table", "Table 2", "Table 3", ... */
export function uniqueViewName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}
