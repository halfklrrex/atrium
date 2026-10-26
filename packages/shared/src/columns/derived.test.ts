import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ColumnDef } from '../schemas/board';
import {
  DERIVED_WRITE_MESSAGE,
  SERVER_MANAGED_WRITE_MESSAGE,
  ColumnTypeRegistry,
  columnRegistry,
  createColumnRegistry,
  defineColumnType,
  type ColumnContext,
} from './index';

// Test-only types: no production column type is derived yet.
const itemIdLike = defineColumnType<Record<string, never>, string>({
  type: 'test_item_id',
  label: 'Test item ID',
  derived: true,
  settingsSchema: z.object({}).strict(),
  valueSchema: z.string(),
  defaultSettings: () => ({}),
  toText: (v) => v,
  compare: (a, b) => a.localeCompare(b),
  compute: (ctx) => ctx.item.id,
});

// Test-only server-managed type: stores a value, but only Cloud Functions write it.
const managedLike = defineColumnType<Record<string, never>, { total: number }>({
  type: 'test_managed',
  label: 'Test managed',
  serverManaged: true,
  settingsSchema: z.object({}).strict(),
  valueSchema: z.object({ total: z.number() }),
  defaultSettings: () => ({}),
  toText: (v) => String(v.total),
  compare: (a, b) => a.total - b.total,
});

const capped = defineColumnType<{ max: number }, { n: number }>({
  type: 'test_capped',
  label: 'Test capped',
  settingsSchema: z.object({ max: z.number() }),
  valueSchema: z.object({ n: z.number() }),
  defaultSettings: () => ({ max: 3 }),
  toText: (v) => String(v.n),
  compare: (a, b) => a.n - b.n,
  validateValue: (v, s) =>
    v.n <= s.max ? { ok: true } : { ok: false, message: `Must be at most ${s.max}` },
});

const registry = createColumnRegistry().register(itemIdLike).register(managedLike).register(capped);

const def = (type: string, id = 'c1', settings: Record<string, unknown> = {}): ColumnDef => ({
  id,
  type,
  title: id,
  position: 'a0',
  settings,
});

const ctxFor = (columns: ColumnDef[], values: Record<string, unknown> = {}): ColumnContext => ({
  boardId: 'b1',
  item: { id: 'item-7', values },
  columns,
});

describe('derived column framework', () => {
  it('flags production derived types', () => {
    expect(
      columnRegistry
        .list()
        .filter((t) => t.derived)
        .map((t) => t.type)
        .sort(),
    ).toEqual(['creation_log', 'item_id', 'last_updated', 'progress']);
    expect(columnRegistry.derivedColumnIds([def('text'), def('status', 'c2')])).toEqual([]);
    expect(
      columnRegistry.derivedColumnIds([def('text'), def('progress', 'c1'), def('item_id', 'c2')]),
    ).toEqual(['c1', 'c2']);
  });

  it('refuses to register a derived type without compute()', () => {
    const broken = { ...itemIdLike, type: 'broken', compute: undefined };
    expect(() => new ColumnTypeRegistry().register(broken)).toThrow(/must define compute/);
  });

  it('isDerived is true only for derived types and false for unknown ones', () => {
    expect(registry.isDerived('test_item_id')).toBe(true);
    expect(registry.isDerived('text')).toBe(false);
    expect(registry.isDerived('nope')).toBe(false);
  });

  it('computeValue calls compute for derived types and returns null otherwise', () => {
    const columns = [def('test_item_id'), def('text', 'c2')];
    const ctx = ctxFor(columns);
    expect(registry.computeValue(columns[0]!, ctx)).toBe('item-7');
    expect(registry.computeValue(columns[1]!, ctx)).toBeNull();
    expect(registry.computeValue(def('nope'), ctx)).toBeNull();
    expect(registry.computeValue(def('test_item_id', 'c1', { extra: 1 }), ctx)).toBeNull();
  });

  it('derivedColumnIds lists derived columns in order and skips unknown types', () => {
    const columns = [
      def('text', 'a'),
      def('test_item_id', 'b'),
      def('nope', 'c'),
      def('test_item_id', 'd'),
    ];
    expect(registry.derivedColumnIds(columns)).toEqual(['b', 'd']);
    expect(registry.derivedColumnIds([])).toEqual([]);
  });
});

describe('server-managed column framework (FW2)', () => {
  it('flags exactly the production types written only by Cloud Functions', () => {
    expect(
      columnRegistry
        .list()
        .filter((t) => t.serverManaged)
        .map((t) => t.type),
    ).toEqual(['button', 'files', 'time_tracking']);
  });

  it('isServerManaged is true only for flagged types and false for unknown ones', () => {
    expect(registry.isServerManaged('test_managed')).toBe(true);
    expect(registry.isServerManaged('test_item_id')).toBe(false);
    expect(registry.isServerManaged('text')).toBe(false);
    expect(registry.isServerManaged('nope')).toBe(false);
    expect(columnRegistry.isServerManaged('button')).toBe(true);
  });

  it('serverManagedColumnIds lists flagged columns in order and skips the rest', () => {
    const columns = [
      def('text', 'a'),
      def('test_managed', 'b'),
      def('test_item_id', 'c'),
      def('nope', 'd'),
      def('test_managed', 'e'),
    ];
    expect(registry.serverManagedColumnIds(columns)).toEqual(['b', 'e']);
    expect(registry.serverManagedColumnIds([])).toEqual([]);
    // Derived columns are a different list.
    expect(registry.derivedColumnIds(columns)).toEqual(['c']);
  });
});

describe('validateCell', () => {
  it('rejects every client write to a server-managed column, empty and valid ones included', () => {
    const column = def('test_managed');
    for (const value of [{ total: 3 }, 'x', null, undefined]) {
      expect(registry.validateCell(column, value)).toEqual({
        ok: false,
        message: SERVER_MANAGED_WRITE_MESSAGE,
      });
    }
    expect(SERVER_MANAGED_WRITE_MESSAGE).toBe('This column is updated by Atrium automatically');
    expect(columnRegistry.validateCell(def('button'), {})).toEqual({
      ok: false,
      message: SERVER_MANAGED_WRITE_MESSAGE,
    });
  });

  it('keeps the derived message for derived types', () => {
    expect(registry.validateCell(def('test_item_id'), 'x')).toEqual({
      ok: false,
      message: DERIVED_WRITE_MESSAGE,
    });
  });

  it('rejects every write to a derived column, empty ones included', () => {
    const column = def('test_item_id');
    for (const value of ['x', 5, null, undefined]) {
      expect(registry.validateCell(column, value)).toEqual({
        ok: false,
        message: DERIVED_WRITE_MESSAGE,
      });
    }
    expect(DERIVED_WRITE_MESSAGE).toBe('This column is calculated automatically');
  });

  it('accepts empty cells and schema-valid values', () => {
    expect(registry.validateCell(def('text'), null)).toEqual({ ok: true });
    expect(registry.validateCell(def('text'), 'hello')).toEqual({ ok: true });
  });

  it('rejects values that fail the schema with a readable message', () => {
    const result = registry.validateCell(def('text'), 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it('runs validateValue with the column settings after the schema', () => {
    const column = def('test_capped', 'c1', { max: 5 });
    expect(registry.validateCell(column, { n: 5 })).toEqual({ ok: true });
    expect(registry.validateCell(column, { n: 6 })).toEqual({
      ok: false,
      message: 'Must be at most 5',
    });
    expect(registry.validateCell(column, { n: 'x' }).ok).toBe(false);
  });

  it('falls back to default settings when stored settings are invalid', () => {
    expect(registry.validateCell(def('test_capped', 'c1', {}), { n: 3 })).toEqual({ ok: true });
    expect(registry.validateCell(def('test_capped', 'c1', {}), { n: 4 }).ok).toBe(false);
  });

  it('reports unknown column types instead of throwing', () => {
    const result = registry.validateCell(def('nope'), 'x');
    expect(result.ok).toBe(false);
  });
});
