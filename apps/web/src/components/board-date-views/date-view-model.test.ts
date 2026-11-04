import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, STATUS_LABEL_COLORS, WORKSPACE_COLORS } from '../../theme/palette';
import { textContrastFor, textToneFor } from './date-view-model';

describe('textToneFor', () => {
  it('uses white on red and purple fills', () => {
    expect(textToneFor('#df2f4a')).toBe('light');
    expect(textToneFor('#9d50dd')).toBe('light');
  });

  it('uses dark ink on light fills', () => {
    for (const hex of ['#fdab3d', '#00c875', '#ffcb00', '#c4c4c4', '#fff']) {
      expect(textToneFor(hex)).toBe('dark');
    }
  });

  it('falls back to dark for a missing or invalid colour', () => {
    expect(textToneFor(null)).toBe('dark');
    expect(textToneFor('nope')).toBe('dark');
    expect(textContrastFor('nope')).toBeNull();
  });

  it('always picks the better contrast across the palettes', () => {
    const hexes = [...WORKSPACE_COLORS, ...GROUP_COLORS, ...STATUS_LABEL_COLORS].map((c) => c.hex);
    for (const hex of hexes) {
      const c = textContrastFor(hex)!;
      const chosen = textToneFor(hex) === 'light' ? c.light : c.dark;
      expect(chosen).toBe(Math.max(c.light, c.dark));
      if (Math.max(c.light, c.dark) >= 4.5) expect(chosen).toBeGreaterThanOrEqual(4.5);
    }
  });
});
