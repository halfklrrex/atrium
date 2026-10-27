import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../schemas/board';
import {
  autoNumberColumn,
  columnRegistry,
  computeCreationLog,
  computeItemId,
  computeLastUpdated,
  computeProgress,
  creationLogColumn,
  formatItemId,
  itemIdColumn,
  lastUpdatedColumn,
  progressColumn,
  timestampToIso,
  type ColumnContext,
} from './index';

const autoDef: ColumnDef = {
  id: 'c_auto',
  type: 'auto_number',
  title: 'Auto',
  position: 'a0',
  settings: {},
};

describe('progress column', () => {
  const settings = {
    related_columns: {
      isNormalized: true,
      columns: {
        col_status_1: { isSelected: true, percentage: 50 },
        col_status_2: { isSelected: true, percentage: 50 },
        col_status_3: { isSelected: false, percentage: 0 },
      },
    },
  };

  it('validates settings schema with related_columns and rejects unknown keys', () => {
    expect(progressColumn.settingsSchema.safeParse(settings).success).toBe(true);
    expect(progressColumn.settingsSchema.safeParse({}).success).toBe(false);
    expect(progressColumn.settingsSchema.safeParse({ ...settings, extra: true }).success).toBe(
      false,
    );
  });

  it('validates value schema: accepts { progress: int 0..100 } and rejects legacy forms', () => {
    expect(progressColumn.valueSchema.safeParse({ progress: 75 }).success).toBe(true);
    expect(progressColumn.valueSchema.safeParse({ progress: 0 }).success).toBe(true);
    expect(progressColumn.valueSchema.safeParse({ progress: 100 }).success).toBe(true);
    // Rejects outside 0..100
    expect(progressColumn.valueSchema.safeParse({ progress: -1 }).success).toBe(false);
    expect(progressColumn.valueSchema.safeParse({ progress: 101 }).success).toBe(false);
    // Rejects bare numbers or { percent }
    expect(progressColumn.valueSchema.safeParse(75).success).toBe(false);
    expect(progressColumn.valueSchema.safeParse({ percent: 75 }).success).toBe(false);
  });

  it('computes progress correctly by index matching', () => {
    const statusColumns = {
      col_status_1: {
        labels: [
          { id: 'l1', index: 1, label: 'Done', color: '#00c875', isDone: true },
          { id: 'l2', index: 2, label: 'Working', color: '#fdab3d', isDone: false },
        ],
      },
      col_status_2: {
        labels: [
          { id: 'l3', index: 1, label: 'Complete', color: '#00c875', isDone: true },
          { id: 'l4', index: 2, label: 'Pending', color: '#e2445c', isDone: false },
        ],
      },
    };

    // Both done: 100%
    const itemBothDone = {
      values: {
        col_status_1: { index: 1 },
        col_status_2: { index: 1 },
      },
    };
    expect(computeProgress(itemBothDone, settings, statusColumns)).toBe(100);

    // One done: 50%
    const itemOneDone = {
      values: {
        col_status_1: { index: 1 },
        col_status_2: { index: 2 },
      },
    };
    expect(computeProgress(itemOneDone, settings, statusColumns)).toBe(50);

    // Neither done: 0%
    const itemNoneDone = {
      values: {
        col_status_1: { index: 2 },
        col_status_2: { index: 2 },
      },
    };
    expect(computeProgress(itemNoneDone, settings, statusColumns)).toBe(0);
  });

  it('computes progress by label-text match through findStatusLabel', () => {
    const statusColumns = {
      col_status_1: {
        labels: [
          { id: 'l1', index: 1, label: 'Done', color: '#00c875', isDone: true },
          { id: 'l2', index: 2, label: 'Working', color: '#fdab3d', isDone: false },
        ],
      },
      col_status_2: {
        labels: [{ id: 'l3', index: 1, label: 'Done', color: '#00c875', isDone: true }],
      },
    };

    // Label text match (case-insensitive trim)
    const item = {
      values: {
        col_status_1: { label: '  done  ' },
        col_status_2: { label: 'Done' },
      },
    };
    expect(computeProgress(item, settings, statusColumns)).toBe(100);
  });

  it('computes progress with isNormalized: false and custom weights', () => {
    const weightedSettings = {
      related_columns: {
        isNormalized: false,
        columns: {
          col_status_1: { isSelected: true, percentage: 80 },
          col_status_2: { isSelected: true, percentage: 20 },
        },
      },
    };
    const statusColumns = {
      col_status_1: {
        labels: [{ id: 'l1', index: 1, label: 'Done', color: '#00c875', isDone: true }],
      },
      col_status_2: {
        labels: [{ id: 'l2', index: 1, label: 'Done', color: '#00c875', isDone: true }],
      },
    };

    // Only col_status_1 (80% weight) is done
    const item1 = { values: { col_status_1: { index: 1 }, col_status_2: { index: 99 } } };
    expect(computeProgress(item1, weightedSettings, statusColumns)).toBe(80);

    // Only col_status_2 (20% weight) is done
    const item2 = { values: { col_status_1: { index: 99 }, col_status_2: { index: 1 } } };
    expect(computeProgress(item2, weightedSettings, statusColumns)).toBe(20);
  });

  it('handles edge cases: no selected columns, missing column, invalid cell values', () => {
    // No selected columns returns 0
    const noColsSettings = {
      related_columns: { isNormalized: true, columns: {} },
    };
    expect(computeProgress({ values: {} }, noColsSettings)).toBe(0);

    // Missing column in item.values
    const statusCols = {
      col_status_1: {
        labels: [{ id: 'l1', index: 1, label: 'Done', color: '#00c875', isDone: true }],
      },
    };
    expect(computeProgress({ values: {} }, settings, statusCols)).toBe(0);

    // Invalid cell values (non-status shapes, malformed)
    const malformedItem = {
      values: {
        col_status_1: 'bare string',
        col_status_2: { foo: 'bar' },
      },
    };
    expect(computeProgress(malformedItem, settings, statusCols)).toBe(0);
  });

  it('toText formats percentage and compare sorts numerically', () => {
    const p1 = { progress: 25 };
    const p2 = { progress: 80 };
    expect(progressColumn.toText(p1, settings)).toBe('25%');
    expect(progressColumn.compare(p1, p2, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('progress', { progress: 60 });
    expect(parsed).toEqual({ success: true, data: { progress: 60 } });
    if (parsed.success) {
      expect(columnRegistry.toText('progress', parsed.data, settings)).toBe('60%');
    }
  });
});

describe('auto_number column', () => {
  const settings = { scope: 'board' as const, prefix: 'REQ-', order: 'ascending' as const };

  it('validates settings and rejects unknown keys', () => {
    expect(
      autoNumberColumn.settingsSchema.safeParse({
        scope: 'group',
        prefix: 'TASK-',
        order: 'ascending',
      }).success,
    ).toBe(true);
    expect(autoNumberColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('accepts strictly { auto_number: int >= 0 } and rejects legacy forms', () => {
    expect(autoNumberColumn.valueSchema.safeParse({ auto_number: 42 }).success).toBe(true);
    expect(autoNumberColumn.valueSchema.safeParse({ auto_number: 0 }).success).toBe(true);
    expect(autoNumberColumn.valueSchema.safeParse({ auto_number: -1 }).success).toBe(false);
    expect(autoNumberColumn.valueSchema.safeParse({ value: 42 }).success).toBe(false);
    expect(autoNumberColumn.valueSchema.safeParse(42).success).toBe(false);
  });

  it('formats prefix in toText and compares numerically', () => {
    const val1 = { auto_number: 5 };
    const val2 = { auto_number: 10 };
    expect(autoNumberColumn.toText(val1, settings)).toBe('REQ-5');
    expect(autoNumberColumn.compare(val1, val2, settings)).toBeLessThan(0);
  });

  it('is derived: computes from boardSeq and is empty while the server has not assigned it', () => {
    expect(autoNumberColumn.derived).toBe(true);
    const ctx = (boardSeq?: number): ColumnContext => ({
      boardId: 'b1',
      item: { id: 'i1', values: { stale: { auto_number: 99 } }, boardSeq },
      columns: [],
    });
    expect(autoNumberColumn.compute?.(ctx(7), settings)).toEqual({ auto_number: 7 });
    expect(autoNumberColumn.compute?.(ctx(), settings)).toBeNull();
    expect(columnRegistry.validateCell(autoDef, { auto_number: 3 }).ok).toBe(false);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('auto_number', { auto_number: 100 });
    expect(parsed).toEqual({ success: true, data: { auto_number: 100 } });
    if (parsed.success) {
      expect(columnRegistry.toText('auto_number', parsed.data, { prefix: '#' })).toBe('#100');
    }
  });
});

describe('item_id column', () => {
  it('validates settings: displayType id and customKey with superRefine', () => {
    expect(itemIdColumn.settingsSchema.safeParse({ displayType: 'id' }).success).toBe(true);
    expect(
      itemIdColumn.settingsSchema.safeParse({
        displayType: 'customKey',
        customKeySettings: { prefix: 'ITEM-' },
      }).success,
    ).toBe(true);

    // customKey requires customKeySettings
    expect(itemIdColumn.settingsSchema.safeParse({ displayType: 'customKey' }).success).toBe(false);
    expect(itemIdColumn.settingsSchema.safeParse({ displayType: 'invalid' }).success).toBe(false);
    expect(itemIdColumn.settingsSchema.safeParse({ unknownKey: 1 }).success).toBe(false);
  });

  it('formats item ID with formatItemId and computeItemId consistently', () => {
    const customSettings = {
      displayType: 'customKey' as const,
      customKeySettings: { prefix: 'ATRIUM-' },
    };
    expect(formatItemId('42', customSettings)).toBe('ATRIUM-42');
    expect(formatItemId('42', { displayType: 'id' })).toBe('42');
    // The computed value is the bare number; the prefix is applied when displayed.
    expect(computeItemId({ seq: 42 }, customSettings)).toBe('42');
    expect(computeItemId({ seq: 42 })).toBe('42');
  });

  it('computes from seq and is empty while the server has not assigned it', () => {
    expect(itemIdColumn.derived).toBe(true);
    const ctx = (seq?: number): ColumnContext => ({
      boardId: 'b1',
      item: { id: 'randomFirestoreId', values: {}, seq },
      columns: [],
    });
    expect(itemIdColumn.compute?.(ctx(12), { displayType: 'id' })).toBe('12');
    expect(itemIdColumn.compute?.(ctx(), { displayType: 'id' })).toBeNull();
  });

  it('compares numerically when /^\\d+$/ matches and compares non-digits as strings', () => {
    const settings = itemIdColumn.defaultSettings();
    // Numeric compare: '2' < '10' (alphabetically '10' < '2')
    expect(itemIdColumn.compare('2', '10', settings)).toBeLessThan(0);
    expect(itemIdColumn.compare('100', '25', settings)).toBeGreaterThan(0);

    // Non-decimal-digit strings: '0x10' vs '2' (0x10 has non-digits, should not parse as hex 16)
    expect(itemIdColumn.compare('0x10', '2', settings)).toBeLessThan(0);
    expect(itemIdColumn.compare('abc', 'def', settings)).toBeLessThan(0);
    expect(itemIdColumn.compare('', '5', settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const parsed = columnRegistry.parseValue('item_id', '123');
    expect(parsed).toEqual({ success: true, data: '123' });
    if (parsed.success) {
      expect(
        columnRegistry.toText('item_id', parsed.data, {
          displayType: 'customKey',
          customKeySettings: { prefix: '#' },
        }),
      ).toBe('#123');
    }
  });
});

describe('timestampToIso helper', () => {
  it('parses ISO strings, Date objects, and {toDate()} objects', () => {
    const iso = '2026-10-24T12:00:00.000Z';
    expect(timestampToIso(iso)).toBe(iso);

    const d = new Date(iso);
    expect(timestampToIso(d)).toBe(iso);

    const firestoreTimestamp = { toDate: () => new Date(iso) };
    expect(timestampToIso(firestoreTimestamp)).toBe(iso);
  });

  it('returns null for null, undefined, invalid dates, and faulty toDate objects', () => {
    expect(timestampToIso(null)).toBeNull();
    expect(timestampToIso(undefined)).toBeNull();
    expect(timestampToIso('not-a-date')).toBeNull();
    expect(timestampToIso(new Date(NaN))).toBeNull();
    expect(timestampToIso({ toDate: () => 'not-a-date-object' })).toBeNull();
    expect(
      timestampToIso({
        toDate: () => {
          throw new Error('fail');
        },
      }),
    ).toBeNull();
  });
});

describe('creation_log column', () => {
  it('validates settings with mode (personOnly | dateOnly | personAndDate)', () => {
    expect(creationLogColumn.settingsSchema.safeParse({ mode: 'personAndDate' }).success).toBe(
      true,
    );
    expect(creationLogColumn.settingsSchema.safeParse({ mode: 'dateOnly' }).success).toBe(true);
    expect(creationLogColumn.settingsSchema.safeParse({ mode: 'personOnly' }).success).toBe(true);
    expect(creationLogColumn.settingsSchema.safeParse({ mode: 'invalid' }).success).toBe(false);
  });

  it('validates ISO datetime and rejects invalid timestamps or invalid creator_id', () => {
    expect(
      creationLogColumn.valueSchema.safeParse({
        created_at: '2026-10-24T12:00:00.000Z',
        creator_id: 'u123',
      }).success,
    ).toBe(true);
    expect(
      creationLogColumn.valueSchema.safeParse({ created_at: '2026-10-24T12:00:00.000Z' }).success,
    ).toBe(true);

    // Invalid ISO datetime
    expect(creationLogColumn.valueSchema.safeParse({ created_at: 'not-a-date' }).success).toBe(
      false,
    );
    expect(creationLogColumn.valueSchema.safeParse({ created_at: '2026-13-45' }).success).toBe(
      false,
    );

    // Invalid creator_id (empty string or too long)
    expect(
      creationLogColumn.valueSchema.safeParse({
        created_at: '2026-10-24T12:00:00.000Z',
        creator_id: '',
      }).success,
    ).toBe(false);
  });

  it('computes creation log from item metadata, {toDate} objects, or returns null when pending', () => {
    const itemIso = {
      createdAt: '2026-10-24T10:00:00.000Z',
      createdBy: 'user_456',
    };
    expect(computeCreationLog(itemIso)).toEqual({
      created_at: '2026-10-24T10:00:00.000Z',
      creator_id: 'user_456',
    });

    const itemToDate = {
      createdAt: { toDate: () => new Date('2026-10-24T10:00:00.000Z') },
      createdBy: 'user_456',
    };
    expect(computeCreationLog(itemToDate)).toEqual({
      created_at: '2026-10-24T10:00:00.000Z',
      creator_id: 'user_456',
    });

    // Pending server timestamp (null createdAt) returns null
    expect(computeCreationLog({ createdAt: null, createdBy: 'u1' })).toBeNull();
  });

  it('toText respects mode setting', () => {
    const val = { created_at: '2026-10-24T10:00:00.000Z', creator_id: 'user_1' };
    expect(creationLogColumn.toText(val, { mode: 'dateOnly' })).toBe('2026-10-24T10:00:00.000Z');
    expect(creationLogColumn.toText(val, { mode: 'personOnly' })).toBe('user_1');
    expect(creationLogColumn.toText(val, { mode: 'personAndDate' })).toBe(
      '2026-10-24T10:00:00.000Z by user_1',
    );
  });

  it('round-trips through registry parseValue and toText', () => {
    const raw = { created_at: '2026-10-24T12:00:00.000Z', creator_id: 'u1' };
    const parsed = columnRegistry.parseValue('creation_log', raw);
    expect(parsed).toEqual({ success: true, data: raw });
    if (parsed.success) {
      expect(columnRegistry.toText('creation_log', parsed.data, { mode: 'dateOnly' })).toBe(
        '2026-10-24T12:00:00.000Z',
      );
    }
  });
});

describe('last_updated column', () => {
  const settings = { mode: 'personOnly' as const };

  it('validates settings with mode and rejects unknown keys', () => {
    expect(lastUpdatedColumn.settingsSchema.safeParse({ mode: 'dateOnly' }).success).toBe(true);
    expect(lastUpdatedColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('validates ISO datetime and rejects invalid timestamps or invalid updater_id', () => {
    expect(
      lastUpdatedColumn.valueSchema.safeParse({
        updated_at: '2026-10-24T14:30:00.000Z',
        updater_id: 'u789',
      }).success,
    ).toBe(true);
    expect(lastUpdatedColumn.valueSchema.safeParse({ updated_at: 'bad-date' }).success).toBe(false);
    expect(
      lastUpdatedColumn.valueSchema.safeParse({
        updated_at: '2026-10-24T14:30:00.000Z',
        updater_id: '',
      }).success,
    ).toBe(false);
  });

  it('computes last updated from item metadata, {toDate} objects, or returns null when pending', () => {
    const item = {
      updatedAt: '2026-10-24T15:00:00.000Z',
      updatedBy: 'u_updater',
    };
    expect(computeLastUpdated(item)).toEqual({
      updated_at: '2026-10-24T15:00:00.000Z',
      updater_id: 'u_updater',
    });

    const itemToDate = {
      updatedAt: { toDate: () => new Date('2026-10-24T15:00:00.000Z') },
      updatedBy: 'u_updater',
    };
    expect(computeLastUpdated(itemToDate)).toEqual({
      updated_at: '2026-10-24T15:00:00.000Z',
      updater_id: 'u_updater',
    });

    // Pending server timestamp (null updatedAt) returns null
    expect(computeLastUpdated({ updatedAt: null, updatedBy: 'u1' })).toBeNull();
  });

  it('toText respects mode setting and compare sorts chronologically', () => {
    const u1 = { updated_at: '2026-10-24T10:00:00.000Z', updater_id: 'u1' };
    const u2 = { updated_at: '2026-10-24T12:00:00.000Z', updater_id: 'u2' };
    expect(lastUpdatedColumn.toText(u1, settings)).toBe('u1');
    expect(lastUpdatedColumn.compare(u1, u2, settings)).toBeLessThan(0);
  });

  it('round-trips through registry parseValue and toText', () => {
    const raw = { updated_at: '2026-10-24T12:00:00.000Z' };
    const parsed = columnRegistry.parseValue('last_updated', raw);
    expect(parsed).toEqual({ success: true, data: raw });
    if (parsed.success) {
      expect(columnRegistry.toText('last_updated', parsed.data, { mode: 'dateOnly' })).toBe(
        '2026-10-24T12:00:00.000Z',
      );
    }
  });
});
