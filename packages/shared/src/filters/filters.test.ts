import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../schemas/board';
import type { Item } from '../schemas/item';
import {
  DEFAULT_STATUS_LABELS,
  type CheckboxValue,
  type DateValue,
  type DropdownValue,
  type NumbersValue,
  type PeopleValue,
  type StatusValue,
} from '../columns';
import {
  createDefaultFilterState,
  evaluateCondition,
  groupItems,
  matchesFilter,
  sortItems,
} from './engine';
import type { FilterGroup, SortCondition } from './types';

const timestamp = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date(1700000000 * 1000),
  toMillis: () => 1700000000 * 1000,
};

function createTestItem(partial: Partial<Item>): Item {
  return {
    name: 'Sample item',
    groupId: 'group-1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: timestamp,
    createdBy: 'user-1',
    updatedAt: timestamp,
    updatedBy: 'user-1',
    ...partial,
  };
}

const statusCol: ColumnDef = {
  id: 'status_1',
  type: 'status',
  title: 'Status',
  position: 'a0',
  settings: { labels: [...DEFAULT_STATUS_LABELS] },
};

const numbersCol: ColumnDef = {
  id: 'num_1',
  type: 'numbers',
  title: 'Amount',
  position: 'a1',
  settings: { unit: null, decimals: null },
};

const dateCol: ColumnDef = {
  id: 'date_1',
  type: 'date',
  title: 'Due Date',
  position: 'a2',
  settings: { hideWeekdays: false },
};

const peopleCol: ColumnDef = {
  id: 'people_1',
  type: 'people',
  title: 'Owner',
  position: 'a3',
  settings: { singlePerson: false },
};

const dropdownCol: ColumnDef = {
  id: 'drop_1',
  type: 'dropdown',
  title: 'Category',
  position: 'a4',
  settings: {
    labels: [
      { id: 1, label: 'Marketing' },
      { id: 2, label: 'Engineering' },
    ],
    limitSelect: false,
  },
};

const checkCol: ColumnDef = {
  id: 'check_1',
  type: 'checkbox',
  title: 'Done',
  position: 'a5',
  settings: {},
};

const textCol: ColumnDef = {
  id: 'text_1',
  type: 'text',
  title: 'Notes',
  position: 'a6',
  settings: {},
};

const allColumns = [statusCol, numbersCol, dateCol, peopleCol, dropdownCol, checkCol, textCol];

describe('Filter & Sort Engine', () => {
  describe('createDefaultFilterState', () => {
    it('creates an empty default filter state', () => {
      const state = createDefaultFilterState();
      expect(state.searchQuery).toBe('');
      expect(state.personIds).toEqual([]);
      expect(state.filterGroup.conjunction).toBe('and');
      expect(state.filterGroup.conditions).toEqual([]);
      expect(state.sortConditions).toEqual([]);
      expect(state.groupByColumnId).toBeNull();
    });
  });

  describe('evaluateCondition', () => {
    it('evaluates item name conditions', () => {
      const item = createTestItem({ name: 'Launch Website Redesign' });

      expect(
        evaluateCondition(
          item,
          { columnId: 'name', operator: 'is', value: 'launch website redesign' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: 'name', operator: 'is_not', value: 'other' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: 'name', operator: 'contains', value: 'website' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: 'name', operator: 'does_not_contain', value: 'mobile' },
          allColumns,
        ),
      ).toBe(true);
      expect(evaluateCondition(item, { columnId: 'name', operator: 'is_empty' }, allColumns)).toBe(
        false,
      );
      expect(
        evaluateCondition(item, { columnId: 'name', operator: 'is_not_empty' }, allColumns),
      ).toBe(true);
    });

    it('evaluates status conditions', () => {
      const workingItem = createTestItem({
        values: { [statusCol.id]: { index: 0 } as StatusValue },
      });
      const emptyItem = createTestItem({ values: {} });

      // By label text
      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'is', value: 'Working on it' },
          allColumns,
        ),
      ).toBe(true);
      // By label id
      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'is', value: 'working-on-it' },
          allColumns,
        ),
      ).toBe(true);
      // By index
      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'is', value: 0 },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'is_not', value: 'done' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'contains', value: 'working' },
          allColumns,
        ),
      ).toBe(true);

      expect(
        evaluateCondition(
          workingItem,
          { columnId: statusCol.id, operator: 'is_empty' },
          allColumns,
        ),
      ).toBe(false);
      expect(
        evaluateCondition(emptyItem, { columnId: statusCol.id, operator: 'is_empty' }, allColumns),
      ).toBe(true);
      expect(
        evaluateCondition(
          emptyItem,
          { columnId: statusCol.id, operator: 'is_not_empty' },
          allColumns,
        ),
      ).toBe(false);
    });

    it('evaluates numbers conditions', () => {
      const item = createTestItem({
        values: { [numbersCol.id]: 150 as NumbersValue },
      });

      expect(
        evaluateCondition(
          item,
          { columnId: numbersCol.id, operator: 'is', value: 150 },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: numbersCol.id, operator: 'greater_than', value: 100 },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: numbersCol.id, operator: 'less_than', value: 200 },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: numbersCol.id, operator: 'greater_than', value: 200 },
          allColumns,
        ),
      ).toBe(false);
      expect(
        evaluateCondition(item, { columnId: numbersCol.id, operator: 'is_empty' }, allColumns),
      ).toBe(false);
    });

    it('evaluates date conditions', () => {
      const item = createTestItem({
        values: { [dateCol.id]: { date: '2026-10-24' } as DateValue },
      });

      expect(
        evaluateCondition(
          item,
          { columnId: dateCol.id, operator: 'is', value: '2026-10-24' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: dateCol.id, operator: 'greater_than', value: '2026-10-01' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: dateCol.id, operator: 'less_than', value: '2026-11-01' },
          allColumns,
        ),
      ).toBe(true);
    });

    it('evaluates people conditions', () => {
      const item = createTestItem({
        values: {
          [peopleCol.id]: {
            personsAndTeams: [{ id: 'usr_avery', kind: 'person' }],
          } as PeopleValue,
        },
      });

      expect(
        evaluateCondition(
          item,
          { columnId: peopleCol.id, operator: 'is', value: 'usr_avery' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: peopleCol.id, operator: 'is_not', value: 'usr_other' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(item, { columnId: peopleCol.id, operator: 'is_empty' }, allColumns),
      ).toBe(false);
    });

    it('evaluates checkbox conditions', () => {
      const checkedItem = createTestItem({
        values: { [checkCol.id]: { checked: 'true' } as CheckboxValue },
      });
      const uncheckedItem = createTestItem({
        values: { [checkCol.id]: { checked: 'false' } as CheckboxValue },
      });

      expect(
        evaluateCondition(
          checkedItem,
          { columnId: checkCol.id, operator: 'is', value: true },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          uncheckedItem,
          { columnId: checkCol.id, operator: 'is', value: true },
          allColumns,
        ),
      ).toBe(false);
      expect(
        evaluateCondition(
          checkedItem,
          { columnId: checkCol.id, operator: 'is_not_empty' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          uncheckedItem,
          { columnId: checkCol.id, operator: 'is_empty' },
          allColumns,
        ),
      ).toBe(true);
    });

    it('matches Checkbox is Unchecked for { checked: "false" }, false, and empty cells', () => {
      const uncheckedFalseStr = createTestItem({
        name: 'FalseStr',
        values: { [checkCol.id]: { checked: 'false' } as CheckboxValue },
      });
      const uncheckedEmpty = createTestItem({
        name: 'EmptyCell',
        values: {},
      });
      const checkedTrue = createTestItem({
        name: 'TrueItem',
        values: { [checkCol.id]: { checked: 'true' } as CheckboxValue },
      });

      // "is unchecked"
      expect(
        evaluateCondition(
          uncheckedFalseStr,
          { columnId: checkCol.id, operator: 'is', value: 'unchecked' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          uncheckedEmpty,
          { columnId: checkCol.id, operator: 'is', value: 'unchecked' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          checkedTrue,
          { columnId: checkCol.id, operator: 'is', value: 'unchecked' },
          allColumns,
        ),
      ).toBe(false);

      // "is checked"
      expect(
        evaluateCondition(
          checkedTrue,
          { columnId: checkCol.id, operator: 'is', value: 'checked' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          uncheckedFalseStr,
          { columnId: checkCol.id, operator: 'is', value: 'checked' },
          allColumns,
        ),
      ).toBe(false);
    });

    it('safely guards date values without .date property', () => {
      const malformedDateItem = createTestItem({
        values: { [dateCol.id]: { otherField: '2026-10-25' } as unknown as DateValue },
      });
      expect(
        evaluateCondition(
          malformedDateItem,
          { columnId: dateCol.id, operator: 'is', value: '2026-10-25' },
          allColumns,
        ),
      ).toBe(false);
    });

    it('evaluates dropdown conditions', () => {
      const item = createTestItem({
        values: { [dropdownCol.id]: { ids: [1] } as DropdownValue },
      });

      expect(
        evaluateCondition(
          item,
          { columnId: dropdownCol.id, operator: 'is', value: 'Marketing' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: dropdownCol.id, operator: 'contains', value: 'market' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: dropdownCol.id, operator: 'is_not', value: 'Engineering' },
          allColumns,
        ),
      ).toBe(true);
    });

    it('evaluates text conditions', () => {
      const item = createTestItem({
        values: { [textCol.id]: 'Urgent client meeting' },
      });

      expect(
        evaluateCondition(
          item,
          { columnId: textCol.id, operator: 'contains', value: 'client' },
          allColumns,
        ),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: textCol.id, operator: 'does_not_contain', value: 'internal' },
          allColumns,
        ),
      ).toBe(true);
    });

    it('ignores conditions with empty or undefined values', () => {
      const item = createTestItem({ name: 'Alpha' });
      expect(
        evaluateCondition(item, { columnId: 'name', operator: 'is', value: '' }, allColumns),
      ).toBe(true);
      expect(
        evaluateCondition(
          item,
          { columnId: 'name', operator: 'contains', value: undefined },
          allColumns,
        ),
      ).toBe(true);
    });
  });

  describe('matchesFilter', () => {
    const item1 = createTestItem({
      name: 'Design landing page',
      values: {
        [statusCol.id]: { index: 0 } as StatusValue, // Working on it
        [peopleCol.id]: { personsAndTeams: [{ id: 'user-avery', kind: 'person' }] } as PeopleValue,
        [numbersCol.id]: 500 as NumbersValue,
      },
    });

    const item2 = createTestItem({
      name: 'Deploy backend functions',
      values: {
        [statusCol.id]: { index: 1 } as StatusValue, // Done
        [peopleCol.id]: { personsAndTeams: [{ id: 'user-sarah', kind: 'person' }] } as PeopleValue,
        [numbersCol.id]: 200 as NumbersValue,
      },
    });

    it('matches by search query across name and columns', () => {
      expect(matchesFilter(item1, null, 'landing', null, allColumns)).toBe(true);
      expect(matchesFilter(item2, null, 'landing', null, allColumns)).toBe(false);

      // Search matching column text (status text "Working on it")
      expect(matchesFilter(item1, null, 'working', null, allColumns)).toBe(true);
      expect(matchesFilter(item2, null, 'working', null, allColumns)).toBe(false);
    });

    it('filters by assigned person ID', () => {
      expect(matchesFilter(item1, null, null, ['user-avery'], allColumns)).toBe(true);
      expect(matchesFilter(item1, null, null, ['user-sarah'], allColumns)).toBe(false);
      expect(matchesFilter(item2, null, null, ['user-sarah'], allColumns)).toBe(true);
      expect(matchesFilter(item2, null, null, ['user-avery', 'user-sarah'], allColumns)).toBe(true);
    });

    it('evaluates advanced filter group with AND conjunction', () => {
      const group: FilterGroup = {
        conjunction: 'and',
        conditions: [
          { columnId: statusCol.id, operator: 'is', value: 'Working on it' },
          { columnId: numbersCol.id, operator: 'greater_than', value: 300 },
        ],
      };
      expect(matchesFilter(item1, group, null, null, allColumns)).toBe(true);
      expect(matchesFilter(item2, group, null, null, allColumns)).toBe(false);
    });

    it('evaluates advanced filter group with OR conjunction', () => {
      const group: FilterGroup = {
        conjunction: 'or',
        conditions: [
          { columnId: statusCol.id, operator: 'is', value: 'Done' },
          { columnId: numbersCol.id, operator: 'greater_than', value: 1000 },
        ],
      };
      // item1: status is Working (false), num is 500 (false) -> false
      expect(matchesFilter(item1, group, null, null, allColumns)).toBe(false);
      // item2: status is Done (true) -> true
      expect(matchesFilter(item2, group, null, null, allColumns)).toBe(true);
    });

    it('combines search query, person filter, and advanced filter group', () => {
      const group: FilterGroup = {
        conjunction: 'and',
        conditions: [{ columnId: numbersCol.id, operator: 'greater_than', value: 100 }],
      };

      // All match
      expect(matchesFilter(item1, group, 'design', ['user-avery'], allColumns)).toBe(true);

      // Person mismatch
      expect(matchesFilter(item1, group, 'design', ['user-sarah'], allColumns)).toBe(false);

      // Search query mismatch
      expect(matchesFilter(item1, group, 'backend', ['user-avery'], allColumns)).toBe(false);
    });
  });

  describe('sortItems', () => {
    const itemA = createTestItem({
      name: 'Alpha',
      values: {
        [numbersCol.id]: 100 as NumbersValue,
        [statusCol.id]: { index: 1 } as StatusValue, // Done
      },
    });

    const itemB = createTestItem({
      name: 'Beta',
      values: {
        [numbersCol.id]: 50 as NumbersValue,
        [statusCol.id]: { index: 0 } as StatusValue, // Working on it
      },
    });

    const itemC = createTestItem({
      name: 'Gamma',
      values: {
        [numbersCol.id]: 200 as NumbersValue,
        [statusCol.id]: { index: 0 } as StatusValue, // Working on it
      },
    });

    const itemEmpty = createTestItem({
      name: 'Empty',
      values: {},
    });

    it('sorts by item name ascending and descending', () => {
      const items = [itemC, itemA, itemB];
      const asc = sortItems(items, [{ columnId: 'name', direction: 'asc' }], allColumns);
      expect(asc.map((i) => i.name)).toEqual(['Alpha', 'Beta', 'Gamma']);

      const desc = sortItems(items, [{ columnId: 'name', direction: 'desc' }], allColumns);
      expect(desc.map((i) => i.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    });

    it('sorts by numeric column and keeps empty values at the end', () => {
      const items = [itemEmpty, itemA, itemC, itemB];
      const asc = sortItems(items, [{ columnId: numbersCol.id, direction: 'asc' }], allColumns);
      expect(asc.map((i) => i.name)).toEqual(['Beta', 'Alpha', 'Gamma', 'Empty']);

      const desc = sortItems(items, [{ columnId: numbersCol.id, direction: 'desc' }], allColumns);
      expect(desc.map((i) => i.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Empty']);
    });

    it('sorts and searches derived Item ID and Auto number columns by their computed value', () => {
      const idCol: ColumnDef = {
        id: 'id_1',
        type: 'item_id',
        title: 'ID',
        position: 'a8',
        settings: { displayType: 'id' },
      };
      const autoCol: ColumnDef = {
        id: 'auto_1',
        type: 'auto_number',
        title: 'No.',
        position: 'a9',
        settings: { scope: 'board', order: 'ascending' },
      };
      const cols = [idCol, autoCol];
      const n2 = createTestItem({ name: 'Two', seq: 2, boardSeq: 20 });
      const n10 = createTestItem({ name: 'Ten', seq: 10, boardSeq: 3 });
      const pending = createTestItem({ name: 'Pending' });
      const items = [pending, n10, n2];
      expect(
        sortItems(items, [{ columnId: idCol.id, direction: 'asc' }], cols).map((i) => i.name),
      ).toEqual(['Two', 'Ten', 'Pending']);
      expect(
        sortItems(items, [{ columnId: autoCol.id, direction: 'asc' }], cols).map((i) => i.name),
      ).toEqual(['Ten', 'Two', 'Pending']);
      expect(matchesFilter(n10, null, '10', null, cols)).toBe(true);
      expect(matchesFilter(n2, null, '10', null, cols)).toBe(false);
    });

    it('supports multi-level sorting', () => {
      const items = [itemA, itemC, itemB];
      // Primary: Status asc (Working on it index 0 first, then Done index 1)
      // Secondary: Numbers asc
      const conditions: SortCondition[] = [
        { columnId: statusCol.id, direction: 'asc' },
        { columnId: numbersCol.id, direction: 'asc' },
      ];
      const sorted = sortItems(items, conditions, allColumns);
      // itemB: status 0, num 50
      // itemC: status 0, num 200
      // itemA: status 1, num 100
      expect(sorted.map((i) => i.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    });

    it('tie-breaks on secondary sort keys when primary sort values are both empty', () => {
      const itemE1 = createTestItem({
        name: 'Echo 1',
        values: {
          [numbersCol.id]: 20 as NumbersValue,
        },
      });
      const itemE2 = createTestItem({
        name: 'Echo 2',
        values: {
          [numbersCol.id]: 10 as NumbersValue,
        },
      });
      // Both have empty statusCol.id
      // Primary: status asc (both empty)
      // Secondary: numbers asc (10 < 20)
      const conditions: SortCondition[] = [
        { columnId: statusCol.id, direction: 'asc' },
        { columnId: numbersCol.id, direction: 'asc' },
      ];
      const sorted = sortItems([itemE1, itemE2], conditions, allColumns);
      expect(sorted.map((i) => i.name)).toEqual(['Echo 2', 'Echo 1']);
    });
  });

  describe('groupItems', () => {
    const item1 = createTestItem({
      name: 'Item 1',
      groupId: 'group-default-1',
      values: {
        [statusCol.id]: { index: 0 } as StatusValue, // Working on it
        [checkCol.id]: { checked: 'true' } as CheckboxValue,
        [peopleCol.id]: { personsAndTeams: [{ id: 'user-avery', kind: 'person' }] } as PeopleValue,
      },
    });

    const item2 = createTestItem({
      name: 'Item 2',
      groupId: 'group-default-1',
      values: {
        [statusCol.id]: { index: 1 } as StatusValue, // Done
        [checkCol.id]: { checked: 'false' } as CheckboxValue,
        [peopleCol.id]: { personsAndTeams: [{ id: 'user-sarah', kind: 'person' }] } as PeopleValue,
      },
    });

    const item3 = createTestItem({
      name: 'Item 3',
      groupId: 'group-default-2',
      values: {
        [statusCol.id]: { index: 0 } as StatusValue, // Working on it
      },
    });

    it('clusters by natural groupId when groupByColumnId is null', () => {
      const items = [item1, item2, item3];
      const groups = groupItems(items, null);
      expect(groups.length).toBe(2);
      expect(groups[0]?.groupId).toBe('group-default-1');
      expect(groups[0]?.items.length).toBe(2);
      expect(groups[1]?.groupId).toBe('group-default-2');
      expect(groups[1]?.items.length).toBe(1);
    });

    it('clusters dynamically by status column', () => {
      const items = [item1, item2, item3];
      const groups = groupItems(items, statusCol.id, statusCol);

      const workingGroup = groups.find((g) => g.groupTitle === 'Working on it');
      const doneGroup = groups.find((g) => g.groupTitle === 'Done');

      expect(workingGroup?.items.map((i) => i.name)).toEqual(['Item 1', 'Item 3']);
      expect(doneGroup?.items.map((i) => i.name)).toEqual(['Item 2']);
    });

    it('clusters dynamically by checkbox column', () => {
      const items = [item1, item2, item3];
      const groups = groupItems(items, checkCol.id, checkCol);

      const done = groups.find((g) => g.groupTitle === 'Done');
      const notDone = groups.find((g) => g.groupTitle === 'Not Done');

      expect(done?.items.map((i) => i.name)).toEqual(['Item 1']);
      expect(notDone?.items.map((i) => i.name)).toEqual(['Item 2', 'Item 3']);
    });

    it('clusters dynamically by people column', () => {
      const items = [item1, item2, item3];
      const groups = groupItems(items, peopleCol.id, peopleCol);

      const averyGroup = groups.find((g) => g.groupTitle === 'user-avery');
      const sarahGroup = groups.find((g) => g.groupTitle === 'user-sarah');
      const unassigned = groups.find((g) => g.groupTitle === 'Unassigned');

      expect(averyGroup?.items.map((i) => i.name)).toEqual(['Item 1']);
      expect(sarahGroup?.items.map((i) => i.name)).toEqual(['Item 2']);
      expect(unassigned?.items.map((i) => i.name)).toEqual(['Item 3']);
    });

    it('clusters dynamically by people column with custom user lookup', () => {
      const items = [item1, item2, item3];
      const lookup = (uid: string) => (uid === 'user-avery' ? 'Avery Cat' : undefined);
      const groups = groupItems(items, peopleCol.id, peopleCol, undefined, lookup);

      const averyGroup = groups.find((g) => g.groupTitle === 'Avery Cat');
      expect(averyGroup?.items.map((i) => i.name)).toEqual(['Item 1']);
    });
  });
});
