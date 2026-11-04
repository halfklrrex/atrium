import { z } from 'zod';
import { boardKindSchema, boardRoleSchema } from '../roles';
import {
  auditFields,
  iconSchema,
  idSchema,
  positionSchema,
  timestampSchema,
  uidSchema,
  type WriteDoc,
} from './common';
import { slugIdSchema } from './board';
import { chartSettingsSchema } from './view';

/** Limits shared by the dashboard rules, the schema, the layout engine and the UI (P6 spec). */
export const DASHBOARD_LIMITS = {
  name: 80,
  boards: 50,
  widgets: 24,
  widgetTitle: 80,
  /** The grid has this many columns. */
  gridColumns: 12,
  widgetMinW: 2,
  widgetMaxW: 12,
  widgetMinH: 2,
  widgetMaxH: 12,
  /** Largest row a widget may start on. */
  maxY: 1000,
  filterValues: 50,
  tableColumns: 8,
  /** Most entries in `access`. */
  accessEntries: 100,
} as const;

export const DASHBOARD_WIDGET_TYPES = ['chart', 'numbers', 'battery', 'table', 'workload'] as const;
export const dashboardWidgetTypeSchema = z.enum(DASHBOARD_WIDGET_TYPES);
export type DashboardWidgetType = z.infer<typeof dashboardWidgetTypeSchema>;

/** Dashboards are trashed and restored like boards, but never archived. */
export const dashboardStateSchema = z.enum(['active', 'deleted']);
export type DashboardState = z.infer<typeof dashboardStateSchema>;

const columnIdSchema = z.string().min(1).max(128);

/** A widget's position and size in grid units (12 columns). */
export const widgetLayoutSchema = z
  .object({
    x: z
      .number()
      .int()
      .min(0)
      .max(DASHBOARD_LIMITS.gridColumns - 1),
    y: z.number().int().min(0).max(DASHBOARD_LIMITS.maxY),
    w: z.number().int().min(DASHBOARD_LIMITS.widgetMinW).max(DASHBOARD_LIMITS.widgetMaxW),
    h: z.number().int().min(DASHBOARD_LIMITS.widgetMinH).max(DASHBOARD_LIMITS.widgetMaxH),
  })
  .strict()
  .refine((l) => l.x + l.w <= DASHBOARD_LIMITS.gridColumns, 'Widget extends past the grid');
export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;

/** Keeps only items whose `columnId` cell holds one of `values` (status label ids, person uids...). */
export const widgetFilterSchema = z
  .object({
    columnId: columnIdSchema,
    values: z.array(z.string().min(1).max(128)).max(DASHBOARD_LIMITS.filterValues),
  })
  .strict();
export type WidgetFilter = z.infer<typeof widgetFilterSchema>;

export const AGGREGATE_MODES = ['count', 'sum', 'average', 'min', 'max'] as const;

/** Chart widget: the Chart view's settings, applied across the widget's boards. */
export const chartWidgetSettingsSchema = chartSettingsSchema.strict();

export const numbersWidgetSettingsSchema = z
  .object({
    mode: z.enum(AGGREGATE_MODES),
    /** Numbers / formula column; null with `count`. */
    columnId: columnIdSchema.nullable(),
    filter: widgetFilterSchema.nullable(),
  })
  .strict();

export const batteryWidgetSettingsSchema = z
  .object({
    /** null = the first status column of each board. */
    statusColumnId: columnIdSchema.nullable(),
    /** Status label ids that count as done. */
    doneLabelIds: z.array(z.string().min(1).max(128)).max(DASHBOARD_LIMITS.filterValues),
  })
  .strict();

export const tableWidgetSettingsSchema = z
  .object({
    columnIds: z.array(columnIdSchema).max(DASHBOARD_LIMITS.tableColumns),
    filter: widgetFilterSchema.nullable(),
    rowLimit: z.union([z.literal(10), z.literal(25), z.literal(50)]),
  })
  .strict();

export const workloadWidgetSettingsSchema = z
  .object({
    peopleColumnId: columnIdSchema.nullable(),
    dateColumnId: columnIdSchema.nullable(),
    bucket: z.enum(['week', 'month']),
  })
  .strict();

const widgetBase = {
  id: slugIdSchema,
  title: z.string().max(DASHBOARD_LIMITS.widgetTitle),
  layout: widgetLayoutSchema,
  /** A subset of the dashboard boards; empty means all of them. */
  boardIds: z.array(idSchema).max(DASHBOARD_LIMITS.boards),
};

/** One widget; `settings` is a per-type shape selected by `type`. */
export const dashboardWidgetSchema = z.discriminatedUnion('type', [
  z.object({ ...widgetBase, type: z.literal('chart'), settings: chartWidgetSettingsSchema }),
  z.object({ ...widgetBase, type: z.literal('numbers'), settings: numbersWidgetSettingsSchema }),
  z.object({ ...widgetBase, type: z.literal('battery'), settings: batteryWidgetSettingsSchema }),
  z.object({ ...widgetBase, type: z.literal('table'), settings: tableWidgetSettingsSchema }),
  z.object({ ...widgetBase, type: z.literal('workload'), settings: workloadWidgetSettingsSchema }),
]);
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

/** The widgets list: at most 24 with unique ids. */
export const dashboardWidgetsSchema = z
  .array(dashboardWidgetSchema)
  .max(DASHBOARD_LIMITS.widgets)
  .refine(
    (list) => new Set(list.map((w) => w.id)).size === list.length,
    'Widget ids must be unique',
  );

/** `dashboards/{dashboardId}` (P6 spec). Stores no item data: widgets read live from the boards. */
export const dashboardSchema = z
  .object({
    workspaceId: idSchema,
    folderId: idSchema.nullable(),
    name: z.string().min(1).max(DASHBOARD_LIMITS.name),
    /** Same access model as boards. */
    kind: boardKindSchema,
    access: z.record(uidSchema, boardRoleSchema),
    /** Always `Object.keys(access)`; rule-enforced so private dashboards can be listed. */
    accessUids: z.array(uidSchema).min(1),
    position: positionSchema,
    icon: iconSchema.nullable(),
    boardIds: z
      .array(idSchema)
      .max(DASHBOARD_LIMITS.boards)
      .refine((ids) => new Set(ids).size === ids.length, 'Board ids must be unique'),
    widgets: dashboardWidgetsSchema,
    state: dashboardStateSchema,
    deletedAt: timestampSchema.nullable(),
    ...auditFields,
    updatedBy: uidSchema.optional(),
  })
  .superRefine((d, ctx) => {
    const allowed = new Set(d.boardIds);
    d.widgets.forEach((w, i) => {
      if (w.boardIds.some((id) => !allowed.has(id))) {
        ctx.addIssue({
          code: 'custom',
          path: ['widgets', i, 'boardIds'],
          message: 'Widget boards must be a subset of the dashboard boards',
        });
      }
    });
  });
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardWrite = WriteDoc<Dashboard>;

/** What the "New dashboard" dialog collects. */
export const createDashboardInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(DASHBOARD_LIMITS.name),
  kind: boardKindSchema.default('main'),
  folderId: idSchema.nullable().default(null),
  boardIds: z.array(idSchema).max(DASHBOARD_LIMITS.boards).default([]),
});
export type CreateDashboardInput = z.input<typeof createDashboardInputSchema>;

/** Default settings for a new widget of each type. */
export function defaultWidgetSettings<T extends DashboardWidgetType>(
  type: T,
): Extract<DashboardWidget, { type: T }>['settings'];
export function defaultWidgetSettings(type: DashboardWidgetType): DashboardWidget['settings'] {
  switch (type) {
    case 'chart':
      return {
        chartType: 'bar',
        xColumnId: null,
        dateBucket: 'month',
        stackColumnId: null,
        yMode: 'count',
        yColumnId: null,
        sortBy: 'board',
        showLegend: true,
        showValues: true,
        showEmpty: true,
      };
    case 'numbers':
      return { mode: 'count', columnId: null, filter: null };
    case 'battery':
      return { statusColumnId: null, doneLabelIds: [] };
    case 'table':
      return { columnIds: [], filter: null, rowLimit: 10 };
    case 'workload':
      return { peopleColumnId: null, dateColumnId: null, bucket: 'week' };
  }
}

/** Default grid size (w, h) for a new widget of each type. */
export const DEFAULT_WIDGET_SIZE: Record<DashboardWidgetType, { w: number; h: number }> = {
  chart: { w: 6, h: 5 },
  numbers: { w: 3, h: 3 },
  battery: { w: 6, h: 3 },
  table: { w: 12, h: 6 },
  workload: { w: 12, h: 6 },
};
