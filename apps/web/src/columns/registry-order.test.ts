import { columnRegistry } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { ADD_COLUMN_ORDER } from './registry';

describe('ADD_COLUMN_ORDER', () => {
  it('is sorted alphabetically by display label', () => {
    const labels = ADD_COLUMN_ORDER.map((type) => columnRegistry.get(type).label);
    const sorted = [...labels].sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' }),
    );
    expect(labels).toEqual(sorted);
    expect(new Set(ADD_COLUMN_ORDER).size).toBe(ADD_COLUMN_ORDER.length);
  });
});
