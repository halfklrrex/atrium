import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ColumnTypeRegistry,
  UnknownColumnTypeError,
  columnRegistry,
  createColumnRegistry,
  defineColumnType,
  findStatusLabel,
  statusColumn,
  statusSettingsSchema,
  textColumn,
} from './index';

describe('ColumnTypeRegistry', () => {
  it('ships the full P1 and P2 column sets in the default registry', () => {
    expect(columnRegistry.list().map((t) => t.type)).toEqual([
      'text',
      'status',
      'people',
      'date',
      'numbers',
      'dropdown',
      'checkbox',
      'link',
      'long_text',
      'tags',
      'rating',
      'vote',
      'color_picker',
      'country',
      'location',
      'email',
      'phone',
      'dependency',
      'progress',
      'auto_number',
      'item_id',
      'creation_log',
      'last_updated',
      'board_relation',
      'mirror',
      'button',
      'files',
      'formula',
      'timeline',
      'week',
      'hour',
      'world_clock',
      'time_tracking',
    ]);
    expect(columnRegistry.has('formula')).toBe(true);
  });

  it('throws UnknownColumnTypeError for unregistered types', () => {
    expect(() => columnRegistry.get('nope')).toThrow(UnknownColumnTypeError);
    expect(columnRegistry.find('nope')).toBeUndefined();
  });

  it('refuses duplicate registration', () => {
    const registry = new ColumnTypeRegistry().register(textColumn);
    expect(() => registry.register(textColumn)).toThrow(/already registered/);
  });

  it('supports registering custom types with their own generics', () => {
    const weight = defineColumnType({
      type: 'weight',
      label: 'Weight',
      settingsSchema: z.object({ unit: z.string() }),
      valueSchema: z.number(),
      defaultSettings: () => ({ unit: '' }),
      toText: (v, s) => `${v}${s.unit}`,
      compare: (a, b) => a - b,
    });
    const registry = createColumnRegistry().register(weight);
    expect(registry.toText('weight', 5, { unit: 'kg' })).toBe('5kg');
    expect(registry.compare('weight', 1, 2, { unit: '' })).toBeLessThan(0);
  });

  it('treats null/undefined as an empty, always-valid cell', () => {
    expect(columnRegistry.parseValue('status', null)).toEqual({ success: true, data: null });
    expect(columnRegistry.parseValue('text', undefined)).toEqual({ success: true, data: null });
    expect(columnRegistry.toText('status', null, columnRegistry.defaultSettings('status'))).toBe(
      '',
    );
  });

  it('reports a readable error for invalid values and settings', () => {
    const badValue = columnRegistry.parseValue('text', 42);
    expect(badValue.success).toBe(false);
    const badSettings = columnRegistry.parseSettings('status', { labels: [] });
    expect(badSettings.success).toBe(false);
    if (!badSettings.success) expect(badSettings.error).toContain('labels');
  });

  it('sorts empty cells last regardless of direction of the comparator', () => {
    const settings = columnRegistry.defaultSettings('text');
    expect(columnRegistry.compare('text', null, 'a', settings)).toBe(1);
    expect(columnRegistry.compare('text', 'a', undefined, settings)).toBe(-1);
    expect(columnRegistry.compare('text', null, null, settings)).toBe(0);
  });
});

describe('text column', () => {
  const settings = textColumn.defaultSettings();

  it('has empty default settings and accepts only strict empty settings', () => {
    expect(settings).toEqual({});
    expect(textColumn.settingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('accepts strings only', () => {
    expect(textColumn.valueSchema.safeParse('hello').success).toBe(true);
    expect(textColumn.valueSchema.safeParse({ text: 'hello' }).success).toBe(false);
  });

  it('renders and sorts naturally', () => {
    expect(textColumn.toText('hello', settings)).toBe('hello');
    const sorted = ['item 10', 'Item 2', 'item 1'].sort((a, b) =>
      textColumn.compare(a, b, settings),
    );
    expect(sorted).toEqual(['item 1', 'Item 2', 'item 10']);
  });
});

describe('status column', () => {
  const settings = statusColumn.defaultSettings();

  it('has valid default settings with labels, colours and unique indexes', () => {
    expect(statusSettingsSchema.safeParse(settings).success).toBe(true);
    expect(settings.labels.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(settings.labels.every((l) => /^#[0-9a-f]{6}$/i.test(l.color))).toBe(true);
  });

  it('returns independent default settings on each call', () => {
    const a = statusColumn.defaultSettings();
    a.labels[0]!.label = 'Changed';
    expect(statusColumn.defaultSettings().labels[0]!.label).toBe('Working on it');
  });

  it('rejects duplicate label ids and indexes', () => {
    const dup = {
      labels: [
        { id: 'a', index: 0, label: 'A', color: '#111111' },
        { id: 'a', index: 0, label: 'B', color: '#222222' },
      ],
    };
    const result = statusSettingsSchema.safeParse(dup);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(2);
  });

  it('accepts monday-style values by index or by label, and rejects empty objects', () => {
    expect(statusColumn.valueSchema.safeParse({ index: 1 }).success).toBe(true);
    expect(statusColumn.valueSchema.safeParse({ label: 'Done' }).success).toBe(true);
    expect(statusColumn.valueSchema.safeParse({ index: 1, label: 'Done' }).success).toBe(true);
    expect(statusColumn.valueSchema.safeParse({}).success).toBe(false);
    expect(statusColumn.valueSchema.safeParse({ index: -1 }).success).toBe(false);
  });

  it('resolves labels by index first, then by case-insensitive label', () => {
    expect(findStatusLabel({ index: 1 }, settings)?.label).toBe('Done');
    expect(findStatusLabel({ label: ' stuck ' }, settings)?.index).toBe(2);
    expect(findStatusLabel({ index: 1, label: 'Stuck' }, settings)?.label).toBe('Done');
    expect(findStatusLabel({ index: 99 }, settings)).toBeNull();
  });

  it('renders text from settings, falling back to the stored label', () => {
    expect(statusColumn.toText({ index: 0 }, settings)).toBe('Working on it');
    expect(statusColumn.toText({ index: 99, label: 'Legacy' }, settings)).toBe('Legacy');
    expect(statusColumn.toText({ index: 99 }, settings)).toBe('');
  });

  it('sorts by label index with unknown labels last', () => {
    const values = [{ index: 2 }, { index: 99 }, { index: 0 }, { label: 'Done' }];
    const sorted = [...values].sort((a, b) => statusColumn.compare(a, b, settings));
    expect(sorted).toEqual([{ index: 0 }, { label: 'Done' }, { index: 2 }, { index: 99 }]);
  });
});
