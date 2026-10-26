import { describe, expect, it } from 'vitest';
import { formatBatteryTooltip } from './battery-format';

describe('formatBatteryTooltip', () => {
  it('keeps one decimal for a fractional percent', () => {
    expect(formatBatteryTooltip('Done', 5, 8)).toBe('Done 5/8   62.5%');
    expect(formatBatteryTooltip('Stuck', 1, 3)).toBe('Stuck 1/3   33.3%');
  });
  it('drops the decimal from a whole number', () => {
    expect(formatBatteryTooltip('Done', 4, 8)).toBe('Done 4/8   50%');
    expect(formatBatteryTooltip('Done', 8, 8)).toBe('Done 8/8   100%');
  });
  it('names the empty segment', () => {
    expect(formatBatteryTooltip('', 2, 8)).toBe('Empty 2/8   25%');
  });
  it('survives a zero total', () => {
    expect(formatBatteryTooltip('Done', 0, 0)).toBe('Done 0/0   0%');
  });
});
