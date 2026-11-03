import { describe, expect, it } from 'vitest';
import {
  BUTTON_LIMITS,
  buttonActionSchema,
  buttonColumn,
  buttonSettingsSchema,
  buttonValueSchema,
  columnRegistry,
  renderRenameTemplate,
  validateButtonActions,
} from './index';

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
      actions: [],
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

    const customSettings = { label: 'Execute', color: '#579bfc', actions: [] };
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

describe('button actions', () => {
  it('accepts valid actions and rejects unknown keys, unknown types and bad templates', () => {
    expect(buttonActionSchema.safeParse({ type: 'archive_item' }).success).toBe(true);
    expect(buttonActionSchema.safeParse({ type: 'archive_item', x: 1 }).success).toBe(false);
    expect(buttonActionSchema.safeParse({ type: 'notify' }).success).toBe(false);
    expect(buttonActionSchema.safeParse({ type: 'rename_item', template: '' }).success).toBe(false);
    expect(
      buttonActionSchema.safeParse({ type: 'rename_item', template: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(buttonActionSchema.safeParse({ type: 'move_to_group', groupId: 'g 1' }).success).toBe(
      false,
    );
  });

  it('validates the notify action: 1 to 10 uids, message up to 140', () => {
    const ok = { type: 'notify', uids: ['u1'], message: 'x'.repeat(140) };
    expect(buttonActionSchema.safeParse(ok).success).toBe(true);
    expect(buttonActionSchema.safeParse({ type: 'notify', uids: ['u1'] }).success).toBe(true);
    expect(buttonActionSchema.safeParse({ type: 'notify', uids: [] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}`);
    expect(buttonActionSchema.safeParse({ type: 'notify', uids: eleven }).success).toBe(false);
    expect(
      buttonActionSchema.safeParse({ type: 'notify', uids: ['u1'], message: 'x'.repeat(141) })
        .success,
    ).toBe(false);
    expect(buttonActionSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it('limits a button to 5 actions and defaults to none', () => {
    expect(buttonSettingsSchema.parse({}).actions).toEqual([]);
    const six = Array.from({ length: BUTTON_LIMITS.maxActions + 1 }, () => ({
      type: 'archive_item',
    }));
    expect(buttonSettingsSchema.safeParse({ actions: six }).success).toBe(false);
    expect(buttonSettingsSchema.safeParse({ actions: six.slice(1) }).success).toBe(true);
  });

  it('renders templates: {name}, {date} (UTC), unknown tokens kept, trimmed', () => {
    const now = Date.UTC(2026, 10, 3, 23, 59);
    expect(renderRenameTemplate(' {name} - {date} {who} ', 'Task', now)).toBe(
      'Task - 2026-11-03 {who}',
    );
  });

  describe('validateButtonActions', () => {
    const col = (id: string, type: string, extra: object = {}) => ({
      id,
      type,
      title: id,
      settings: {},
      ...extra,
    });
    const board = {
      columns: [
        col('text', 'text'),
        col('num', 'numbers'),
        col('btn', 'button'),
        col('files', 'files'),
        col('mig', 'text', { migrating: { toType: 'numbers' } }),
        col('stat', 'status', {
          settings: { labels: [{ index: 0, label: 'Done', color: '#00c875' }] },
        }),
      ],
      groups: [{ id: 'g1' }],
      columnLocks: ['text'],
    };
    const fails = (action: object, role: 'owner' | 'editor' | null = 'editor') =>
      validateButtonActions([action as never], board, role);

    it('accepts good actions', () => {
      expect(
        validateButtonActions(
          [
            { type: 'set_value', columnId: 'stat', value: { index: 0 } },
            { type: 'move_to_group', groupId: 'g1' },
            { type: 'archive_item' },
          ],
          board,
          'editor',
        ),
      ).toEqual({ ok: true });
    });

    it.each([
      [{ type: 'set_value', columnId: 'nope', value: 'x' }, 'no longer exists'],
      [{ type: 'set_value', columnId: 'btn', value: {} }, 'button'],
      [{ type: 'set_value', columnId: 'files', value: {} }, 'managed'],
      [{ type: 'set_value', columnId: 'mig', value: 'x' }, 'changing type'],
      [{ type: 'set_value', columnId: 'num', value: 'abc' }, ''],
      [{ type: 'move_to_group', groupId: 'g2' }, 'group no longer exists'],
      [{ type: 'set_value', columnId: 'text', value: 'x' }, 'locked'],
    ])('refuses %j', (action, text) => {
      const r = fails(action);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.index).toBe(0);
        expect(r.message).toContain(text);
      }
    });

    it('lets an owner write a locked column and reports the failing index', () => {
      expect(fails({ type: 'set_value', columnId: 'text', value: 'x' }, 'owner')).toEqual({
        ok: true,
      });
      const r = validateButtonActions(
        [{ type: 'archive_item' }, { type: 'move_to_group', groupId: 'zz' }],
        board,
        'editor',
      );
      expect(r).toMatchObject({ ok: false, index: 1 });
    });

    it('checks notify uids: unique, and members when the list is known', () => {
      const notify = (uids: string[], memberUids?: string[]) =>
        validateButtonActions([{ type: 'notify', uids }], {
          ...board,
          ...(memberUids ? { memberUids } : {}),
        });
      expect(notify(['a', 'b'])).toEqual({ ok: true });
      expect(notify(['a', 'a'])).toMatchObject({ ok: false, index: 0 });
      expect(notify(['a', 'b'], ['a', 'b', 'c'])).toEqual({ ok: true });
      const r = notify(['a', 'z'], ['a', 'b']);
      expect(r).toMatchObject({ ok: false, index: 0 });
      if (!r.ok) expect(r.message).toContain('Notify people');
    });

    it('skips the lock check when no role is given (settings time)', () => {
      expect(
        validateButtonActions([{ type: 'set_value', columnId: 'text', value: 'x' }], board),
      ).toEqual({ ok: true });
    });
  });
});
