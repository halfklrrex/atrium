import { describe, expect, it } from 'vitest';
import {
  VIEW_LIMITS,
  boardViewSchema,
  defaultViewSettings,
  uniqueViewName,
  viewSettingsSchema,
  type TimestampLike,
} from '../index';

const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

describe('board view schemas', () => {
  const baseView = () => ({
    name: 'Due this week',
    type: 'table' as const,
    position: 'a1',
    ownerId: null,
    settings: defaultViewSettings(),
    createdAt: ts(),
    createdBy: 'u1',
    updatedAt: ts(),
    updatedBy: 'u1',
  });

  it('accepts a shared table view and a personal one', () => {
    expect(boardViewSchema.safeParse(baseView()).success).toBe(true);
    expect(boardViewSchema.safeParse({ ...baseView(), ownerId: 'u1' }).success).toBe(true);
  });

  it('accepts saved filters, sorts and hidden columns', () => {
    const settings = {
      filter: {
        personIds: ['u1'],
        filterGroup: {
          conjunction: 'or' as const,
          conditions: [{ columnId: 'status', operator: 'is' as const, value: 'Done' }],
        },
        sortConditions: [{ columnId: 'date', direction: 'desc' as const }],
        groupByColumnId: 'status',
      },
      hiddenColumnIds: ['notes'],
    };
    expect(viewSettingsSchema.parse(settings)).toMatchObject({ hiddenColumnIds: ['notes'] });
  });

  it('rejects empty and over-long names and unknown types', () => {
    expect(boardViewSchema.safeParse({ ...baseView(), name: '' }).success).toBe(false);
    expect(boardViewSchema.safeParse({ ...baseView(), name: 'x'.repeat(61) }).success).toBe(false);
    expect(boardViewSchema.safeParse({ ...baseView(), type: 'chart' }).success).toBe(false);
  });

  it('enforces the size caps', () => {
    const settings = defaultViewSettings();
    const tooManyConditions = Array.from({ length: VIEW_LIMITS.conditions + 1 }, () => ({
      columnId: 'c',
      operator: 'is_empty' as const,
    }));
    expect(
      viewSettingsSchema.safeParse({
        ...settings,
        filter: {
          ...settings.filter,
          filterGroup: { conjunction: 'and', conditions: tooManyConditions },
        },
      }).success,
    ).toBe(false);
    expect(
      viewSettingsSchema.safeParse({
        ...settings,
        filter: {
          ...settings.filter,
          sortConditions: Array.from({ length: VIEW_LIMITS.sorts + 1 }, () => ({
            columnId: 'c',
            direction: 'asc',
          })),
        },
      }).success,
    ).toBe(false);
    expect(
      viewSettingsSchema.safeParse({
        ...settings,
        hiddenColumnIds: Array.from({ length: VIEW_LIMITS.hiddenColumns + 1 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false);
    expect(
      viewSettingsSchema.safeParse({
        ...settings,
        filter: {
          ...settings.filter,
          personIds: Array.from({ length: VIEW_LIMITS.persons + 1 }, (_, i) => `u${i}`),
        },
      }).success,
    ).toBe(false);
  });

  it('names new views uniquely', () => {
    expect(uniqueViewName('Table', ['Main table'])).toBe('Table');
    expect(uniqueViewName('Table', ['Table'])).toBe('Table 2');
    expect(uniqueViewName('Table', ['table', 'Table 2'])).toBe('Table 3');
  });
});
