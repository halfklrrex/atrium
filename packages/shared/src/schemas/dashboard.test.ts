import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_LIMITS,
  DASHBOARD_WIDGET_TYPES,
  createDashboardInputSchema,
  dashboardSchema,
  dashboardWidgetSchema,
  defaultWidgetSettings,
  widgetLayoutSchema,
  type TimestampLike,
} from '../index';

const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const widget = (type: (typeof DASHBOARD_WIDGET_TYPES)[number], id = 'w1') => ({
  id,
  type,
  title: 'Widget',
  layout: { x: 0, y: 0, w: 4, h: 3 },
  boardIds: [] as string[],
  settings: defaultWidgetSettings(type),
});

const dashboard = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'w1',
  folderId: null,
  name: 'Overview',
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  boardIds: ['b1', 'b2'],
  widgets: [widget('numbers')],
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
  ...overrides,
});

describe('widget layout', () => {
  it('accepts the grid limits', () => {
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 12, h: 12 }).success).toBe(true);
    expect(widgetLayoutSchema.safeParse({ x: 10, y: 4, w: 2, h: 2 }).success).toBe(true);
  });

  it.each([
    ['w below 2', { x: 0, y: 0, w: 1, h: 3 }],
    ['w above 12', { x: 0, y: 0, w: 13, h: 3 }],
    ['h below 2', { x: 0, y: 0, w: 3, h: 1 }],
    ['h above 12', { x: 0, y: 0, w: 3, h: 13 }],
    ['negative x', { x: -1, y: 0, w: 3, h: 3 }],
    ['past the right edge', { x: 10, y: 0, w: 3, h: 3 }],
    ['fractional', { x: 0.5, y: 0, w: 3, h: 3 }],
    ['extra key', { x: 0, y: 0, w: 3, h: 3, z: 1 }],
  ])('rejects %s', (_label, layout) => {
    expect(widgetLayoutSchema.safeParse(layout).success).toBe(false);
  });
});

describe('widgets', () => {
  it.each(DASHBOARD_WIDGET_TYPES)('accepts a default %s widget', (type) => {
    expect(dashboardWidgetSchema.safeParse(widget(type)).success).toBe(true);
  });

  it('rejects settings of another type', () => {
    expect(
      dashboardWidgetSchema.safeParse({
        ...widget('numbers'),
        settings: defaultWidgetSettings('battery'),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown settings keys (strict per type)', () => {
    const w = widget('table');
    expect(
      dashboardWidgetSchema.safeParse({ ...w, settings: { ...w.settings, extra: 1 } }).success,
    ).toBe(false);
  });

  it('rejects an unknown type, a long title and a bad id', () => {
    expect(dashboardWidgetSchema.safeParse({ ...widget('chart'), type: 'pie' }).success).toBe(
      false,
    );
    expect(
      dashboardWidgetSchema.safeParse({
        ...widget('chart'),
        title: 'x'.repeat(DASHBOARD_LIMITS.widgetTitle + 1),
      }).success,
    ).toBe(false);
    expect(dashboardWidgetSchema.safeParse({ ...widget('chart'), id: 'no spaces' }).success).toBe(
      false,
    );
  });

  it('validates numbers, table and workload settings', () => {
    const numbers = widget('numbers');
    const filter = { columnId: 'status', values: ['1', '2'] };
    expect(
      dashboardWidgetSchema.safeParse({
        ...numbers,
        settings: { mode: 'sum', columnId: 'cost', filter },
      }).success,
    ).toBe(true);
    expect(
      dashboardWidgetSchema.safeParse({
        ...numbers,
        settings: { mode: 'median', columnId: null, filter: null },
      }).success,
    ).toBe(false);
    const table = widget('table');
    expect(
      dashboardWidgetSchema.safeParse({ ...table, settings: { ...table.settings, rowLimit: 11 } })
        .success,
    ).toBe(false);
    expect(
      dashboardWidgetSchema.safeParse({
        ...table,
        settings: { ...table.settings, columnIds: Array.from({ length: 9 }, (_, i) => `c${i}`) },
      }).success,
    ).toBe(false);
    const workload = widget('workload');
    expect(
      dashboardWidgetSchema.safeParse({
        ...workload,
        settings: { ...workload.settings, bucket: 'day' },
      }).success,
    ).toBe(false);
  });

  it('validates chart settings like the Chart view', () => {
    const chart = widget('chart');
    expect(
      dashboardWidgetSchema.safeParse({
        ...chart,
        settings: { ...chart.settings, chartType: 'radar' },
      }).success,
    ).toBe(false);
  });
});

describe('dashboardSchema', () => {
  it('accepts a valid dashboard', () => {
    expect(dashboardSchema.safeParse(dashboard()).success).toBe(true);
  });

  it('accepts a private dashboard with an updatedBy and an empty widget list', () => {
    expect(
      dashboardSchema.safeParse(
        dashboard({ kind: 'private', widgets: [], updatedBy: 'u1', icon: 'D' }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['empty name', { name: '' }],
    ['name over 80', { name: 'x'.repeat(81) }],
    ['unknown kind', { kind: 'public' }],
    ['archived state', { state: 'archived' }],
    ['unknown role', { access: { u1: 'admin' } }],
    ['empty accessUids', { accessUids: [] }],
    ['long icon', { icon: 'toolongicon' }],
    ['missing workspace', { workspaceId: undefined }],
    ['51 boards', { boardIds: Array.from({ length: 51 }, (_, i) => `b${i}`) }],
    ['duplicate boards', { boardIds: ['b1', 'b1'] }],
    ['25 widgets', { widgets: Array.from({ length: 25 }, (_, i) => widget('numbers', `w${i}`)) }],
    ['duplicate widget ids', { widgets: [widget('numbers'), widget('battery')] }],
    [
      'widget board outside the dashboard',
      { widgets: [{ ...widget('numbers'), boardIds: ['zzz'] }] },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(dashboardSchema.safeParse(dashboard(overrides)).success).toBe(false);
  });

  it('accepts exactly 24 widgets and 50 boards', () => {
    const boardIds = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const widgets = Array.from({ length: 24 }, (_, i) => widget('numbers', `w${i}`));
    expect(dashboardSchema.safeParse(dashboard({ boardIds, widgets })).success).toBe(true);
  });

  it('accepts a widget reading a subset of the dashboard boards', () => {
    expect(
      dashboardSchema.safeParse(
        dashboard({ widgets: [{ ...widget('numbers'), boardIds: ['b2'] }] }),
      ).success,
    ).toBe(true);
  });
});

describe('createDashboardInputSchema', () => {
  it('trims and defaults', () => {
    expect(createDashboardInputSchema.parse({ name: '  Plan ' })).toEqual({
      name: 'Plan',
      kind: 'main',
      folderId: null,
      boardIds: [],
    });
  });

  it('rejects an empty name and too many boards', () => {
    expect(createDashboardInputSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      createDashboardInputSchema.safeParse({
        name: 'x',
        boardIds: Array.from({ length: 51 }, (_, i) => `b${i}`),
      }).success,
    ).toBe(false);
  });
});
