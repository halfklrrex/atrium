import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeActivity } from '../../test/activity';
import { activityLabel, activitySentence, isBoardLevel, valueView } from './activity-format';

const statusColumn: ColumnDef = {
  id: 'status',
  type: 'status',
  title: 'Status',
  position: 'a0',
  settings: columnRegistry.defaultSettings('status') as Record<string, unknown>,
};

describe('activityLabel', () => {
  it('uses the column title for edits and the action for item events', () => {
    expect(activityLabel(makeActivity('a', { columnTitle: 'Status' }))).toBe('Status');
    expect(activityLabel(makeActivity('a', { kind: 'item_created' }))).toBe('Created');
    expect(activityLabel(makeActivity('a', { kind: 'item_moved' }))).toBe('Moved');
    expect(activityLabel(makeActivity('a', { kind: 'item_archived' }))).toBe('Archived');
    expect(activityLabel(makeActivity('a', { data: { more: 3 } }))).toBe('More changes');
  });
});

describe('activitySentence', () => {
  it('reads board-level events as sentences', () => {
    const rename = makeActivity('a', {
      kind: 'group_renamed',
      itemId: null,
      itemName: null,
      groupTitle: 'Shipped',
      data: { fromText: 'Done', toText: 'Shipped' },
    });
    expect(activitySentence(rename)).toBe('Avery Quinn renamed the group Done to Shipped');
    expect(isBoardLevel(rename)).toBe(true);
    expect(
      activitySentence(
        makeActivity('b', { kind: 'column_deleted', itemId: null, columnTitle: 'Budget' }),
      ),
    ).toBe('Avery Quinn deleted the column Budget');
  });

  it('describes access changes in each direction', () => {
    const access = (data: object) =>
      activitySentence(
        makeActivity('a', { kind: 'board_access_changed', itemId: null, data: data as never }),
      );
    expect(access({ targetName: 'Sam Rivera', toRole: 'editor', fromRole: null })).toBe(
      'Avery Quinn added Sam Rivera as editor',
    );
    expect(access({ targetName: 'Sam Rivera', toRole: 'viewer', fromRole: 'editor' })).toBe(
      'Avery Quinn changed Sam Rivera from editor to viewer',
    );
    expect(access({ targetName: 'Sam Rivera', toRole: null, fromRole: 'viewer' })).toBe(
      'Avery Quinn removed Sam Rivera from the board',
    );
  });

  it('names the item, the column and both values for an edit', () => {
    const edit = makeActivity('a', {
      columnTitle: 'Status',
      data: { fromText: 'Building', toText: 'Done' },
    });
    expect(activitySentence(edit)).toBe(
      'Avery Quinn changed Status on "Ship the pipeline" from Building to Done',
    );
    expect(isBoardLevel(edit)).toBe(false);
  });
});

describe('valueView', () => {
  const edit = (data: object) =>
    makeActivity('a', { columnId: 'status', columnType: 'status', data: data as never });

  it('draws the column cell when the column and the raw value are still valid', () => {
    const view = valueView(edit({ toValue: { index: 1 }, toText: 'Done' }), 'to', [statusColumn]);
    expect(view.kind).toBe('cell');
  });

  it('falls back to the stored text when the column is gone, retyped or the raw value is missing', () => {
    const data = { toValue: { index: 1 }, toText: 'Done' };
    expect(valueView(edit(data), 'to', [])).toEqual({ kind: 'text', text: 'Done' });
    expect(valueView(edit(data), 'to', [{ ...statusColumn, type: 'text' }])).toEqual({
      kind: 'text',
      text: 'Done',
    });
    expect(valueView(edit({ toText: 'Done' }), 'to', [statusColumn])).toEqual({
      kind: 'text',
      text: 'Done',
    });
  });

  it('keeps types without a read-only cell as text and shows empty values as empty', () => {
    const text: ColumnDef = { ...statusColumn, id: 't', type: 'text' };
    const event = makeActivity('a', {
      columnId: 't',
      columnType: 'text',
      data: { toValue: { text: 'hi' }, toText: 'hi' },
    });
    expect(valueView(event, 'to', [text])).toEqual({ kind: 'text', text: 'hi' });
    expect(valueView(edit({ fromText: '' }), 'from', [statusColumn])).toEqual({ kind: 'empty' });
  });
});
