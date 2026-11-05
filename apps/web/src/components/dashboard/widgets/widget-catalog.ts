import { defaultWidgetSettings, type DashboardWidgetType } from '@atrium/shared';

export interface WidgetTypeInfo {
  type: DashboardWidgetType;
  label: string;
  hint: string;
  /** False while the widget is not built yet; the dialog lists it as "Coming soon". */
  available: boolean;
}

/** Widget types in the order the Add widget dialog lists them. */
export const WIDGET_TYPES: readonly WidgetTypeInfo[] = [
  { type: 'numbers', label: 'Numbers', hint: 'Count, sum, average, min or max', available: true },
  { type: 'battery', label: 'Battery', hint: 'Progress by status', available: true },
  { type: 'chart', label: 'Chart', hint: 'Bars, lines and pies', available: true },
  { type: 'table', label: 'Table', hint: 'Items from several boards', available: true },
  { type: 'workload', label: 'Workload', hint: 'Items per person', available: true },
];

export const DEFAULT_WIDGET_TITLE: Record<DashboardWidgetType, string> = {
  chart: 'Chart',
  numbers: 'Numbers',
  battery: 'Battery',
  table: 'Table',
  workload: 'Workload',
};

export { defaultWidgetSettings };

/**
 * Smallest grid size (columns, rows) a resize may reach per widget type, so content stays
 * readable: a Numbers tile fits in 2x2, the others need room for a title, a header and a row.
 * The schema allows 2x2 for all; this is only the UI's floor.
 */
export const WIDGET_MIN_SIZE: Record<DashboardWidgetType, { w: number; h: number }> = {
  numbers: { w: 2, h: 2 },
  battery: { w: 3, h: 2 },
  chart: { w: 4, h: 3 },
  table: { w: 4, h: 3 },
  workload: { w: 4, h: 3 },
};

/** `size` raised to the widget type's minimum. */
export function atLeastMinSize(
  type: DashboardWidgetType,
  size: { w: number; h: number },
): { w: number; h: number } {
  const min = WIDGET_MIN_SIZE[type];
  return { w: Math.max(size.w, min.w), h: Math.max(size.h, min.h) };
}
