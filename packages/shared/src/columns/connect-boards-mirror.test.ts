import { describe, expect, it } from 'vitest';
import {
  boardRelationColumn,
  boardRelationSettingsSchema,
  boardRelationValueSchema,
  columnRegistry,
  computeMirror,
  isRelationWithinSettings,
  mirrorColumn,
  mirrorSettingsSchema,
  mirrorValueSchema,
} from './index';

describe('Connect Boards & Mirror Columns', () => {
  describe('Connect Boards (board_relation)', () => {
    it('accepts valid linkedItems pairs', () => {
      const parsed = boardRelationValueSchema.safeParse({
        linkedItems: [
          { boardId: 'b1', itemId: 'item1' },
          { boardId: 'b1', itemId: 'item2' },
          { boardId: 'b2', itemId: 'item1' },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.linkedItems).toHaveLength(3);
      }
    });

    it('accepts empty linkedItems array', () => {
      const parsed = boardRelationValueSchema.safeParse({ linkedItems: [] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.linkedItems).toEqual([]);
      }
    });

    it('rejects duplicate {boardId, itemId} pairs', () => {
      const parsed = boardRelationValueSchema.safeParse({
        linkedItems: [
          { boardId: 'b1', itemId: 'item1' },
          { boardId: 'b1', itemId: 'item1' },
        ],
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain('linkedItems must be unique');
      }
    });

    it('validates settings with unique boardIds and twoWay superRefine', () => {
      const defaults = boardRelationColumn.defaultSettings();
      expect(defaults).toEqual({
        boardIds: [],
        allowMultipleItems: true,
        twoWay: false,
      });
      expect(boardRelationSettingsSchema.safeParse(defaults).success).toBe(true);

      // Rejects duplicate boardIds
      expect(
        boardRelationSettingsSchema.safeParse({
          ...defaults,
          boardIds: ['b1', 'b1'],
        }).success,
      ).toBe(false);

      // twoWay requires twoWayColumnId
      expect(
        boardRelationSettingsSchema.safeParse({
          ...defaults,
          twoWay: true,
        }).success,
      ).toBe(false);

      // twoWay: false rejects twoWayColumnId
      expect(
        boardRelationSettingsSchema.safeParse({
          ...defaults,
          twoWay: false,
          twoWayColumnId: 'col_rel_2',
        }).success,
      ).toBe(false);

      // Valid twoWay configuration
      expect(
        boardRelationSettingsSchema.safeParse({
          boardIds: ['b1', 'b2'],
          allowMultipleItems: false,
          twoWay: true,
          twoWayColumnId: 'col_rel_2',
        }).success,
      ).toBe(true);
    });

    it('isRelationWithinSettings enforces allowMultipleItems and boardIds', () => {
      const settingsSingle = {
        boardIds: ['b1'],
        allowMultipleItems: false,
        twoWay: false,
      };

      // Exceeds multiple items limit
      const multi = {
        linkedItems: [
          { boardId: 'b1', itemId: 'i1' },
          { boardId: 'b1', itemId: 'i2' },
        ],
      };
      expect(isRelationWithinSettings(multi, settingsSingle)).toBe(false);

      // Disallowed board ID
      const wrongBoard = {
        linkedItems: [{ boardId: 'b99', itemId: 'i1' }],
      };
      expect(isRelationWithinSettings(wrongBoard, settingsSingle)).toBe(false);

      // Valid single item on allowed board
      const valid = {
        linkedItems: [{ boardId: 'b1', itemId: 'i1' }],
      };
      expect(isRelationWithinSettings(valid, settingsSingle)).toBe(true);
    });

    it('toText renders comma-separated item IDs', () => {
      const settings = boardRelationColumn.defaultSettings();
      expect(
        boardRelationColumn.toText(
          {
            linkedItems: [
              { boardId: 'b1', itemId: 'item-a' },
              { boardId: 'b1', itemId: 'item-b' },
            ],
          },
          settings,
        ),
      ).toBe('item-a, item-b');
      expect(boardRelationColumn.toText({ linkedItems: [] }, settings)).toBe('');
    });

    it('compare sorts primarily by count, then lexicographically', () => {
      const settings = boardRelationColumn.defaultSettings();
      const empty = { linkedItems: [] };
      const oneA = { linkedItems: [{ boardId: 'b1', itemId: 'item-1' }] };
      const oneB = { linkedItems: [{ boardId: 'b1', itemId: 'item-2' }] };
      const two = {
        linkedItems: [
          { boardId: 'b1', itemId: 'item-1' },
          { boardId: 'b1', itemId: 'item-2' },
        ],
      };

      expect(boardRelationColumn.compare(empty, oneA, settings)).toBeLessThan(0);
      expect(boardRelationColumn.compare(two, oneA, settings)).toBeGreaterThan(0);
      expect(boardRelationColumn.compare(oneA, oneB, settings)).toBeLessThan(0);
      expect(boardRelationColumn.compare(oneA, oneA, settings)).toBe(0);
    });
  });

  describe('Mirror Column (mirror)', () => {
    it('validates mirror value schema and settings schema', () => {
      const parsed = mirrorValueSchema.safeParse({
        mirroredValues: ['Done', 'In Progress'],
        displayValue: 'Done, In Progress',
      });
      expect(parsed.success).toBe(true);

      const settings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'status_col', b2: 'status_col_2' },
        aggregation: 'count' as const,
      };
      expect(mirrorSettingsSchema.safeParse(settings).success).toBe(true);
    });

    it('renders connected items through the registry instead of raw JSON', () => {
      const item = {
        values: {
          connect_col: {
            linkedItems: [
              { boardId: 'b1', itemId: 'i1' },
              { boardId: 'b1', itemId: 'i2' },
            ],
          },
        },
      };

      const connectedItems = {
        'b1:i1': {
          id: 'i1',
          boardId: 'b1',
          state: 'active' as const,
          values: { status_col: { index: 1 } },
        },
        'b1:i2': {
          id: 'i2',
          boardId: 'b1',
          state: 'active' as const,
          values: { status_col: { index: 0 } },
        },
      };

      const targetColumns = {
        status_col: {
          id: 'status_col',
          type: 'status',
          settings: {
            labels: [
              { id: 'working', index: 0, label: 'Working on it', color: '#fdab3d' },
              { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
            ],
          },
        },
      };

      const settings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'status_col' },
        aggregation: 'none' as const,
      };

      const computed = computeMirror(item, settings, connectedItems, targetColumns, columnRegistry);
      // Renders formatted label through registry: "Done, Working on it" (NOT {"index":1})
      expect(computed.displayValue).toBe('Done, Working on it');
      expect(computed.mirroredValues).toEqual([{ index: 1 }, { index: 0 }]);
    });

    it('renders non-status columns through the registry (e.g. date, numbers)', () => {
      const item = {
        values: {
          connect_col: {
            linkedItems: [
              { boardId: 'b1', itemId: 'i1' },
              { boardId: 'b1', itemId: 'i2' },
            ],
          },
        },
      };

      const connectedItems = {
        'b1:i1': {
          id: 'i1',
          boardId: 'b1',
          state: 'active' as const,
          values: {
            date_col: { date: '2026-10-24', time: '14:00:00' },
            num_col: 1234.56,
          },
        },
        'b1:i2': {
          id: 'i2',
          boardId: 'b1',
          state: 'active' as const,
          values: {
            date_col: { date: '2026-12-31' },
            num_col: 7890,
          },
        },
      };

      const targetColumns = {
        date_col: {
          id: 'date_col',
          type: 'date',
          settings: { hideWeekdays: false },
        },
        num_col: {
          id: 'num_col',
          type: 'numbers',
          settings: { unit: { symbol: '$', direction: 'left' }, decimals: null },
        },
      };

      const dateSettings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'date_col' },
        aggregation: 'none' as const,
      };
      const dateComputed = computeMirror(
        item,
        dateSettings,
        connectedItems,
        targetColumns,
        columnRegistry,
      );
      expect(dateComputed.displayValue).toBe('2026-10-24 14:00:00, 2026-12-31');

      const numSettings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'num_col' },
        aggregation: 'none' as const,
      };
      const numComputed = computeMirror(
        item,
        numSettings,
        connectedItems,
        targetColumns,
        columnRegistry,
      );
      expect(numComputed.displayValue).toBe('$1234.56, $7890');
    });

    it('prevents cross-board data leak when two boards share the same item id', () => {
      const item = {
        values: {
          connect_col: {
            linkedItems: [{ boardId: 'b1', itemId: 'item_100' }],
          },
        },
      };

      // Both board b1 and board b2 have an item with id 'item_100'
      const connectedItems = {
        'b1:item_100': {
          id: 'item_100',
          boardId: 'b1',
          state: 'active' as const,
          values: { text_col: 'Board 1 Data' },
        },
        'b2:item_100': {
          id: 'item_100',
          boardId: 'b2',
          state: 'active' as const,
          values: { text_col: 'LEAKED Board 2 Data' },
        },
      };

      const settings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'text_col' },
        aggregation: 'none' as const,
      };

      const computed = computeMirror(item, settings, connectedItems);
      expect(computed.displayValue).toBe('Board 1 Data');

      // If relation is to b2:item_100 with targetColumnIds for b2
      const itemB2 = {
        values: {
          connect_col: {
            linkedItems: [{ boardId: 'b2', itemId: 'item_100' }],
          },
        },
      };
      const settingsB2 = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b2: 'text_col' },
        aggregation: 'none' as const,
      };
      expect(computeMirror(itemB2, settingsB2, connectedItems).displayValue).toBe(
        'LEAKED Board 2 Data',
      );

      // If connectedItems entry has mismatched boardId, it must be rejected
      const maliciousItems = {
        'b1:item_100': {
          id: 'item_100',
          boardId: 'b2', // Mismatched!
          state: 'active' as const,
          values: { text_col: 'Spoofed Data' },
        },
      };
      expect(computeMirror(item, settings, maliciousItems).displayValue).toBe('');
    });

    it('skips inactive (archived or trashed) connected items', () => {
      const item = {
        values: {
          connect_col: {
            linkedItems: [
              { boardId: 'b1', itemId: 'i1' },
              { boardId: 'b1', itemId: 'i2' },
            ],
          },
        },
      };

      const connectedItems = {
        'b1:i1': {
          id: 'i1',
          boardId: 'b1',
          state: 'active' as const,
          values: { num_col: 10 },
        },
        'b1:i2': {
          id: 'i2',
          boardId: 'b1',
          state: 'trash' as const, // Inactive item
          values: { num_col: 99 },
        },
      };

      const settings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'num_col' },
        aggregation: 'sum' as const,
      };

      const computed = computeMirror(item, settings, connectedItems);
      // Only active item i1 (10) is counted
      expect(computed.displayValue).toBe('10');
    });

    it('implements all aggregations: count, count_filled, count_empty, percent_filled, sum, avg, min, max, earliest, latest', () => {
      const item = {
        values: {
          connect_col: {
            linkedItems: [
              { boardId: 'b1', itemId: 'i1' },
              { boardId: 'b1', itemId: 'i2' },
              { boardId: 'b1', itemId: 'i3' },
            ],
          },
        },
      };

      const connectedItems = {
        'b1:i1': {
          id: 'i1',
          boardId: 'b1',
          state: 'active' as const,
          values: { num_col: 10, date_col: { date: '2026-10-15' } },
        },
        'b1:i2': {
          id: 'i2',
          boardId: 'b1',
          state: 'active' as const,
          values: { num_col: 30, date_col: { date: '2026-10-01', time: '09:00:00' } },
        },
        'b1:i3': {
          id: 'i3',
          boardId: 'b1',
          state: 'active' as const,
          values: { num_col: null }, // empty target value
        },
      };

      const targetColumns = {
        date_col: {
          id: 'date_col',
          type: 'date',
          settings: { hideWeekdays: false },
        },
        num_col: {
          id: 'num_col',
          type: 'numbers',
          settings: {},
        },
      };

      const baseSettings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'num_col' },
      };

      // count
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'count' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('3');

      // count_filled
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'count_filled' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('2');

      // count_empty
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'count_empty' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('1');

      // percent_filled (2 out of 3 = 67%)
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'percent_filled' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('67%');

      // sum (10 + 30 = 40)
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'sum' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('40');

      // average (40 / 2 = 20)
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'average' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('20');

      // min (10)
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'min' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('10');

      // max (30)
      expect(
        computeMirror(
          item,
          { ...baseSettings, aggregation: 'max' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('30');

      // earliest & latest with canonical date_col (out-of-order test: i1 is Oct 15, i2 is Oct 01)
      const dateSettings = {
        relationColumnId: 'connect_col',
        targetColumnIds: { b1: 'date_col' },
      };
      expect(
        computeMirror(
          item,
          { ...dateSettings, aggregation: 'earliest' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('2026-10-01 09:00:00');
      expect(
        computeMirror(
          item,
          { ...dateSettings, aggregation: 'latest' },
          connectedItems,
          targetColumns,
          columnRegistry,
        ).displayValue,
      ).toBe('2026-10-15');
    });

    it('toText and compare', () => {
      const settings = mirrorColumn.defaultSettings();
      expect(mirrorColumn.toText({ mirroredValues: [1, 2], displayValue: '1, 2' }, settings)).toBe(
        '1, 2',
      );

      const valA = { mirroredValues: [5], displayValue: '5' };
      const valB = { mirroredValues: [20], displayValue: '20' };
      expect(mirrorColumn.compare(valA, valB, settings)).toBeLessThan(0);
    });

    it('is registered in columnRegistry', () => {
      expect(columnRegistry.has('board_relation')).toBe(true);
      expect(columnRegistry.has('mirror')).toBe(true);
    });
  });
});
