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
  { type: 'workload', label: 'Workload', hint: 'Items per person', available: false },
];

export const DEFAULT_WIDGET_TITLE: Record<DashboardWidgetType, string> = {
  chart: 'Chart',
  numbers: 'Numbers',
  battery: 'Battery',
  table: 'Table',
  workload: 'Workload',
};

export { defaultWidgetSettings };
