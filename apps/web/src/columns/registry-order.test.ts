import { columnRegistry } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { ADD_COLUMN_ENTRIES, ADD_COLUMN_ORDER } from './registry';

describe('ADD_COLUMN_ORDER', () => {
  it('is sorted alphabetically by display label', () => {
    const labels = ADD_COLUMN_ORDER.map((type) => columnRegistry.get(type).label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(labels).toEqual(sorted);
    expect(new Set(ADD_COLUMN_ORDER).size).toBe(ADD_COLUMN_ORDER.length);
  });

  it('offers Priority as a status column pre-filled with monday-style labels', () => {
    const entry = ADD_COLUMN_ENTRIES.find((e) => e.key === 'priority');
    expect(entry?.type).toBe('status');
    expect(entry?.preset?.title).toBe('Priority');
    const labels = (entry?.preset?.settings.labels ?? []) as { label: string; color: string }[];
    expect(labels.map((l) => [l.label, l.color])).toEqual([
      ['Critical', '#df2f4a'],
      ['High', '#fdab3d'],
      ['Medium', '#579bfc'],
      ['Low', '#66ccff'],
    ]);
    const keys = ADD_COLUMN_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
