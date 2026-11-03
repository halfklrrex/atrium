import { describe, expect, it, vi } from 'vitest';
import { makeActivity } from '../test/activity';
import { ts } from '../test/fixtures';
import {
  MAX_ACTOR_FILTER,
  NO_ACTIVITY_FILTERS,
  activityWhereSpecs,
  hasActivityFilters,
  parseActivity,
  sinceForPreset,
} from './activity';

vi.mock('../lib/firebase', () => ({ db: {} }));

describe('parseActivity', () => {
  const now = 1_700_000_000_000;

  it('keeps valid entries with their ids', () => {
    const { id, ...data } = makeActivity('a1', { expiresAt: ts(now + 1000) });
    expect(parseActivity([{ id, data }], now).map((e) => e.id)).toEqual(['a1']);
  });

  it('drops legacy entries that do not match the schema', () => {
    const legacy = {
      kind: 'button_clicked',
      itemId: 'i1',
      columnId: 'c1',
      userId: 'u1',
      createdAt: ts(now),
      data: { itemName: 'x', columnLabel: 'y' },
    };
    expect(parseActivity([{ id: 'old', data: legacy }], now)).toEqual([]);
  });

  it('drops entries past their expiry', () => {
    const { id, ...data } = makeActivity('a2', { expiresAt: ts(now - 1) });
    expect(parseActivity([{ id, data }], now)).toEqual([]);
  });
});

describe('activityWhereSpecs', () => {
  it('builds no clauses without filters', () => {
    expect(activityWhereSpecs(NO_ACTIVITY_FILTERS)).toEqual([]);
    expect(hasActivityFilters(NO_ACTIVITY_FILTERS)).toBe(false);
  });

  it('uses == for one person and in for several, capped at ten', () => {
    expect(activityWhereSpecs({ ...NO_ACTIVITY_FILTERS, actorIds: ['u1'] })).toEqual([
      { field: 'actorId', op: '==', value: 'u1' },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => `u${i}`);
    const [spec] = activityWhereSpecs({ ...NO_ACTIVITY_FILTERS, actorIds: many });
    expect(spec?.op).toBe('in');
    expect(spec?.value).toHaveLength(MAX_ACTOR_FILTER);
  });

  it('adds the column and the date lower bound', () => {
    const since = new Date(2026, 9, 1);
    const filters = { actorIds: ['u1', 'u2'], columnId: 'status', since };
    expect(activityWhereSpecs(filters)).toEqual([
      { field: 'actorId', op: 'in', value: ['u1', 'u2'] },
      { field: 'columnId', op: '==', value: 'status' },
      { field: 'createdAt', op: '>=', value: since },
    ]);
    expect(hasActivityFilters(filters)).toBe(true);
  });
});

describe('sinceForPreset', () => {
  const now = new Date(2026, 10, 3, 15, 30);
  it('maps the presets to the start of the window', () => {
    expect(sinceForPreset('all', now)).toBeNull();
    expect(sinceForPreset('today', now)).toEqual(new Date(2026, 10, 3));
    expect(sinceForPreset('7d', now)?.getTime()).toBe(now.getTime() - 7 * 86_400_000);
    expect(sinceForPreset('30d', now)?.getTime()).toBe(now.getTime() - 30 * 86_400_000);
  });
});
