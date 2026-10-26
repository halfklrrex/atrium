import { describe, expect, it } from 'vitest';
import { buttonColumn, buttonSettingsSchema, buttonValueSchema, columnRegistry } from './index';

describe('P2 Button Column', () => {
  it('validates button value schema accepts only empty object (no stored value)', () => {
    // Valid empty cell object
    expect(buttonValueSchema.safeParse({}).success).toBe(true);

    // Rejects cell values with properties (no stored cell value)
    const withLabel = buttonValueSchema.safeParse({ label: 'Deploy' });
    expect(withLabel.success).toBe(false);

    const withClicked = buttonValueSchema.safeParse({
      lastClicked: '2026-10-24T19:20:00.000Z',
    });
    expect(withClicked.success).toBe(false);

    const withColor = buttonValueSchema.safeParse({
      color: '#579bfc',
    });
    expect(withColor.success).toBe(false);
  });

  it('validates settings schema and palette defaults', () => {
    const defaults = buttonColumn.defaultSettings();
    expect(defaults).toEqual({
      label: 'Click',
      color: '#579bfc',
    });
    expect(buttonSettingsSchema.safeParse(defaults).success).toBe(true);

    const custom = buttonSettingsSchema.safeParse({
      label: 'Open Ticket',
      color: '#ff6d3b',
    });
    expect(custom.success).toBe(true);

    // Rejects invalid hex color
    const invalidHex = buttonSettingsSchema.safeParse({
      color: '#123', // Must be #RRGGBB
    });
    expect(invalidHex.success).toBe(false);
  });

  it('toText returns settings.label and compare returns 0', () => {
    const settings = buttonColumn.defaultSettings();
    expect(buttonColumn.toText({}, settings)).toBe('Click');

    const customSettings = { label: 'Execute', color: '#579bfc' };
    expect(buttonColumn.toText({}, customSettings)).toBe('Execute');

    expect(buttonColumn.compare({}, {}, settings)).toBe(0);
  });

  it('defines allowed summaries without filled or percent summaries', () => {
    expect(buttonColumn.summaries).toEqual(['count', 'count_empty']);
    expect(buttonColumn.summaries).not.toContain('count_filled');
    expect(buttonColumn.summaries).not.toContain('percent_filled');
  });

  it('integrates into columnRegistry and round-trips parseValue and toText', () => {
    expect(columnRegistry.has('button')).toBe(true);
    const col = columnRegistry.get('button');
    expect(col.label).toBe('Button');

    const parsed = columnRegistry.parseValue('button', {});
    expect(parsed.success).toBe(true);
    expect(columnRegistry.toText('button', {}, { label: 'Start Task' })).toBe('Start Task');
  });

  it('is server-managed (FW2): clients never write the cell, clicks go through a callable', () => {
    expect(buttonColumn.serverManaged).toBe(true);
    expect(columnRegistry.isServerManaged('button')).toBe(true);
    const def = { id: 'b', type: 'button', title: 'Go', position: 'a0', settings: {} };
    expect(columnRegistry.validateCell(def, {})).toEqual({
      ok: false,
      message: 'This column is updated by Atrium automatically',
    });
    expect(columnRegistry.serverManagedColumnIds([def])).toEqual(['b']);
  });
});
